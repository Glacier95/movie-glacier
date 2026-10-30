import { contextBridge, ipcRenderer } from 'electron';
import type { Bridge, JobState } from '../src/shared.js';

const invoke = <T,>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>;
const bridge: Bridge = {
  platform: process.platform,
  onMenuAction: callback => {
    const listener = (_event: unknown, action: Parameters<typeof callback>[0]) => callback(action);
    ipcRenderer.on('menuAction', listener);
    return () => ipcRenderer.removeListener('menuAction', listener);
  },
  listWorks: () => invoke('listWorks'),
  getSettings: () => invoke('getSettings'),
  setSettings: patch => invoke('setSettings', patch),
  testSources: patch => invoke('testSources', patch),
  listScrapeLogs: () => invoke('listScrapeLogs'),
  chooseFolders: () => invoke('chooseFolders'),
  setFavorite: (workId, favorite) => invoke('setFavorite', workId, favorite),
  choosePlayer: () => invoke('choosePlayer'),
  updateLibrary: () => invoke('updateLibrary'),
  rescanLibrary: () => invoke('rescanLibrary'),
  refreshMetadata: () => invoke('refreshMetadata'),
  refreshWorkMetadata: (workId, source) => invoke('refreshWorkMetadata', workId, source),
  openWorkLocation: workId => invoke('openWorkLocation', workId),
  openShooterSubtitles: workId => invoke('openShooterSubtitles', workId),
  retryFailed: () => invoke('retryFailed'),
  getJob: () => invoke('getJob'),
  play: assetId => invoke('play', assetId),
  searchMatch: (workId, query) => invoke('searchMatch', workId, query),
  setMatch: (workId, tmdbId) => invoke('setMatch', workId, tmdbId),
  saveWorkEdit: (workId, edit) => invoke('saveWorkEdit', workId, edit),
  ignoreWork: workId => invoke('ignoreWork', workId),
  listIgnored: () => invoke('listIgnored'),
  restoreWork: workId => invoke('restoreWork', workId),
  openHelp: source => invoke('openHelp', source),
  toggleFullscreen: () => invoke('toggleFullscreen'),
  isFullscreen: () => invoke('isFullscreen'),
  onFullscreen: callback => {
    const listener = (_event: unknown, full: boolean) => callback(full);
    ipcRenderer.on('fullscreen', listener);
    return () => ipcRenderer.removeListener('fullscreen', listener);
  },
  doubanLogin: () => invoke('doubanLogin'),
  doubanLogout: () => invoke('doubanLogout'),
  imdbVerify: () => invoke('imdbVerify'),
  onChanged: callback => {
    const listener = () => callback();
    ipcRenderer.on('changed', listener);
    return () => ipcRenderer.removeListener('changed', listener);
  },
  onJob: callback => {
    const listener = (_event: unknown, job: JobState) => callback(job);
    ipcRenderer.on('job', listener);
    return () => ipcRenderer.removeListener('job', listener);
  }
};
contextBridge.exposeInMainWorld('library', bridge);
