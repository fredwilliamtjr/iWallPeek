'use strict';

const { execFile } = require('child_process');
const path = require('path');
const { invalid } = require('../core/safety');

// Windows: SystemParametersInfo(SPI_SETDESKWALLPAPER) via PowerShell, com estilo
// "Preencher". Vale para todos os monitores. O caminho vai por variável de
// ambiente — nunca concatenado no script.
const SCRIPT = `
$ErrorActionPreference = 'Stop'
$image = $env:IWALLPEEK_IMAGE
if (-not (Test-Path -LiteralPath $image -PathType Leaf)) { throw 'IWP:notfound' }
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class IWallPeekNative {
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool SystemParametersInfo(int action, int param, string value, int flags);
}
'@
$key = 'HKCU:\\Control Panel\\Desktop'
Set-ItemProperty -LiteralPath $key -Name WallpaperStyle -Value '10'
Set-ItemProperty -LiteralPath $key -Name TileWallpaper -Value '0'
# 20 = SPI_SETDESKWALLPAPER; 3 = SPIF_UPDATEINIFILE | SPIF_SENDCHANGE
if (-not [IWallPeekNative]::SystemParametersInfo(20, 0, $image, 3)) {
  throw ('IWP:spi:' + [Runtime.InteropServices.Marshal]::GetLastWin32Error())
}
Write-Output 'OK'
`;

function powershellPath() {
  const root = process.env.SystemRoot || 'C:\\Windows';
  return path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function setWallpaper(file) {
  return new Promise((resolve, reject) => {
    execFile(powershellPath(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT], {
      timeout: 60000,
      windowsHide: true,
      env: { ...process.env, IWALLPEEK_IMAGE: path.resolve(file) }
    }, (error, stdout, stderr) => {
      if (error || !/OK/.test(String(stdout))) {
        // Mensagens do PowerShell só em ASCII: o stderr vem na code page OEM.
        const match = /IWP:([a-z]+)(?::(\d+))?/.exec(`${stderr}\n${stdout}`);
        if (match?.[1] === 'notfound') reject(invalid('Imagem não encontrada.'));
        else if (match?.[1] === 'spi') reject(invalid(`O Windows recusou o plano de fundo (erro ${match[2]}).`));
        else reject(invalid('Não foi possível aplicar o plano de fundo no Windows.'));
        return;
      }
      resolve();
    });
  });
}

function createWindowsPlatform() {
  return {
    supportsSpaces: false,
    needsReapply: () => false,
    async apply(file) {
      await setWallpaper(file);
      return { status: 'Aplicado em todos os monitores.', fallback: false };
    },
    async reapply(file) {
      await setWallpaper(file);
    }
  };
}

module.exports = { createWindowsPlatform, setWallpaper };
