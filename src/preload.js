'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('iWallPeek', {
  getState: call('state:get'),
  setSource: call('source:set'),
  setRegion: call('region:set'),
  setAllSpaces: call('allSpaces:set'),
  setRetention: call('retention:set'),
  setAuto: call('auto:set'),
  chooseFolder: call('folder:choose'),
  openFolder: call('folder:open'),
  loadCatalog: call('catalog:load'),
  select: call('catalog:select'),
  move: call('catalog:move'),
  saveSelected: call('image:save'),
  applySelected: call('image:apply'),
  refreshDaily: call('daily:refresh'),
  reapplySpaces: call('spaces:reapply'),
  setLaunchAtLogin: call('login:set'),
  onStateChanged: (callback) => {
    ipcRenderer.on('state:changed', (_event, state) => callback(state));
  }
});
