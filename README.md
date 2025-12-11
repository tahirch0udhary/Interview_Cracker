# 🎯 InterviewCracker

An AI-powered desktop application that helps you ace your interviews in real-time. It captures audio from your microphone and/or system audio, transcribes speech using local Whisper AI, and provides instant, professional answers using OpenAI GPT or Google Gemini.

## ✨ Features

- 🎤 **Real-time Audio Capture** - Record from microphone, system audio, or both simultaneously
- 🗣️ **Local Speech-to-Text** - Uses Whisper.cpp for fast, private transcription (no cloud required)
- 🤖 **AI-Powered Answers** - Get professional interview responses from OpenAI GPT-4o-mini or Google Gemini
- 📝 **Response Size Control** - Choose between short, medium, or detailed answers
- 💬 **Conversation History** - Maintains context throughout your interview session
- 🔒 **Privacy First** - Audio transcription happens locally on your machine

## 📋 Prerequisites

- **Node.js** (v18 or higher)
- **npm** (v9 or higher)
- **Whisper.cpp binaries** (included in `/whisper` folder)
- **API Keys** for OpenAI and/or Google Gemini

## 🚀 Installation

### 1. Clone the repository

```bash
git clone https://github.com/tahirch0udhary/Interview_Cracker.git
cd Interview_Cracker
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure API Keys

Create or edit `config.json` in the root directory:

```json
{
  "gemini_api_key": "YOUR_GEMINI_API_KEY",
  "openai_api_key": "YOUR_OPENAI_API_KEY",
  "whisper_binary_path": "./whisper/main.exe",
  "whisper_model": "./whisper/ggml-base.bin"
}
```

**Get your API keys:**
- OpenAI: https://platform.openai.com/api-keys
- Google Gemini: https://makersuite.google.com/app/apikey

### 4. Whisper Setup

The `/whisper` folder should contain:
- `main.exe` - Whisper.cpp binary
- `ggml-base.bin` - Whisper model file

If not present, download from [whisper.cpp releases](https://github.com/ggerganov/whisper.cpp/releases) and the model from [Hugging Face](https://huggingface.co/ggerganov/whisper.cpp).

## 🏃 Running the App

### Development Mode

```bash
npm run dev
```

This starts both the Vite dev server and Electron app with hot-reload.

### Production Build

```bash
npm run build:react
npm run package
```

## 🎮 Usage

1. **Select AI Provider** - Choose between OpenAI or Google Gemini
2. **Set Response Size** - Short (concise), Medium (balanced), or Large (detailed)
3. **Choose Audio Source**:
   - **User** - Your microphone only
   - **Interviewer** - System/desktop audio only
   - **Both** - Capture both simultaneously
4. **Click Record** - Start capturing audio
5. **Speak or let the interviewer speak** - The app transcribes in real-time
6. **Click Stop** - Audio is transcribed and sent to AI for a professional response
7. **Auto-send** - Enable to automatically send transcribed text to AI

## 📁 Project Structure

```
Interview_Cracker/
├── electron/
│   ├── main.js              # Electron main process
│   ├── preload.js           # Preload script for IPC
│   └── ai-workers/
│       ├── openai_client.js  # OpenAI API integration
│       ├── gemini_client.js  # Google Gemini integration
│       └── whisper_worker.js # Local Whisper transcription
├── src/
│   ├── App.jsx              # Main React component
│   ├── main.jsx             # React entry point
│   └── renderer.css         # Tailwind CSS styles
├── whisper/                  # Whisper.cpp binaries & models
├── config.json              # API keys configuration
└── package.json
```

## ⚙️ Configuration Options

| Option | Description |
|--------|-------------|
| `gemini_api_key` | Your Google Gemini API key |
| `openai_api_key` | Your OpenAI API key |
| `whisper_binary_path` | Path to whisper.cpp executable |
| `whisper_model` | Path to Whisper model file |

## 🔧 Troubleshooting

### "No speech detected"
- Ensure your microphone is properly connected and selected
- Speak clearly and at a normal volume
- Check the audio level indicator while recording

### Transcription quality is poor
- Use a better Whisper model (download `ggml-small.bin` or `ggml-medium.bin`)
- Reduce background noise
- Speak closer to the microphone

### API errors
- Verify your API keys are correct in `config.json`
- Check your API usage limits
- Ensure you have internet connectivity

## 📄 License

MIT License

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

**⚠️ Disclaimer:** This tool is intended for interview preparation and practice purposes. Please use it ethically and responsibly.
