'use strict';

const { execFile } = require('child_process');
const { pathToFileURL } = require('url');
const path = require('path');
const { invalid, WallError } = require('../core/safety');

// Linux: cada ambiente gráfico guarda o fundo num lugar. Ubuntu (GNOME) é o
// principal; KDE Plasma, XFCE, Cinnamon, MATE e LXQt/LXDE também são cobertos.
// Tudo com execFile (sem shell) e o caminho como argumento.

function run(command, args, { timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = String(stderr || '');
        reject(error);
      } else {
        resolve(String(stdout || ''));
      }
    });
  });
}

function desktopNames(env = process.env) {
  const raw = [env.XDG_CURRENT_DESKTOP, env.XDG_SESSION_DESKTOP, env.DESKTOP_SESSION].filter(Boolean).join(':');
  return raw.toLowerCase().split(/[:;]/).map((name) => name.trim()).filter(Boolean);
}

function detectDesktop(env = process.env) {
  const names = desktopNames(env);
  const has = (...candidates) => candidates.some((candidate) => names.some((name) => name.includes(candidate)));
  if (has('kde', 'plasma')) return 'kde';
  if (has('xfce')) return 'xfce';
  if (has('cinnamon')) return 'cinnamon';
  if (has('mate')) return 'mate';
  if (has('lxqt')) return 'lxqt';
  if (has('lxde')) return 'lxde';
  if (has('gnome', 'ubuntu', 'unity', 'budgie', 'pantheon', 'pop', 'cosmic', 'zorin', 'deepin')) return 'gnome';
  return names.length ? 'unknown' : 'gnome';
}

const DESKTOP_LABELS = {
  gnome: 'GNOME/Ubuntu', kde: 'KDE Plasma', xfce: 'XFCE', cinnamon: 'Cinnamon',
  mate: 'MATE', lxqt: 'LXQt', lxde: 'LXDE', unknown: 'ambiente gráfico'
};

async function gsettingsHasKey(schema, key) {
  try {
    return (await run('gsettings', ['list-keys', schema])).split(/\s+/).includes(key);
  } catch {
    return false;
  }
}

async function applyGnome(file) {
  const uri = pathToFileURL(file).href;
  const schema = 'org.gnome.desktop.background';
  await run('gsettings', ['set', schema, 'picture-options', 'zoom']);
  await run('gsettings', ['set', schema, 'picture-uri', uri]);
  // GNOME 42+ (Ubuntu 22.04+) tem uma imagem separada para o tema escuro.
  if (await gsettingsHasKey(schema, 'picture-uri-dark')) {
    await run('gsettings', ['set', schema, 'picture-uri-dark', uri]);
  }
}

async function applyCinnamon(file) {
  const schema = 'org.cinnamon.desktop.background';
  await run('gsettings', ['set', schema, 'picture-options', 'zoom']);
  await run('gsettings', ['set', schema, 'picture-uri', pathToFileURL(file).href]);
}

async function applyMate(file) {
  await run('gsettings', ['set', 'org.mate.background', 'picture-options', 'zoom']);
  await run('gsettings', ['set', 'org.mate.background', 'picture-filename', file]);
}

async function applyKde(file) {
  try {
    // Plasma 5.24+ / 6: aplica em todas as telas e atividades.
    await run('plasma-apply-wallpaperimage', [file], { timeout: 30000 });
    return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const script = [
    'var all = desktops();',
    'for (var i = 0; i < all.length; i++) {',
    '  var d = all[i];',
    '  d.wallpaperPlugin = "org.kde.image";',
    '  d.currentConfigGroup = ["Wallpaper", "org.kde.image", "General"];',
    `  d.writeConfig("Image", ${JSON.stringify(pathToFileURL(file).href)});`,
    '}'
  ].join('\n');
  await run('dbus-send', ['--session', '--type=method_call', '--dest=org.kde.plasmashell',
    '/PlasmaShell', 'org.kde.PlasmaShell.evaluateScript', `string:${script}`]);
}

async function applyXfce(file) {
  const properties = (await run('xfconf-query', ['-c', 'xfce4-desktop', '-l']))
    .split('\n').map((line) => line.trim()).filter((line) => /\/last-image$/.test(line));
  if (!properties.length) throw invalid('XFCE sem monitores configurados.');
  for (const property of properties) {
    await run('xfconf-query', ['-c', 'xfce4-desktop', '-p', property, '-s', file]);
    await run('xfconf-query', ['-c', 'xfce4-desktop', '-p', property.replace(/last-image$/, 'image-style'), '-s', '5']).catch(() => {});
  }
}

async function applyPcmanfm(binary, file) {
  await run(binary, ['--set-wallpaper', file, '--wallpaper-mode', 'crop']);
}

async function applyFallback(file) {
  for (const attempt of [
    () => applyGnome(file),
    () => run('feh', ['--bg-fill', file])
  ]) {
    try {
      await attempt();
      return;
    } catch {
      // tenta o próximo
    }
  }
  throw invalid('Ambiente gráfico não suportado para trocar o plano de fundo.');
}

const APPLIERS = {
  gnome: applyGnome,
  cinnamon: applyCinnamon,
  mate: applyMate,
  kde: applyKde,
  xfce: applyXfce,
  lxqt: (file) => applyPcmanfm('pcmanfm-qt', file),
  lxde: (file) => applyPcmanfm('pcmanfm', file),
  unknown: applyFallback
};

async function setWallpaper(file, env = process.env) {
  const desktop = detectDesktop(env);
  const absolute = path.resolve(file);
  try {
    await APPLIERS[desktop](absolute);
  } catch (error) {
    if (error instanceof WallError) throw error;
    const reason = error.code === 'ENOENT' ? 'ferramenta do ambiente gráfico não encontrada' : (error.stderr || error.message || '').trim();
    throw invalid(`Não foi possível aplicar o plano de fundo no ${DESKTOP_LABELS[desktop]}${reason ? ` (${reason})` : ''}.`);
  }
  return desktop;
}

function createLinuxPlatform() {
  return {
    supportsSpaces: false,
    needsReapply: () => false,
    async apply(file) {
      const desktop = await setWallpaper(file);
      return { status: `Aplicado em todos os monitores e áreas de trabalho (${DESKTOP_LABELS[desktop]}).`, fallback: false };
    },
    async reapply(file) {
      await setWallpaper(file);
    }
  };
}

module.exports = { createLinuxPlatform, setWallpaper, detectDesktop, DESKTOP_LABELS };
