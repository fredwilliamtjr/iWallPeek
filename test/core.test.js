'use strict';

// Porta de scripts/verify.swift + testes do modelo e das plataformas.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const { validateURL, validateImage, MAX_IMAGE_BYTES } = require('../src/core/safety');
const { safeGet } = require('../src/core/http');
const { WallpaperService, makeImage, day } = require('../src/core/service');
const { ImageStore, exportImage, CACHE_BUDGET } = require('../src/core/store');
const { Prefs } = require('../src/core/prefs');
const { WallModel } = require('../src/core/model');
const { detectDesktop } = require('../src/platform/linux');

function tempDir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'iwallpeek-test-')));
}

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

// PNG RGBA válido de w×h (equivale ao NSBitmapImageRep 2×2 do teste Swift).
function png(width = 2, height = 2, { apng = false } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr)];
  if (apng) parts.push(chunk('acTL', Buffer.alloc(8)));
  parts.push(chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

function jpegHeader(width, height) {
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]), sof, Buffer.from([0xff, 0xd9])]);
}

test('URL: só HTTPS nos domínios Microsoft permitidos', () => {
  for (const address of ['https://res.public.onecdn.static.microsoft/a', 'https://www.bing.com/a', 'https://assets.msn.com/a']) {
    assert.doesNotThrow(() => validateURL(address), address);
  }
  for (const address of ['https://img-s-msn-com.akamaized.net/a', 'http://www.bing.com/a', 'file:///etc/passwd',
    'https://bing.com.evil.test/a', 'https://evilbing.com/a', 'https://user:password@bing.com/a',
    'https://bing.com:8080/a', 'https://127.0.0.1/a', 'nada']) {
    assert.throws(() => validateURL(address), address);
  }
});

test('Redirecionamento para fora da lista é recusado antes de conectar', async () => {
  const requested = [];
  const fakeFetch = async (url) => {
    requested.push(url);
    if (url.startsWith('https://www.bing.com/')) {
      return new Response(null, { status: 302, headers: { location: 'https://evil.test/payload' } });
    }
    return new Response('nunca', { status: 200 });
  };
  await assert.rejects(() => safeGet('https://www.bing.com/', 1000, { fetchImpl: fakeFetch }));
  assert.deepEqual(requested, ['https://www.bing.com/']);

  const okFetch = async (url) => (url.endsWith('/start')
    ? new Response(null, { status: 301, headers: { location: '/image.jpg' } })
    : new Response('ok', { status: 200 }));
  assert.equal((await safeGet('https://www.bing.com/start', 1000, { fetchImpl: okFetch })).toString(), 'ok');
});

test('Download acima do limite é interrompido', async () => {
  const big = async () => new Response(Buffer.alloc(5000), { status: 200 });
  await assert.rejects(() => safeGet('https://www.bing.com/x', 1000, { fetchImpl: big }), /limite/);
  const declared = async () => new Response('x', { status: 200, headers: { 'content-length': '999999' } });
  await assert.rejects(() => safeGet('https://www.bing.com/x', 1000, { fetchImpl: declared }), /limite/);
  const notFound = async () => new Response('x', { status: 404 });
  await assert.rejects(() => safeGet('https://www.bing.com/x', 1000, { fetchImpl: notFound }), /resposta válida/);
});

test('Imagem: rejeita não-imagem, excesso de bytes, APNG e dimensões absurdas', () => {
  assert.throws(() => validateImage(Buffer.from('<html>oops</html>')));
  assert.throws(() => validateImage(Buffer.alloc(MAX_IMAGE_BYTES + 1)));
  assert.throws(() => validateImage(png(2, 2, { apng: true })));
  assert.throws(() => validateImage(jpegHeader(20000, 10)));
  assert.throws(() => validateImage(jpegHeader(10000, 10000)));
  assert.deepEqual(validateImage(png()), { type: 'png', width: 2, height: 2 });
  assert.equal(validateImage(jpegHeader(3840, 2160)).type, 'jpeg');
  // Decodificador real (nativeImage no app) tem a palavra final.
  assert.throws(() => validateImage(png(), () => null));
  assert.throws(() => validateImage(png(), () => ({ width: 3, height: 2 })));
});

test('Cache: teto de 500 MB remove o mais antigo e preserva o atual', () => {
  const base = tempDir();
  const files = [0, 1].map((index) => {
    const file = path.join(base, `${crypto.randomUUID()}.jpg`);
    fs.writeFileSync(file, '');
    fs.truncateSync(file, 260 * 1024 * 1024);
    const when = new Date(Date.now() + (index - 2) * 1000);
    fs.utimesSync(file, when, when);
    return file;
  });
  new ImageStore(base).prune(files[1], 30);
  assert.equal(fs.existsSync(files[0]), false);
  assert.equal(fs.existsSync(files[1]), true);
  assert.ok(CACHE_BUDGET === 500 * 1024 * 1024);
  fs.rmSync(base, { recursive: true, force: true });
});

test('Cache: não segue link simbólico, mantém a atual e ignora arquivos alheios', () => {
  const base = tempDir();
  const real = path.join(base, 'real');
  const store = new ImageStore(real);
  const old = store.save(png());
  fs.utimesSync(old, new Date(0), new Date(0));
  const current = store.save(png());
  const unrelated = path.join(real, 'personal.txt');
  fs.writeFileSync(unrelated, 'preserve');
  store.prune(current, 7);
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(current), true);
  assert.equal(fs.existsSync(unrelated), true);
  const link = path.join(base, 'linked');
  fs.symlinkSync(real, link);
  assert.throws(() => new ImageStore(link).save(png()), /link simbólico/);
  assert.equal(store.validFile('../real/x.jpg'), null);
  assert.equal(store.validFile('personal.txt'), null);
  fs.rmSync(base, { recursive: true, force: true });
});

test('Exportação: nome controlado, idempotente e nunca sobrescreve', () => {
  const base = tempDir();
  const data = png();
  const image = makeImage({ url: 'https://www.bing.com/test', title: '../evil', date: '../20261011', source: 'bing', market: 'pt-BR' });
  const target = exportImage(data, image, base);
  assert.equal(path.dirname(target), base);
  assert.match(path.basename(target), /^iWallPeek-bing-20261011-[0-9a-f]{16}\.png$/);
  assert.equal(exportImage(data, image, base), target);
  fs.writeFileSync(target, 'personal file');
  assert.throws(() => exportImage(data, image, base), /Nenhum arquivo foi substituído/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'personal file');
  fs.rmSync(target);
  const other = path.join(base, 'private.txt');
  fs.writeFileSync(other, 'keep');
  fs.symlinkSync(other, target);
  assert.throws(() => exportImage(data, image, base));
  assert.equal(fs.readFileSync(other, 'utf8'), 'keep');
  assert.throws(() => exportImage(data, image, path.join(base, 'nao-existe')), /pasta válida/);
  fs.rmSync(base, { recursive: true, force: true });
});

function fakeService(images) {
  const service = new WallpaperService({ systemLocale: () => ({ language: 'pt', region: 'BR' }) });
  service.downloads = 0;
  service.catalog = async (source) => images.filter((image) => image.source === source);
  service.download = async () => { service.downloads += 1; return png(); };
  return service;
}

function fakePlatform() {
  return {
    applied: [],
    supportsSpaces: false,
    needsReapply: () => false,
    async apply(file) { this.applied.push(file); return { status: 'Aplicado (teste).', fallback: false }; },
    async reapply() {}
  };
}

test('Preferências: autossalvar e pastas independentes por serviço', () => {
  const base = tempDir();
  const prefs = new Prefs(path.join(base, 'prefs.json'));
  prefs.set('source', 'spotlight');
  prefs.set('folder.bing', '/one');
  prefs.set('folder.spotlight', '/two');
  const model = new WallModel({ prefs, service: fakeService([]), store: new ImageStore(path.join(base, 'cache')), platform: fakePlatform() });
  model.setAuto('bing', true);
  model.setAuto('spotlight', false);
  model.setRegion('en-US');
  const reloaded = new Prefs(path.join(base, 'prefs.json'));
  assert.equal(reloaded.bool('auto.bing'), true);
  assert.equal(reloaded.bool('auto.spotlight'), false);
  assert.equal(reloaded.string('bingRegion'), 'en-US');
  const snapshot = model.snapshot();
  assert.equal(snapshot.source, 'spotlight');
  assert.equal(snapshot.folderBing, '/one');
  assert.equal(snapshot.folderSpotlight, '/two');
  assert.equal(model.service.market('en-US'), 'en-US');
  assert.equal(model.service.market('../../evil'), 'pt-BR');
  fs.rmSync(base, { recursive: true, force: true });
});

test('Modelo: aplica uma vez por dia, autossalva e navegar não troca o fundo', async () => {
  const base = tempDir();
  const exportBing = path.join(base, 'export-bing');
  fs.mkdirSync(exportBing);
  const images = [
    makeImage({ url: 'https://www.bing.com/th?id=hoje', title: 'Hoje', date: day(), source: 'bing', market: 'pt-BR' }),
    makeImage({ url: 'https://www.bing.com/th?id=ontem', title: 'Ontem', date: '20000101', source: 'bing', market: 'pt-BR' }),
    makeImage({ url: 'https://arc.msn.com/spot', title: 'Spot', date: day(), source: 'spotlight', market: 'pt-BR' })
  ];
  const prefs = new Prefs(path.join(base, 'prefs.json'));
  const platform = fakePlatform();
  const service = fakeService(images);
  const model = new WallModel({ prefs, service, store: new ImageStore(path.join(base, 'cache')), platform });
  model.setAuto('bing', true);
  model.setFolder('bing', exportBing);

  await model.refreshDaily();
  assert.equal(platform.applied.length, 1);
  assert.equal(model.currentTitle, 'Hoje');
  assert.equal(model.status, 'Atualização concluída.');
  assert.equal(fs.readdirSync(exportBing).length, 1);

  await model.refreshDaily();
  assert.equal(platform.applied.length, 1, 'mesmo dia não reaplica');
  assert.equal(service.downloads, 1, 'cache evita novo download');

  await model.loadCatalog('bing');
  assert.equal(model.catalog.length, 2);
  await model.move(1);
  assert.equal(model.selected.title, 'Ontem');
  assert.equal(platform.applied.length, 1, 'navegar não aplica');
  await model.applySelected();
  assert.equal(platform.applied.length, 2);
  assert.equal(model.currentTitle, 'Ontem');

  // Autossalvar sem pasta escolhida informa o erro, sem impedir o restante.
  model.setAuto('spotlight', true);
  await model.refreshDaily({ force: true, exportOnly: 'spotlight' });
  assert.match(model.status, /Escolha a pasta de autossalvamento de Windows Spotlight/);

  // Estado persiste entre execuções.
  const again = new WallModel({ prefs: new Prefs(path.join(base, 'prefs.json')), service, store: new ImageStore(path.join(base, 'cache')), platform });
  assert.equal(again.currentTitle, 'Ontem');
  assert.equal(again.currentSource, 'bing');
  assert.equal(again.records.length >= 2, true);
  fs.rmSync(base, { recursive: true, force: true });
});

test('Modelo: falha ao aplicar não esconde a exportação nem trava o estado', async () => {
  const base = tempDir();
  const folder = path.join(base, 'out');
  fs.mkdirSync(folder);
  const images = [makeImage({ url: 'https://www.bing.com/th?id=x', title: 'X', date: day(), source: 'bing', market: 'pt-BR' })];
  const platform = fakePlatform();
  platform.apply = async () => { throw new Error('sem monitor'); };
  const model = new WallModel({ prefs: new Prefs(path.join(base, 'p.json')), service: fakeService(images), store: new ImageStore(path.join(base, 'c')), platform });
  model.setAuto('bing', true);
  model.setFolder('bing', folder);
  await model.refreshDaily();
  assert.match(model.status, /Plano de fundo: sem monitor/);
  assert.equal(fs.readdirSync(folder).length, 1);
  assert.equal(model.busy, false);
  fs.rmSync(base, { recursive: true, force: true });
});

test('Bing/Spotlight: parsing ignora itens inválidos', () => {
  const service = new WallpaperService();
  const bing = service.parseBing({ images: [
    { urlbase: '/th?id=OHR.Ok', title: 'T', copyright: 'C', startdate: '20261118' },
    { urlbase: 'https://evil.test/x', startdate: '20261117' },
    { urlbase: '/th?id=Sem', startdate: 5 }
  ] }, 'pt-BR');
  assert.equal(bing.length, 1);
  assert.equal(bing[0].url, 'https://www.bing.com/th?id=OHR.Ok_UHD.jpg');
  assert.equal(bing[0].title, 'T — C');
  const ad = (u) => ({ item: JSON.stringify({ ad: { image_fullscreen_001_landscape: { t: 'img', u }, hs1_title_text: { tx: 'Título' } } }) });
  const spot = service.parseSpotlight({ batchrsp: { items: [ad('https://img-s-msn-com.akamaized.net/x'), ad('https://img-prod-cms-rt-microsoft-com.akamaized.net/y'), ad('https://res.public.onecdn.static.microsoft/z'), { item: '{' }] } }, 'pt-BR');
  assert.equal(spot.length, 1);
  assert.equal(spot[0].title, 'Título');
  assert.throws(() => service.parseBing({ images: [] }, 'pt-BR'));
});

test('Linux: detecção do ambiente gráfico', () => {
  assert.equal(detectDesktop({ XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' }), 'gnome');
  assert.equal(detectDesktop({ XDG_CURRENT_DESKTOP: 'KDE' }), 'kde');
  assert.equal(detectDesktop({ XDG_CURRENT_DESKTOP: 'XFCE' }), 'xfce');
  assert.equal(detectDesktop({ XDG_CURRENT_DESKTOP: 'X-Cinnamon' }), 'cinnamon');
  assert.equal(detectDesktop({ XDG_CURRENT_DESKTOP: 'MATE' }), 'mate');
  assert.equal(detectDesktop({ XDG_CURRENT_DESKTOP: 'Budgie:GNOME' }), 'gnome');
  assert.equal(detectDesktop({ XDG_CURRENT_DESKTOP: 'i3' }), 'unknown');
  assert.equal(detectDesktop({}), 'gnome');
});

test('macOS: configuração global preserva as quatro mesas (JXA)', { skip: process.platform !== 'darwin' }, async () => {
  const { runJXA } = require('../src/platform/macos');
  const base = tempDir();
  const write = (name, json) => {
    const file = path.join(base, name);
    fs.writeFileSync(`${file}.json`, JSON.stringify(json));
    execFileSync('/usr/bin/plutil', ['-convert', 'binary1', '-o', file, `${file}.json`]);
    return file;
  };
  const read = (file) => JSON.parse(execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', `
    ObjC.import('Foundation');
    function conv(v) {
      if (v.isKindOfClass($.NSData)) return { data: conv($.NSPropertyListSerialization.propertyListWithDataOptionsFormatError(v, 0, null, null)) };
      if (v.isKindOfClass($.NSDate)) return { date: true };
      if (v.isKindOfClass($.NSDictionary)) { var o = {}; var k = ObjC.deepUnwrap(v.allKeys); k.forEach(function (key) { o[key] = conv(v.objectForKey(key)); }); return o; }
      if (v.isKindOfClass($.NSArray)) { var a = []; for (var i = 0; i < v.count; i++) a.push(conv(v.objectAtIndex(i))); return a; }
      return ObjC.deepUnwrap(v);
    }
    function run(argv) { var d = $.NSData.dataWithContentsOfFile(argv[0]); return JSON.stringify(conv($.NSPropertyListSerialization.propertyListWithDataOptionsFormatError(d, 0, null, null))); }
  `, file]).toString());

  const spaces = { mesa1: { Desktop: 'original1' }, mesa2: { Desktop: 'original2' }, mesa3: { Desktop: 'original3' }, mesa4: { Desktop: 'original4' } };
  const fixture = { Spaces: spaces, Displays: { display1: { keep: true } }, AllSpacesAndDisplays: { Idle: { keep: 'screensaver' }, Type: 'individual' }, unrelated: 'preserve' };
  const image = '/tmp/foto com espaço e aspas "日本.jpg';
  const out = path.join(base, 'out.plist');
  await runJXA(['transform', write('fx.plist', fixture), out, image]);
  const result = read(out);
  assert.deepEqual(result.Spaces, spaces);
  assert.deepEqual(result.Displays, fixture.Displays);
  assert.equal(result.unrelated, 'preserve');
  const global = result.AllSpacesAndDisplays;
  assert.deepEqual(global.Idle, { keep: 'screensaver' });
  assert.equal(global.Type, 'desktop');
  const choice = global.Desktop.Content.Choices[0];
  assert.equal(choice.Provider, 'com.apple.wallpaper.choice.image');
  assert.equal(choice.Configuration.data.type, 'imageFile');
  assert.equal(decodeURIComponent(choice.Configuration.data.url.relative).normalize('NFC'), `file://${image}`.normalize('NFC'));

  await assert.rejects(() => runJXA(['transform', write('bad.plist', { unknown: true }), path.join(base, 'bad-out.plist'), image]), /não reconhecida/);
  await runJXA(['transform', write('null.plist', { ...fixture, AllSpacesAndDisplays: '$null' }), path.join(base, 'null-out.plist'), image]);
  fs.rmSync(base, { recursive: true, force: true });
});

test('Feeds reais (IWALLPEEK_LIVE_TEST=1)', { skip: process.env.IWALLPEEK_LIVE_TEST !== '1' }, async () => {
  const service = new WallpaperService({ systemLocale: () => ({ language: 'pt', region: 'BR' }) });
  for (const market of ['pt-BR', 'en-US']) {
    const history = await service.catalog('bing', market, true);
    assert.ok(history.length > 1 && history.length <= 8);
    assert.ok(history.every((image) => image.market === market && image.source === 'bing'));
    console.log(`Histórico Bing ${market}: ${history.length} imagens`);
  }
  for (const source of ['bing', 'spotlight']) {
    const image = await service.fetch(source);
    const data = await service.download(image);
    const info = validateImage(data);
    console.log(`Feed validado: ${source}, ${data.length} bytes, ${info.width}x${info.height}, host ${new URL(image.url).hostname}`);
  }
});

test('macOS: início automático informa o status e abre os Ajustes quando preciso', () => {
  const { macLoginOutcome } = require('../src/platform');
  assert.equal(macLoginOutcome(true, { status: 'enabled', openAtLogin: true }), null);
  assert.equal(macLoginOutcome(false, { status: 'not-registered', openAtLogin: false }), null);
  const approval = macLoginOutcome(true, { status: 'requires-approval', openAtLogin: false });
  assert.equal(approval.openSettings, true);
  assert.match(approval.message, /autorização/);
  const other = macLoginOutcome(true, { status: 'not-found', openAtLogin: false });
  assert.match(other.message, /status: not-found/);
  assert.equal(other.openSettings, true);
  assert.match(macLoginOutcome(false, { status: 'enabled', openAtLogin: true }).message, /manteve/);
});
