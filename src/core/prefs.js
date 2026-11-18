'use strict';

const fs = require('fs');
const path = require('path');

// Substitui o UserDefaults do Swift: chave/valor num JSON com gravação atômica.
class Prefs {
  constructor(file) {
    this.file = file;
    this.values = {};
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) this.values = parsed;
    } catch {
      this.values = {};
    }
  }

  has(key) {
    return Object.prototype.hasOwnProperty.call(this.values, key);
  }

  get(key, fallback = undefined) {
    return this.has(key) ? this.values[key] : fallback;
  }

  string(key, fallback = null) {
    const value = this.get(key);
    return typeof value === 'string' ? value : fallback;
  }

  bool(key, fallback = false) {
    const value = this.get(key);
    return typeof value === 'boolean' ? value : fallback;
  }

  set(key, value) {
    this.values[key] = value;
    this.flush();
  }

  flush() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, `${JSON.stringify(this.values, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Prefs };
