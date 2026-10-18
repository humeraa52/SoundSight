/**
 * SoundSight Zero-Click Webcam Auto-Capture Scanner
 * Continuously analyzes live camera feed for:
 * - Document presence
 * - Stability (motion delta)
 * - Sharpness (Laplacian edge variance)
 * - Lighting (mean luminance)
 * - Distance & position
 * 
 * Provides audio guidance without requiring a capture button.
 * Automatically captures when content is clear and steady for ~1.5s.
 */

class SoundSightCameraScanner {
  constructor() {
    this.videoEl = null;
    this.canvasEl = null;
    this.stream = null;
    this.isRunning = false;
    this.isStarting = false;
    this.state = 'IDLE'; // IDLE | CAMERA_STARTING | WAITING_FOR_CAPTURE | STABILIZING | CAPTURING
    this.analysisInterval = null;
    this.captureTimer = null;
    
    // Auto-capture criteria tracking & frame metrics
    this.prevFrameData = null;
    this.consecutiveStableFrames = 0;
    this.requiredStableFrames = 12; // ~1.2s at 10 FPS
    // Scanner guidance is repeated only if the same problem
    // remains for about 8 seconds.
    this.lastGuidanceTime = 0;
    this.lastGuidanceType = null;
    this.guidanceCooldownMs = 8000;
    this.lastGuidanceType = null;
    this.captured = false;
    
    this.onCaptureCallback = null;
  }

  init(videoEl, canvasEl, onCapture) {
    this.videoEl = videoEl;
    this.canvasEl = canvasEl;
    this.onCaptureCallback = onCapture;
  }

  async start() {
    // Guard against being started again while already running/starting.
    // A duplicate "Scan" command firing before this finished initializing
    // used to launch a second overlapping getUserMedia() call, which is
    // exactly what made the camera flaky and take many tries to open.
    if (this.isRunning || this.isStarting) {
      console.log('[Scanner] Already running or starting — ignoring duplicate start()');
      return;
    }
    this.isStarting = true;
    this.state = 'CAMERA_STARTING';
    this.captured = false;
    this.consecutiveStableFrames = 0;
    this.prevFrameData = null;
    // Wait before giving the first problem guidance.
    this.lastGuidanceTime = Date.now();
    this.guidanceCooldownMs = 8000;
    this.lastGuidanceType = null;

    console.log('[SCAN] Capture started');

    if (window.SoundSightEarcons) {
      window.SoundSightEarcons.cameraOpenChime();
    }

    // Step 1: Open camera
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });

      this.videoEl.srcObject = this.stream;
      await this.videoEl.play();
      this.isRunning = true;
      this.isStarting = false;
      this.state = 'WAITING_FOR_CAPTURE';

      // Spoken TTS guidance on open
      if (window.SoundSightTTS) {
        window.SoundSightTTS.speak(
          "The camera is ready. Please place your study material in front of the camera. Take your time. When you are ready, say Capture."
        );
      }

      // Start continuous analysis loop at 10 FPS
      this.startAnalysisLoop();

    } catch (err) {
      console.error('[Scanner] Camera access error:', err);
      this.isStarting = false;
      this.isRunning = false;
      this.state = 'IDLE';
      if (window.SoundSightTTS) {
        window.SoundSightTTS.speak(
          "Camera access is blocked. Please allow camera permission in your browser settings."
        );
      }
      if (window.SoundSightEarcons) {
        window.SoundSightEarcons.errorTone();
      }
      throw err;
    }
  }

  stop() {
    this.isRunning = false;
    this.isStarting = false;
    this.state = 'IDLE';
    if (this.captureTimer) {
      clearTimeout(this.captureTimer);
      this.captureTimer = null;
    }
    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
      this.analysisInterval = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    if (this.videoEl) {
      this.videoEl.srcObject = null;
    }
    const guideBox = document.getElementById('cameraGuideBox');
    if (guideBox) {
      guideBox.classList.remove('capturing');
      guideBox.classList.remove('guide-capturing');
    }
    this.updateScannerMeters({ stability: 0, sharpness: 0, lighting: 'Checking...', status: 'Camera Idle' });
  }

  startAnalysisLoop() {
    if (this.analysisInterval) clearInterval(this.analysisInterval);
    
    this.analysisInterval = setInterval(() => {
      if (!this.isRunning || this.captured || !this.videoEl || this.videoEl.readyState !== 4) {
        return;
      }
      this.analyzeFrame();
    }, 100); // 10 FPS
  }

  analyzeFrame() {
    const video = this.videoEl;
    const canvas = this.canvasEl;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // Use a normalized resolution for fast real-time computer vision analysis
    const width = 320;
    const height = 180;
    canvas.width = width;
    canvas.height = height;

    ctx.drawImage(video, 0, 0, width, height);
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    // 1. Lighting Analysis (mean luminance)
    let totalLuminance = 0;
    const grayBuffer = new Uint8Array(width * height);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      // Perceived luminance formula
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      grayBuffer[j] = lum;
      totalLuminance += lum;
    }
    const meanLuminance = totalLuminance / (width * height);
    const isTooDark = meanLuminance < 45;
    const isWashedOut = meanLuminance > 225;
    const isGoodLighting = !isTooDark && !isWashedOut;

    // 2. Stability Analysis (frame-to-frame pixel delta)
    let motionDelta = 0;
    if (this.prevFrameData) {
      let diffSum = 0;
      // Sample every 4th pixel for high speed
      for (let k = 0; k < grayBuffer.length; k += 4) {
        diffSum += Math.abs(grayBuffer[k] - this.prevFrameData[k]);
      }
      motionDelta = diffSum / (grayBuffer.length / 4);
    }
    this.prevFrameData = grayBuffer;
    const isSteady = motionDelta < 9.0;

    // 3. Sharpness Analysis (Laplacian gradient variance on central scan area)
    let laplacianVar = 0;
    let lapSum = 0;
    let lapSqSum = 0;
    let lapCount = 0;

    // Sample central 50% region of frame
    const startX = Math.floor(width * 0.25);
    const endX = Math.floor(width * 0.75);
    const startY = Math.floor(height * 0.25);
    const endY = Math.floor(height * 0.75);

    for (let y = startY; y < endY; y += 2) {
      for (let x = startX; x < endX; x += 2) {
        const idx = y * width + x;
        // Laplacian kernel: 4*center - top - bottom - left - right
        const center = grayBuffer[idx];
        const top = grayBuffer[idx - width] || center;
        const bottom = grayBuffer[idx + width] || center;
        const left = grayBuffer[idx - 1] || center;
        const right = grayBuffer[idx + 1] || center;
        const lap = 4 * center - (top + bottom + left + right);

        lapSum += lap;
        lapSqSum += lap * lap;
        lapCount++;
      }
    }

    if (lapCount > 0) {
      const meanLap = lapSum / lapCount;
      laplacianVar = (lapSqSum / lapCount) - (meanLap * meanLap);
    }
    const isSharp = laplacianVar > 48; // Laplacian variance threshold for readable STEM document

    // 4. Document Presence (contrast variance in center vs borders)
    let centerLumSum = 0;
    let centerCount = 0;
    for (let y = startY; y < endY; y += 2) {
      for (let x = startX; x < endX; x += 2) {
        centerLumSum += grayBuffer[y * width + x];
        centerCount++;
      }
    }
    const centerMean = centerLumSum / Math.max(centerCount, 1);
    const documentDetected = isSharp || Math.abs(centerMean - meanLuminance) > 12;

    // Update Visual Meters for accessibility
    const stabilityPct = Math.max(0, Math.min(100, Math.round((1 - (motionDelta / 20)) * 100)));
    const sharpnessPct = Math.max(0, Math.min(100, Math.round((laplacianVar / 100) * 100)));
    let lightLabel = isTooDark ? "Too Dark" : (isWashedOut ? "Too Bright" : "Optimal");
    
    let statusMsg = "Camera ready. Say 'Capture' when ready";
    if (this.state === 'STABILIZING') {
      statusMsg = "Hold steady... Capturing now";
    } else if (this.state === 'CAPTURING') {
      statusMsg = "Processing image...";
    } else if (documentDetected && isSharp && isSteady) {
      statusMsg = "Material clear & steady. Say 'Capture'";
    } else if (documentDetected) {
      statusMsg = "Material detected. Say 'Capture' when ready";
    }

    this.updateScannerMeters({
      stability: stabilityPct,
      sharpness: sharpnessPct,
      lighting: lightLabel,
      status: statusMsg
    });

    // Note: Auto-capture has been removed per accessibility requirements.
    // The camera remains open until the user explicitly says "Capture".
    if (documentDetected && isGoodLighting && isSharp && isSteady) {
      this.consecutiveStableFrames++;
    } else {
      this.consecutiveStableFrames = Math.max(0, this.consecutiveStableFrames - 2);
      this.provideAudioGuidance({ documentDetected, isTooDark, isWashedOut, isSharp, isSteady });
    }
  }

provideAudioGuidance({
  documentDetected,
  isTooDark,
  isWashedOut,
  isSharp,
  isSteady
}) {
  if (this.state !== 'WAITING_FOR_CAPTURE') {
    return;
  }

  const now = Date.now();

  // Identify the current problem.
  let guidance = null;
  let guidanceType = null;

  if (!documentDetected) {

    guidanceType = 'DOCUMENT';
    guidance =
      "I cannot clearly detect the document. Please place the study material inside the camera area.";

  } else if (isTooDark) {

    guidanceType = 'LIGHT';
    guidance =
      "The lighting is too dark. Please add more light.";

  } else if (isWashedOut) {

    guidanceType = 'BRIGHT';
    guidance =
      "The lighting is too bright. Please reduce the light slightly.";

  } else if (!isSteady) {

    guidanceType = 'STEADY';
    guidance =
      "Please hold the document steady.";

  } else if (!isSharp) {

    guidanceType = 'SHARP';
    guidance =
      "The content is blurry. Please hold the camera steady and keep the content clearly visible.";
  }

  // Nothing is wrong anymore.
  // Reset the guidance state.
  if (!guidance) {
    this.lastGuidanceType = null;
    this.lastGuidanceTime = now;
    return;
  }

  // A NEW problem has appeared.
  // Start the timer, but don't speak immediately.
  if (this.lastGuidanceType !== guidanceType) {
    this.lastGuidanceType = guidanceType;
    this.lastGuidanceTime = now;

    console.log(
      `[Scanner] New guidance condition: ${guidanceType}`
    );

    return;
  }

  // Same problem must remain for 8 seconds.
  if (now - this.lastGuidanceTime < 8000) {
    return;
  }

  // Reset timer before speaking.
  this.lastGuidanceTime = now;

  console.log(
    `[Scanner] Repeating guidance after 8 seconds: ${guidanceType}`
  );

  if (window.SoundSightTTS) {
    window.SoundSightTTS.speak(guidance);
  }
}

  requestCapture() {
    // Check scanner is active & waiting; prevent duplicate triggers
    if (!this.isRunning || this.state !== 'WAITING_FOR_CAPTURE' || this.captured) {
      console.log(`[Scanner] requestCapture ignored. isRunning=${this.isRunning}, state=${this.state}, captured=${this.captured}`);
      return false;
    }

    this.captured = true;
    this.state = 'STABILIZING';
    console.log('[Scanner] Explicit voice capture requested. Stabilizing frame...');

    this.updateScannerMeters({
      stability: 100,
      sharpness: 100,
      lighting: 'Optimal',
      status: 'Hold steady... Capturing now'
    });

    // Provide immediate auditory feedback
    if (window.SoundSightTTS) {
      window.SoundSightTTS.speak("Hold steady. Capturing now.");
    }
    if (window.SoundSightEarcons) {
      window.SoundSightEarcons.commandChime();
    }

    // Flash UI guide
    const guideBox = document.getElementById('cameraGuideBox');
    if (guideBox) {
      guideBox.classList.add('capturing');
      guideBox.classList.add('guide-capturing');
    }

    // Wait ~1000ms for camera frame stabilization
    this.captureTimer = setTimeout(() => {
      if (!this.isRunning) return;
      this.executeCapture();
    }, 1000);

    return true;
  }

  executeCapture() {
    this.state = 'CAPTURING';
    console.log('[SCAN] Image captured');

    if (window.SoundSightEarcons) {
      window.SoundSightEarcons.captureClick();
    }

    const guideBox = document.getElementById('cameraGuideBox');
    if (guideBox) {
      guideBox.classList.remove('capturing');
      guideBox.classList.remove('guide-capturing');
    }

    // Capture high-resolution image from video
    const captureCanvas = document.createElement('canvas');
    captureCanvas.width = (this.videoEl && this.videoEl.videoWidth) ? this.videoEl.videoWidth : 1280;
    captureCanvas.height = (this.videoEl && this.videoEl.videoHeight) ? this.videoEl.videoHeight : 720;
    const captureCtx = captureCanvas.getContext('2d');
    if (this.videoEl) {
      captureCtx.drawImage(this.videoEl, 0, 0, captureCanvas.width, captureCanvas.height);
    }
    const fullImageData = captureCanvas.toDataURL('image/jpeg', 0.92);

    // Stop camera and hand off to existing app.js callback
    const cb = this.onCaptureCallback;
    this.stop();
    if (cb) {
      cb(fullImageData);
    }
  }

  triggerCapture() {
    return this.requestCapture();
  }

  updateScannerMeters({ stability, sharpness, lighting, status }) {
    const stabText = document.getElementById('meterStabilityText');
    const sharpText = document.getElementById('meterSharpnessText');
    const lightVal = document.getElementById('meterLightVal');
    const statusVal = document.getElementById('scannerStatusText');

    if (stabText) stabText.textContent = `${stability}%`;
    if (sharpText) sharpText.textContent = `${sharpness}%`;
    if (lightVal) lightVal.textContent = lighting;
    if (statusVal) statusVal.textContent = status;
  }
}

window.SoundSightCameraScanner = new SoundSightCameraScanner();