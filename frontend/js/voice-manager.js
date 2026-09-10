/**
 * SoundSight Voice Command System & State Manager
 * Features:
 * - SpeechRecognition with auto-restart resilience
 * - Anti-echo TTS lockout (ignores input during SPEAKING state)
 * - 5 explicit states: IDLE, LISTENING, COMMAND_DETECTED, PROCESSING, SPEAKING
 * - Natural language intent routing and alias mapping
 * - Visual & acoustic feedback
 */

class SoundSightVoiceManager {
  constructor() {
    this.recognition = null;
    this.isListening = false;
    this.shouldListen = false;
    this.state = 'IDLE'; // IDLE | LISTENING | COMMAND_DETECTED | PROCESSING | SPEAKING
    this.commandHandlers = {};
    this.lastTranscript = '';
    this.silenceTimer = null;
    this.stateCallbacks = [];
    this.micTested = false;

    this.initRecognition();
  }

  initRecognition() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRec) {
      console.log("[VOICE] SpeechRecognition supported");
    } else {
      console.error("[VOICE] SpeechRecognition not supported");
      return;
    }

    this.recognition = new SpeechRec();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';

    this.recognition.onstart = () => {
      this.isListening = true;
      console.log('[VOICE] Recognition started');
      if (this.state !== 'SPEAKING') {
        this.setState('LISTENING');
      }
    };

    this.recognition.onresult = (event) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          final += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }

      const text = (final || interim).trim();
      if (!text) return;

      console.log('[VOICE] Speech result:');
      if (final) {
        console.log(`[VOICE] Final transcript: ${final.trim()}`);
      }

      this.lastTranscript = text;
      this.updateTranscriptUI(text, !!final);

      // CRITICAL ANTI-ECHO GUARD:
      // While TTS is speaking, drop microphone audio to avoid self-triggering commands!
      if (this.state === 'SPEAKING' || (window.SoundSightTTS && window.SoundSightTTS.isSpeaking)) {
        const lower = text.toLowerCase();
        // Allow ONLY explicit user emergency interruption 'stop' or 'pause'
        if (/\b(stop|halt|pause|silence|be quiet|shut up)\b/i.test(lower)) {
          console.log('[VOICE] TTS Barge-in stop detected.');
          console.log(`[VOICE] Final transcript: ${text}`);
          console.log(`[VOICE] Normalized transcript: ${lower}`);
          console.log('[VOICE] Detected intent: STOP');
          console.log('[VOICE] Executing action: STOP_SPEECH');
          if (window.SoundSightTTS) {
            window.SoundSightTTS.stop();
          }
          if (window.SoundSightEarcons) {
            window.SoundSightEarcons.commandChime();
          }
          this.setState('LISTENING');
        } else {
          console.log(`[VOICE] Discarded speech during SPEAKING state (anti-echo): "${text}"`);
          return;
        }
      }

      // If we have a final recognized command or an immediate match
      if (final || this.isImmediateCommand(text)) {
        this.processCommand(text);
      }
    };

    this.recognition.onerror = (event) => {
      console.log(`[VOICE] Error: ${event.error}`);
      if (event.error === 'not-allowed') {
        this.shouldListen = false;
        this.setState('IDLE');
        if (window.SoundSightTTS) {
          window.SoundSightTTS.speak("Microphone access is unavailable. Please allow microphone permission in your browser settings.");
        }
      }
    };

    this.recognition.onend = () => {
      this.isListening = false;
      console.log('[VOICE] Recognition ended');
      // Auto-restart if we are supposed to remain listening and not actively speaking
      if (this.shouldListen && this.state !== 'SPEAKING') {
        setTimeout(() => {
          try {
            if (this.shouldListen && !this.isListening && this.state !== 'SPEAKING') {
              this.recognition.start();
            }
          } catch (e) {
            // Already active or restarting
          }
        }, 300);
      } else {
        if (this.state !== 'SPEAKING') {
          this.setState('IDLE');
        }
      }
    };
  }

  async checkMicrophoneAccess() {
    if (this.micTested) return true;
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log('[VOICE] Microphone access granted');
        // Stop the probe stream so browser audio input remains dedicated to SpeechRecognition
        stream.getTracks().forEach(track => track.stop());
        this.micTested = true;
        return true;
      } catch (e) {
        console.warn('[VOICE] Microphone query note:', e);
      }
    }
    return true;
  }

  isImmediateCommand(text) {
    const clean = text.trim().toLowerCase();
    return /\b(scan|upload|history|revise|explain|stop|pause|continue|repeat|slow|faster|help|home|back|settings|start)\b/i.test(clean);
  }

  async startListening() {
    this.shouldListen = true;
    await this.checkMicrophoneAccess();

    if (this.recognition && !this.isListening && this.state !== 'SPEAKING') {
      try {
        this.recognition.start();
        if (window.SoundSightEarcons) {
          window.SoundSightEarcons.listeningBeep();
        }
      } catch (e) {
        // Recognition already active
      }
    }
  }

  stopListening() {
    this.shouldListen = false;
    if (this.recognition && this.isListening) {
      try {
        this.recognition.stop();
      } catch (e) {
        // Recognition already stopped
      }
    }
    this.setState('IDLE');
  }

  toggleListening() {
    if (this.shouldListen) {
      this.stopListening();
    } else {
      this.startListening();
    }
  }

  setState(newState) {
    const prevState = this.state;
    this.state = newState;
    console.log('[VoiceManager] State changed to:', newState);
    this.updateStateUI();
    this.stateCallbacks.forEach(cb => cb(newState));

    // When returning to LISTENING from SPEAKING, ensure recognition resumes
    if (prevState === 'SPEAKING' && newState === 'LISTENING' && this.shouldListen && !this.isListening) {
      setTimeout(() => {
        try {
          if (this.shouldListen && !this.isListening && this.state === 'LISTENING') {
            this.recognition?.start();
          }
        } catch (e) {
          // Handled
        }
      }, 250);
    }
  }

  onStateChange(cb) {
    this.stateCallbacks.push(cb);
  }

  registerCommand(intent, callback) {
    this.commandHandlers[intent] = callback;
  }

  processCommand(rawText) {
    const text = (rawText || '').trim();
    if (!text) return;
    const norm = text.toLowerCase();

    // Anti-echo gate during TTS
    if (this.state === 'SPEAKING' || (window.SoundSightTTS && window.SoundSightTTS.isSpeaking)) {
      if (/\b(stop|halt|pause|silence|be quiet|shut up)\b/i.test(norm)) {
        console.log(`[VOICE] Final transcript: ${text}`);
        console.log(`[VOICE] Normalized transcript: ${norm}`);
        console.log('[VOICE] Detected intent: STOP');
        console.log('[VOICE] Executing action: STOP_SPEECH');
        window.SoundSightTTS?.stop();
        this.setState('LISTENING');
        return;
      } else {
        console.log(`[VOICE] Discarded speech during SPEAKING state (anti-echo): "${norm}"`);
        return;
      }
    }

    // Provide acoustic feedback
    if (window.SoundSightEarcons) {
      window.SoundSightEarcons.commandChime();
    }

    this.setState('COMMAND_DETECTED');

    let intent = 'FREEFORM';
    let payload = text;

    // Flexible Natural Language Intent Matching:
    if (/\b(start soundsight|start app|begin)\b/i.test(norm) || norm === 'start') {
      intent = 'START';
    } else if (/(can you )?(please )?(take a |open |start )?scan/i.test(norm) || /\b(scan|open camera|camera)\b/i.test(norm)) {
      intent = 'SCAN';
    } else if (/\b(upload|choose file|upload image|upload file|upload document)\b/i.test(norm)) {
      intent = 'UPLOAD';
    } else if (/\b(history|view history|open history|show history|saved items)\b/i.test(norm)) {
      intent = 'HISTORY';
    } else if (/open item|item \d+/i.test(norm)) {
      intent = 'OPEN_ITEM';
      payload = norm;
    } else if (norm.startsWith('revise') || norm.startsWith('revision') || /\b(quiz|practice|test me)\b/i.test(norm)) {
      intent = 'REVISE';
      payload = norm.replace(/^(revise|revision|practice|quiz)\s*(for|about|on)?\s*/i, '').trim();
    } else if (/\b(explain again|restart explanation)\b/i.test(norm)) {
      intent = 'EXPLAIN_AGAIN';
    } else if (/\b(explain|read it|read out|speak|what does it say|read explanation)\b/i.test(norm)) {
      intent = 'EXPLAIN';
    } else if (/\b(stop|halt|be quiet|silence|stop audio|shut up)\b/i.test(norm)) {
      intent = 'STOP';
    } else if (/\b(pause|hold on|pause audio)\b/i.test(norm)) {
      intent = 'PAUSE';
    } else if (/\b(continue|resume|keep going)\b/i.test(norm)) {
      intent = 'CONTINUE';
    } else if (/\b(repeat|say again|read again|play again|repeat that)\b/i.test(norm)) {
      intent = 'REPEAT';
    } else if (/\b(go slow|slower|slow down|slow)\b/i.test(norm)) {
      intent = 'GO_SLOW';
    } else if (/\b(go faster|faster|speed up)\b/i.test(norm)) {
      intent = 'GO_FASTER';
    } else if (/\b(normal speed|normal)\b/i.test(norm)) {
      intent = 'NORMAL_SPEED';
    } else if (/\b(help|what can i say|instructions|assist)\b/i.test(norm)) {
      intent = 'HELP';
    } else if (/\b(settings|options|preferences)\b/i.test(norm)) {
      intent = 'SETTINGS';
    } else if (/\b(home|dashboard|go home|back to dashboard)\b/i.test(norm)) {
      intent = 'HOME';
    } else if (/\bback\b/i.test(norm)) {
      intent = 'BACK';
    } else if (/quick revision/i.test(norm)) {
      intent = 'REVISE_MODE';
      payload = 'quick';
    } else if (/detailed revision/i.test(norm)) {
      intent = 'REVISE_MODE';
      payload = 'detailed';
    } else if (/exam revision/i.test(norm)) {
      intent = 'REVISE_MODE';
      payload = 'exam';
    } else if (/question mode/i.test(norm)) {
      intent = 'REVISE_MODE';
      payload = 'question';
    }

    const actionMap = {
      'SCAN': 'OPEN_SCANNER',
      'HISTORY': 'OPEN_HISTORY',
      'REVISE': 'OPEN_REVISION',
      'HELP': 'OPEN_HELP',
      'SETTINGS': 'OPEN_SETTINGS',
      'HOME': 'OPEN_HOME',
      'BACK': 'GO_BACK',
      'START': 'START_SOUNDSIGHT',
      'EXPLAIN': 'START_EXPLANATION',
      'STOP': 'STOP_SPEECH',
      'PAUSE': 'PAUSE_SPEECH',
      'CONTINUE': 'CONTINUE_SPEECH',
      'REPEAT': 'REPEAT_SPEECH',
    };
    const actionName = actionMap[intent] || intent;

    console.log(`[VOICE] Final transcript: ${text}`);
    console.log(`[VOICE] Normalized transcript: ${norm}`);
    console.log(`[VOICE] Detected intent: ${intent}`);
    console.log(`[VOICE] Executing action: ${actionName}`);

    this.dispatch(intent, payload);

    // Return to LISTENING if not processing or speaking
    setTimeout(() => {
      if (this.state === 'COMMAND_DETECTED') {
        this.setState('LISTENING');
      }
    }, 400);
  }

  dispatch(intent, payload) {
    if (this.commandHandlers[intent]) {
      this.commandHandlers[intent](payload);
      return;
    }
    const actionMap = {
      'OPEN_SCANNER': 'SCAN',
      'OPEN_HISTORY': 'HISTORY',
      'OPEN_REVISION': 'REVISE',
      'OPEN_HELP': 'HELP',
      'OPEN_SETTINGS': 'SETTINGS',
      'OPEN_HOME': 'HOME',
      'GO_BACK': 'BACK',
      'SCAN': 'OPEN_SCANNER',
      'HISTORY': 'OPEN_HISTORY',
      'REVISE': 'OPEN_REVISION',
      'HELP': 'OPEN_HELP',
      'SETTINGS': 'OPEN_SETTINGS',
      'HOME': 'OPEN_HOME',
      'BACK': 'GO_BACK'
    };
    const alt = actionMap[intent];
    if (alt && this.commandHandlers[alt]) {
      this.commandHandlers[alt](payload);
      return;
    }
    console.log('[VoiceManager] Unhandled intent:', intent, payload);
  }

  updateStateUI() {
    const dot = document.getElementById('voiceStatusDot');
    const label = document.getElementById('voiceStatusText');
    const micBtn = document.getElementById('micToggleBtn');

    const stateMap = {
      'IDLE': { text: 'Idle', dotClass: 'status-dot idle' },
      'LISTENING': { text: 'Listening', dotClass: 'status-dot listening' },
      'COMMAND_DETECTED': { text: 'Processing', dotClass: 'status-dot processing' },
      'PROCESSING': { text: 'Processing', dotClass: 'status-dot processing' },
      'SPEAKING': { text: 'Speaking', dotClass: 'status-dot speaking' }
    };

    const current = stateMap[this.state] || stateMap['IDLE'];

    if (dot) dot.className = current.dotClass;
    if (label) label.textContent = current.text;

    if (micBtn) {
      const isListening = this.state === 'LISTENING';
      micBtn.setAttribute('aria-pressed', isListening.toString());
      if (isListening) {
        micBtn.classList.add('active');
      } else {
        micBtn.classList.remove('active');
      }
    }
  }

  updateTranscriptUI(text, isFinal) {
    const el = document.getElementById('voiceTranscriptLive');
    if (el) {
      el.textContent = text ? `“${text}”` : '';
      if (isFinal) {
        el.classList.add('transcript-final');
      } else {
        el.classList.remove('transcript-final');
      }
    }
  }
}

window.SoundSightVoiceManager = new SoundSightVoiceManager();
console.log("[VOICE] Voice manager loaded");
