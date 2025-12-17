// electron/main.js
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const AdmZip = require('adm-zip');
const { app, BrowserWindow, ipcMain, desktopCapturer } = require('electron');

// --- Paths ---
const whisperFolder = path.resolve(__dirname, '../whisper');
const whisperZipPath = path.resolve(__dirname, '../whisper.zip');

// --- Download URL ---
const WHISPER_DOWNLOAD_URL = 'https://github.com/tahirch0udhary/Interview_Cracker/releases/download/v1.0.0/whisper.zip';

/**
 * Download file with redirect support and proper timeout
 */
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;

    console.log('Fetching:', url.slice(0, 80) + '...');

    const request = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 600000  // 10 minutes for slow connections
    }, (response) => {
      const statusCode = response.statusCode;

      // Handle redirects
      if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
        console.log(`Redirect (${statusCode}) -> following...`);
        downloadFile(response.headers.location, dest)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (statusCode !== 200) {
        reject(new Error(`HTTP Error: ${statusCode}`));
        return;
      }

      // Create file stream
      const file = fs.createWriteStream(dest);

      // Track progress
      const totalSize = parseInt(response.headers['content-length'], 10);
      let downloadedSize = 0;
      let lastPercent = 0;
      let lastTime = Date.now();

      response.on('data', (chunk) => {
        downloadedSize += chunk.length;
        
        // Update progress every 2%
        if (totalSize) {
          const percent = Math.floor((downloadedSize / totalSize) * 100);
          if (percent >= lastPercent + 2 || percent === 100) {
            lastPercent = percent;
            const elapsed = (Date.now() - lastTime) / 1000;
            const speed = (downloadedSize / 1024 / 1024 / elapsed).toFixed(1);
            process.stdout.write(`\rDownloading: ${percent}% (${speed} MB/s)   `);
          }
        }
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close(() => {
          console.log('\n✓ Download complete!');

          if (fs.existsSync(dest)) {
            const size = fs.statSync(dest).size;
            console.log(`  File size: ${(size / 1024 / 1024).toFixed(2)} MB`);
            
            if (size < 1000) {
              reject(new Error('Downloaded file is too small'));
              return;
            }
            resolve();
          } else {
            reject(new Error('File was not saved'));
          }
        });
      });

      file.on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });

      response.on('error', (err) => {
        file.close();
        fs.unlink(dest, () => {});
        reject(err);
      });
    });

    // Handle request errors
    request.on('error', (err) => {
      reject(new Error(`Network error: ${err.message}`));
    });

    // Timeout only for initial connection, not entire download
    request.on('timeout', () => {
      // Don't destroy - just log warning
      console.log('\nConnection slow, still downloading...');
    });
  });
}

/**
 * Setup whisper folder
 */
async function ensureWhisperFolder() {
  // Check if already exists
  if (fs.existsSync(whisperFolder)) {
    const files = fs.readdirSync(whisperFolder);
    if (files.some(f => f.includes('main') || f.includes('ggml'))) {
      console.log('✓ Whisper folder already exists');
      return;
    }
    console.log('Whisper folder incomplete, re-downloading...');
    fs.rmSync(whisperFolder, { recursive: true, force: true });
  }

  console.log('\n========================================');
  console.log('   DOWNLOADING WHISPER');
  console.log('   One-time download (~150 MB)');
  console.log('   Please wait...');
  console.log('========================================\n');

  try {
    await downloadFile(WHISPER_DOWNLOAD_URL, whisperZipPath);

    // Verify file exists
    if (!fs.existsSync(whisperZipPath)) {
      throw new Error('Download completed but file not found');
    }

    // Validate ZIP
    console.log('Validating ZIP...');
    const header = Buffer.alloc(4);
    const fd = fs.openSync(whisperZipPath, 'r');
    fs.readSync(fd, header, 0, 4, 0);
    fs.closeSync(fd);

    if (header[0] !== 0x50 || header[1] !== 0x4B) {
      const content = fs.readFileSync(whisperZipPath, 'utf8').slice(0, 200);
      console.error('Invalid file content:', content);
      throw new Error('Downloaded file is not a valid ZIP');
    }

    // Extract
    console.log('Extracting...');
    const zip = new AdmZip(whisperZipPath);
    const entries = zip.getEntries();
    console.log(`  Found ${entries.length} files in archive`);

    zip.extractAllTo(path.dirname(whisperFolder), true);

    // Handle different folder names in ZIP
    if (!fs.existsSync(whisperFolder)) {
      const parentDir = path.dirname(whisperFolder);
      const extractedDirs = fs.readdirSync(parentDir).filter(f => {
        const fullPath = path.join(parentDir, f);
        return fs.statSync(fullPath).isDirectory() &&
               (f.toLowerCase().includes('whisper') || f.toLowerCase().includes('ggml'));
      });

      if (extractedDirs.length > 0) {
        const extractedDir = path.join(parentDir, extractedDirs[0]);
        console.log(`  Renaming ${extractedDirs[0]} to whisper`);
        fs.renameSync(extractedDir, whisperFolder);
      }
    }

    // Cleanup ZIP
    fs.unlinkSync(whisperZipPath);

    // Verify
    if (fs.existsSync(whisperFolder)) {
      const files = fs.readdirSync(whisperFolder);
      console.log('\n✓ Whisper setup complete!');
      console.log('  Contents:', files.slice(0, 5).join(', '));
    } else {
      throw new Error('Extraction failed');
    }

  } catch (error) {
    if (fs.existsSync(whisperZipPath)) {
      fs.unlinkSync(whisperZipPath);
    }

    console.error('\n========================================');
    console.error('   DOWNLOAD FAILED');
    console.error('========================================');
    console.error('Error:', error.message);
    console.error('\nMANUAL SETUP:');
    console.error('1. Download: https://github.com/tahirch0udhary/Interview_Cracker/releases/download/v1.0.0/whisper.zip');
    console.error(`2. Extract to: ${whisperFolder}`);
    console.error('3. Restart the app\n');
  }
}

// --- Initialize ---
ensureWhisperFolder();

// --- Window ---
function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  });

  win.once('ready-to-show', () => win.show());

  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  return win;
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// --- Config ---
let config = {};
try {
  config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json')));
} catch {}

if (!config.whisper_binary_path) {
  config.whisper_binary_path = path.join(whisperFolder, process.platform === 'win32' ? 'main.exe' : 'main');
}
if (!config.whisper_model) {
  config.whisper_model = path.join(whisperFolder, 'ggml-base.bin');
}

// --- IPC Handlers ---
ipcMain.handle('ai:generate', async (event, { provider, prompt, responseSize, history, apiKey, model, temperature }) => {
  try {
    if (provider === 'gemini') {
      return require('./ai-workers/gemini_client').generate(prompt, apiKey, responseSize, history, model, temperature);
    }
    if (provider === 'openai') {
      return require('./ai-workers/openai_client').generate(prompt, apiKey, responseSize, history, model, temperature);
    }
    return 'Unknown provider';
  } catch (error) {
    return `Error: ${error.message}`;
  }
});

ipcMain.handle('ai:clearThread', async (event, { provider }) => {
  try {
    if (provider === 'openai') {
      return require('./ai-workers/openai_client').clearThread(config.openai_api_key);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('whisper:transcribe', async (event, audioBuffer) => {
  return require('./ai-workers/whisper_worker').transcribe(audioBuffer, config);
});

ipcMain.handle('get-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    fetchWindowIcons: false
  });
  return sources.map(s => ({ id: s.id, name: s.name }));
});
