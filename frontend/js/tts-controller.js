/**
 * SoundSight Text-to-Speech Controller
 * Manages SpeechSynthesis queue, sentence-boundary chunking,
 * garbage-collection retention, playback rate, pause/resume/repeat,
 * and coordinates with the voice state machine to prevent self-triggering loops.
 */

class SoundSightTTS {
  constructor() {
    this.synth = window.speechSynthesis;
    this.currentRate = 1.0;
    this.currentPitch = 1.0;
    this.selectedVoice = null;
    this.lastSpokenText = '';
    this.lastExplanationText = '';
    this.isPaused = false;
    this.isSpeaking = false;
    this.chunks = [];
    this.currentChunkIndex = 0;
    this.currentOptions = {};

    this.initVoices();
  }

  initVoices() {
    if (!this.synth) return;
    const loadVoices = () => {
      const voices = this.synth.getVoices();
      if (voices && voices.length > 0) {
        this.selectedVoice = voices.find(v => (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Enhanced')) && v.lang.startsWith('en'))
          || voices.find(v => v.lang.startsWith('en'))
          || voices[0];
      }
    };

    loadVoices();
    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = loadVoices;
    }
  }

  setRate(rate) {
    this.currentRate = Math.max(0.5, Math.min(2.0, rate));
    return this.currentRate;
  }

  goSlow() {
    this.setRate(0.8);
    this.speak("Speech speed set to slow.");
  }

  goFaster() {
    this.setRate(1.3);
    this.speak("Speech speed set to faster.");
  }

  normalSpeed() {
    this.setRate(1.0);
    this.speak("Speech speed set to normal.");
  }

  /**
   * Chunks long explanations into clean sentence boundaries (<180 chars)
   * to bypass Chrome SpeechSynthesis buffer stall bug.
   */
  chunkText(text) {
    const clean = (text || '').trim();
    if (!clean) return [];

    const rawSentences = clean.match(/[^.!?\n]+[.!?\n]+|[^.!?\n]+$/g) || [clean];
    const chunks = [];

    for (let s of rawSentences) {
      const trimmed = s.trim();
      if (!trimmed) continue;

      if (trimmed.length > 180) {
        // Sub-chunk on comma or semicolon
        const subParts = trimmed.match(/[^,;]+[,;]+|[^,;]+$/g) || [trimmed];
        for (let p of subParts) {
          const pTrim = p.trim();
          if (pTrim) chunks.push(pTrim);
        }
      } else {
        chunks.push(trimmed);
      }
    }

    return chunks.length > 0 ? chunks : [clean];
  }

  /**
   * Explain entrypoint with explicit logging per requirements.
   */
  speakExplanation(text, options = {}) {
    console.log('[TTS] Explain pressed');
    console.log(`[TTS] Explanation length: ${(text || '').length}`);
    this.lastExplanationText = text;
    this.speak(text, { ...options, isExplanation: true });
  }

  /**
   * Speaks text using sentence-level queue to prevent GC drops.
   */
  speak(text, options = {}) {
    if (!this.synth) {
      console.warn('[TTS] SpeechSynthesis not supported.');
      if (options.onEnd) options.onEnd();
      return;
    }

    if (!text || !text.trim()) return;

    this.stop();
    this.lastSpokenText = text;
    if (options.isExplanation) {
      this.lastExplanationText = text;
    }

    console.log('[TTS] Starting speech');
    this.chunks = this.chunkText(text);
    this.currentChunkIndex = 0;
    this.currentOptions = options;
    this.isSpeaking = true;
    this.isPaused = false;

    this.playNextChunk();
  }

  playNextChunk() {
    if (!this.isSpeaking || this.currentChunkIndex >= this.chunks.length) {
      if (this.isSpeaking) {
        console.log('[TTS] Speech ended');
        this.isSpeaking = false;
        this.updateUIStatus(false);
        if (window.SoundSightVoiceManager) {
          window.SoundSightVoiceManager.setState('LISTENING');
        }
        if (this.currentOptions.onEnd) {
          this.currentOptions.onEnd();
        }
      }
      return;
    }

    const chunk = this.chunks[this.currentChunkIndex];
    const utterance = new SpeechSynthesisUtterance(chunk);
    utterance.rate = this.currentOptions.rate || this.currentRate;
    utterance.pitch = this.currentOptions.pitch || this.currentPitch;
    if (this.selectedVoice) {
      utterance.voice = this.selectedVoice;
    }

    // Retain global reference to avoid V8 garbage collection dropping utterance
    window.__soundsight_active_utterance = utterance;

    utterance.onstart = () => {
      if (this.currentChunkIndex === 0) {
        console.log('[TTS] Speech started');
        this.updateUIStatus(true);
        if (window.SoundSightVoiceManager) {
          window.SoundSightVoiceManager.setState('SPEAKING');
        }
        if (this.currentOptions.onStart) {
          this.currentOptions.onStart();
        }
      }
    };

    utterance.onend = () => {
      window.__soundsight_active_utterance = null;
      this.currentChunkIndex++;
      this.playNextChunk();
    };

    utterance.onerror = (e) => {
      console.warn('[TTS] Speech error:', e);
      window.__soundsight_active_utterance = null;
      this.isSpeaking = false;
      this.updateUIStatus(false);
      if (window.SoundSightVoiceManager) {
        window.SoundSightVoiceManager.setState('LISTENING');
      }
      if (this.currentOptions.onError) {
        this.currentOptions.onError(e);
      }
    };

    this.synth.speak(utterance);
  }

  stop() {
    if (this.synth) {
      this.synth.cancel();
    }
    window.__soundsight_active_utterance = null;
    this.isSpeaking = false;
    this.isPaused = false;
    this.chunks = [];
    this.currentChunkIndex = 0;
    this.updateUIStatus(false);
    if (window.SoundSightVoiceManager) {
      window.SoundSightVoiceManager.setState('LISTENING');
    }
  }

  pause() {
    if (this.synth && this.isSpeaking && !this.isPaused) {
      this.synth.pause();
      this.isPaused = true;
      this.updateUIStatus(false, 'paused');
    }
  }

  resume() {
    if (this.synth && this.isPaused) {
      this.synth.resume();
      this.isPaused = false;
      this.updateUIStatus(true);
    }
  }

  repeat() {
    console.log('[TTS] Repeat triggered');
    if (this.lastExplanationText) {
      this.speakExplanation(this.lastExplanationText);
    } else if (this.lastSpokenText) {
      this.speak(this.lastSpokenText);
    } else {
      this.speak("Nothing to repeat.");
    }
  }

  updateUIStatus(isSpeaking, state = 'speaking') {
    const statusEl = document.getElementById('audioPlayingStatus');
    if (statusEl) {
      if (isSpeaking) {
        statusEl.textContent = '🔊 Speaking explanation';
        statusEl.classList.remove('hidden');
      } else if (state === 'paused') {
        statusEl.textContent = '⏸ Speech paused';
        statusEl.classList.remove('hidden');
      } else {
        statusEl.classList.add('hidden');
      }
    }
  }
}

window.SoundSightTTS = new SoundSightTTS();
