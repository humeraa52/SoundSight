/**
 * SoundSight Web Audio API Earcon Synthesizer
 * Generates instant, accessible acoustic cues for non-visual orientation
 */

class SoundSightEarcons {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playTone(freq, type = 'sine', duration = 0.15, gainVal = 0.15, startTime = 0) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    try {
      const now = this.ctx.currentTime + startTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(gainVal, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + duration);
    } catch (e) {
      console.warn('[Earcons] Play tone error:', e);
    }
  }

  // Chime when mic starts listening
  listeningBeep() {
    this.init();
    this.playTone(523.25, 'sine', 0.12, 0.15, 0);    // C5
    this.playTone(659.25, 'sine', 0.18, 0.20, 0.08); // E5
  }

  // Chime when a voice command is recognized
  commandChime() {
    this.init();
    this.playTone(659.25, 'sine', 0.08, 0.18, 0);    // E5
    this.playTone(880.00, 'sine', 0.14, 0.22, 0.07); // A5
  }

  // Sound when camera scanner opens
  cameraOpenChime() {
    this.init();
    this.playTone(440, 'triangle', 0.15, 0.15, 0);
    this.playTone(554.37, 'triangle', 0.20, 0.18, 0.1);
  }

  // Sound when auto-capture triggers (shutter click simulation)
  captureClick() {
    this.init();
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      // High click
      this.playTone(1200, 'triangle', 0.04, 0.25, 0);
      // Low mechanical body
      this.playTone(200, 'sine', 0.09, 0.3, 0.03);
    } catch (e) {
      console.warn(e);
    }
  }

  // Chord when analysis is ready
  analysisCompleteChime() {
    this.init();
    this.playTone(523.25, 'sine', 0.2, 0.18, 0);     // C5
    this.playTone(659.25, 'sine', 0.2, 0.18, 0.12);  // E5
    this.playTone(783.99, 'sine', 0.35, 0.22, 0.24); // G5
  }

  // Alert tone on errors
  errorTone() {
    this.init();
    this.playTone(300, 'sawtooth', 0.15, 0.12, 0);
    this.playTone(220, 'sawtooth', 0.25, 0.15, 0.12);
  }

  // Soft click for tactile button navigation
  buttonClick() {
    this.playTone(700, 'sine', 0.04, 0.08, 0);
  }
}

window.SoundSightEarcons = new SoundSightEarcons();
