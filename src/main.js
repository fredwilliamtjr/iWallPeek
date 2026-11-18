'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, nativeImage, powerMonitor, screen } = require('electron');
const path = require('path');
const { Prefs } = require('./core/prefs');
const { WallpaperService, SOURCES, MARKETS } = require('./core/service');
const { ImageStore } = require('./core/store');
const { WallModel } = require('./core/model');
const { createPlatform, createLaunchAtLogin, systemName } = require('./platform');

const APP_NAME = 'iWallPeek';
const DAILY_CHECK_MS = 15 * 60 * 1000;
const SPACE_FALLBACK_MS = 60 * 1000;

// Pasta de dados fixa "iWallPeek" em todas as plataformas (no macOS é a mesma
// da versão Swift: ~/Library/Application Support/iWallPeek). IWALLPEEK_USER_DATA
// permite rodar testes isolados sem tocar nos dados reais.
app.setName(APP_NAME);
app.setPath('userData', process.env.IWALLPEEK_USER_DATA || path.join(app.getPath('appData'), APP_NAME));

let tray = null;
let mainWindow = null;
let model = null;
let prefs = null;
let launchAtLogin = null;
let isQuitting = false;
let platform = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(boot);
}

function systemLocale() {
  const preferred = (app.getPreferredSystemLanguages?.() || [])[0] || app.getSystemLocale?.() || app.getLocale() || 'pt-BR';
  const [languagePart, regionPart] = preferred.replace('_', '-').split('-');
  const language = /^[a-z]{2,3}$/i.test(languagePart || '') ? languagePart.toLowerCase() : 'pt';
  const regionRaw = app.getLocaleCountryCode?.() || regionPart || 'BR';
  const region = /^[a-z]{2}$/i.test(regionRaw) ? regionRaw.toUpperCase() : 'BR';
  return { language, region };
}

function decode(data) {
  const image = nativeImage.createFromBuffer(data);
  return image.isEmpty() ? null : image.getSize();
}

function thumbnail(data) {
  const image = nativeImage.createFromBuffer(data);
  if (image.isEmpty()) return null;
  const { width } = image.getSize();
  const resized = width > 1600 ? image.resize({ width: 1600, quality: 'good' }) : image;
  return `data:image/jpeg;base64,${resized.toJPEG(85).toString('base64')}`;
}

function boot() {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();

  const userData = app.getPath('userData');
  prefs = new Prefs(path.join(userData, 'preferences.json'));
  platform = createPlatform({ userData });
  launchAtLogin = createLaunchAtLogin(app);
  model = new WallModel({
    prefs,
    platform,
    decode,
    thumbnail,
    service: new WallpaperService({ systemLocale, decode, userAgent: `iWallPeek/${app.getVersion()}` }),
    store: new ImageStore(path.join(userData, 'Wallpapers'), { decode }),
    onChange: broadcast
  });

  createTray();

  powerMonitor.on('resume', () => model.refreshDaily());
  powerMonitor.on('unlock-screen', () => model.refreshDaily());
  screen.on('display-added', () => model.reapplyToActiveSpace());
  screen.on('display-metrics-changed', () => model.reapplyToActiveSpace());
  setInterval(() => model.refreshDaily(), DAILY_CHECK_MS);
  // Sem evento de troca de mesa no Electron: no modo alternativo do macOS
  // (sem configuração global), reaplica periodicamente na mesa ativa.
  setInterval(() => model.reapplyToActiveSpace(), SPACE_FALLBACK_MS);

  if (!prefs.bool('didShow.v2')) {
    showWindow();
    prefs.set('didShow.v2', true);
  }
  model.refreshDaily();
}

// ---------- bandeja ----------

function trayImage() {
  if (process.platform === 'darwin') {
    // Sufixo "Template": o macOS adapta a cor ao tema; @2x é carregado sozinho.
    return nativeImage.createFromPath(path.join(__dirname, 'assets', 'trayTemplate.png'));
  }
  const size = process.platform === 'linux' ? 24 : 16;
  return nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')).resize({ width: size, height: size });
}

function createTray() {
  tray = new Tray(trayImage());
  tray.setToolTip('iWallPeek — imagens diárias');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir iWallPeek…', click: () => showWindow() },
    { label: 'Atualizar imagem diária', click: () => model.refreshDaily({ force: true }) },
    { type: 'separator' },
    { label: 'Sair', accelerator: process.platform === 'darwin' ? 'Command+Q' : undefined, click: quit }
  ]));
  // Windows: clique esquerdo abre a janela; o direito mostra o menu.
  if (process.platform === 'win32') tray.on('click', () => showWindow());
}

function quit() {
  isQuitting = true;
  app.quit();
}

// ---------- janela ----------

function showWindow() {
  if (!model) return;
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    if (process.platform === 'darwin') app.focus({ steal: true });
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 900,
    minHeight: 680,
    title: APP_NAME,
    show: false,
    icon: process.platform === 'darwin' ? undefined : path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.removeMenu();
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (process.platform === 'darwin') app.focus({ steal: true });
  });
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------- estado e IPC ----------

function fullState() {
  return {
    ...model.snapshot(),
    app: {
      version: app.getVersion(),
      platform: process.platform,
      systemName: systemName(),
      supportsSpaces: platform.supportsSpaces,
      loginEnabled: safeLoginState(),
      markets: MARKETS
    }
  };
}

function safeLoginState() {
  try {
    return Boolean(launchAtLogin.isEnabled());
  } catch {
    return false;
  }
}

function broadcast() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('state:changed', fullState());
  }
}

const isSource = (value) => SOURCES.includes(value);

async function chooseFolder(title, buttonLabel) {
  const result = await dialog.showOpenDialog(mainWindow, {
    title,
    buttonLabel,
    properties: ['openDirectory', 'createDirectory']
  });
  return result.canceled ? null : result.filePaths[0] || null;
}

const handlers = {
  'state:get': () => fullState(),
  'source:set': (source) => isSource(source) && model.setSource(source),
  'region:set': (region) => {
    if (MARKETS.some(([code]) => code === region)) model.setRegion(region);
  },
  'allSpaces:set': (enabled) => model.setAllSpaces(Boolean(enabled)),
  'retention:set': (days) => model.setRetention(Number(days)),
  'auto:set': (source, enabled) => isSource(source) && model.setAuto(source, Boolean(enabled)),
  'folder:choose': async (source) => {
    if (!isSource(source)) return;
    const folder = await chooseFolder(`Pasta de autossalvamento — ${source === 'bing' ? 'Bing' : 'Windows Spotlight'}`, 'Escolher pasta');
    if (folder) model.setFolder(source, folder);
  },
  'folder:open': async (source) => {
    if (!isSource(source)) return;
    const folder = model.folder(source);
    if (!folder) {
      model.status = `Escolha a pasta de autossalvamento de ${source === 'bing' ? 'Bing' : 'Windows Spotlight'}.`;
      model.changed();
      return;
    }
    const error = await shell.openPath(folder);
    if (error) {
      model.status = `Não foi possível abrir a pasta: ${error}`;
      model.changed();
    }
  },
  'catalog:load': (source) => isSource(source) && model.loadCatalog(source),
  'catalog:select': (id) => typeof id === 'string' && model.select(id),
  'catalog:move': (offset) => (offset === 1 || offset === -1) && model.move(offset),
  'image:save': async () => {
    if (model.busy || !model.selected) return;
    const folder = await chooseFolder('Salvar imagem', 'Salvar nesta pasta');
    if (folder) await model.saveSelected(folder);
  },
  'image:apply': () => model.applySelected(),
  'daily:refresh': (options) => model.refreshDaily({
    force: Boolean(options?.force),
    exportOnly: isSource(options?.exportOnly) ? options.exportOnly : null
  }),
  'spaces:reapply': () => model.applyCurrentToSpaces(),
  'login:set': (enabled) => {
    try {
      launchAtLogin.set(Boolean(enabled));
    } catch (error) {
      model.status = `Início com o ${systemName()}: ${error.message}`;
    }
    model.changed();
  }
};

for (const [channel, handler] of Object.entries(handlers)) {
  ipcMain.handle(channel, async (_event, ...args) => {
    await handler(...args);
    return fullState();
  });
}

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', (event) => {
  event.preventDefault();
});

app.on('activate', () => showWindow());
