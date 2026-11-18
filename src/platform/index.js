'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function createPlatform({ userData }) {
  // Modo simulação para testes de interface: não altera o plano de fundo.
  if (process.env.IWALLPEEK_DRY_RUN === '1') {
    const supportsSpaces = process.platform === 'darwin';
    return {
      supportsSpaces,
      needsReapply: () => false,
      async apply(file) {
        console.log(`[iWallPeek] simulação: aplicaria ${file}`);
        return { status: 'Simulação: nenhum plano de fundo foi alterado.', fallback: false };
      },
      async reapply() {}
    };
  }
  if (process.platform === 'darwin') {
    const { createMacPlatform, backupDirFor } = require('./macos');
    return createMacPlatform({ backupDir: backupDirFor(userData) });
  }
  if (process.platform === 'win32') {
    return require('./windows').createWindowsPlatform();
  }
  return require('./linux').createLinuxPlatform();
}

// ---------- iniciar com o sistema ----------
// macOS/Windows: API do Electron. Linux: arquivo .desktop em ~/.config/autostart
// (padrão freedesktop, vale para GNOME, KDE, XFCE, Cinnamon...).

function linuxAutostartFile(env = process.env) {
  const configHome = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(configHome, 'autostart', 'iwallpeek.desktop');
}

function desktopExecQuote(value) {
  // Escapes da especificação Desktop Entry para argumentos entre aspas.
  return `"${value.replace(/(["`$\\])/g, '\\$1').replace(/%/g, '%%')}"`;
}

function createLaunchAtLogin(app) {
  if (process.platform !== 'linux') {
    return {
      isEnabled: () => app.getLoginItemSettings().openAtLogin,
      set: (enabled) => app.setLoginItemSettings({ openAtLogin: Boolean(enabled), openAsHidden: true })
    };
  }
  return {
    isEnabled: () => fs.existsSync(linuxAutostartFile()),
    set(enabled) {
      const file = linuxAutostartFile();
      if (!enabled) {
        fs.rmSync(file, { force: true });
        return;
      }
      // AppImage: process.execPath é o ponto de montagem temporário; o caminho
      // estável do arquivo vem na variável APPIMAGE.
      const executable = process.env.APPIMAGE || process.execPath;
      const entry = [
        '[Desktop Entry]',
        'Type=Application',
        'Name=iWallPeek',
        'Comment=Imagens diárias do Bing e do Windows Spotlight',
        `Exec=${desktopExecQuote(executable)}`,
        'Terminal=false',
        'X-GNOME-Autostart-enabled=true',
        ''
      ].join('\n');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, entry, 'utf8');
    }
  };
}

function systemName() {
  if (process.platform === 'darwin') return 'macOS';
  if (process.platform === 'win32') return 'Windows';
  return 'Linux';
}

module.exports = { createPlatform, createLaunchAtLogin, linuxAutostartFile, systemName };
