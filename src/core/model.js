'use strict';

const fs = require('fs');
const path = require('path');
const { SOURCES, SOURCE_TITLES, day } = require('./service');
const { exportImage } = require('./store');
const { validateImage, invalid } = require('./safety');

// Porta de WallModel (Library.swift). Sem Electron: tudo que é de plataforma
// chega por injeção (aplicar fundo, miniatura, decodificador).

const NO_FOLDER = 'Nenhuma pasta selecionada';
const errorText = (error) => (error && error.message) || String(error);

class WallModel {
  constructor({ prefs, service, store, platform, thumbnail, decode, onChange }) {
    this.prefs = prefs;
    this.service = service;
    this.store = store;
    this.platform = platform; // { apply(file,{allSpaces}) -> {status,fallback}, reapply(file), supportsSpaces, needsReapply() }
    this.thumbnail = thumbnail || (() => null);
    this.decode = decode;
    this.onChange = onChange || (() => {});

    this.source = SOURCES.includes(prefs.string('source')) ? prefs.string('source') : 'bing';
    this.region = prefs.string('bingRegion', 'auto');
    this.allSpaces = prefs.has('allSpaces') ? prefs.bool('allSpaces') : true;
    const days = prefs.get('retention');
    this.retention = [7, 30, 90].includes(days) ? days : 30;
    this.autoBing = prefs.bool('auto.bing');
    this.autoSpotlight = prefs.bool('auto.spotlight');
    this.catalog = [];
    this.catalogSource = null;
    this.selectedID = null;
    this.preview = null;
    this.busy = false;
    this.status = 'Pronto';
    this.currentTitle = prefs.string('imageTitle', 'Nenhuma imagem aplicada');
    this.currentSource = null;
    this.currentPreview = null;
    this.spaceStatus = prefs.string('spaceStatus.v2', 'Aguardando aplicação');
    this.currentPath = null;

    const saved = prefs.get('library.v2');
    this.records = Array.isArray(saved)
      ? saved.filter((entry) => entry && entry.image && this.store.validFile(entry.filename))
      : [];

    const currentPath = prefs.string('currentPath');
    if (currentPath) {
      const file = this.store.validFile(path.basename(currentPath));
      if (file && file === path.resolve(currentPath)) {
        this.currentPath = file;
        this.currentPreview = this.safeThumbnail(file);
        this.currentSource = this.records.find((entry) => entry.filename === path.basename(file))?.image.source || null;
      }
    }
  }

  // ---------- estado ----------

  folder(source) {
    return this.prefs.string(`folder.${source}`, '');
  }

  get selected() {
    return this.catalog.find((image) => image.id === this.selectedID) || null;
  }

  snapshot() {
    return {
      source: this.source,
      region: this.region,
      allSpaces: this.allSpaces,
      retention: this.retention,
      autoBing: this.autoBing,
      autoSpotlight: this.autoSpotlight,
      folderBing: this.folder('bing') || NO_FOLDER,
      folderSpotlight: this.folder('spotlight') || NO_FOLDER,
      hasFolderBing: Boolean(this.folder('bing')),
      hasFolderSpotlight: Boolean(this.folder('spotlight')),
      catalog: this.catalog.map(({ id, title, date, source }) => ({ id, title, date, source })),
      catalogSource: this.catalogSource,
      selectedID: this.selectedID,
      selectedTitle: this.selected?.title || null,
      preview: this.preview,
      busy: this.busy,
      status: this.status,
      currentTitle: this.currentTitle,
      currentSource: this.currentSource,
      currentPreview: this.currentPreview,
      spaceStatus: this.spaceStatus
    };
  }

  changed() {
    this.onChange(this.snapshot());
  }

  safeThumbnail(fileOrData) {
    try {
      const data = Buffer.isBuffer(fileOrData) ? fileOrData : fs.readFileSync(fileOrData);
      return this.thumbnail(data);
    } catch {
      return null;
    }
  }

  // Executa uma operação exclusiva (equivalente ao busy + Task do Swift).
  async run(work) {
    if (this.busy) return false;
    this.busy = true;
    this.changed();
    try {
      await work();
    } finally {
      this.busy = false;
      this.changed();
    }
    return true;
  }

  // ---------- preferências ----------

  setSource(source) {
    if (!SOURCES.includes(source) || this.busy) return;
    this.source = source;
    this.prefs.set('source', source);
    this.changed();
  }

  setRegion(region) {
    if (typeof region !== 'string' || this.busy) return;
    this.region = region;
    this.prefs.set('bingRegion', region);
    this.changed();
  }

  setAllSpaces(enabled) {
    this.allSpaces = Boolean(enabled);
    this.prefs.set('allSpaces', this.allSpaces);
    this.changed();
  }

  setRetention(days) {
    if (![7, 30, 90].includes(days)) return;
    this.retention = days;
    this.prefs.set('retention', days);
    this.changed();
  }

  setAuto(source, enabled) {
    if (source === 'bing') { this.autoBing = Boolean(enabled); this.prefs.set('auto.bing', this.autoBing); }
    if (source === 'spotlight') { this.autoSpotlight = Boolean(enabled); this.prefs.set('auto.spotlight', this.autoSpotlight); }
    this.changed();
  }

  setFolder(source, folder) {
    if (!SOURCES.includes(source) || typeof folder !== 'string' || !folder) return;
    this.prefs.set(`folder.${source}`, folder);
    this.changed();
  }

  requireFolder(source) {
    const folder = this.folder(source);
    if (!folder) throw invalid(`Escolha a pasta de autossalvamento de ${SOURCE_TITLES[source]}.`);
    return folder;
  }

  // ---------- cache ----------

  async cached(image) {
    const entry = this.records.find((record) => record.image.id === image.id);
    const file = entry && this.store.validFile(entry.filename);
    if (file) {
      const data = fs.readFileSync(file);
      validateImage(data, this.decode);
      return { file, data };
    }
    const data = await this.service.download(image);
    const saved = this.store.save(data);
    this.records = this.records.filter((record) => record.image.id !== image.id);
    this.records.unshift({ image, filename: path.basename(saved) });
    this.store.prune(this.currentPath || saved, this.retention, [saved]);
    this.persistLibrary();
    return { file: saved, data };
  }

  persistLibrary() {
    this.records = this.records.filter((record) => this.store.validFile(record.filename)).slice(0, 1000);
    this.prefs.set('library.v2', this.records);
  }

  localImages(source) {
    const market = this.service.market(this.region);
    return this.records
      .filter((record) => record.image.source === source && (source !== 'bing' || record.image.market === market))
      .map((record) => record.image);
  }

  // ---------- histórico ----------

  loadCatalog(source) {
    if (!SOURCES.includes(source)) return Promise.resolve(false);
    return this.run(async () => {
      this.status = `Buscando histórico de ${SOURCE_TITLES[source]}…`;
      this.preview = null;
      this.catalogSource = source;
      this.changed();
      try {
        const fetched = await this.service.catalog(source, this.region, true);
        const seen = new Set();
        this.catalog = [...fetched, ...this.localImages(source)]
          .filter((image) => !seen.has(image.id) && seen.add(image.id))
          .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
        this.selectedID = this.catalog[0]?.id || null;
        if (this.selected) {
          const { data } = await this.cached(this.selected);
          this.preview = this.safeThumbnail(data);
        }
        this.status = source === 'bing'
          ? 'Histórico do Bing: imagens recentes da região escolhida e imagens já baixadas.'
          : 'Spotlight: imagem atual e histórico local das imagens obtidas pelo iWallPeek.';
      } catch (error) {
        this.catalog = this.localImages(source);
        this.selectedID = this.catalog[0]?.id || null;
        if (this.selected) {
          try { this.preview = this.safeThumbnail((await this.cached(this.selected)).data); } catch { /* sem prévia */ }
        }
        this.status = `Não foi possível atualizar o histórico: ${errorText(error)}`;
      }
    });
  }

  select(id) {
    const image = this.catalog.find((item) => item.id === id);
    if (!image || this.busy) return Promise.resolve(false);
    this.selectedID = id;
    this.preview = null;
    return this.run(async () => {
      try {
        const { data } = await this.cached(image);
        this.preview = this.safeThumbnail(data);
        this.status = image.title;
      } catch (error) {
        this.status = `Erro ao visualizar: ${errorText(error)}`;
      }
    });
  }

  move(offset) {
    const index = this.catalog.findIndex((image) => image.id === this.selectedID);
    const next = this.catalog[index + offset];
    if (index < 0 || !next) return Promise.resolve(false);
    return this.select(next.id);
  }

  saveSelected(folder) {
    const image = this.selected;
    if (!image || !folder) return Promise.resolve(false);
    return this.run(async () => {
      try {
        const { data } = await this.cached(image);
        const file = exportImage(data, image, folder, this.decode);
        this.status = `Imagem salva em ${file}`;
      } catch (error) {
        this.status = `Erro ao salvar: ${errorText(error)}`;
      }
    });
  }

  // ---------- aplicar ----------

  dailyKey(source) {
    return `${day()}:${source}:${source === 'bing' ? this.service.market(this.region) : 'auto'}`;
  }

  async apply(image, file, data) {
    const result = await this.platform.apply(file, { allSpaces: this.allSpaces });
    this.currentPath = file;
    this.currentTitle = image.title;
    this.currentPreview = this.safeThumbnail(data);
    this.currentSource = image.source;
    this.source = image.source;
    this.prefs.set('source', image.source);
    this.prefs.set('currentPath', file);
    this.prefs.set('imageTitle', image.title);
    this.spaceStatus = result.status;
    this.prefs.set('needsSpaceFallback', Boolean(result.fallback));
    this.prefs.set('spaceStatus.v2', this.spaceStatus);
    this.store.prune(file, this.retention);
    this.persistLibrary();
  }

  applySelected() {
    const image = this.selected;
    if (!image) return Promise.resolve(false);
    return this.run(async () => {
      try {
        const { file, data } = await this.cached(image);
        await this.apply(image, file, data);
        // Mantém esta imagem do histórico até amanhã; navegar sozinho nunca troca o fundo.
        this.prefs.set('applied.v2', this.dailyKey(image.source));
        this.status = `Imagem aplicada como plano de fundo.${this.spaceStatus.includes('reaplicada') ? ` ${this.spaceStatus}` : ''}`;
      } catch (error) {
        this.status = `Erro ao aplicar: ${errorText(error)}`;
      }
    });
  }

  async autoExport(data, image) {
    if (!(image.source === 'bing' ? this.autoBing : this.autoSpotlight)) return;
    exportImage(data, image, this.requireFolder(image.source), this.decode);
  }

  refreshDaily({ force = false, exportOnly = null } = {}) {
    return this.run(async () => {
      const failures = [];
      const wallpaperSource = this.source;
      for (const source of SOURCES) {
        if (exportOnly && source !== exportOnly) continue;
        const autosave = source === 'bing' ? this.autoBing : this.autoSpotlight;
        const mustApply = !exportOnly && source === wallpaperSource
          && (force || !this.currentPath || this.prefs.string('applied.v2') !== this.dailyKey(source));
        const exportKey = `${this.dailyKey(source)}:${this.folder(source) || NO_FOLDER}`;
        const mustExport = autosave && (force || this.prefs.string(`exported.${source}`) !== exportKey);
        if (!mustApply && !mustExport) continue;
        try {
          this.status = `Buscando imagem de ${SOURCE_TITLES[source]}…`;
          this.changed();
          const image = await this.service.fetch(source, this.region);
          const { file, data } = await this.cached(image);
          // Falha ao exportar não esconde o outro serviço nem impede aplicar o fundo.
          if (mustApply) {
            try {
              await this.apply(image, file, data);
              this.prefs.set('applied.v2', this.dailyKey(source));
            } catch (error) {
              failures.push(`Plano de fundo: ${errorText(error)}`);
            }
          }
          if (mustExport) {
            try {
              await this.autoExport(data, image);
              this.prefs.set(`exported.${source}`, exportKey);
            } catch (error) {
              failures.push(`Autossalvar ${SOURCE_TITLES[source]}: ${errorText(error)}`);
            }
          }
        } catch (error) {
          failures.push(`${SOURCE_TITLES[source]}: ${errorText(error)}`);
        }
      }
      this.status = failures.length ? failures.join('\n') : 'Atualização concluída.';
    });
  }

  // Reaplica na mesa ativa quando a configuração global não pôde ser usada (macOS).
  async reapplyToActiveSpace() {
    if (!this.allSpaces || this.busy || !this.currentPath || !this.platform.supportsSpaces) return;
    if (!(this.prefs.bool('needsSpaceFallback') || this.platform.needsReapply())) return;
    try {
      validateImage(fs.readFileSync(this.currentPath), this.decode);
      await this.platform.reapply(this.currentPath);
    } catch (error) {
      this.spaceStatus = `Falha ao reaplicar nesta mesa: ${errorText(error)}`;
      this.changed();
    }
  }

  applyCurrentToSpaces() {
    if (!this.currentPath) return Promise.resolve(false);
    return this.run(async () => {
      try {
        const result = await this.platform.apply(this.currentPath, { allSpaces: this.allSpaces });
        this.spaceStatus = result.status;
        this.prefs.set('needsSpaceFallback', Boolean(result.fallback));
        this.prefs.set('spaceStatus.v2', this.spaceStatus);
      } catch (error) {
        this.spaceStatus = errorText(error);
      }
    });
  }
}

module.exports = { WallModel, NO_FOLDER };
