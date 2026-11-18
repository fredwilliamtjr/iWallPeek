'use strict';

const crypto = require('crypto');
const { safeGet } = require('./http');
const { validateURL, validateImage, invalid, MAX_IMAGE_BYTES, MAX_METADATA_BYTES } = require('./safety');

// Porta de WallpaperService.swift.

const SOURCES = ['bing', 'spotlight'];
const SOURCE_TITLES = { bing: 'Bing', spotlight: 'Windows Spotlight' };

const MARKETS = [
  ['auto', 'Região atual do sistema'], ['pt-BR', 'Brasil'], ['en-US', 'Estados Unidos'],
  ['en-GB', 'Reino Unido'], ['en-CA', 'Canadá (inglês)'], ['fr-CA', 'Canadá (francês)'],
  ['de-DE', 'Alemanha'], ['fr-FR', 'França'], ['it-IT', 'Itália'], ['es-ES', 'Espanha'],
  ['ja-JP', 'Japão'], ['zh-CN', 'China'], ['en-IN', 'Índia'], ['en-AU', 'Austrália']
];

function imageId(source, market, url) {
  return crypto.createHash('sha256').update(source + market + url).digest('hex');
}

function makeImage({ url, title, date, source, market }) {
  return { id: imageId(source, market, url), url, title, date, source, market };
}

function day(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

function isoSeconds(now = new Date()) {
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

class WallpaperService {
  // systemLocale: () => { language: 'pt', region: 'BR' }
  constructor({ systemLocale, fetchImpl, decode, userAgent = 'iWallPeek' } = {}) {
    this.systemLocale = systemLocale || (() => ({ language: 'pt', region: 'BR' }));
    this.fetchImpl = fetchImpl;
    this.decode = decode;
    this.userAgent = userAgent;
  }

  market(selection) {
    if (selection !== 'auto' && MARKETS.some(([code]) => code === selection)) return selection;
    const { language, region } = this.systemLocale();
    return `${language || 'pt'}-${region || 'BR'}`;
  }

  get(url, limit) {
    return safeGet(url, limit, { fetchImpl: this.fetchImpl, userAgent: this.userAgent });
  }

  async fetch(source, region = 'auto') {
    const [image] = await this.catalog(source, region, false);
    if (!image) throw invalid('Nenhuma imagem disponível.');
    return image;
  }

  async catalog(source, region, history) {
    const locale = this.market(source === 'bing' ? region : 'auto');
    let endpoint;
    if (source === 'bing') {
      endpoint = new URL('https://www.bing.com/HPImageArchive.aspx');
      endpoint.search = new URLSearchParams({ format: 'js', idx: '0', n: history ? '8' : '1', mkt: locale }).toString();
    } else {
      const country = this.systemLocale().region || 'BR';
      const values = {
        pid: '338387', fmt: 'json', rafb: '0', ua: 'WindowsShellClient/0', cdm: '1',
        disphorzres: '9999', dispvertres: '9999', lo: '80217', pl: locale, lc: locale,
        ctry: country, time: isoSeconds()
      };
      endpoint = new URL('https://arc.msn.com/v3/Delivery/Placement');
      endpoint.search = new URLSearchParams(Object.keys(values).sort().map((key) => [key, values[key]])).toString();
    }

    const data = await this.get(endpoint, MAX_METADATA_BYTES);
    let feed;
    try {
      feed = JSON.parse(data.toString('utf8'));
    } catch {
      throw invalid('O serviço retornou dados inválidos.');
    }

    return source === 'bing' ? this.parseBing(feed, locale) : this.parseSpotlight(feed, locale);
  }

  parseBing(feed, locale) {
    const items = Array.isArray(feed?.images) ? feed.images : [];
    // Itens inválidos não escondem o restante do histórico válido.
    const images = items.map((item) => {
      if (typeof item?.urlbase !== 'string' || !item.urlbase.startsWith('/th?') || typeof item.startdate !== 'string') return null;
      const url = `https://www.bing.com${item.urlbase}_UHD.jpg`;
      try { validateURL(url); } catch { return null; }
      const title = [item.title, item.copyright].filter((part) => typeof part === 'string' && part).join(' — ');
      return makeImage({ url, title: title || 'Imagem do Bing', date: item.startdate, source: 'bing', market: locale });
    }).filter(Boolean);
    if (!images.length) throw invalid('Bing não retornou imagens válidas.');
    return images;
  }

  parseSpotlight(feed, locale) {
    const items = Array.isArray(feed?.batchrsp?.items) ? feed.batchrsp.items : [];
    const images = [];
    for (const entry of items) {
      let ad;
      try { ad = JSON.parse(entry?.item)?.ad; } catch { continue; }
      const asset = ad?.image_fullscreen_001_landscape;
      if (!asset || asset.t !== 'img' || typeof asset.u !== 'string') continue;
      try { validateURL(asset.u); } catch { continue; }
      const title = typeof ad?.hs1_title_text?.tx === 'string' ? ad.hs1_title_text.tx : 'Imagem do Windows Spotlight';
      images.push(makeImage({ url: asset.u, title, date: day(), source: 'spotlight', market: locale }));
    }
    if (!images.length) throw invalid('Spotlight não retornou imagens válidas.');
    return images;
  }

  async download(image) {
    const data = await this.get(image.url, MAX_IMAGE_BYTES);
    validateImage(data, this.decode);
    return data;
  }
}

module.exports = { WallpaperService, SOURCES, SOURCE_TITLES, MARKETS, day, imageId, makeImage };
