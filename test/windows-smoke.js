'use strict';

// Teste real no Windows (usado no CI): aplica uma imagem e confere o registro.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { setWallpaper } = require('../src/platform/windows');

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, 0x40)]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iwallpeek pasta com espaço '));
  const file = path.join(dir, 'fundo de teste.png');
  fs.writeFileSync(file, png(64));
  await setWallpaper(file);
  const query = execFileSync('reg', ['query', 'HKCU\\Control Panel\\Desktop', '/v', 'Wallpaper']).toString();
  const style = execFileSync('reg', ['query', 'HKCU\\Control Panel\\Desktop', '/v', 'WallpaperStyle']).toString();
  console.log(query.trim());
  console.log(style.trim());
  // O Windows pode registrar o próprio caminho ou a cópia TranscodedWallpaper.
  if (!query.includes(file) && !/TranscodedWallpaper/i.test(query)) throw new Error('Wallpaper não registrado');
  if (!/\b10\b/.test(style)) throw new Error('Estilo "Preencher" não registrado');
  await setWallpaper(path.join(dir, 'nao-existe.png')).then(
    () => { throw new Error('Aceitou arquivo inexistente'); },
    (error) => console.log(`Inexistente recusado: ${error.message}`)
  );
  console.log('PASS: plano de fundo aplicado no Windows');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
