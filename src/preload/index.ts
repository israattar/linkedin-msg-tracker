// Bridge between the renderer and the main process. The renderer only ever
// sees this typed API; it has no direct access to Node, the network client,
// or the API key.
import { contextBridge, ipcRenderer } from 'electron';
import type { AddContactInput, TrackerApi } from '../shared/types';

const api: TrackerApi = {
  listContacts: () => ipcRenderer.invoke('contacts:list'),
  addContact: (input: AddContactInput) => ipcRenderer.invoke('contacts:add', input),
  applyAction: (contactId, actionId, followUpDate) =>
    ipcRenderer.invoke('contacts:act', contactId, actionId, followUpDate),
  undoLastAction: () => ipcRenderer.invoke('contacts:undo'),
  deleteDraft: (contactId) => ipcRenderer.invoke('contacts:delete-draft', contactId),
  deleteContact: (contactId) => ipcRenderer.invoke('contacts:delete', contactId),
  listDeleted: () => ipcRenderer.invoke('contacts:list-deleted'),
  restoreContact: (contactId) => ipcRenderer.invoke('contacts:restore', contactId),
  purgeContact: (contactId) => ipcRenderer.invoke('contacts:purge', contactId),
  saveDraft: (contactId, text) => ipcRenderer.invoke('contacts:save-draft', contactId, text),
  saveNotes: (contactId, text) => ipcRenderer.invoke('contacts:save-notes', contactId, text),
  setNeedsReply: (contactId, needsReply) =>
    ipcRenderer.invoke('contacts:set-needs-reply', contactId, needsReply),
  markReplied: (contactId) => ipcRenderer.invoke('contacts:replied', contactId),
  getQueue: () => ipcRenderer.invoke('queue:list'),
  listConnections: () => ipcRenderer.invoke('connections:list'),
  logConnection: (delta) => ipcRenderer.invoke('connections:log', delta),
  setConnections: (date, count) => ipcRenderer.invoke('connections:set', date, count),
  getSyncStatus: () => ipcRenderer.invoke('sync:status'),
  importFromTeamHub: () => ipcRenderer.invoke('sync:import'),
  retryFailedSyncs: () => ipcRenderer.invoke('sync:retry'),
  getStorageInfo: () => ipcRenderer.invoke('storage:info'),
  exportBackup: () => ipcRenderer.invoke('storage:export'),
  restoreBackup: () => ipcRenderer.invoke('storage:restore'),
  revealDataFolder: () => ipcRenderer.invoke('storage:reveal'),
  onFocusRequested: (callback) => {
    const listener = (): void => callback();
    ipcRenderer.on('nav:focus', listener);
    return () => ipcRenderer.removeListener('nav:focus', listener);
  },
};

contextBridge.exposeInMainWorld('tracker', api);
