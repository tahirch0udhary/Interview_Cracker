
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  generateAI: (opts) => ipcRenderer.invoke('ai:generate', opts),
  transcribe: (audioBuffer) => ipcRenderer.invoke('whisper:transcribe', audioBuffer),
  getSources: () => ipcRenderer.invoke('get-sources'),
});
