import React, { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'

export default function App() {
  const [provider, setProvider] = useState('openai')
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
  
  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const analyserRef = useRef(null)
  const userAnalyserRef = useRef(null)
  const animationFrameRef = useRef(null)
  const streamRef = useRef(null)
  const isRecordingRef = useRef(false)
  const audioContextRef = useRef(null)

  // Load available audio input devices and desktop sources
  useEffect(() => {
    async function loadDevices() {
      try {
        // Request microphone permission first
        await navigator.mediaDevices.getUserMedia({ audio: true })
        const devices = await navigator.mediaDevices.enumerateDevices()
        const audioInputs = devices.filter(d => d.kind === 'audioinput')
        setAudioDevices(audioInputs)
        if (audioInputs.length > 0 && !selectedDevice) {
          setSelectedDevice(audioInputs[0].deviceId)
        }
        
        // Load desktop sources for system audio
        const sources = await window.electronAPI.getSources()
        setDesktopSources(sources)
        if (sources.length > 0 && !selectedSource) {
          // Try to find "Entire Screen" or first screen
          const screen = sources.find(s => s.name.includes('Entire Screen') || s.name.includes('Screen'))
          setSelectedSource(screen ? screen.id : sources[0].id)
        }
      } catch (err) {
        console.error('Failed to load devices:', err)
      }
    }
    loadDevices()
  }, [])

  async function askAI(promptText = prompt) {
    if (!promptText.trim()) return
    setResponse('Processing...')
    // Send history along with the prompt for context
    const res = await window.electronAPI.generateAI({ provider, prompt: promptText, responseSize, history })
    setHistory(h => [...h, { role: 'user', text: promptText }, { role: 'ai', text: res }])
    setResponse(res)
    setPrompt('')
  }

  async function startRecording() {
    try {
      let stream;
      
      // For simplicity, use direct stream capture based on mode
      if (audioSource === 'user') {
        // Just capture microphone directly
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: selectedDevice ? { exact: selectedDevice } : undefined,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        })
      } else if (audioSource === 'interviewer') {
        // Just capture system audio
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: selectedSource
            }
          },
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: selectedSource,
              maxWidth: 1,
              maxHeight: 1
            }
          }
        })
        stream.getVideoTracks().forEach(track => track.stop())
      } else {
        // Both - mix audio streams
        const audioContext = new (window.AudioContext || window.webkitAudioContext)()
        audioContextRef.current = audioContext
        const destination = audioContext.createMediaStreamDestination()
        
        // Get system audio
        try {
          const systemStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: selectedSource
              }
            },
            video: {
              mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: selectedSource,
                maxWidth: 1,
                maxHeight: 1
              }
            }
          })
          systemStream.getVideoTracks().forEach(track => track.stop())
          const systemSource = audioContext.createMediaStreamSource(systemStream)
          systemSource.connect(destination)
          
          const analyser = audioContext.createAnalyser()
          analyser.fftSize = 256
          systemSource.connect(analyser)
          analyserRef.current = analyser
        } catch (err) {
          console.error('System audio failed:', err)
        }
        
        // Get microphone
        try {
          const micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              deviceId: selectedDevice ? { exact: selectedDevice } : undefined,
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            }
          })
          const micSource = audioContext.createMediaStreamSource(micStream)
          micSource.connect(destination)
          
          const userAnalyser = audioContext.createAnalyser()
          userAnalyser.fftSize = 256
          micSource.connect(userAnalyser)
          userAnalyserRef.current = userAnalyser
        } catch (err) {
          console.error('Mic failed:', err)
        }
        
        stream = destination.stream
      }
      
      if (!stream || stream.getAudioTracks().length === 0) {
        throw new Error('No audio tracks available')
      }
      
      streamRef.current = stream
      
      // Set up audio level monitoring for single-source modes
      if (audioSource !== 'both') {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)()
        audioContextRef.current = audioContext
        const source = audioContext.createMediaStreamSource(stream)
        const analyser = audioContext.createAnalyser()
        analyser.fftSize = 256
        source.connect(analyser)
        analyserRef.current = analyser
      }
      
      // Start monitoring audio levels
      const dataArray = new Uint8Array(128)
      const userDataArray = new Uint8Array(128)
      const updateLevel = () => {
        if (analyserRef.current) {
          analyserRef.current.getByteFrequencyData(dataArray)
          const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
          setAudioLevel(Math.min(100, avg * 2))
        }
        if (userAnalyserRef.current && audioSource === 'both') {
          userAnalyserRef.current.getByteFrequencyData(userDataArray)
          const userAvg = userDataArray.reduce((a, b) => a + b, 0) / userDataArray.length
          setUserAudioLevel(Math.min(100, userAvg * 2))
        }
        if (isRecordingRef.current) {
          animationFrameRef.current = requestAnimationFrame(updateLevel)
        }
      }
      updateLevel()
      
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        console.log('Data available:', event.data.size)
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = async () => {
        console.log('Recording stopped, chunks:', audioChunksRef.current.length)
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        console.log('Audio blob size:', audioBlob.size)
        const arrayBuffer = await audioBlob.arrayBuffer()
        const uint8Array = new Uint8Array(arrayBuffer)
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop())
        if (audioContextRef.current) {
          audioContextRef.current.close()
        }
        
        // Transcribe
        setIsTranscribing(true)
        setResponse('Transcribing audio...')
        
        try {
          const transcription = await window.electronAPI.transcribe(Array.from(uint8Array))
          
          if (transcription && !transcription.startsWith('Error:')) {
            // Check if speech was actually detected
            const noSpeechPhrases = ['No speech detected', '[BLANK_AUDIO]', 'please check your microphone']
            const isNoSpeech = noSpeechPhrases.some(phrase => transcription.includes(phrase))
            
            if (isNoSpeech) {
              // Don't send to AI, just show the message
              setPrompt('')
              setResponse('🎤 No speech detected - please speak clearly and try again')
            } else {
              setPrompt(transcription)
              setResponse(`Transcribed: "${transcription}"`)
              
              // Auto-send if enabled
              if (autoSend) {
                setTimeout(() => askAI(transcription), 500)
              }
            }
          } else {
            setResponse(transcription || 'Transcription failed')
          }
        } catch (err) {
          setResponse(`Transcription error: ${err.message}`)
        }
        
        setIsTranscribing(false)
      }

      mediaRecorder.start(1000) // Get data every second
      setIsRecording(true)
      isRecordingRef.current = true
      console.log('Recording started')
    } catch (err) {
      console.error('Recording error:', err)
      setResponse(`Recording error: ${err.message}`)
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      isRecordingRef.current = false
      setAudioLevel(0)
      setUserAudioLevel(0)
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }

  function toggleRecording() {
    if (isRecording) {
      stopRecording()
    } else {
      startRecording()
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-4xl font-bold text-blue-600 mb-6">InterviewCracker</h1>

      <div className="flex flex-wrap gap-4 items-center mb-4">
        <label className="font-semibold">
          Provider:
          <select
            value={provider}
            onChange={e => setProvider(e.target.value)}
            className="ml-2 px-2 py-1 border rounded"
          >
            <option value="gemini">Google Gemini</option>
            <option value="openai">OpenAI</option>
          </select>
        </label>

        <label className="font-semibold">
          Response Size:
          <select
            value={responseSize}
            onChange={e => setResponseSize(e.target.value)}
            className="ml-2 px-2 py-1 border rounded"
          >
            <option value="small">Short (256 tokens)</option>
            <option value="medium">Medium (1024 tokens)</option>
            <option value="large">Detailed (4096 tokens)</option>
          </select>
        </label>

        <label className="flex items-center gap-2 font-semibold">
          <input
            type="checkbox"
            checked={autoSend}
            onChange={e => setAutoSend(e.target.checked)}
            className="w-4 h-4"
          />
          Auto-send after transcription
        </label>
      </div>

      {/* Voice Recording Section */}
      <div className="mb-4 p-4 bg-gray-50 rounded-lg border">
        {/* Audio Source Selector */}
        <div className="mb-3 flex items-center gap-4 flex-wrap">
          <label className="text-sm font-medium text-gray-700">Capture:</label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="audioSource"
              value="both"
              checked={audioSource === 'both'}
              onChange={e => setAudioSource(e.target.value)}
              disabled={isRecording}
            />
            <span className="text-sm">Both</span>
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="audioSource"
              value="interviewer"
              checked={audioSource === 'interviewer'}
              onChange={e => setAudioSource(e.target.value)}
              disabled={isRecording}
            />
            <span className="text-sm">Interviewer Only</span>
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="audioSource"
              value="user"
              checked={audioSource === 'user'}
              onChange={e => setAudioSource(e.target.value)}
              disabled={isRecording}
            />
            <span className="text-sm">My Mic Only</span>
          </label>
        </div>
        
        {/* Device Selectors - Compact Row */}
        <div className="mb-3 flex flex-wrap gap-3 text-sm">
          {(audioSource === 'both' || audioSource === 'interviewer') && (
            <label className="flex items-center gap-1">
              <span className="text-gray-600">Screen:</span>
              <select
                value={selectedSource}
                onChange={e => setSelectedSource(e.target.value)}
                className="p-1 border rounded text-sm max-w-[150px]"
                disabled={isRecording}
              >
                {desktopSources.map(source => (
                  <option key={source.id} value={source.id}>
                    {source.name.length > 20 ? source.name.slice(0, 20) + '...' : source.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          
          {(audioSource === 'both' || audioSource === 'user') && (
            <label className="flex items-center gap-1">
              <span className="text-gray-600">Mic:</span>
              <select
                value={selectedDevice}
                onChange={e => setSelectedDevice(e.target.value)}
                className="p-1 border rounded text-sm max-w-[180px]"
                disabled={isRecording}
              >
                {audioDevices.map(device => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {(device.label || 'Default').replace(/\s*\(.*?\)\s*/g, '').slice(0, 25)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        
        <div className="flex items-center gap-4">
          <button
            onClick={toggleRecording}
            disabled={isTranscribing}
            className={`px-6 py-3 rounded-full shadow font-semibold flex items-center gap-2 ${
              isRecording 
                ? 'bg-red-600 text-white animate-pulse' 
                : 'bg-purple-600 text-white hover:bg-purple-700'
            } ${isTranscribing ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {isRecording ? (
              <>
                <span className="w-3 h-3 bg-white rounded-full"></span>
                Stop Recording
              </>
            ) : (
              <>
                🎤 {isTranscribing ? 'Transcribing...' : 'Start Recording'}
              </>
            )}
          </button>
          
          {isRecording && (
            <div className="flex flex-col gap-2">
              <span className="text-red-600 font-semibold animate-pulse">
                ● Recording...
              </span>
              {/* Audio Level Meters */}
              <div className="flex flex-col gap-1">
                {(audioSource === 'both' || audioSource === 'interviewer') && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-16">System:</span>
                    <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div 
                        className={`h-full transition-all duration-75 ${
                          audioLevel > 50 ? 'bg-green-500' : audioLevel > 20 ? 'bg-yellow-500' : 'bg-red-500'
                        }`}
                        style={{ width: `${audioLevel}%` }}
                      ></div>
                    </div>
                  </div>
                )}
                {(audioSource === 'both' || audioSource === 'user') && (
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-500 w-16">Mic:</span>
                    <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div 
                        className={`h-full transition-all duration-75 ${
                          (audioSource === 'both' ? userAudioLevel : audioLevel) > 50 ? 'bg-green-500' : 
                          (audioSource === 'both' ? userAudioLevel : audioLevel) > 20 ? 'bg-yellow-500' : 'bg-red-500'
                        }`}
                        style={{ width: `${audioSource === 'both' ? userAudioLevel : audioLevel}%` }}
                      ></div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          
          {isTranscribing && (
            <span className="text-purple-600 font-semibold">
              ⏳ Transcribing...
            </span>
          )}
        </div>
      </div>

      <textarea
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        className="w-full h-32 p-3 border rounded mb-4"
        placeholder="Type or paste interview question... or use the microphone above"
      />

      <button
        onClick={() => askAI()}
        disabled={!prompt.trim()}
        className="px-4 py-2 bg-green-600 text-white rounded shadow hover:bg-green-700 disabled:opacity-50"
      >
        Ask AI
      </button>

      <div className="mt-6 p-4 bg-white shadow rounded min-h-[100px] prose prose-sm max-w-none">
        <ReactMarkdown>{response}</ReactMarkdown>
      </div>

      <h2 className="mt-6 text-xl font-bold flex items-center justify-between">
        <span>Conversation ({history.length} messages)</span>
        {history.length > 0 && (
          <button
            onClick={() => {
              if (confirm('Clear all conversation history?')) {
                setHistory([])
                setResponse('')
              }
            }}
            className="text-sm px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600"
          >
            Clear History
          </button>
        )}
      </h2>
      <div className="space-y-4 mt-2">
        {[...history].reverse().map((h, i) => (
          <div
            key={i}
            className={
              h.role === 'user'
                ? 'p-3 bg-blue-50 rounded border-l-4 border-blue-500'
                : 'p-3 bg-green-50 rounded border-l-4 border-green-500 prose prose-sm max-w-none'
            }
          >
            <span className="font-bold">{h.role === 'user' ? 'You' : 'AI'}:</span>
            {h.role === 'ai' ? <ReactMarkdown>{h.text}</ReactMarkdown> : <span className="ml-2">{h.text}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
