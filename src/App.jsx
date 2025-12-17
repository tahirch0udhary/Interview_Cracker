import React, { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'

// ============================================================================
// CONSTANTS
// ============================================================================
const VAD_CONFIG = {
  mic: { baseThreshold: 20, noiseMargin: 15 },
  system: { baseThreshold: 10, noiseMargin: 10 },
  silenceDuration: 1500,      // Reduced - stop faster after speech ends
  minSpeechDuration: 500,     // Increased - need more speech before processing
  noiseFloorSamples: 50,      // More samples for stable noise floor
  preBufferMs: 500,           // Keep 500ms of audio before speech detected
}

const NO_SPEECH_PHRASES = [
  'No speech detected',
  '[BLANK_AUDIO]',
  'please check your microphone',
  'Error:',
  'Invalid audio format',
  'audio too short',
  'failed to',
]

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================
function getMicDisplayName(device) {
  const label = device.label || ''
  const lower = label.toLowerCase()
  const shortLabel = label.replace(/\s*\(.*?\)\s*/g, '').slice(0, 20)

  if (/headset|headphone|airpods|earbuds|hands-free|bluetooth|wireless|jabra|sony|bose|beats|sennheiser/.test(lower)) {
    return `🎧 Headset: ${shortLabel}`
  }
  if (/usb|external|blue|yeti|rode|shure|audio-technica|hyperx/.test(lower)) {
    return `🎙️ External: ${shortLabel}`
  }
  if (/webcam|camera|logitech|c920|c922|c930/.test(lower)) {
    return `📷 Webcam: ${shortLabel}`
  }
  if (/realtek|internal|built-in|laptop|integrated|array/.test(lower)) {
    return `💻 Computer Mic`
  }
  if (/default|communications/.test(lower) || !label) {
    return `🎤 System Default`
  }
  return `🎤 ${shortLabel}`
}

function getAudioLevel(analyser, dataArray, timeDomainData) {
  analyser.getByteFrequencyData(dataArray)
  let avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length

  if (avg === 0) {
    analyser.getByteTimeDomainData(timeDomainData)
    let sumSquares = 0
    for (let i = 0; i < timeDomainData.length; i++) {
      const deviation = timeDomainData[i] - 128
      sumSquares += deviation * deviation
    }
    avg = Math.sqrt(sumSquares / timeDomainData.length) * 2
  }
  return avg
}

function getAudioMimeType() {
  return MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
}

// ============================================================================
// AUDIO METER COMPONENT
// ============================================================================
function AudioMeter({ label, level }) {
  const color = level > 50 ? 'bg-green-500' : level > 20 ? 'bg-yellow-500' : 'bg-gray-400'
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 w-16">{label}:</span>
      <div className="w-24 h-3 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full transition-all duration-75 ${color}`} style={{ width: `${Math.min(level, 100)}%` }} />
      </div>
    </div>
  )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function App() {
  // State
  const [provider, setProvider] = useState('openai')
  const [apiKey, setApiKey] = useState('')
  const [showApiKeyInput, setShowApiKeyInput] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [response, setResponse] = useState('')
  const [history, setHistory] = useState([])
  const [responseSize, setResponseSize] = useState('medium')
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [autoSend, setAutoSend] = useState(true)
  const [audioLevel, setAudioLevel] = useState(0)
  const [userAudioLevel, setUserAudioLevel] = useState(0)
  const [audioDevices, setAudioDevices] = useState([])
  const [selectedDevice, setSelectedDevice] = useState('')
  const [audioSource, setAudioSource] = useState('both')
  const [desktopSources, setDesktopSources] = useState([])
  const [selectedSource, setSelectedSource] = useState('')
  const [listeningStatus, setListeningStatus] = useState('idle')
  // Model/temperature
  const OPENAI_MODELS = [
    {
      value: 'gpt-4.1-mini',
      label: 'GPT-4.1 Mini',
      supportsTemperature: true,
      multimodal: false,
    },

    {
      value: 'gpt-4o',
      label: 'GPT-4o (Multimodal)',
      supportsTemperature: true,
      multimodal: true,
    },

    // 🔹 Fast & cheap
    {
      value: 'gpt-4o-mini',
      label: 'GPT-4o Mini',
      supportsTemperature: true,
      multimodal: true,
    },

    // 🔹 High reasoning (text)
    {
      value: 'gpt-4.1',
      label: 'GPT-4.1',
      supportsTemperature: true,
      multimodal: false,
    },
    // 🔹 Reasoning-only (no temperature)
    {
      value: 'o3',
      label: 'O3 (Reasoning)',
      supportsTemperature: false,
      multimodal: false,
    },

    {
      value: 'o4-mini',
      label: 'O4 Mini (Reasoning)',
      supportsTemperature: false,
      multimodal: false,
    },
  ];


  const GEMINI_MODELS = [
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', supportsTemperature: true },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', supportsTemperature: true },
  { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', supportsTemperature: true },
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', supportsTemperature: true },
  { value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite', supportsTemperature: true },
];

  const [selectedModel, setSelectedModel] = useState(OPENAI_MODELS[0].value);
  const [temperature, setTemperature] = useState(1.0);

  // Refs
  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const analyserRef = useRef(null)
  const userAnalyserRef = useRef(null)
  const animationFrameRef = useRef(null)
  const streamRef = useRef(null)
  const audioContextRef = useRef(null)
  const isRecordingRef = useRef(false)
  const silenceTimeoutRef = useRef(null)
  const isSpeakingRef = useRef(false)
  const noiseFloorRef = useRef(0)
  const noiseFloorSamplesRef = useRef([])
  const peakLevelRef = useRef(0)
  const audioSourceRef = useRef('both')
  const speechStartTimeRef = useRef(null)

  // Sync refs with state
  useEffect(() => { audioSourceRef.current = audioSource }, [audioSource])
  // Show API key input when provider changes
  useEffect(() => {
    setShowApiKeyInput(true);
    if (provider === 'openai') setSelectedModel(OPENAI_MODELS[0].value);
    if (provider === 'gemini') setSelectedModel(GEMINI_MODELS[0].value);
  }, [provider]);

  // Load devices on mount
  useEffect(() => {
    async function loadDevices() {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true })
        const devices = await navigator.mediaDevices.enumerateDevices()
        const audioInputs = devices.filter(d => d.kind === 'audioinput')
        setAudioDevices(audioInputs)
        if (audioInputs.length > 0 && !selectedDevice) {
          setSelectedDevice(audioInputs[0].deviceId)
        }

        const sources = await window.electronAPI.getSources()
        setDesktopSources(sources)
        if (sources.length > 0 && !selectedSource) {
          const screen = sources.find(s => s.name.includes('Screen'))
          setSelectedSource(screen ? screen.id : sources[0].id)
        }
      } catch (err) {
        console.error('Failed to load devices:', err)
      }
    }
    loadDevices()
  }, [])

  // ---------------------------------------------------------------------------
  // AI & Transcription
  // ---------------------------------------------------------------------------
  async function askAI(promptText = prompt) {
    if (!promptText.trim()) return;
    setResponse('Processing...');

    console.log('Sending API key to backend:', apiKey); // Log the API key being sent

    const res = await window.electronAPI.generateAI({
      provider,
      prompt: promptText,
      responseSize,
      history,
      apiKey,
      model: selectedModel,
      temperature: provider === 'openai' || provider === 'gemini' ? temperature : undefined,
    });

    setHistory(h => [...h, { role: 'user', text: promptText }, { role: 'ai', text: res }]);
    setResponse(res);
    setPrompt('');
    return res;
  }

  async function processAudioChunk() {
    if (audioChunksRef.current.length === 0) {
      if (isRecordingRef.current) setListeningStatus('listening')
      return
    }

    const audioBlob = new Blob(audioChunksRef.current, { type: getAudioMimeType() })
    audioChunksRef.current = []

    if (audioBlob.size < 1000) {
      console.log('Audio blob too small:', audioBlob.size)
      if (isRecordingRef.current) setListeningStatus('listening')
      return
    }

    setListeningStatus('processing')
    setIsTranscribing(true)

    try {
      const arrayBuffer = await audioBlob.arrayBuffer()
      const uint8Array = new Uint8Array(arrayBuffer)
      
      console.log(`Sending audio: ${uint8Array.length} bytes`)
      
      const transcription = await window.electronAPI.transcribe(Array.from(uint8Array))
      
      // Check if result is an error or empty
      const isError = NO_SPEECH_PHRASES.some(p => transcription?.includes(p))
      
      if (isError) {
        console.log('Transcription skipped:', transcription)
      } else if (transcription?.trim()) {
        setPrompt(transcription)
        setResponse(`Transcribed: "${transcription}"`)
        if (autoSend) await askAI(transcription)
      }
    } catch (err) {
      console.error('Transcription error:', err)
    }

    setIsTranscribing(false)
    if (isRecordingRef.current) setListeningStatus('listening')
  }

  // ---------------------------------------------------------------------------
  // MediaRecorder
  // ---------------------------------------------------------------------------
  function createMediaRecorder(stream) {
    const recorder = new MediaRecorder(stream, { mimeType: getAudioMimeType() })

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunksRef.current.push(event.data)
      }
    }

    recorder.onstop = async () => {
      // Process the recorded audio
      await processAudioChunk()
    }

    return recorder
  }

  // ---------------------------------------------------------------------------
  // Audio Streams
  // ---------------------------------------------------------------------------
  async function getMicrophoneStream() {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: selectedDevice ? { exact: selectedDevice } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    })
  }

  async function getSystemAudioStream() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: selectedSource } },
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: selectedSource, maxWidth: 1, maxHeight: 1 } }
    })
    stream.getVideoTracks().forEach(track => track.stop())
    return stream
  }

  async function getAudioStream() {
    if (audioSource === 'user') return getMicrophoneStream()
    if (audioSource === 'interviewer') return getSystemAudioStream()

    // Both - setup AudioContext for mixing
    const audioContext = new (window.AudioContext || window.webkitAudioContext)()
    audioContextRef.current = audioContext
    if (audioContext.state === 'suspended') await audioContext.resume()

    const destination = audioContext.createMediaStreamDestination()
    let systemStream, micStream
    // System audio
    try {
      systemStream = await getSystemAudioStream()
      const systemSource = audioContext.createMediaStreamSource(systemStream)
      const systemGain = audioContext.createGain()
      systemSource.connect(systemGain)
      systemGain.connect(destination)
      // System analyser for VAD
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      systemGain.connect(analyser)
      analyserRef.current = analyser
    } catch (err) {
      console.error('System audio failed:', err)
    }

    // Microphone
    try {
      micStream = await getMicrophoneStream()
      const micSource = audioContext.createMediaStreamSource(micStream)
      const micGain = audioContext.createGain()
      micSource.connect(micGain)
      micGain.connect(destination)
      // Mic analyser for VAD
      const userAnalyser = audioContext.createAnalyser()
      userAnalyser.fftSize = 256
      micGain.connect(userAnalyser)
      userAnalyserRef.current = userAnalyser
    } catch (err) {
      console.error('Microphone failed:', err)
    }

    // Always return the mixed destination stream for recording in 'both' mode
    streamRef.current = destination.stream
    return destination.stream
  }

  // ---------------------------------------------------------------------------
  // Voice Activity Detection
  // ---------------------------------------------------------------------------
  function startAudioLevelMonitoring() {
    const dataArray = new Uint8Array(128)
    const userDataArray = new Uint8Array(128)
    const timeDomainData = new Uint8Array(128)

    const updateLevel = () => {
      if (!isRecordingRef.current) return

      let currentLevel = 0

      if (analyserRef.current) {
        const level = getAudioLevel(analyserRef.current, dataArray, timeDomainData)
        currentLevel = Math.max(currentLevel, level)
        setAudioLevel(level)
      }

      if (userAnalyserRef.current && audioSourceRef.current === 'both') {
        const level = getAudioLevel(userAnalyserRef.current, userDataArray, timeDomainData)
        currentLevel = Math.max(currentLevel, level)
        setUserAudioLevel(level)
      }

      // Update noise floor
      if (!isSpeakingRef.current) {
        noiseFloorSamplesRef.current.push(currentLevel)
        if (noiseFloorSamplesRef.current.length > VAD_CONFIG.noiseFloorSamples) {
          noiseFloorSamplesRef.current.shift()
        }
        noiseFloorRef.current = noiseFloorSamplesRef.current.reduce((a, b) => a + b, 0) / noiseFloorSamplesRef.current.length
      }

      // Calculate threshold
      const isSystem = audioSourceRef.current === 'interviewer'
      const config = isSystem ? VAD_CONFIG.system : VAD_CONFIG.mic
      const threshold = Math.max(config.baseThreshold, noiseFloorRef.current + config.noiseMargin)

      if (isSpeakingRef.current && currentLevel > peakLevelRef.current) {
        peakLevelRef.current = currentLevel
      }

      // VAD Logic - automatic speech detection
      if (streamRef.current) {
        const isSoundDetected = currentLevel > threshold

        if (isSoundDetected) {
          if (!isSpeakingRef.current) {
            isSpeakingRef.current = true
            peakLevelRef.current = currentLevel
            speechStartTimeRef.current = Date.now()
            setListeningStatus('speaking')

            // Create fresh MediaRecorder and start recording
            if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
              audioChunksRef.current = []
              try { 
                mediaRecorderRef.current = createMediaRecorder(streamRef.current)
                mediaRecorderRef.current.start(100) 
              } catch (e) { 
                console.error('Failed to start recorder:', e) 
              }
            }
          }

          if (silenceTimeoutRef.current) {
            clearTimeout(silenceTimeoutRef.current)
            silenceTimeoutRef.current = null
          }
        } else if (isSpeakingRef.current && !silenceTimeoutRef.current) {
          silenceTimeoutRef.current = setTimeout(() => handleSilenceTimeout(), VAD_CONFIG.silenceDuration)
        }
      }

      if (isRecordingRef.current) {
        animationFrameRef.current = requestAnimationFrame(updateLevel)
      }
    }

    updateLevel()
  }

  function handleSilenceTimeout() {
    const speechDuration = Date.now() - (speechStartTimeRef.current || Date.now())
    const isSystem = audioSourceRef.current === 'interviewer'
    const minPeak = isSystem ? VAD_CONFIG.system.baseThreshold : VAD_CONFIG.mic.baseThreshold

    if (speechDuration >= VAD_CONFIG.minSpeechDuration && peakLevelRef.current > minPeak) {
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop()
      }
    } else {
      discardRecording()
    }

    isSpeakingRef.current = false
    peakLevelRef.current = 0
    noiseFloorSamplesRef.current = []
    silenceTimeoutRef.current = null
  }

  function discardRecording() {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.onstop = () => {
        audioChunksRef.current = []
        // Recorder will be recreated when speech is detected again
        setListeningStatus('listening')
      }
      mediaRecorderRef.current.stop()
    } else {
      audioChunksRef.current = []
      setListeningStatus('listening')
    }
  }

  // ---------------------------------------------------------------------------
  // Recording Controls
  // ---------------------------------------------------------------------------
  async function startRecording() {
    try {
      const stream = await getAudioStream()
      if (!stream || stream.getAudioTracks().length === 0) {
        throw new Error('No audio tracks available')
      }

      streamRef.current = stream

      // Setup analyser for single-source modes
      if (audioSource !== 'both') {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)()
        audioContextRef.current = audioContext
        const source = audioContext.createMediaStreamSource(stream)
        const analyser = audioContext.createAnalyser()
        analyser.fftSize = 256
        source.connect(analyser)
        analyserRef.current = analyser
      }

      isRecordingRef.current = true
      noiseFloorRef.current = 0
      noiseFloorSamplesRef.current = []
      
      startAudioLevelMonitoring()

      // In continuous mode, don't create recorder yet - VAD will create it
      // In PTT mode, we wait for user to press the button
      
      setIsRecording(true)
      setListeningStatus('listening')
    } catch (err) {
      console.error('Recording error:', err)
      setResponse(`Recording error: ${err.message}`)
    }
  }

  function stopRecording() {
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current)
      silenceTimeoutRef.current = null
    }

    isSpeakingRef.current = false
    isRecordingRef.current = false
    setIsRecording(false)
    setListeningStatus('idle')
    setAudioLevel(0)
    setUserAudioLevel(0)

    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
    if (mediaRecorderRef.current?.state !== 'inactive') mediaRecorderRef.current?.stop()
    streamRef.current?.getTracks().forEach(track => track.stop())
    audioContextRef.current?.close()
    audioContextRef.current = null
  }

  function toggleRecording() {
    isRecording ? stopRecording() : startRecording()
  }

  // ---------------------------------------------------------------------------
  // Computed Values
  // ---------------------------------------------------------------------------
  const currentThreshold = Math.round(Math.max(
    audioSource === 'interviewer' ? VAD_CONFIG.system.baseThreshold : VAD_CONFIG.mic.baseThreshold,
    noiseFloorRef.current + (audioSource === 'interviewer' ? VAD_CONFIG.system.noiseMargin : VAD_CONFIG.mic.noiseMargin)
  ))

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-4xl font-bold text-blue-600 mb-6">InterviewCracker</h1>

      {/* Settings */}
      <div className="flex flex-wrap gap-4 items-center mb-4">
        <label className="font-semibold">
          Provider:
          <select value={provider} onChange={e => setProvider(e.target.value)} className="ml-2 px-2 py-1 border rounded">
            <option value="gemini">Google Gemini</option>
            <option value="openai">OpenAI</option>
          </select>
        </label>

        {showApiKeyInput && (
          <label className="font-semibold">
            API Key:
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              className="ml-2 px-2 py-1 border rounded w-64"
              placeholder={`Enter your ${provider === 'openai' ? 'OpenAI' : 'Gemini'} API key`}
            />
          </label>
        )}

        <label className="font-semibold">
          Model:
          <select
            value={selectedModel}
            onChange={e => {
              const model = e.target.value;
              setSelectedModel(model);
              const selected = OPENAI_MODELS.find(m => m.value === model);
              if (selected && !selected.supportsTemperature) {
                setTemperature(null); // Disable temperature if not supported
              } else {
                setTemperature(1.0); // Reset to default if supported
              }
            }}
            className="ml-2 px-2 py-1 border rounded"
          >
            {(provider === 'openai' ? OPENAI_MODELS : GEMINI_MODELS).map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </label>

        {(provider === 'openai' || provider === 'gemini') && (OPENAI_MODELS.concat(GEMINI_MODELS).find(m => m.value === selectedModel)?.supportsTemperature) && (
          <div className="mb-3">
            <label className="text-sm font-medium text-gray-700">Temperature:</label>
            <input
              type="number"
              value={temperature}
              onChange={e => setTemperature(parseFloat(e.target.value))}
              className="p-1 border rounded text-sm w-full"
              min="0"
              max="2"
              step="0.1"
            />
          </div>
        )}

        <label className="font-semibold">
          Response Size:
          <select value={responseSize} onChange={e => setResponseSize(e.target.value)} className="ml-2 px-2 py-1 border rounded">
            <option value="small">Short (256 tokens)</option>
            <option value="medium">Medium (1024 tokens)</option>
            <option value="large">Detailed (4096 tokens)</option>
          </select>
        </label>

        <label className="flex items-center gap-2 font-semibold">
          <input type="checkbox" checked={true} disabled className="w-4 h-4" />
          Auto-send
        </label>
      </div>
      {/* Reset Button */}
      <button
        onClick={() => {
          setApiKey('');
          setSelectedModel(provider === 'openai' ? OPENAI_MODELS[0].value : GEMINI_MODELS[0].value);
          setTemperature(1.0);
          setResponseSize('medium');
          setPrompt('');
        }}
        className="px-4 py-2 bg-gray-500 text-white rounded-lg shadow hover:bg-gray-600 mb-3"
      >
        Reset to Defaults
      </button>

      <div className="mb-4 p-4 bg-gray-50 rounded-lg border">
        <div className="mb-3 flex items-center gap-4 flex-wrap">
          <label className="text-sm font-medium text-gray-700">Capture:</label>
          {['both', 'interviewer', 'user'].map(src => (
            <label key={src} className="flex items-center gap-1">
              <input type="radio" name="audioSource" value={src} checked={audioSource === src} onChange={e => setAudioSource(e.target.value)} disabled={isRecording} />
              <span className="text-sm">{src === 'both' ? 'Both' : src === 'interviewer' ? 'Interviewer' : 'My Mic'}</span>
            </label>
          ))}
        </div>

        {/* Device Selectors */}
        <div className="mb-3 flex flex-wrap gap-3 text-sm">
          {(audioSource === 'both' || audioSource === 'interviewer') && (
            <label className="flex items-center gap-1">
              <span className="text-gray-600">Screen:</span>
              <select value={selectedSource} onChange={e => setSelectedSource(e.target.value)} className="p-1 border rounded text-sm max-w-[150px]" disabled={isRecording}>
                {desktopSources.map(s => <option key={s.id} value={s.id}>{s.name.slice(0, 20)}</option>)}
              </select>
            </label>
          )}

          {(audioSource === 'both' || audioSource === 'user') && (
            <label className="flex items-center gap-1">
              <span className="text-gray-600">Mic:</span>
              <select value={selectedDevice} onChange={e => setSelectedDevice(e.target.value)} className="p-1 border rounded text-sm max-w-[220px]" disabled={isRecording}>
                {audioDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{getMicDisplayName(d)}</option>)}
              </select>
            </label>
          )}
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          <div className="relative">
            <button
              onClick={() => {
                if (!apiKey) return;
                toggleRecording();
              }}
              disabled={!apiKey || (isTranscribing && !isRecording)}
              className={`px-6 py-3 rounded-full shadow font-semibold flex items-center gap-2 ${isRecording ? 'bg-red-600 text-white' : 'bg-purple-600 text-white hover:bg-purple-700'} ${(!apiKey || (isTranscribing && !isRecording)) ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {isRecording ? (
                <><span className="w-3 h-3 bg-white rounded-full animate-pulse" /> Stop</>
              ) : (
                <>🎤 {isTranscribing ? 'Transcribing...' : 'Start'}</>
              )}
            </button>
            {!apiKey && (
              <p className="text-xs text-red-500 mt-1">Please enter your API key to enable this button.</p>
            )}
          </div>

          {isRecording && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                {listeningStatus === 'listening' && (
                  <span className="text-blue-600 font-semibold flex items-center gap-1">
                    <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                    👂 Listening (lvl: {Math.round(audioLevel)}, thr: {currentThreshold})
                  </span>
                )}

                {listeningStatus === 'speaking' && (
                  <span className="text-green-600 font-semibold flex items-center gap-1">
                    <span className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
                    🎙️ Recording ({Math.round(audioLevel)})
                  </span>
                )}
                
                {listeningStatus === 'processing' && (
                  <span className="text-purple-600 font-semibold flex items-center gap-1">
                    <span className="w-2 h-2 bg-purple-500 rounded-full animate-spin" />
                    ⏳ Processing...
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-1">
                {(audioSource === 'both' || audioSource === 'interviewer') && <AudioMeter label="System" level={audioLevel} />}
                {(audioSource === 'both' || audioSource === 'user') && <AudioMeter label="Mic" level={audioSource === 'both' ? userAudioLevel : audioLevel} />}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Prompt */}
      <textarea
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        className="w-full h-32 p-3 border rounded mb-4"
        placeholder="Type question or use microphone..."
      />
      <button onClick={() => askAI()} disabled={!prompt.trim()} className="px-4 py-2 bg-green-600 text-white rounded shadow hover:bg-green-700 disabled:opacity-50">
        Ask AI
      </button>

      {/* Response */}
      <div className="mt-6 p-4 bg-white shadow rounded min-h-[100px] prose prose-sm max-w-none">
        <ReactMarkdown>{response}</ReactMarkdown>
      </div>

      {/* History */}
      <h2 className="mt-6 text-xl font-bold flex items-center justify-between">
        <span>Conversation ({history.length})</span>
        {history.length > 0 && (
          <button onClick={async () => { 
            if (confirm('Clear history?')) { 
              setHistory([])
              setResponse('')
              // Clear OpenAI thread for fresh conversation
              if (provider === 'openai') {
                await window.electronAPI.clearThread({ provider })
              }
            } 
          }} className="text-sm px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600">
            Clear
          </button>
        )}
      </h2>
      
      <div className="space-y-4 mt-2">
        {[...history].reverse().map((h, i) => (
          <div key={i} className={h.role === 'user' ? 'p-3 bg-blue-50 rounded border-l-4 border-blue-500' : 'p-3 bg-green-50 rounded border-l-4 border-green-500 prose prose-sm max-w-none'}>
            <span className="font-bold">{h.role === 'user' ? 'You' : 'AI'}:</span>
            {h.role === 'ai' ? <ReactMarkdown>{h.text}</ReactMarkdown> : <span className="ml-2">{h.text}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
