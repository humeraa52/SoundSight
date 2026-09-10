# SoundSight 🎙️👁️
> **“An AI Assistive Workspace Converting STEM Content to Clear Audio”**

SoundSight is an audio-first AI assistive learning workspace designed primarily for visually impaired STEM students. Built on the core product principle that **the application must be usable primarily through voice**, students never need to visually hunt for buttons to perform essential actions.

---

## Key Features

1. **Audio-First STEM Workspace**:
   - WCAG 2.1 AAA accessible dark UI (pure `#070A12` background, `#FFE600` primary yellow, `#00E5FF` cyan, large readable typography, 4px focus rings).
   - High-contrast voice state indicator (`IDLE`, `LISTENING`, `COMMAND_DETECTED`, `PROCESSING`, `SPEAKING`).
   - Web Audio API earcons providing immediate acoustic cues for microphone listening, commands acknowledged, auto-capturing, and analysis complete.

2. **Zero-Click Webcam Auto-Capture**:
   - Voice command: **“Scan”** opens the webcam automatically.
   - Initial announcements:
     1. *"The camera is now open. Please place your code, document, diagram or flowchart in front of the camera."*
     2. *"Hold the content steady. I will capture it automatically when it is clear."*
   - Continuously analyzes camera video frames for:
     - Document presence
     - Stability (motion delta)
     - Sharpness (Laplacian variance)
     - Lighting (mean pixel luminance)
     - Position & Distance
   - Real-time debounced spoken guidance:
     - *"I cannot detect the document."*
     - *"The content is blurry."*
     - *"Please move the document closer."*
     - *"Please hold the document steady."*
   - Once stable and clear for ~1.5s, announces *"Capturing."*, plays shutter chime, and automatically takes the snapshot. **No capture button required!**

3. **Intelligent STEM Content Understanding**:
   - Classifies and structurally decomposes:
     - **Code**: Language detection, algorithmic purpose, overall logic, line-by-line explanation, variables, conditions, loops, functions, I/O, error identification & corrections.
     - **Flowcharts**: Node types (terminators, process boxes, decision diamonds, I/O), label text, arrow connections, and sequential traversal (*"The diamond represents a decision... The Yes path goes to..."*).
     - **Formulas**: LaTeX rendering, clear phonetic math reading (*"x equals negative b plus or minus..."*), and symbol-by-symbol parameter mapping.
     - **Diagrams**: Component mapping, spatial arrangement (left, right, center, top, bottom), operational connections, and overall system purpose.
   - **Certainty Partitioning**: Visually and audibly separates Certain, Uncertain, and Missing information (*"I can identify some content, but part of the image is unclear..."*).

4. **Interactive Speech Controls**:
   - **“Explain”** / **“Explain again”**: Begins or restarts the AI explanation.
   - **“Go slow”** / **“Normal speed”** / **“Go faster”**: Adjusts playback speed (0.8x / 1.0x / 1.3x).
   - **“Stop”** / **“Pause”** / **“Continue”** / **“Repeat”**: Instant tactile speech control.
   - **Anti-Echo Safety**: Gated recognition prevents SoundSight from recognizing its own TTS voice as user commands.

5. **Learning History**:
   - Automatically saves every scanned or uploaded item with timestamp, image, title, OCR text, and structured analysis.
   - Voice command: **“History”** announces total items and verbally lists them.
   - Voice command: **“Open item one”** opens the item directly into the workspace.

6. **Voice-Based Revision**:
   - Voice command: **“Revise Round Robin Scheduling”** (or any topic).
   - Searches history semantically and prompts: *"I found your Round Robin Scheduling material. Would you like a quick revision or detailed revision?"*
   - 4 Revision Modes:
     - **Quick Revision**: Overview, key points, formulas, common mistakes.
     - **Detailed Revision**: Step-by-step deep dive and underlying theory.
     - **Exam Revision**: High-yield tips, pitfalls, mnemonics.
     - **Question Mode**: AI asks a conceptual question aloud, student speaks their answer into the mic, and SoundSight evaluates the conceptual understanding!

7. **Instant STEM Benchmarks**:
   - 5 Built-in benchmark test cards for immediate zero-hardware verification:
     1. Round Robin CPU Scheduling
     2. Binary Search Flowchart
     3. Quadratic Formula & Complex Roots
     4. Python Bubble Sort Algorithm
     5. Ohm's Law Series Circuit

---

## Quick Start

### 1. Start the SoundSight Server
From the project directory:
```bash
python backend/server.py
```
Or with custom port:
```bash
python backend/server.py --port 5000
```

### 2. Open in Browser
Visit `http://localhost:5000` in Google Chrome or Microsoft Edge (which natively support the Web Speech API and MediaDevices webcam access).

### 3. Usage
- Click **Start SoundSight** (or press Enter) to grant audio context.
- Say **“Scan”** to open the webcam and experience the zero-click auto capture.
- Or select one of the 5 benchmark cards on the dashboard to test the complete pipeline instantly!
- Say **“Explain”**, **“Go slow”**, **“Repeat”**, **“History”**, or **“Revise Round Robin”** to explore the voice capabilities.
