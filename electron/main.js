const { app, BrowserWindow, ipcMain, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
  console.log('Creating window...');
  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  });

  win.once('ready-to-show', () => {
    console.log('Window ready to show');
    win.show();
  });

  win.on('closed', () => {
    console.log('Window was closed');
  });

  console.log('NODE_ENV:', process.env.NODE_ENV);
  if (process.env.NODE_ENV === 'development') {
    console.log('Loading from http://localhost:5173');
    win.loadURL('http://localhost:5173').catch(err => {
      console.error('Failed to load URL:', err);
    });
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
  });

  win.webContents.on('did-finish-load', () => {
    console.log('Page finished loading');
  });

  return win;
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

let config = {};
try {
  config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json')));
} catch {}

ipcMain.handle('ai:generate', async (event, { provider, prompt, responseSize, history, apiKey }) => {
  try {
    console.log('Received API key in backend:', apiKey); // Log the API key received

    if (provider === 'gemini') {
      // Accept apiKey, model, temperature from frontend if provided, fallback to config.json
      const { model, temperature } = arguments[1] || {};
      return require('./ai-workers/gemini_client').generate(
        prompt,
        apiKey,
        responseSize,
        history,
        model,
        temperature
      );
    }
    if (provider === 'openai') {
      const { model, temperature } = arguments[1] || {};
      return require('./ai-workers/openai_client').generate(
        prompt,
        apiKey,
        responseSize,
        history,
        model,
        temperature
      );
    }
    return 'Unknown provider';
  } catch (error) {
    console.error('AI generation error:', error);
    return `Error: ${error.message}`;
  }
});

// Clear OpenAI thread (for new conversation)
ipcMain.handle('ai:clearThread', async (event, { provider }) => {
  try {
    if (provider === 'openai') {
      return require('./ai-workers/openai_client').clearThread(config.openai_api_key);
    }
    return { success: true };
  } catch (error) {
    console.error('Clear thread error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('whisper:transcribe', async (event, audioBuffer) => {
  return require('./ai-workers/whisper_worker').transcribe(audioBuffer, config);
});

// Get desktop sources for system audio capture
ipcMain.handle('get-sources', async () => {
  const sources = await desktopCapturer.getSources({ 
    types: ['window', 'screen'],
    fetchWindowIcons: false 
  });
  return sources.map(source => ({
    id: source.id,
    name: source.name
  }));
});
