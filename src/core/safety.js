'use strict';

// Regras de segurança de rede e de imagens (porta de Security.swift).

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_METADATA_BYTES = 2 * 1024 * 1024;
const MAX_DIMENSION = 16384;
const MAX_PIXELS = 50000000;
const ALLOWED_DOMAINS = ['bing.com', 'msn.com', 'microsoft.com', 'msn.net'];
const ALLOWED_HOSTS = ['res.public.onecdn.static.microsoft'];

class WallError extends Error {}

function invalid(message) {
  return new WallError(message);
}

function validateURL(address) {
  let url;
  try {
    url = address instanceof URL ? address : new URL(String(address));
  } catch {
    throw invalid('Endereço de imagem não autorizado.');
  }
  const host = url.hostname.toLowerCase();
  const allowedHost = ALLOWED_HOSTS.includes(host)
    || ALLOWED_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  if (url.protocol !== 'https:' || url.username || url.password
    || (url.port && url.port !== '443') || !allowedHost) {
    throw invalid('Endereço de imagem não autorizado.');
  }
  return url;
}

function isPNG(data) {
  return data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47
    && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a;
}

function isJPEG(data) {
  return data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
}

// Lê tipo e dimensões do cabeçalho sem decodificar a imagem.
function probeImage(data) {
  if (isPNG(data)) {
    if (data.length < 33 || data.toString('latin1', 12, 16) !== 'IHDR') return null;
    // APNG (mais de um quadro) é rejeitado, como o CGImageSourceGetCount == 1 do Swift.
    let offset = 8;
    while (offset + 8 <= data.length) {
      const length = data.readUInt32BE(offset);
      const type = data.toString('latin1', offset + 4, offset + 8);
      if (type === 'acTL') return null;
      if (type === 'IDAT' || type === 'IEND') break;
      offset += 12 + length;
    }
    return { type: 'png', width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (isJPEG(data)) {
    let offset = 2;
    while (offset + 4 <= data.length) {
      if (data[offset] !== 0xff) return null;
      const marker = data[offset + 1];
      if (marker === 0xff) { offset += 1; continue; }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { offset += 2; continue; }
      if (marker === 0xd9 || marker === 0xda) return null;
      const length = data.readUInt16BE(offset + 2);
      const isSOF = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isSOF) {
        if (offset + 9 > data.length) return null;
        return { type: 'jpeg', height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
  }
  return null;
}

// decode (opcional): função que decodifica de verdade e devolve {width,height} ou null.
// No app é o nativeImage do Electron; nos testes pode ser omitida.
function validateImage(data, decode) {
  const fail = () => invalid('Arquivo recebido não é uma imagem JPEG/PNG válida ou excede os limites.');
  if (!Buffer.isBuffer(data) || data.length === 0 || data.length > MAX_IMAGE_BYTES) throw fail();
  const info = probeImage(data);
  if (!info) throw fail();
  const { width, height } = info;
  if (!(width > 0 && height > 0 && width <= MAX_DIMENSION && height <= MAX_DIMENSION && width * height <= MAX_PIXELS)) {
    throw fail();
  }
  if (decode) {
    const decoded = decode(data);
    if (!decoded || decoded.width !== width || decoded.height !== height) throw fail();
  }
  return info;
}

function imageExtension(data) {
  return isPNG(data) ? 'png' : 'jpg';
}

module.exports = {
  MAX_IMAGE_BYTES,
  MAX_METADATA_BYTES,
  WallError,
  invalid,
  validateURL,
  validateImage,
  probeImage,
  imageExtension
};
