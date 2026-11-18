'use strict';

const api = window.iWallPeek;
const $ = (id) => document.getElementById(id);

const PANELS = {
  wallpaper: 'Plano de fundo',
  lockScreen: 'Tela de bloqueio',
  bing: 'Imagem diária do Bing',
  spotlight: 'Windows Spotlight',
  general: 'Configurações'
};
const SOURCE_TITLES = { bing: 'Bing', spotlight: 'Windows Spotlight' };

let panel = 'wallpaper';
let state = null;

const LOCK_TEXT = {
  darwin: {
    heading: 'Acompanha o plano de fundo',
    text: 'O iWallPeek usa a mesma imagem do plano de fundo na tela de bloqueio, conforme o comportamento do macOS. A escolha de um serviço independente para bloqueio não está disponível nesta versão.',
    caption: 'A tela de login após reiniciar pode usar o fundo do próprio macOS.'
  },
  win32: {
    heading: 'Tela de bloqueio do Windows',
    text: 'O Windows mantém uma imagem própria na tela de bloqueio (Windows Spotlight ou a imagem escolhida em Personalização). O iWallPeek não altera a tela de bloqueio nesta versão; ele troca apenas o plano de fundo da área de trabalho.',
    caption: 'Para ver o Spotlight também no bloqueio, use Configurações › Personalização › Tela de bloqueio › Windows Spotlight.'
  },
  linux: {
    heading: 'Acompanha o plano de fundo',
    text: 'No Ubuntu (GNOME), a tela de bloqueio mostra o mesmo plano de fundo da área de trabalho, desfocado. Em outros ambientes gráficos isso depende da configuração do próprio sistema.',
    caption: 'A tela de login (GDM) usa o fundo do sistema e não é alterada pelo iWallPeek.'
  }
};

function displayDate(raw) {
  return /^\d{8}$/.test(raw) ? `${raw.slice(6, 8)}/${raw.slice(4, 6)}/${raw.slice(0, 4)}` : raw;
}

function renderPhoto(container, src) {
  container.replaceChildren();
  if (src) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    container.append(img);
    return;
  }
  const empty = document.createElement('div');
  empty.className = 'photo-empty';
  empty.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5-5-8 8"/></svg>';
  const text = document.createElement('span');
  text.textContent = state?.busy ? 'Carregando imagem…' : 'Nenhuma imagem selecionada';
  empty.append(text);
  container.append(empty);
}

function setPanel(next) {
  if (!PANELS[next] || (state?.busy && next !== panel)) return;
  const changed = next !== panel;
  panel = next;
  render();
  // Como o onChange do SwiftUI: abrir Bing/Spotlight carrega o histórico.
  if (changed && (next === 'bing' || next === 'spotlight')) api.loadCatalog(next);
}

function render() {
  if (!state) return;
  const s = state;
  const serviceSource = panel === 'bing' || panel === 'spotlight' ? panel : null;

  document.querySelectorAll('#nav button').forEach((button) => {
    button.classList.toggle('active', button.dataset.panel === panel);
    button.disabled = s.busy && button.dataset.panel !== panel;
  });
  document.querySelectorAll('[data-section]').forEach((section) => {
    const name = section.dataset.section;
    section.hidden = !(name === panel || (name === 'service' && serviceSource));
  });
  $('panel-title').textContent = PANELS[panel];
  $('spinner').hidden = !s.busy;
  $('status').textContent = s.status;
  $('version').textContent = `Versão ${s.app.version}`;
  document.querySelectorAll('[data-busy-disable]').forEach((element) => {
    element.classList.toggle('disabled', s.busy);
    element.querySelectorAll('button, select, input').forEach((control) => { control.disabled = s.busy; });
    if (element.matches('button')) element.disabled = s.busy;
  });

  // Plano de fundo
  document.querySelectorAll('[data-photo="current"]').forEach((photo) => renderPhoto(photo, s.currentPreview));
  $('current-title').textContent = s.currentTitle;
  $('current-source').textContent = s.currentSource ? `Imagem aplicada: ${SOURCE_TITLES[s.currentSource]}` : '';
  $('source').value = s.source;
  $('all-spaces-row').hidden = !s.app.supportsSpaces;
  $('all-spaces').checked = s.allSpaces;
  $('space-status').textContent = s.spaceStatus;
  $('reapply').textContent = s.app.supportsSpaces ? 'Reaplicar nas mesas' : 'Reaplicar';
  if (!s.busy) $('reapply').disabled = !s.currentPreview;
  $('view-history').textContent = `Ver histórico de ${SOURCE_TITLES[s.source]}`;

  // Tela de bloqueio
  const lock = LOCK_TEXT[s.app.platform] || LOCK_TEXT.linux;
  $('lock-heading').textContent = lock.heading;
  $('lock-text').textContent = lock.text;
  $('lock-caption').textContent = lock.caption;

  // Bing / Spotlight
  if (serviceSource) {
    const ready = s.catalogSource === serviceSource;
    const catalog = ready ? s.catalog : [];
    $('region-group').hidden = serviceSource !== 'bing';
    if ($('region').options.length !== s.app.markets.length) {
      $('region').replaceChildren(...s.app.markets.map(([code, label]) => new Option(label, code)));
    }
    $('region').value = s.region;
    renderPhoto(document.querySelector('[data-photo="preview"]'), ready ? s.preview : null);
    $('selected-title').textContent = ready && s.selectedTitle ? s.selectedTitle : '';
    const index = catalog.findIndex((image) => image.id === s.selectedID);
    if (!s.busy) {
      $('prev').disabled = index < 0 || index === catalog.length - 1;
      $('next').disabled = index <= 0;
      $('save').disabled = index < 0;
      $('apply').disabled = index < 0;
    }
    const auto = serviceSource === 'bing' ? s.autoBing : s.autoSpotlight;
    $('auto').checked = auto;
    $('auto-label').textContent = `Autossalvar imagem diária de ${SOURCE_TITLES[serviceSource]}`;
    $('folder').textContent = serviceSource === 'bing' ? s.folderBing : s.folderSpotlight;
    if (!s.busy) $('export-now').disabled = !auto;
    $('history-caption').textContent = serviceSource === 'bing'
      ? 'Imagens recentes buscadas no Bing para a região selecionada.'
      : 'Imagem atual e histórico local das imagens já obtidas.';
    renderHistory(catalog, s);
  }

  // Configurações
  $('login').checked = s.app.loginEnabled;
  $('login-label').textContent = `Iniciar com o ${s.app.systemName}`;
  $('retention').value = String(s.retention);
  $('about-version').textContent = `iWallPeek ${s.app.version}`;
}

function renderHistory(catalog, s) {
  const list = $('history');
  if (!catalog.length) {
    const empty = document.createElement('li');
    empty.className = 'history-empty';
    empty.textContent = 'Nenhuma imagem disponível. Atualize o histórico.';
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(...catalog.map((image) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.disabled = s.busy;
    button.className = image.id === s.selectedID ? 'selected' : '';
    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.innerHTML = image.id === s.selectedID
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16.5 9"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5-5-8 8"/></svg>';
    const date = document.createElement('span');
    date.className = 'date';
    date.textContent = displayDate(image.date);
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = image.title;
    button.append(mark, date, title);
    button.addEventListener('click', () => api.select(image.id));
    item.append(button);
    return item;
  }));
}

function currentServiceSource() {
  return panel === 'bing' || panel === 'spotlight' ? panel : null;
}

function bind() {
  document.querySelectorAll('#nav button').forEach((button) => {
    button.addEventListener('click', () => setPanel(button.dataset.panel));
  });
  $('source').addEventListener('change', (event) => api.setSource(event.target.value));
  $('refresh').addEventListener('click', () => api.refreshDaily({ force: true }));
  $('all-spaces').addEventListener('change', (event) => api.setAllSpaces(event.target.checked));
  $('reapply').addEventListener('click', () => api.reapplySpaces());
  $('view-history').addEventListener('click', () => setPanel(state?.source === 'spotlight' ? 'spotlight' : 'bing'));
  $('goto-wallpaper').addEventListener('click', () => setPanel('wallpaper'));
  $('region').addEventListener('change', async (event) => {
    await api.setRegion(event.target.value);
    api.loadCatalog('bing');
  });
  $('prev').addEventListener('click', () => api.move(1));
  $('next').addEventListener('click', () => api.move(-1));
  $('save').addEventListener('click', () => api.saveSelected());
  $('apply').addEventListener('click', () => api.applySelected());
  $('auto').addEventListener('change', (event) => api.setAuto(currentServiceSource(), event.target.checked));
  $('choose-folder').addEventListener('click', () => api.chooseFolder(currentServiceSource()));
  $('open-folder').addEventListener('click', () => api.openFolder(currentServiceSource()));
  $('export-now').addEventListener('click', () => api.refreshDaily({ force: true, exportOnly: currentServiceSource() }));
  $('reload-history').addEventListener('click', () => api.loadCatalog(currentServiceSource()));
  $('login').addEventListener('change', (event) => api.setLaunchAtLogin(event.target.checked));
  $('retention').addEventListener('change', (event) => api.setRetention(Number(event.target.value)));
}

async function init() {
  bind();
  api.onStateChanged((next) => {
    state = next;
    render();
  });
  state = await api.getState();
  render();
}

init();
