
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const os = require('os');

// Get ffmpeg path from ffmpeg-static
const ffmpegPath = require('ffmpeg-static');
console.log('FFmpeg path:', ffmpegPath);

// Convert WebM to WAV using ffmpeg with audio normalization for laptop mics
async function convertToWav(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    // Check if input file exists
    if (!fs.existsSync(inputPath)) {
      return reject(new Error(`Input file not found: ${inputPath}`));
    }
    
    const inputSize = fs.statSync(inputPath).size;
    console.log(`Input file size: ${inputSize} bytes`);
    
    const args = [
      '-i', inputPath,
      '-af', 'volume=2.0,highpass=f=80,lowpass=f=8000',  // Boost volume, gentle filtering for speech
      '-ar', '16000',      // Sample rate 16kHz (required by Whisper)
      '-ac', '1',          // Mono audio
      '-c:a', 'pcm_s16le', // PCM 16-bit little-endian
      '-y',                // Overwrite output
      outputPath
    ];
    
    console.log('FFmpeg args:', args.join(' '));
    const proc = spawn(ffmpegPath, args);
    
    let stderrOutput = '';
    
    proc.on('error', (err) => {
      console.error('FFmpeg spawn error:', err);
      reject(err);
    });
    
    proc.stderr.on('data', (data) => {
      stderrOutput += data.toString();
    });
    
    proc.on('close', (code) => {
      console.log('FFmpeg stderr:', stderrOutput);
      if (code === 0) {
        // Verify output file was created
        if (fs.existsSync(outputPath)) {
          const outputSize = fs.statSync(outputPath).size;
          console.log(`Output WAV size: ${outputSize} bytes`);
          resolve(outputPath);
        } else {
          reject(new Error('FFmpeg completed but output file not found'));
        }
      } else {
        reject(new Error(`FFmpeg exited with code ${code}: ${stderrOutput}`));
      }
    });
  });
}

// Use local Whisper binary for transcription
async function transcribe(audioBuffer, config) {
  const tempDir = os.tmpdir();
  const timestamp = Date.now();
  const tempWebmPath = path.join(tempDir, `whisper_${timestamp}.webm`);
  const tempWavPath = path.join(tempDir, `whisper_${timestamp}.wav`);
  
  // Helper function for cleanup
  const cleanup = () => {
    try { 
      if (fs.existsSync(tempWebmPath)) fs.unlinkSync(tempWebmPath); 
    } catch (e) { console.log('Cleanup webm error:', e.message); }
    try { 
      if (fs.existsSync(tempWavPath)) fs.unlinkSync(tempWavPath); 
    } catch (e) { console.log('Cleanup wav error:', e.message); }
  };
  
  try {
    // Write the webm file
    const buffer = Buffer.from(audioBuffer);
    console.log(`Audio buffer received: ${buffer.length} bytes`);
    fs.writeFileSync(tempWebmPath, buffer);
    console.log('Saved WebM to:', tempWebmPath);
    
    // Convert WebM to WAV
    console.log('Converting to WAV...');
    await convertToWav(tempWebmPath, tempWavPath);
    console.log('Converted to WAV:', tempWavPath);
    
    // Get whisper binary and model paths
    const whisperExe = path.resolve(config.whisper_binary_path || './whisper/main.exe');
    const modelPath = path.resolve(config.whisper_model || './whisper/ggml-base.bin');
    
    console.log('Whisper exe:', whisperExe);
    console.log('Model path:', modelPath);
    console.log('Audio path:', tempWavPath);
    
    return new Promise((resolve, reject) => {
      // whisper.cpp arguments
      const args = [
        '-m', modelPath,
        '-f', tempWavPath,
        '-l', 'en',
        '--no-timestamps'
      ];
      
      console.log('Whisper args:', [whisperExe, ...args].join(' '));
      const proc = spawn(whisperExe, args);
      
      let stdout = '';
      let stderr = '';
      
      proc.stdout.on('data', (data) => {
        const str = data.toString();
        stdout += str;
        console.log('Whisper stdout:', str);
      });
      
      proc.stderr.on('data', (data) => {
        const str = data.toString();
        stderr += str;
        console.log('Whisper stderr:', str);
      });
      
      proc.on('error', (error) => {
        console.error('Whisper spawn error:', error);
        cleanup();
        reject(`Whisper error: ${error.message}`);
      });
      
      proc.on('close', (code) => {
        console.log('Whisper exit code:', code);
        console.log('Whisper full stdout:', stdout);
        console.log('Whisper full stderr:', stderr);
        
        if (code === 0) {
          // Parse the output - whisper.cpp outputs text
          let text = stdout.trim()
            .split('\n')
            .map(line => line.replace(/^\[.*?\]\s*/, '').trim())
            .filter(line => line.length > 0)
            .join(' ');
          
          // Handle blank audio detection
          if (stdout.includes('[BLANK_AUDIO]') || text === '' || text === '[BLANK_AUDIO]') {
            console.log('Whisper detected blank/silent audio');
            cleanup();
            resolve('No speech detected - please check your microphone settings and speak clearly');
          } else {
            console.log('Transcription result:', text);
            cleanup();
            resolve(text || 'No speech detected');
          }
        } else {
          cleanup();
          console.error('Whisper failed with code:', code);
          reject(`Whisper failed (code ${code}): ${stderr}`);
        }
      });
    });
  } catch (error) {
    // Cleanup on error
    cleanup();
    console.error('Transcription error:', error);
    return `Error: ${error.message}`;
  }
}

module.exports = { transcribe };
