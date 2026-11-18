'use strict';

const { execFile } = require('child_process');
const os = require('os');
const path = require('path');
const { invalid } = require('../core/safety');

// macOS: o mesmo caminho do Swift, via JXA (osascript -l JavaScript) com a
// ponte ObjC — NSWorkspace por monitor e, no macOS 14+, a configuração global
// do WallpaperAgent (Index.plist). Abordagem do plist derivada de
// treschar/wallall (MIT); ver THIRD_PARTY_LICENSES.

const JXA = String.raw`
ObjC.import('Foundation');
ObjC.import('AppKit');

function fail(message) { throw new Error('IWP:' + message); }

function readPlist(data) {
  // 2 = NSPropertyListMutableContainersAndLeaves
  var root = $.NSPropertyListSerialization.propertyListWithDataOptionsFormatError(data, 2, null, null);
  if (!root || root.isNil()) fail('Estrutura de wallpaper do macOS não reconhecida.');
  return root;
}

function isDict(value) { return value && !value.isNil() && value.isKindOfClass($.NSDictionary); }
function isNullString(value) {
  return value && !value.isNil() && value.isKindOfClass($.NSString) && ObjC.unwrap(value) === '$null';
}

function binary(object) {
  // 200 = NSPropertyListBinaryFormat_v1_0
  var data = $.NSPropertyListSerialization.dataWithPropertyListFormatOptionsError(object, 200, 0, null);
  if (!data || data.isNil()) fail('Não foi possível gerar a configuração de wallpaper.');
  return data;
}

// Transformação pura: preserva Spaces, Displays, Idle e campos alheios.
function transform(original, imagePath) {
  var root = readPlist(original);
  if (!isDict(root) || !isDict(root.objectForKey('Spaces')) || !isDict(root.objectForKey('Displays'))) {
    fail('Estrutura de wallpaper do macOS não reconhecida.');
  }
  var all = root.objectForKey('AllSpacesAndDisplays');
  if (!isDict(all) && !isNullString(all)) fail('Estrutura de wallpaper do macOS não reconhecida.');

  var url = $.NSURL.fileURLWithPath(imagePath);
  var relative = $.NSMutableDictionary.alloc.init;
  relative.setObjectForKey(url.absoluteString, 'relative');
  var configuration = $.NSMutableDictionary.alloc.init;
  configuration.setObjectForKey($('imageFile'), 'type');
  configuration.setObjectForKey(relative, 'url');

  var choice = $.NSMutableDictionary.alloc.init;
  choice.setObjectForKey(binary(configuration), 'Configuration');
  choice.setObjectForKey($.NSArray.array, 'Files');
  choice.setObjectForKey($('com.apple.wallpaper.choice.image'), 'Provider');

  var content = $.NSMutableDictionary.alloc.init;
  content.setObjectForKey($.NSArray.arrayWithObject(choice), 'Choices');
  content.setObjectForKey($('$null'), 'EncodedOptionValues');
  content.setObjectForKey($('$null'), 'Shuffle');

  var now = $.NSDate.date;
  var desktop = $.NSMutableDictionary.alloc.init;
  desktop.setObjectForKey(content, 'Content');
  desktop.setObjectForKey(now, 'LastSet');
  desktop.setObjectForKey(now, 'LastUse');

  var global = isDict(all) ? all.mutableCopy : $.NSMutableDictionary.alloc.init;
  global.setObjectForKey(desktop, 'Desktop');
  global.setObjectForKey($('desktop'), 'Type');
  root.setObjectForKey(global, 'AllSpacesAndDisplays');
  return binary(root);
}

function isSymlinkOrMissing(fm, file) {
  var attributes = fm.attributesOfItemAtPathError(file, null);
  if (!attributes || attributes.isNil()) return { missing: true };
  return { symlink: ObjC.unwrap(attributes.objectForKey('NSFileType')) === 'NSFileTypeSymbolicLink', attributes: attributes };
}

function writeGlobal(imagePath, backupDir) {
  var fm = $.NSFileManager.defaultManager;
  var file = ObjC.unwrap($.NSHomeDirectory()) + '/Library/Application Support/com.apple.wallpaper/Store/Index.plist';
  var info = isSymlinkOrMissing(fm, file);
  if (info.missing || info.symlink
    || ObjC.unwrap(info.attributes.objectForKey('NSFileType')) !== 'NSFileTypeRegular'
    || ObjC.unwrap(info.attributes.objectForKey('NSFileSize')) >= 10 * 1024 * 1024) {
    fail('Armazenamento de wallpaper indisponível ou inseguro.');
  }
  var permissions = info.attributes.objectForKey('NSFilePosixPermissions');
  var original = $.NSData.dataWithContentsOfFile(file);
  if (!original || original.isNil()) fail('Armazenamento de wallpaper indisponível ou inseguro.');
  var updated = transform(original, imagePath);

  var backupInfo = isSymlinkOrMissing(fm, backupDir);
  if (backupInfo.symlink) fail('Pasta de backup não pode ser link simbólico.');
  fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(backupDir, true, $(), null);
  var backup = backupDir + '/' + ObjC.unwrap($.NSUUID.UUID.UUIDString) + '.plist';
  // 2 = NSDataWritingWithoutOverwriting
  if (!original.writeToFileOptionsError(backup, 2, null)) fail('Não foi possível gravar o backup do wallpaper.');

  // Recusa sobrescrever uma mudança concorrente do Ajustes do Sistema/outro app.
  if (!$.NSData.dataWithContentsOfFile(file).isEqualToData(original)) {
    fail('O wallpaper mudou durante a operação. Tente novamente.');
  }
  // 1 = NSDataWritingAtomic
  if (!updated.writeToFileOptionsError(file, 1, null)) fail('Não foi possível gravar a configuração de wallpaper.');
  if (permissions && !permissions.isNil()) {
    var attrs = $.NSMutableDictionary.alloc.init;
    attrs.setObjectForKey(permissions, 'NSFilePosixPermissions');
    fm.setAttributesOfItemAtPathError(attrs, file, null);
  }
  if (!$.NSData.dataWithContentsOfFile(file).isEqualToData(updated)) {
    fail('Não foi possível confirmar a gravação para todas as mesas.');
  }
  return { backup: backup };
}

function applyScreens(imagePath) {
  var url = $.NSURL.fileURLWithPath(imagePath);
  var screens = $.NSScreen.screens;
  var count = screens.count;
  var failures = 0;
  for (var i = 0; i < count; i++) {
    var ok = $.NSWorkspace.sharedWorkspace.setDesktopImageURLForScreenOptionsError(url, screens.objectAtIndex(i), $.NSDictionary.dictionary, null);
    if (!ok) failures++;
  }
  return { screens: count, failures: failures };
}

function run(argv) {
  var mode = argv[0];
  var out;
  if (mode === 'screens') out = applyScreens(argv[1]);
  else if (mode === 'global') out = writeGlobal(argv[1], argv[2]);
  else if (mode === 'transform') {
    var data = $.NSData.dataWithContentsOfFile(argv[1]);
    if (!data || data.isNil()) fail('Fixture ausente.');
    if (!transform(data, argv[3]).writeToFileAtomically(argv[2], true)) fail('Falha ao gravar fixture.');
    out = { ok: true };
  } else fail('Modo inválido.');
  return JSON.stringify(out);
}
`;

function runJXA(args) {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', JXA, ...args], { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        const match = /IWP:(.*?)(?:\s*\(-\d+\))?\s*$/m.exec(String(stderr));
        reject(invalid(match ? match[1].trim() : 'O macOS recusou a alteração do plano de fundo.'));
        return;
      }
      try {
        resolve(JSON.parse(String(stdout).trim()));
      } catch {
        reject(invalid('Resposta inesperada do macOS.'));
      }
    });
  });
}

function macMajor() {
  // Darwin 23 = macOS 14 (Sonoma); Darwin 22 = macOS 13.
  const darwin = Number(os.release().split('.')[0]);
  return Number.isFinite(darwin) ? darwin - 9 : 0;
}

function killWallpaperAgent() {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/killall', ['-u', os.userInfo().username, 'WallpaperAgent'], { timeout: 10000 }, (error) => {
      if (error) reject(invalid('Configuração salva; WallpaperAgent não confirmou o recarregamento.'));
      else resolve();
    });
  });
}

function createMacPlatform({ backupDir }) {
  async function applyScreens(file) {
    const result = await runJXA(['screens', file]);
    if (!result.screens) throw invalid('Nenhum monitor disponível.');
    if (result.failures >= result.screens) throw invalid('Não foi possível aplicar a imagem nos monitores.');
    return result.failures > 0 ? 'A imagem não foi aplicada em alguns monitores.' : null;
  }

  return {
    supportsSpaces: true,
    needsReapply: () => macMajor() < 14,
    async apply(file, { allSpaces }) {
      let warning = null;
      if (allSpaces && macMajor() >= 14) {
        try {
          await runJXA(['global', file, backupDir]);
          await killWallpaperAgent();
          return { status: 'Configuração global gravada para todas as mesas.', fallback: false };
        } catch (error) {
          warning = `Todas as mesas: ${error.message} A imagem será reaplicada periodicamente na mesa ativa.`;
        }
      } else if (allSpaces) {
        warning = 'Neste macOS, a imagem será reaplicada periodicamente na mesa ativa.';
      }
      const screenWarning = await applyScreens(file);
      return {
        status: warning || screenWarning || (allSpaces ? 'Configuração global gravada para todas as mesas.' : 'Aplicado nas mesas ativas.'),
        fallback: Boolean(warning)
      };
    },
    async reapply(file) {
      await applyScreens(file);
    }
  };
}

module.exports = { createMacPlatform, runJXA, macMajor, backupDirFor: (userData) => path.join(userData, 'WallpaperBackups') };
