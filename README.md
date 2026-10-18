# SoundSight

**A voice-first STEM study workspace for blind and visually impaired students.**

SoundSight turns STEM material (code, flowcharts, formulas, diagrams, graphs, tables and notes) into clear spoken explanations. A student can scan or upload content, hear it explained, save it, revise it with a voice quiz, and ask an AI study companion questions, all without needing to see the screen.

> "See less. Understand more. Learn independently."

---

## Features

### Capture and analysis
- **Camera scanner** with a live preview and stability, sharpness and lighting indicators. Say "Capture" or press Enter.
- **Upload** images from the file picker, or open files by voice from a dedicated folder (images, PDF, Word, PowerPoint, text, CSV, Markdown).
- **Visual STEM understanding** using Gemini vision. The actual image is the source of truth, and OCR text is only supporting evidence.
- **STEM vs non-STEM detection.** Posters, selfies, ads and other non-STEM content are rejected and never saved. Words like "Programmers Club" alone do not count as code.
- **Typed explanations** for Code (line by line), Flowchart (in execution order), Formula (spoken math and symbol meanings), Diagram (components and layout), Graph, Table and Text.
- **Layered fallbacks:** Gemini (three models in order), then a Groq vision model, then local analysis. Local analysis refuses to invent content when there is too little real text.
- **Text-only analysis** for documents (PDF, Word, PowerPoint, text) using the same STEM classification.

### Listening and speaking
- **Continuous voice recognition** with command matching that tolerates mishearing (fuzzy matching, natural phrases like "please open settings").
- **Barge-in:** commands work while SoundSight is speaking (pause, continue, repeat, speed changes, navigation, stop).
- **Text-to-speech controller** with pause, resume, repeat, stop, and slow, normal and fast speeds. Long text is chunked, and a watchdog recovers from stalled browser speech.
- **Sound cues** (earcons) for listening, command accepted, analysis complete and errors.
- **Keyboard access:** Space toggles the microphone, Escape stops audio or closes the camera, and keys 1 to 6 open dashboard cards.

### Learning history
- Every STEM result is saved automatically, including its structure, so saved flowcharts, formulas and code keep their detail.
- Open by number ("open item two") or by topic name, with fuzzy matching and a clarifying question when more than one topic matches.

### Revision
Pick a saved topic by number or name, then choose a mode:
- **Quiz:** five questions asked one at a time, answered by voice. A correct answer moves on. A wrong answer is explained, then the quiz continues. A final score is announced. Answers are marked by AI, so different wording of the right answer still counts, with a keyword-match fallback if the AI is down. Say "skip" or "I don't know" to pass a question and "stop quiz" to leave.
- **Quick, Detailed and Exam Revision** with spoken summaries and tips.
- **Ask AI** about the current topic only.

### Ask AI
- **Dashboard Ask AI:** a general study assistant. It never sees scans, uploads, history or revision content.
- **Section popups** (Scanner/Explanation, Upload, History, Revision): answer using only that page's content.
- Each conversation is stored separately by source and content, so chats never mix across pages.
- Answers are plain spoken text with no markdown, so text-to-speech reads them naturally.
- Quick actions: Explain simply, Give an example, Teach me, Quiz me, plus Stop, Repeat and New Chat.

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Python, Flask |
| AI analysis | Google Gemini (vision and text), Groq vision backup |
| Ask AI and quizzes | Gemini first, OpenAI-compatible backup (for example Groq) |
| OCR | Tesseract.js running in the browser (bundled in `frontend/js/vendor`) |
| Voice | Browser Web Speech API (recognition and synthesis) |
| Frontend | Vanilla JavaScript, HTML and CSS, no framework |
| Storage | JSON files in `backend/data/` |
| Optional file support | PyMuPDF (PDF), python-docx (Word), python-pptx (PowerPoint), pillow-heif (HEIC photos) |

OCR runs in the browser, so no system Tesseract installation is needed.

## Project structure

```
soundsight/
├── .env                          # API keys (never commit)
├── backend/
│   ├── server.py                 # Flask app and all API routes
│   ├── stem_engine.py            # STEM classification, Gemini/Groq analysis, revision
│   └── data/
│       ├── history.json          # Saved STEM items
│       ├── ai_chats.json         # Ask AI conversations
│       └── voice_uploads/        # Folder for opening files by voice
└── frontend/
    ├── index.html
    ├── css/styles.css
    ├── assets/hero_student.jpg
    └── js/
        ├── app.js                # Views, navigation, voice command wiring
        ├── voice-manager.js      # Speech recognition, intents, barge-in
        ├── tts-controller.js     # Text-to-speech and playback controls
        ├── camera-scanner.js     # Camera capture
        ├── stem-analyzer.js      # OCR + backend analysis + local fallback
        ├── history-manager.js    # Saved items and voice opening
        ├── revision-manager.js   # Topic list, revision modes, voice quiz
        ├── assistant.js          # Ask AI chats and context separation
        ├── audio-earcons.js      # Sound cues
        ├── samples.js            # Built-in benchmark STEM cards
        └── vendor/               # Tesseract.js worker, core and language data
```

## Getting started

### Requirements
- Python 3.10 or newer
- A Google Gemini API key
- Google Chrome or Edge (needed for browser speech recognition)

### Install

```bash
git clone <your-repo-url>
cd soundsight
python -m venv .venv

# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install flask pillow python-dotenv requests google-genai
```

Optional, for opening more file types by voice (a type is hidden if its package is missing):

```bash
pip install pillow-heif pymupdf python-docx python-pptx
```

### Configure

Create a `.env` file in the project root (next to the `backend` and `frontend` folders):

```env
# Required
GEMINI_API_KEY=your_gemini_key

# Backup AI for Ask AI, quizzes and text analysis (OpenAI-compatible API)
BACKUP_AI_URL=https://api.groq.com/openai/v1/chat/completions
BACKUP_AI_KEY=your_groq_key
BACKUP_AI_MODEL=openai/gpt-oss-120b

# Backup image analysis when Gemini fails (uses BACKUP_AI_KEY if no key given)
GROQ_VISION_MODEL=your_groq_vision_model
GROQ_VISION_KEY=
GROQ_VISION_URL=

# Optional
PORT=5000
VOICE_UPLOADS_DIR=
```

Variables already set in your shell take priority over `.env`.

### Run

```bash
cd backend
python server.py
```

Open **http://127.0.0.1:5000** in Chrome or Edge, press **Start SoundSight**, and allow the microphone.

## Voice commands

| Say | What happens |
|---|---|
| "Start SoundSight" | Starts the app and begins listening |
| "Scan" / "Open camera" | Opens the scanner |
| "Capture" / "Take picture" / "Ready" | Captures the image |
| "Close camera" | Closes the scanner |
| "Upload" | Lists files in the voice upload folder, or opens the file picker if empty |
| "History" | Reads out saved topics |
| "Open item one" / "Open [topic name]" | Opens a saved topic |
| "Revision" / "Revise [topic]" | Reads saved topics, or opens the named one |
| "Quiz" | Starts a voice quiz (after choosing a topic) |
| "Quick Revision" / "Detailed Revision" / "Exam Revision" | Reads that revision style |
| "Skip" / "I don't know" | Skips a quiz question |
| "Stop quiz" | Leaves the quiz |
| "Explain" / "Explain again" | Reads the explanation of the current content |
| "Explain [topic]" | Opens Ask AI and asks about that topic |
| "Ask AI" | Opens the general assistant |
| "Ask about this" | Opens the Ask AI popup for the current content |
| "Close Ask AI" | Closes the popup |
| "Pause" / "Continue" / "Repeat" / "Stop" | Controls speech playback |
| "Go slow" / "Normal speed" / "Go faster" | Changes speech speed |
| "Help" / "Settings" | Opens the guide or settings |
| "Home" / "Dashboard" / "Back" | Returns to the dashboard |

A **simulated voice bar** at the bottom of the screen lets you type any command for testing without a microphone.

## API reference

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | Health check |
| POST | `/api/analyze` | Analyze an image and/or text |
| GET | `/api/history` | List saved STEM items |
| POST | `/api/history` | Save a STEM item |
| GET | `/api/history/<id>` | Get one saved item |
| POST | `/api/revise/generate` | Quick, Detailed or Exam revision |
| POST | `/api/revise/quiz` | Create quiz questions for a topic |
| POST | `/api/revise/check` | Mark a spoken quiz answer |
| POST | `/api/revise/evaluate` | Evaluate a revision answer |
| GET | `/api/ai-chats` | List Ask AI conversations |
| GET | `/api/ai-chats/<id>` | Get one conversation |
| POST | `/api/ai-chat` | Ask AI (`source`: standalone, scanner, upload, history, revision) |
| GET | `/api/voice-files` | List files in the voice upload folder |
| GET | `/api/voice-files/<name>` | Read one file (image as `imageData`, document as `rawText`) |

## How analysis works

1. The browser creates a smaller grayscale copy of the image and runs Tesseract.js OCR on it.
2. The original image and OCR text go to `/api/analyze`.
3. Gemini classifies and analyzes the image, trying three models in order. If Gemini fails, a Groq vision model is tried.
4. Non-STEM results are returned as `contentType: "None"` and are not saved.
5. STEM results get a title, topic, structured explanation and a spoken script, then are saved to history.
6. If every AI provider fails and there is too little real text, the app reports that the analysis is unavailable instead of inventing content.

## Voice upload folder

Students can open files by voice from one folder. By default it is `backend/data/voice_uploads/`. Set `VOICE_UPLOADS_DIR` to use another folder, such as a synced cloud-drive folder. Supported types: png, jpg, jpeg, webp, gif, bmp, tif, tiff, heic, heif, pdf, docx, pptx, txt, md, csv. Scanned PDFs with no text layer are returned as an image of one page. Files over 25 MB are rejected.

## Sharing for review

To let teammates try the app from another network without sharing files, use a temporary tunnel:

1. Start the server: `python server.py`
2. In a second terminal: `cloudflared tunnel --url http://localhost:5000`
3. Send the printed `https://...trycloudflare.com` link to your teammates.
4. Press **Ctrl+C** in the tunnel terminal to stop sharing.

The link changes each time. Keep your computer awake and both terminals open while others use it. The link is HTTPS, so the microphone works. Anyone with the link uses your API quota and shares your `history.json` and `ai_chats.json`, so back up `backend/data/` first if that matters.

## Deployment notes

- Keep `.env`, `backend/data/` and `.venv` out of version control.
- Replace Flask's development server with `waitress` (Windows) or `gunicorn` (Linux).
- History and chats live in shared JSON files, and history stores the scanned images. Multi-user deployment needs accounts and a database.
- HTTPS is required for microphone access outside `localhost`.
- Set the backup AI variables so quizzes and Ask AI keep working if Gemini hits its quota.

## Known limitations

- Voice recognition depends on the browser. Chrome or Edge is recommended.
- During a quiz, spoken answers that exactly match an app command (for example "stop", "repeat", "back", "normal", "slow", "can") are treated as commands and not as answers.
- The file picker accepts images only. Documents are opened through the voice upload folder.
- Items saved before STEM detection was fixed may need to be deleted from `history.json` by hand.
- The Braille keyboard in Ask AI is a demonstration placeholder.

## Team and license

Add your team name, members, college and course, and a license here.