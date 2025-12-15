
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
      '-af', 'highpass=f=100,lowpass=f=7500,volume=1.5',  // Gentle filtering, mild boost - preserve speech clarity
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
    
    // Check minimum size - very small files are likely corrupted
    if (buffer.length < 100) {
      console.warn('⚠️ Audio buffer too small, likely empty or corrupted');
      return 'No speech detected - audio too short';
    }
    
    // Check if buffer looks like a valid WebM file
    const webmHeader = buffer.slice(0, 4).toString('hex');
    console.log(`WebM header bytes: ${webmHeader}`);
    // WebM files start with 0x1A45DFA3 (EBML header)
    if (!webmHeader.startsWith('1a45dfa3')) {
      console.warn('⚠️ Buffer does not appear to be a standard WebM file. Header:', webmHeader);
      console.warn('First 20 bytes hex:', buffer.slice(0, 20).toString('hex'));
      // Don't return error - let FFmpeg try to handle it, it's more forgiving
      console.log('Attempting FFmpeg conversion anyway...');
    }
    
    fs.writeFileSync(tempWebmPath, buffer);
    console.log('Saved WebM to:', tempWebmPath);
    
    // Verify written file
    const savedSize = fs.statSync(tempWebmPath).size;
    console.log(`Verified saved WebM size: ${savedSize} bytes`);
    
    if (savedSize !== buffer.length) {
      console.error('⚠️ File size mismatch! Expected:', buffer.length, 'Got:', savedSize);
    }
    
    // Convert WebM to WAV
    console.log('Converting to WAV...');
    await convertToWav(tempWebmPath, tempWavPath);
    console.log('Converted to WAV:', tempWavPath);
    
    // Check WAV file for audio content
    const wavStats = fs.statSync(tempWavPath);
    console.log(`WAV file size: ${wavStats.size} bytes`);
    
    // Analyze WAV file to check if it has actual audio
    const wavBuffer = fs.readFileSync(tempWavPath);
    const wavHeader = wavBuffer.toString('ascii', 0, 4);
    console.log(`WAV header: ${wavHeader}`);
    
    // Check audio data for silence (sample values near 0)
    const dataStart = 44; // WAV header is typically 44 bytes
    let maxSample = 0;
    let sumAbs = 0;
    const sampleCount = Math.min(1000, (wavBuffer.length - dataStart) / 2);
    for (let i = 0; i < sampleCount; i++) {
      const sample = wavBuffer.readInt16LE(dataStart + i * 2);
      maxSample = Math.max(maxSample, Math.abs(sample));
      sumAbs += Math.abs(sample);
    }
    const avgLevel = sumAbs / sampleCount;
    console.log(`📊 WAV audio analysis: maxSample=${maxSample}, avgLevel=${avgLevel.toFixed(1)}, samples checked=${sampleCount}`);
    
    if (maxSample < 100) {
      console.warn('⚠️ WAV file appears to contain mostly silence!');
    };
    if (wavStats.size < 1000) {
      console.warn('⚠️ WAV file very small, may contain no audio');
    }
    
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
          
          // Clean up common Whisper artifacts
          text = text
            .replace(/\[BLANK_AUDIO\]/gi, '')
            .replace(/\[INAUDIBLE\]/gi, '')
            .replace(/\(.*?\)/g, '')  // Remove parenthetical notes
            .replace(/\s+/g, ' ')     // Normalize whitespace
            .trim();
          
          if (stdout.includes('[BLANK_AUDIO]') && text === '') {
            console.log('Whisper detected blank/silent audio');
            cleanup();
            resolve('No speech detected - please check your microphone settings and speak clearly');
          } else if (text === '') {
            console.log('Whisper produced empty transcription');
            cleanup();
            resolve('No speech detected');
          } else {
            console.log('Transcription result:', text);
            cleanup();
            resolve(text);
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
