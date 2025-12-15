
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  generateAI: (opts) => ipcRenderer.invoke('ai:generate', opts),
  clearThread: (opts) => ipcRenderer.invoke('ai:clearThread', opts),
  transcribe: (audioBuffer) => ipcRenderer.invoke('whisper:transcribe', audioBuffer),
  getSources: () => ipcRenderer.invoke('get-sources'),
});
