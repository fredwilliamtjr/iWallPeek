'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { validateImage, imageExtension, invalid, MAX_IMAGE_BYTES } = require('./safety');

// Porta de ImageStore e Exporter (WallpaperService.swift / Library.swift).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CACHE_BUDGET = 500 * 1024 * 1024;

function isSymlink(target) {
  try { return fs.lstatSync(target).isSymbolicLink(); } catch { return false; }
}

class ImageStore {
  constructor(root, { decode } = {}) {
    this.root = path.resolve(root);
    this.decode = decode;
  }

  checkDirectory() {
    // Nem a pasta do cache nem a pasta do app podem ser links simbólicos.
    if (isSymlink(this.root) || isSymlink(path.dirname(this.root))) {
      throw invalid('A pasta de imagens não pode ser um link simbólico.');
    }
    fs.mkdirSync(this.root, { recursive: true });
    if (!fs.lstatSync(this.root).isDirectory()) throw invalid('A pasta de imagens é inválida.');
  }

  save(data) {
    validateImage(data, this.decode);
    this.checkDirectory();
    // Nem o nome nem a extensão vêm de metadados externos.
    const file = path.join(this.root, `${crypto.randomUUID()}.${imageExtension(data)}`);
    fs.writeFileSync(file, data, { flag: 'wx' });
    return file;
  }

  static isCacheName(name) {
    if (typeof name !== 'string' || name !== path.basename(name)) return false;
    const ext = path.extname(name).slice(1);
    return ['jpg', 'png'].includes(ext) && UUID_RE.test(path.basename(name, `.${ext}`));
  }

  // Devolve o caminho se o nome for um arquivo de cache legítimo; senão null.
  validFile(name) {
    if (!ImageStore.isCacheName(name)) return null;
    const file = path.join(this.root, name);
    try {
      const stats = fs.lstatSync(file);
      if (!stats.isFile() || stats.size > MAX_IMAGE_BYTES) return null;
    } catch {
      return null;
    }
    return file;
  }

  prune(keeping, days, additionally = []) {
    this.checkDirectory();
    const keep = new Set([keeping, ...additionally].filter(Boolean).map((file) => path.resolve(file)));
    const cutoff = Date.now() - days * 86400 * 1000;
    const entries = [];
    // Só arquivos regulares com nome UUID criados pelo app; o resto é ignorado.
    for (const name of fs.readdirSync(this.root)) {
      if (!ImageStore.isCacheName(name)) continue;
      const file = path.join(this.root, name);
      const stats = fs.lstatSync(file);
      if (!stats.isFile()) continue;
      entries.push({ file, mtime: stats.mtimeMs, size: stats.size });
    }
    let total = entries.reduce((sum, entry) => sum + entry.size, 0);
    for (const entry of entries.sort((a, b) => a.mtime - b.mtime)) {
      if (keep.has(entry.file)) continue;
      if (entry.mtime < cutoff || total > CACHE_BUDGET) {
        fs.rmSync(entry.file);
        total -= entry.size;
      }
    }
  }
}

function exportImage(data, image, folder, decode) {
  validateImage(data, decode);
  let stats;
  try { stats = fs.statSync(folder); } catch { stats = null; }
  if (!stats || !stats.isDirectory()) throw invalid('Selecione uma pasta válida para salvar as imagens.');

  const ext = imageExtension(data);
  const dayDigits = String(image.date || '').replace(/[^0-9]/g, '').slice(0, 8);
  const name = `iWallPeek-${image.source === 'spotlight' ? 'spotlight' : 'bing'}-${dayDigits}-${String(image.id).slice(0, 16)}.${ext}`;
  const destination = path.join(folder, name);

  let existing = null;
  try { existing = fs.lstatSync(destination); } catch { existing = null; }
  if (existing) {
    // Arquivo idêntico: nada a fazer. Qualquer outra coisa (inclusive link) é preservada.
    if (!existing.isFile() || existing.size !== data.length || !fs.readFileSync(destination).equals(data)) {
      throw invalid('Já existe um arquivo diferente com esse nome. Nenhum arquivo foi substituído.');
    }
    return destination;
  }
  fs.writeFileSync(destination, data, { flag: 'wx' });
  return destination;
}

module.exports = { ImageStore, exportImage, CACHE_BUDGET };
