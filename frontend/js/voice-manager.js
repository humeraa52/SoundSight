/**
 * ============================================================
 * SoundSight Voice Manager
 * ============================================================
 *
 * Handles:
 * - SpeechRecognition
 * - Continuous listening
 * - Voice command routing
 * - Commands while TTS is speaking (barge-in)
 * - Pause / Resume / Stop
 * - Slow / Fast / Normal speech speed
 * - Scan / Upload / History / Revision
 * - Help / Settings / Home / Back
 * - Explain / Repeat
 * - Capture
 * - History item voice opening
 * - Natural voice phrases
 * - Number shortcuts for dashboard cards
 * - Anti-duplicate command protection
 * - Microphone permission handling and auto-recovery
 * - UI state updates
 * - Ask AI routing:
 *     When Ask AI is open (standalone page OR a section popup),
 *     any speech that is not an exact app command is sent to the
 *     assistant as a question. The assistant decides the context
 *     from its CURRENT source, so the standalone chat never sees
 *     scan/upload/history/revision content and popups keep only
 *     their own explicit context.
 * - Quiz routing:
 *     While a revision quiz waits for a spoken answer, almost
 *     everything the student says is an ANSWER, even single words
 *     such as "normal", "slow", "ready" or "can". Only a few
 *     safe commands (home, speed changes, repeat) stay commands.
 *
 * IMPORTANT:
 * This file does NOT replace app.js.
 * app.js still provides the actual action handlers.
 *
 * ============================================================
 */

class SoundSightVoiceManager {

  constructor() {

    this.recognition = null;

    this.isListening = false;
    this.shouldListen = false;

    this.state = 'IDLE';

    this.commandHandlers = {};

    this.lastTranscript = '';

    this.silenceTimer = null;

    this.stateCallbacks = [];

    this.micTested = false;
    this.micPermissionDenied = false;

    this.lastCommandText = '';
    this.lastCommandTime = 0;

    this.isProcessingCommand = false;

    this.healthTimer = null;

    this.restartTimer = null;

    this.isStarting = false;
    this.startingGuardTimer = null;
    this.interimTimer = null;
    this.interimHandledText = '';
    this.interimHandledAt = 0;
    this.lastTtsActiveTime = 0;
    this.minConfidence = 0.55;

    /* "I did not catch that" message limiter (quiz only). */
    this.lastNotCaughtTime = 0;

    /* Speak the "browser not supported" message only once. */
    this.unsupportedWarned = false;

    /*
     * Commands that can be recognized while TTS is speaking.
     *
     * PAUSE / CONTINUE / REPEAT / SPEED commands must reach the
     * TTS controller without stopping speech first.
     *
     * Navigation commands stop TTS first and then execute their
     * application action.
     */
    this.bargeInIntents = new Set([

      'CAPTURE',

      'SCAN',
      'UPLOAD',
      'HISTORY',
      'REVISE',
      'REVISE_MODE',
      'OPEN_ITEM',

      'HELP',
      'SETTINGS',
      'HOME',
      'BACK',

      'EXPLAIN',
      'EXPLAIN_AGAIN',

      'CLOSE_CAMERA',

      'REPEAT',

      'GO_SLOW',
      'GO_FASTER',
      'NORMAL_SPEED',

      'PAUSE',
      'CONTINUE',

      'STOP',

      'ASK_AI'

    ]);

    this.initRecognition();
  }


  /* ==========================================================
     SPEECH RECOGNITION INITIALIZATION
     ========================================================== */

  initRecognition() {

    const SpeechRec =
      window.SpeechRecognition ||
      window.webkitSpeechRecognition;

    if (!SpeechRec) {

      console.error(
        '[VOICE] SpeechRecognition is not supported by this browser'
      );

      this.recognition = null;

      return;
    }

    console.log('[VOICE] SpeechRecognition supported');

    this.recognition = new SpeechRec();

    /* Continuous listening. */
    this.recognition.continuous = true;

    /* Interim results make short commands responsive. */
    this.recognition.interimResults = true;

    /* English (India). */
    this.recognition.lang = 'en-IN';

    /* Multiple alternatives improve recognition. */
    this.recognition.maxAlternatives = 4;

    this.recognition.onnomatch = () => {
      console.debug('[Voice] No reliable speech match.');
    };


    /* --------------------------------------------------------
       Recognition started
       -------------------------------------------------------- */

    this.recognition.onstart = () => {

      this.isStarting = false;

      this.isListening = true;

      this.micPermissionDenied = false;

      console.log('[VOICE] Recognition started');

      /* Do not overwrite SPEAKING. */
      if (!this.isTtsActive()) {
        this.setState('LISTENING');
      }

    };


    /* --------------------------------------------------------
       Recognition result
       -------------------------------------------------------- */

    this.recognition.onresult = (event) => {

      let interim = '';
      let final = '';
      let finalConfidence = 0;   // 0 = unknown
      const finalAlternatives = [];

      for (let i = event.resultIndex; i < event.results.length; i++) {

        const result = event.results[i];

        if (!result) {
          continue;
        }

        if (result.isFinal) {

          if (result[0] && result[0].transcript) {
            final += result[0].transcript;

            if (
              typeof result[0].confidence === 'number' &&
              result[0].confidence > 0
            ) {
              finalConfidence = result[0].confidence;
            }
          }

          for (let a = 0; a < result.length; a++) {
            if (result[a] && result[a].transcript) {
              finalAlternatives.push(result[a].transcript);
            }
          }

        } else if (result[0] && result[0].transcript) {
          interim += result[0].transcript;
        }
      }

      const text = (final || interim).trim();

      if (!text) {
        return;
      }

      this.lastTranscript = text;

      this.updateTranscriptUI(text, !!final);

      /*
       * If this final result is the same command we already
       * ran from the interim result, skip it.
       */
      if (final) {

        const finalNorm = this.normalizeForMatch(final);

        const alreadyRan =
          !!finalNorm &&
          finalNorm === this.interimHandledText &&
          (Date.now() - this.interimHandledAt) < 5000;

        this.interimHandledText = '';

        if (this.interimTimer) {
          clearTimeout(this.interimTimer);
          this.interimTimer = null;
        }

        if (alreadyRan) {
          return;
        }
      }

      /* ======================================================
         TTS ACTIVE
         ====================================================== */

      if (this.isTtsActive()) {

        const lower = text.toLowerCase().trim();

        if (
          /(?:^|\s)(stop|halt|silence|be quiet|shut up)(?:\s|$)/i.test(lower)
        ) {
          console.log('[VOICE] TTS Barge-in STOP detected');
          this.executeBargeInIntent('STOP', text);
          return;
        }

        if (final) {
          const handled =
            this.tryBargeInCommand(final.trim(), finalAlternatives);

          if (handled) {
            return;
          }
        }

        return;
      }

      /* ======================================================
         ORDINARY COMMANDS
         ====================================================== */

      /* Ignore the tail end of our own TTS voice. */
      if (this.recentlySpoke()) {
        return;
      }

      /* Interim result: run short exact commands quickly. */
      if (!final) {
        this.scheduleInterimCommand(text);
        return;
      }

      /* Final result: drop low-confidence junk. */
      if (finalConfidence && finalConfidence < this.minConfidence) {

        console.log(
          `[VOICE] Ignored low-confidence speech (${finalConfidence.toFixed(2)}): ${final}`
        );

        /* During a quiz, tell the student instead of staying silent. */
        if (this.quizOwnsSpeech()) {

          const nowTime = Date.now();

          /* At most once every 4 seconds, so it never loops. */
          if (nowTime - this.lastNotCaughtTime > 4000) {

            this.lastNotCaughtTime = nowTime;

            window.SoundSightTTS?.speak(
              'I did not catch that. Please say your answer again, or say repeat to hear the question.'
            );
          }
        }

        return;
      }

      this.processCommand(final.trim(), finalAlternatives);
    };


    /* --------------------------------------------------------
       Recognition error
       -------------------------------------------------------- */

    this.recognition.onerror = (event) => {

      const error =
        event && event.error
          ? event.error
          : 'unknown';

      this.isStarting = false;

      console.warn(`[VOICE] Recognition error: ${error}`);

      /* Permission denied. */
      if (
        error === 'not-allowed' ||
        error === 'service-not-allowed'
      ) {

        this.micPermissionDenied = true;

        this.shouldListen = false;

        this.isListening = false;

        this.stopHealthCheck();

        this.setState('IDLE');

        console.error('[VOICE] Microphone permission was denied');

        /* Give the student an audible explanation. */
        if (
          window.SoundSightTTS &&
          typeof window.SoundSightTTS.speak === 'function'
        ) {

          try {

            window.SoundSightTTS.speak(
              'Microphone access is blocked. Please allow microphone permission for SoundSight in your browser settings, then press the microphone button again.'
            );

          } catch (e) {

            console.warn(
              '[VOICE] Could not speak microphone permission message:',
              e
            );

          }

        }

        return;
      }

      /* No microphone / hardware. */
      if (error === 'audio-capture') {

        this.isListening = false;

        console.error(
          '[VOICE] No microphone was detected or the microphone is unavailable.'
        );

        return;
      }

      /*
       * Browser may occasionally report these during
       * automatic restart. They are not fatal.
       */
      if (
        error === 'aborted' ||
        error === 'no-speech' ||
        error === 'network'
      ) {

        console.log(`[VOICE] Recoverable recognition error: ${error}`);

        return;
      }

    };


    /* --------------------------------------------------------
       Recognition ended
       -------------------------------------------------------- */

    this.recognition.onend = () => {

      this.isStarting = false;

      clearTimeout(this.interimTimer);

      this.isListening = false;

      console.log('[VOICE] Recognition ended');

      /* Clear an old restart timer. */
      if (this.restartTimer) {

        clearTimeout(this.restartTimer);

        this.restartTimer = null;

      }

      /*
       * Automatically restart if the application should continue
       * listening. Do not restart while TTS is speaking.
       */
      if (
        this.shouldListen &&
        !this.micPermissionDenied &&
        !this.isTtsActive()
      ) {

        this.restartTimer = setTimeout(() => {

          this.restartTimer = null;

          if (
            this.shouldListen &&
            !this.isListening &&
            !this.isStarting &&
            !this.micPermissionDenied &&
            !this.isTtsActive()
          ) {
            this.safeStartRecognition();
          }

        }, 500);

        return;
      }

      if (!this.isTtsActive()) {

        if (this.shouldListen) {
          this.setState('LISTENING');
        } else {
          this.setState('IDLE');
        }

      }

    };

  }


  /* ==========================================================
     SAFE RECOGNITION START
     ========================================================== */

  safeStartRecognition() {

    if (!this.recognition) {
      console.error('[VOICE] Cannot start recognition: SpeechRecognition unavailable');
      return false;
    }

    if (!this.shouldListen) {
      return false;
    }

    if (this.isListening || this.isStarting) {
      return true;
    }

    if (this.micPermissionDenied) {
      console.warn('[VOICE] Recognition blocked because microphone permission is denied');
      return false;
    }

    if (this.isTtsActive()) {
      return false;
    }

    this.isStarting = true;

    clearTimeout(this.startingGuardTimer);

    this.startingGuardTimer = setTimeout(() => {
      this.isStarting = false;
    }, 4000);

    try {

      this.recognition.start();

      return true;

    } catch (e) {

      this.isStarting = false;

      const message = String((e && e.message) || e);

      if (message.includes('already started')) {
        /* Recognition is actually running: fix our flag. */
        this.isListening = true;
      } else {
        console.log('[VOICE] Recognition start skipped:', message);
      }

      return false;
    }
  }


  /* ==========================================================
     MICROPHONE ACCESS
     ========================================================== */

  async checkMicrophoneAccess() {

    /* Already successfully tested. */
    if (this.micTested) {
      return true;
    }

    /* Browser does not expose getUserMedia. */
    if (
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {

      console.error(
        '[VOICE] Browser does not provide microphone access through getUserMedia'
      );

      this.micPermissionDenied = true;

      return false;

    }

    try {

      console.log('[VOICE] Requesting microphone permission...');

      const stream =
        await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });

      console.log('[VOICE] Microphone access granted');

      /*
       * We only needed the stream to verify permission.
       * SpeechRecognition will use the microphone itself.
       */
      if (stream) {

        stream.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch (e) {}
        });

      }

      this.micTested = true;

      this.micPermissionDenied = false;

      return true;

    } catch (error) {

      this.micTested = false;

      this.micPermissionDenied = true;

      console.error('[VOICE] Microphone access failed:', error);

      if (error && error.name === 'NotAllowedError') {

        console.error('[VOICE] Microphone permission denied by browser.');

      } else if (error && error.name === 'NotFoundError') {

        console.error('[VOICE] No microphone device found.');

      } else if (error && error.name === 'NotReadableError') {

        console.error(
          '[VOICE] Microphone is already being used by another application.'
        );

      }

      return false;

    }

  }


  /* ==========================================================
     TTS STATE
     ========================================================== */

  isTtsActive() {

    const tts = window.SoundSightTTS;

    const active = !!(
      tts &&
      tts.isSpeaking === true &&
      tts.isPaused !== true
    );

    if (active) {
      this.lastTtsActiveTime = Date.now();
    }

    return active;
  }

  recentlySpoke(ms = 900) {
    return (Date.now() - this.lastTtsActiveTime) < ms;
  }

  /*
   * True while a revision quiz is waiting for a spoken answer.
   * In that situation single words such as "normal", "slow",
   * "ready" or "can" are answers, not application commands.
   */
  quizOwnsSpeech() {

    const rm = window.SoundSightRevisionManager;

    return !!(
      rm &&
      rm.isAwaitingAnswer &&
      window.SoundSightApp?.currentView === 'revision'
    );
  }

  /*
   * Commands that stay real commands while a quiz waits for an
   * answer: going home/dashboard (any natural wording) and the
   * speed changes. Everything else is treated as an answer.
   */
  isQuizCommand(norm) {

    const text = String(norm || '').toLowerCase().trim();

    const goHome =
      /^(please\s+)?((go|return|take me|head|come)\s+(back\s+)?(to\s+)?(the\s+)?(home|dashboard|main screen|home screen)|back\s+(to\s+)?(the\s+)?(home|dashboard)|open\s+(the\s+)?(home|dashboard)|home|dashboard|main screen)$/i;

    const speed =
      /^(go slower|go faster|slow down|speed up|speak slower|speak faster|normal speed)$/i;

    return goHome.test(text) || speed.test(text);
  }

  /*
   * True while the Revision topic list is showing and the app is
   * waiting for the student to choose a topic.
   */
  topicPickOwnsSpeech() {

    const rm = window.SoundSightRevisionManager;

    return !!(
      rm &&
      rm.awaitingTopic &&
      window.SoundSightApp?.currentView === 'revision'
    );
  }

  /*
   * "one", "2", "open topic two", "open item 3", "pick five"...
   * These choose a topic in Revision. They must not open History
   * items or start Scan / Upload / History.
   */
  looksLikeTopicChoice(norm) {

    const text = String(norm || '').toLowerCase().trim();

    return /^(?:(?:open|select|choose|pick)\s+)?(?:(?:topic|item|number|option)\s+)?(?:\d{1,2}|one|won|two|to|too|three|four|for|five|six|seven|eight|nine|ten|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)$/i
      .test(text);
  }

  normalizeForMatch(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[.,!?;:]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /*
   * Run short, exact commands (like "scan" or "history") as soon as
   * the text is stable for 350 ms, instead of waiting for Chrome's
   * slow final result.
   */
  scheduleInterimCommand(interimText) {

    if (window.SoundSightApp?.awaitingUploadChoice) {
      return;
    }

    /* During a quiz, half-heard words must not run as commands. */
    if (this.quizOwnsSpeech()) {
      return;
    }

    /* On the Revision topic list, wait for the final result of "open topic two". */
    if (
      this.topicPickOwnsSpeech() &&
      this.looksLikeTopicChoice(this.normalizeForMatch(interimText))
    ) {
      return;
    }

    if (this.interimTimer) {
      clearTimeout(this.interimTimer);
      this.interimTimer = null;
    }

    const norm = this.normalizeForMatch(interimText);

    if (!norm || norm.split(' ').length > 4) {
      return;
    }

    const interimRule = this.findRule(norm, false);

    if (!interimRule) {
      return;
    }

    /*
     * "Explain" may be the beginning of a topic request,
     * such as "Explain photosynthesis".
     * Wait for the final speech result for EXPLAIN commands.
     * Keep other short commands fast.
     */
    if (
      interimRule.intent === 'EXPLAIN' ||
      interimRule.intent === 'EXPLAIN_AGAIN'
    ) {
      return;
    }

    this.interimTimer = setTimeout(() => {

      this.interimTimer = null;

      if (this.isTtsActive() || this.recentlySpoke()) {
        return;
      }

      this.interimHandledText = norm;
      this.interimHandledAt = Date.now();

      this.processCommand(interimText.trim(), []);

    }, 350);
  }


  /* ==========================================================
     HEALTH CHECK
     ========================================================== */

  startHealthCheck() {

    if (this.healthTimer) {
      return;
    }

    this.healthTimer = setInterval(() => {
      this.healthCheck();
    }, 1500);

  }

  stopHealthCheck() {

    if (this.healthTimer) {

      clearInterval(this.healthTimer);

      this.healthTimer = null;

    }

  }

  healthCheck() {

    if (!this.shouldListen) {
      return;
    }

    const ttsActive = this.isTtsActive();

    /* Fix incorrect Speaking badge. */
    if (
      this.state === 'SPEAKING' &&
      !ttsActive
    ) {

      console.log('[VOICE] TTS finished - returning to listening');

      const tts = window.SoundSightTTS;

      if (
        tts &&
        !tts.isPaused &&
        typeof tts.updateUIStatus === 'function'
      ) {

        try {
          tts.updateUIStatus(false);
        } catch (e) {}

      }

      this.setState('LISTENING');

    }

  }


  /* ==========================================================
     START LISTENING
     ========================================================== */

  async startListening() {

    /*
     * Browsers without speech recognition (Firefox, Safari on
     * some devices) cannot take voice commands. Say so out loud
     * instead of failing silently.
     */
    if (!this.recognition) {

      console.error(
        '[VOICE] Voice commands are not supported in this browser.'
      );

      if (!this.unsupportedWarned) {

        this.unsupportedWarned = true;

        window.SoundSightTTS?.speak(
          'Voice commands need Google Chrome or Microsoft Edge. You can type commands in the box at the bottom of the screen.'
        );
      }

      return false;
    }

    console.log('[VOICE] Starting microphone listening...');

    this.shouldListen = true;

    this.startHealthCheck();

    const microphoneAvailable = await this.checkMicrophoneAccess();

    if (!microphoneAvailable) {

      this.shouldListen = false;

      this.stopHealthCheck();

      this.setState('IDLE');

      console.error(
        '[VOICE] Listening cancelled because microphone access failed.'
      );

      return false;

    }

    this.micPermissionDenied = false;

    if (
      window.SoundSightEarcons &&
      typeof window.SoundSightEarcons.listeningBeep === 'function'
    ) {

      try {
        window.SoundSightEarcons.listeningBeep();
      } catch (e) {
        console.warn('[VOICE] Listening beep error:', e);
      }

    }

    const started = this.safeStartRecognition();

    if (!started && !this.isListening) {

      /*
       * It may be because TTS is speaking.
       * Do not treat that as microphone failure.
       */
      if (this.isTtsActive()) {

        console.log(
          '[VOICE] Microphone ready; recognition will resume after TTS.'
        );

      } else {

        console.warn(
          '[VOICE] Recognition could not be started immediately.'
        );

      }

    }

    return true;

  }


  /* ==========================================================
     STOP LISTENING
     ========================================================== */

  stopListening() {

    console.log('[VOICE] Stopping microphone listening');

    this.shouldListen = false;

    this.micPermissionDenied = false;

    this.stopHealthCheck();

    if (this.restartTimer) {

      clearTimeout(this.restartTimer);

      this.restartTimer = null;

    }

    if (
      this.recognition &&
      this.isListening
    ) {

      try {
        this.recognition.stop();
      } catch (e) {
        console.log('[VOICE] Recognition stop:', e.message || e);
      }

    }

    this.isListening = false;

    this.setState('IDLE');

  }


  /* ==========================================================
     TOGGLE LISTENING
     ========================================================== */

  toggleListening() {

    if (this.shouldListen) {
      this.stopListening();
    } else {
      this.startListening();
    }

  }


  /* ==========================================================
     STATE MANAGEMENT
     ========================================================== */

  setState(newState) {

    const previousState = this.state;

    this.state = newState;

    console.log('[VoiceManager] State changed to:', newState);

    this.updateStateUI();

    this.stateCallbacks.forEach((callback) => {

      try {
        callback(newState);
      } catch (e) {
        console.warn('[VOICE] State callback error:', e);
      }

    });

    /* When speech finishes, return to listening. */
    if (
      previousState === 'SPEAKING' &&
      newState === 'LISTENING' &&
      this.shouldListen &&
      !this.isListening &&
      !this.micPermissionDenied
    ) {

      setTimeout(() => {

        if (
          this.shouldListen &&
          !this.isListening &&
          this.state === 'LISTENING' &&
          !this.isTtsActive()
        ) {
          this.safeStartRecognition();
        }

      }, 200);

    }

  }

  onStateChange(callback) {

    if (typeof callback === 'function') {
      this.stateCallbacks.push(callback);
    }

  }


  /* ==========================================================
     COMMAND REGISTRATION
     ========================================================== */

  registerCommand(intent, callback) {

    if (!intent || typeof callback !== 'function') {

      console.warn('[VOICE] Invalid command registration:', intent);

      return;

    }

    this.commandHandlers[intent] = callback;

    console.log(`[VOICE] Command registered: ${intent}`);

  }


  /* ==========================================================
     COMMAND DEFINITIONS
     ========================================================== */

  /*
   * NOTE: common single words that appear in normal questions
   * ('question', 'wait', 'review', 'practice', 'quiz') were
   * removed on purpose. They hijacked ordinary sentences.
   *
   * While a quiz waits for an answer, quizOwnsSpeech() makes
   * even the remaining single-word commands count as answers.
   */
  getIntentRules() {

    return [

      /* --------------------------------------------------------
         Revision modes
         -------------------------------------------------------- */

      {
        intent: 'REVISE_MODE',
        payload: 'quick',
        words: [
          'quick revision',
          'quick review',
          'quick revise'
        ]
      },

      {
        intent: 'REVISE_MODE',
        payload: 'detailed',
        words: [
          'detailed revision',
          'detailed review',
          'detailed revise'
        ]
      },

      {
        intent: 'REVISE_MODE',
        payload: 'exam',
        words: [
          'exam revision',
          'exam review',
          'exam revise'
        ]
      },

      {
        intent: 'REVISE_MODE',
        payload: 'question',
        words: [
          'question mode'
        ]
      },


      /* --------------------------------------------------------
         Speech controls
         -------------------------------------------------------- */

      {
        intent: 'STOP',
        words: [
          'stop',
          'halt',
          'be quiet',
          'silence',
          'shut up',
          'stop speaking',
          'stop talking',
          'stop audio'
        ]
      },

      {
        intent: 'PAUSE',
        words: [
          'pause',
          'pause speech',
          'pause speaking',
          'hold on'
        ]
      },

      {
        intent: 'CONTINUE',
        words: [
          'continue',
          'resume',
          'keep going',
          'continue speaking',
          'continue talking'
        ]
      },

      {
        intent: 'REPEAT',
        words: [
          'repeat',
          'say again',
          'read again',
          'play again',
          'repeat that',
          'repeat explanation'
        ]
      },

      {
        intent: 'GO_SLOW',
        words: [
          'go slow',
          'go slower',
          'slower',
          'slow down',
          'slow',
          'speak slower',
          'talk slower',
          'talk slowly',
          'speak slowly'
        ]
      },

      {
        intent: 'GO_FASTER',
        words: [
          'go faster',
          'faster',
          'speed up',
          'speak faster',
          'talk faster',
          'talk quickly'
        ]
      },

      {
        intent: 'NORMAL_SPEED',
        words: [
          'normal speed',
          'normal',
          'normal speaking speed',
          'normal voice speed',
          'go normal'
        ]
      },


      /* --------------------------------------------------------
         Start
         -------------------------------------------------------- */

      {
        intent: 'START',
        words: [
          'start soundsight',
          'start sound sight',
          'start sound site',
          'start soundsite',
          'start sound side',
          'start sound set',
          'start sunset',
          'start sound',
          'start app',
          'start',
          'begin',
          'begin soundsight',
          'begin sound sight',
          'begin sound site'
        ]
      },


      /* --------------------------------------------------------
         Camera closing
         -------------------------------------------------------- */

      {
        intent: 'CLOSE_CAMERA',
        words: [
          'close camera',
          'close the camera',
          'exit camera',
          'exit the camera',
          'stop camera',
          'stop the camera',
          'cancel camera',
          'cancel scan',
          'close scanner',
          'exit scanner',
          'stop scanner',
          'close the scanner',
          'exit the scanner'
        ]
      },


      /* --------------------------------------------------------
         History item commands
         -------------------------------------------------------- */

      {
        intent: 'OPEN_ITEM',
        words: [

          'open item one',
          'open item two',
          'open item three',
          'open item four',
          'open item five',
          'open item six',
          'open item seven',
          'open item eight',

          'item one',
          'item two',
          'item three',
          'item four',
          'item five',
          'item six',
          'item seven',
          'item eight',

          'open item 1',
          'open item 2',
          'open item 3',
          'open item 4',
          'open item 5',
          'open item 6',
          'open item 7',
          'open item 8',

          'item 1',
          'item 2',
          'item 3',
          'item 4',
          'item 5',
          'item 6',
          'item 7',
          'item 8'

        ]
      },


      /* --------------------------------------------------------
         Capture
         -------------------------------------------------------- */

      {
        intent: 'CAPTURE',
        words: [
          'capture',
          'captur',
          'capture image',
          'capture photo',
          'capture scan',
          'take picture',
          'take photo',
          'take a picture',
          'take a photo',
          'take scan',
          'scan now',
          'take the picture',
          'take the photo',
          'ready',
          "i'm ready",
          'i am ready',
          'i am ready now',
          'snap'
        ]
      },

      /* --------------------------------------------------------
          Retry Scanner
         -------------------------------------------------------- */

      {
        intent: 'RETRY_SCAN',
        words: [
          'try again',
          'retry',
          'retry scan',
          'scan again',
          'analyze again',
          'analyse again',
          'do it again'
        ]
      },

      /* --------------------------------------------------------
         Scanner
         -------------------------------------------------------- */

      {
        intent: 'SCAN',
        words: [
          'scan',
          'can',
          'open camera',
          'open the camera',
          'camera',
          'cam',
          'scanner',
          'open scanner',
          'open the scanner',
          'open webcam',
          'webcam',
          'start scanner',
          'start scanning'
        ]
      },


      /* --------------------------------------------------------
         Setup folder
         -------------------------------------------------------- */

      {
        intent: 'SETUP_FOLDER',
        words: [
          'set up folder',
          'setup folder',
          'set up my folder',
          'choose folder',
          'select folder',
          'change folder'
        ]
      },


      /* --------------------------------------------------------
         Upload
         -------------------------------------------------------- */

      {
        intent: 'UPLOAD',
        words: [
          'upload',
          'up load',
          'upload file',
          'upload an image',
          'upload image',
          'upload photo',
          'upload document',
          'choose file',
          'select file',
          'add file',
          'choose an image',
          'select an image',
          'choose image',
          'select image',
          'add image',
          'open file'
        ]
      },


      /* --------------------------------------------------------
         History
         -------------------------------------------------------- */

      {
        intent: 'HISTORY',
        words: [
          'history',
          'his story',
          'open history',
          'show history',
          'view history',
          'saved history',
          'saved topics',
          'saved items',
          'my history',
          'previous scans'
        ]
      },


      /* --------------------------------------------------------
         Explanation
         -------------------------------------------------------- */

      {
        intent: 'EXPLAIN_AGAIN',
        words: [
          'explain again',
          'restart explanation',
          'repeat explanation',
          'explain it again',
          'start explanation again'
        ]
      },

      {
        intent: 'EXPLAIN',
        words: [
          'explain',
          'explain this',
          'read it',
          'read out',
          'read this',
          'what does it say',
          'read explanation',
          'explain the result'
        ]
      },


      /* --------------------------------------------------------
         Help
         -------------------------------------------------------- */

      {
        intent: 'HELP',
        words: [
          'help',
          'help me',
          'open help',
          'show help',
          'help screen',
          'how do i use this'
        ]
      },


      /* --------------------------------------------------------
         Settings
         -------------------------------------------------------- */

      {
        intent: 'SETTINGS',
        words: [
          'settings',
          'setting',
          'open settings',
          'show settings',
          'open setting',
          'show setting',
          'app settings',
          'application settings'
        ]
      },


      /* --------------------------------------------------------
         Ask AI
         -------------------------------------------------------- */

      {
        intent: 'ASK_ABOUT_THIS',
        words: [
          'ask about this',
          'ask ai about this',
          'ask about this topic',
          'ask about this content',
          'ask about this scan',
          'ask a question',
          'ask question'
        ]
      },

      {
        intent: 'CLOSE_ASK',
        words: [
          'close ask ai',
          'close popup',
          'close the popup',
          'close ai',
          'close question'
        ]
      },

      {
        intent: 'ASK_AI',
        words: [
          'ask ai',
          'open ask ai',
          'open ai',
          'talk to ai',
          'talk to sound sight ai',
          'ask sound sight',
          'ask sound sight ai',
          'ai assistant',
          'open ai assistant'
        ]
      },


      /* --------------------------------------------------------
         Home / Dashboard
         -------------------------------------------------------- */

      {
        intent: 'HOME',
        words: [
          'home',
          'go home',
          'open home',
          'return home',
          'back home',
          'dashboard',
          'go to dashboard',
          'return to dashboard',
          'back to dashboard',
          'open dashboard',
          'main screen',
          'go to home'
        ]
      },


      /* --------------------------------------------------------
         Back
         -------------------------------------------------------- */

      {
        intent: 'BACK',
        words: [
          'back',
          'go back',
          'previous screen',
          'previous page'
        ]
      },


      /* --------------------------------------------------------
         Revision
         -------------------------------------------------------- */

      {
        intent: 'REVISE',
        words: [
          'revise',
          'revision',
          'revise mode',
          'open revision',
          'start revision',
          'revision mode'
        ]
      }

    ];

  }


  /* ==========================================================
     NUMBER FALLBACK
     ========================================================== */

  getNumberFallbackMap() {

    return {

      'one': 'SCAN',
      '1': 'SCAN',

      'two': 'UPLOAD',
      '2': 'UPLOAD',

      'three': 'HISTORY',
      '3': 'HISTORY',

      'four': 'REVISE',
      '4': 'REVISE',

      'five': 'HELP',
      '5': 'HELP',

      'six': 'SETTINGS',
      '6': 'SETTINGS'

    };

  }


  /* ==========================================================
     LEVENSHTEIN DISTANCE
     ========================================================== */

  levenshtein(a, b) {

    if (a === b) {
      return 0;
    }

    const m = a.length;
    const n = b.length;

    if (!m) {
      return n;
    }

    if (!n) {
      return m;
    }

    let previous = Array.from({ length: n + 1 }, (_, j) => j);

    for (let i = 1; i <= m; i++) {

      const current = [i];

      for (let j = 1; j <= n; j++) {

        current[j] = Math.min(
          previous[j] + 1,
          current[j - 1] + 1,
          previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );

      }

      previous = current;

    }

    return previous[n];

  }


  /* ==========================================================
     FIND COMMAND RULE
     ========================================================== */

  findRule(candidate, forgiving = false) {

    const rules = this.getIntentRules();

    const normalize = (value) => {

      return String(value || '')
        .toLowerCase()
        .trim()
        .replace(/[.,!?;:]+/g, ' ')
        .replace(/\s+/g, ' ');

    };

    const normalizedCandidate = normalize(candidate);

    if (!normalizedCandidate) {
      return null;
    }

    const candidateTokens =
      normalizedCandidate.split(' ').filter(Boolean);

    for (const rule of rules) {

      for (const rawWord of rule.words) {

        const word = normalize(rawWord);

        if (!word) {
          continue;
        }

        /* 1. Exact command / phrase. */
        if (normalizedCandidate === word) {
          return rule;
        }

        /*
         * 2. Natural-language wrapper.
         *
         * Allows short phrases such as:
         *   "please open settings"
         *   "can you open scanner"
         *
         * Only used for known multi-word commands.
         */
        if (
          forgiving &&
          word.includes(' ') &&
          candidateTokens.length <= 6
        ) {

          const escapedWord =
            word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

          const naturalPattern = new RegExp(
            `^(?:please\\s+|can\\s+you\\s+|could\\s+you\\s+|would\\s+you\\s+|i\\s+want\\s+to\\s+|take\\s+me\\s+to\\s+|go\\s+to\\s+|open\\s+|show\\s+)?${escapedWord}$`,
            'i'
          );

          if (naturalPattern.test(normalizedCandidate)) {
            return rule;
          }

        }

        /* 3. Short one-word fuzzy matching. */
        if (
          forgiving &&
          !word.includes(' ') &&
          candidateTokens.length === 1 &&
          word.length >= 4 &&
          Math.abs(normalizedCandidate.length - word.length) <= 1 &&
          this.levenshtein(normalizedCandidate, word) <= 1
        ) {
          return rule;
        }

      }

    }

    return null;

  }


  /* ==========================================================
     INTENT MATCHING
     ========================================================== */

  matchIntent(normPrimary, normAlternatives = []) {

    const candidates = [normPrimary, ...normAlternatives];

    const build = (rule) => {

      let payload =
        rule.payload !== undefined
          ? rule.payload
          : normPrimary;

      /* Revision topic extraction. */
      if (rule.intent === 'REVISE') {

        payload = normPrimary
          .replace(
            /^(revise|revision)\s*(for|about|on)?\s*/i,
            ''
          )
          .trim();

      }

      /* History manager receives the complete phrase. */
      if (rule.intent === 'OPEN_ITEM') {
        payload = normPrimary;
      }

      return {
        intent: rule.intent,
        payload
      };

    };

    /* Exact match. */
    for (const candidate of candidates) {

      const rule = this.findRule(candidate, false);

      if (rule) {
        return build(rule);
      }

    }

    /* Forgiving match. */
    for (const candidate of candidates) {

      if (candidate.split(/\s+/).filter(Boolean).length > 3) {
        continue;
      }

      const rule = this.findRule(candidate, true);

      if (rule) {
        return build(rule);
      }

    }

    /* Number fallback. */
    const numberMap = this.getNumberFallbackMap();

    for (const candidate of candidates) {

      const trimmed = candidate.trim();

      if (numberMap[trimmed]) {

        return {
          intent: numberMap[trimmed],
          payload: normPrimary
        };

      }

    }

    /*
     * Natural history commands, fuzzy:
     *   "open system architecture"
     *   "open sounds site system architecture" (misheard)
     */
    const historyTopicPattern = /^(open|show|select)\s+.+$/i;

    const hm = window.SoundSightHistoryManager;

    if (
      hm &&
      window.SoundSightApp?.currentView !== 'revision' &&
      typeof hm.findMatches === 'function' &&
      historyTopicPattern.test(normPrimary)
    ) {

      const query = hm.extractTopicFromCommand(normPrimary);

      const found = hm.findMatches(query).length > 0;

      const onHistory =
        window.SoundSightApp?.currentView === 'history';

      /*
       * On the History page every "open ..." is a history request,
       * so the student hears "I could not find..." instead of silence.
       */
      if (found || onHistory) {
        return {
          intent: 'OPEN_ITEM',
          payload: normPrimary
        };
      }
    }

    /* No command matched. */
    return null;

  }


  /* ==========================================================
     BARGE-IN COMMAND HANDLING
     ========================================================== */

  tryBargeInCommand(finalText, alternatives = []) {

    const norm = String(finalText || '').toLowerCase().trim();

    if (!norm) {
      return false;
    }

    if (
      (window.SoundSightApp?.askPopupSource ||
       window.SoundSightApp?.currentView === 'ask-ai') &&
      this.isCloseAskPhrase(norm)
    ) {
      try { window.SoundSightTTS?.stop(); } catch (e) {}
      this.executeBargeInIntent('CLOSE_ASK', norm);
      return true;
    }

    if (window.SoundSightApp?.awaitingUploadChoice && this.looksLikeTopicChoice(norm)) {
      try { window.SoundSightTTS?.stop(); } catch (e) {}
      this.dispatch('FREEFORM', finalText);
      return true;
    }

    /*
     * Topic number said while the Revision list is being read:
     * stop the list and choose that topic.
     */
    if (this.topicPickOwnsSpeech() && this.looksLikeTopicChoice(norm)) {

      try { window.SoundSightTTS?.stop(); } catch (e) {}

      this.dispatch('FREEFORM', finalText);

      return true;
    }

    /*
     * While a quiz question is being read, only a few safe
     * commands may interrupt it. Everything else is ignored so
     * an early spoken answer (for example "normal") does not
     * trigger an application command.
     */
    if (this.quizOwnsSpeech()) {

      if (
        /^(repeat|repeat that|repeat the question|say again|say that again)$/.test(norm)
      ) {

        /* Read the QUESTION again, not an old explanation. */
        window.SoundSightRevisionManager?.askQuestion('');

        return true;
      }

      const allowedDuringQuiz =
        /^(stop|pause|continue|resume)$/i;

      if (!allowedDuringQuiz.test(norm) && !this.isQuizCommand(norm)) {
        return false;
      }
    }

    /* Short commands only. */
    if (norm.split(/\s+/).filter(Boolean).length > 4) {
      return false;
    }

    const alts = (alternatives || [])
      .map((value) => String(value || '').toLowerCase().trim())
      .filter(Boolean);

    const matched = this.matchIntent(norm, alts);

    const intent =
      matched && matched.intent
        ? matched.intent
        : 'FREEFORM';

    if (!this.bargeInIntents.has(intent)) {
      return false;
    }

    console.log(`[VOICE] Command while speaking: ${intent}`);

    /* These commands must NOT stop TTS first. */
    const commandsHandledWithoutStoppingTTS = new Set([
      'PAUSE',
      'CONTINUE',
      'GO_SLOW',
      'GO_FASTER',
      'NORMAL_SPEED',
      'REPEAT'
    ]);

    if (commandsHandledWithoutStoppingTTS.has(intent)) {

      console.log(`[VOICE] Direct TTS command: ${intent}`);

      this.executeBargeInIntent(intent, matched.payload || norm);

      return true;

    }

    /* STOP. */
    if (intent === 'STOP') {

      this.executeBargeInIntent('STOP', matched.payload || norm);

      return true;

    }

    /*
     * Navigation / application command.
     * Stop current explanation first.
     */
    console.log(
      `[VOICE] Stopping speech before navigation/action: ${intent}`
    );

    if (
      window.SoundSightTTS &&
      typeof window.SoundSightTTS.stop === 'function'
    ) {

      try {
        window.SoundSightTTS.stop();
      } catch (e) {
        console.warn('[VOICE] TTS stop error:', e);
      }

    }

    /* Execute directly. */
    this.executeBargeInIntent(intent, matched.payload || norm);

    return true;

  }


  /* ==========================================================
     EXECUTE BARGE-IN INTENT
     ========================================================== */

  executeBargeInIntent(intent, payload = '') {

    console.log(`[VOICE] Executing barge-in intent: ${intent}`);

    /* Command chime. */
    if (
      window.SoundSightEarcons &&
      typeof window.SoundSightEarcons.commandChime === 'function'
    ) {

      try {
        window.SoundSightEarcons.commandChime();
      } catch (e) {
        console.warn('[VOICE] Earcon error:', e);
      }

    }

    /* ---------------- STOP ---------------- */

    if (intent === 'STOP' || intent === 'STOP_SPEECH') {

      if (
        window.SoundSightTTS &&
        typeof window.SoundSightTTS.stop === 'function'
      ) {

        try {
          window.SoundSightTTS.stop();
        } catch (e) {}

      }

      if (this.shouldListen && !this.micPermissionDenied) {
        this.setState('LISTENING');
      } else {
        this.setState('IDLE');
      }

      return true;
    }

    /* ---------------- PAUSE ---------------- */

    if (intent === 'PAUSE' || intent === 'PAUSE_SPEECH') {

      if (
        window.SoundSightTTS &&
        typeof window.SoundSightTTS.pause === 'function'
      ) {
        window.SoundSightTTS.pause();
      }

      return true;
    }

    /* ---------------- CONTINUE ---------------- */

    if (intent === 'CONTINUE' || intent === 'CONTINUE_SPEECH') {

      if (
        window.SoundSightTTS &&
        typeof window.SoundSightTTS.resume === 'function'
      ) {
        window.SoundSightTTS.resume();
      }

      return true;
    }

    /* ---------------- REPEAT ---------------- */

    if (intent === 'REPEAT' || intent === 'REPEAT_SPEECH') {

      if (
        window.SoundSightTTS &&
        typeof window.SoundSightTTS.repeat === 'function'
      ) {
        window.SoundSightTTS.repeat();
      }

      return true;
    }

    /* ---------------- SLOW ---------------- */

    if (intent === 'GO_SLOW') {

      if (
        window.SoundSightTTS &&
        typeof window.SoundSightTTS.goSlow === 'function'
      ) {
        window.SoundSightTTS.goSlow();
      }

      return true;
    }

    /* ---------------- FASTER ---------------- */

    if (intent === 'GO_FASTER') {

      if (
        window.SoundSightTTS &&
        typeof window.SoundSightTTS.goFaster === 'function'
      ) {
        window.SoundSightTTS.goFaster();
      }

      return true;
    }

    /* ---------------- NORMAL ---------------- */

    if (intent === 'NORMAL_SPEED') {

      if (
        window.SoundSightTTS &&
        typeof window.SoundSightTTS.normalSpeed === 'function'
      ) {
        window.SoundSightTTS.normalSpeed();
      }

      return true;
    }

    /* ---------------- ASK AI (standalone) ---------------- */

    if (intent === 'ASK_AI') {

      if (
        window.SoundSightTTS &&
        typeof window.SoundSightTTS.stop === 'function'
      ) {

        try {
          window.SoundSightTTS.stop();
        } catch (e) {}

      }

      if (
        window.SoundSightApp &&
        typeof window.SoundSightApp.openAskAI === 'function'
      ) {
        window.SoundSightApp.openAskAI();
      }

      return true;
    }

    /* ---------------- Registered handler ---------------- */

    if (this.commandHandlers[intent]) {

      try {
        this.commandHandlers[intent](payload);
      } catch (error) {
        console.error(`[VOICE] Error executing ${intent}:`, error);
      }

      return true;

    }

    /* ---------------- Action aliases ---------------- */

    const aliases = {

      'CAPTURE': 'EXECUTE_CAPTURE',
      'SCAN': 'OPEN_SCANNER',
      'UPLOAD': 'TRIGGER_UPLOAD',
      'HISTORY': 'OPEN_HISTORY',
      'REVISE': 'OPEN_REVISION',
      'HELP': 'OPEN_HELP',
      'SETTINGS': 'OPEN_SETTINGS',
      'HOME': 'OPEN_HOME',
      'BACK': 'GO_BACK',
      'EXPLAIN': 'START_EXPLANATION',
      'EXPLAIN_AGAIN': 'START_EXPLANATION',
      'CLOSE_CAMERA': 'CLOSE_CAMERA',
      'REVISE_MODE': 'REVISE_MODE',
      'OPEN_ITEM': 'OPEN_ITEM'

    };

    const alias = aliases[intent];

    if (alias && this.commandHandlers[alias]) {

      try {
        this.commandHandlers[alias](payload);
      } catch (error) {
        console.error(`[VOICE] Error executing ${alias}:`, error);
      }

      return true;

    }

    console.warn('[VOICE] No handler found for:', intent);

    return false;

  }


  /* ==========================================================
     SPOKEN QUESTION CLEANUP
     ==========================================================
     Converts spoken study requests into clear instructions:
       "explain gravity in short"  -> brief explanation
       "explain X for 5 points answer" -> exactly 5 numbered points
     ========================================================== */

  buildSpokenQuestion(text) {

    const question = String(text || '').trim();

    const shortMatch = question.match(
      /^explain\s+(.+?)\s+(?:in\s+)?short(?:\s+please)?[.!?]*$/i
    );

    const marksMatch = question.match(
      /^explain\s+(.+?)\s+for\s+(\d+)\s+points?\s+answer[.!?]*$/i
    );

    if (shortMatch) {
      return `Explain ${shortMatch[1]} briefly in 2–3 simple sentences.`;
    }

    if (marksMatch) {
      return `Explain ${marksMatch[1]} as an exam answer with exactly ${marksMatch[2]} numbered points.`;
    }

    return question;

  }

  isCloseAskPhrase(norm) {

    const text = String(norm || '').toLowerCase().trim();

    return /^(please\s+)?(close|closed|closing|exit|dismiss|cancel)(\s+(the\s+)?(ask(\s*(a\s*i|ai|hai))?|a\s*i|ai|popup|pop\s*up|window|this|it))?[.!?]*$/i
      .test(text);
  }


  /* ==========================================================
     NORMAL COMMAND PROCESSING
     ========================================================== */

  processCommand(rawText, alternatives = []) {

    const text = String(rawText || '').trim();

    if (!text) {
      return;
    }

    const norm = text.toLowerCase().trim();

    const normAlternatives = alternatives
      .map((value) => String(value || '').toLowerCase().trim())
      .filter(Boolean);

    const askApp = window.SoundSightApp;
    const askAssistant = window.SoundSightAssistant;

    /* Close Ask AI by voice (before anything is sent as a question). */
    if (
      (askApp?.askPopupSource || askApp?.currentView === 'ask-ai') &&
      this.isCloseAskPhrase(norm)
    ) {
      this.isProcessingCommand = false;
      this.setState('IDLE');
      this.dispatch('CLOSE_ASK', norm);
      return;
    }

    /*
     * ========================================================
     * ASK AI FOLLOW-UP TOPIC ROUTING
     * ========================================================
     * Checked before anti-echo protection so a spoken topic is
     * not discarded while the clarification finishes.
     */
    if (
      askApp?.currentView === 'ask-ai' &&
      askApp.askAIWaitingForTopic &&
      norm &&
      !/what topic would you like me to explain|ask ai is ready/i.test(norm)
    ) {

      askApp.askAIWaitingForTopic = false;

      this.isProcessingCommand = false;
      this.setState('IDLE');

      if (typeof askAssistant?.ask === 'function') {

        void askAssistant
          .ask(this.buildSpokenQuestion(text))
          .catch((error) => {
            console.error('[VOICE] Topic submission failed:', error);
          });

      } else {

        window.SoundSightTTS?.speak(
          'Ask AI is unavailable. Please try again.'
        );

      }

      return;
    }

    /*
     * ========================================================
     * ASK AI IS OPEN (standalone page OR a section popup)
     * ========================================================
     * Anything that is not an EXACT app command is a question.
     * The assistant uses its CURRENT source:
     *   standalone -> no context at all
     *   popup      -> only that section's explicit context
     */
    const askIsOpen =
      askApp?.currentView === 'ask-ai' ||
      !!askApp?.askPopupSource;

    if (
      askIsOpen &&
      !this.isTtsActive()
    ) {

      const exactCommand = this.findRule(norm, false);

      if (
        !exactCommand &&
        typeof askAssistant?.ask === 'function'
      ) {

        /* Duplicate protection for questions. */
        const nowAsk = Date.now();

        if (
          norm === this.lastCommandText &&
          (nowAsk - this.lastCommandTime) < 1500
        ) {
          return;
        }

        this.lastCommandText = norm;
        this.lastCommandTime = nowAsk;

        this.isProcessingCommand = false;
        this.setState('IDLE');

        void askAssistant
          .ask(this.buildSpokenQuestion(text))
          .catch((error) => {
            console.error('[VOICE] Ask AI failed:', error);
          });

        return;
      }

    }

    /*
     * ========================================================
     * QUIZ ANSWER ROUTING
     * ========================================================
     * While a quiz waits for an answer, almost everything the
     * student says is an ANSWER, even single words such as
     * "normal", "slow", "ready" or "can". Only these stay
     * real commands.
     */
    if (this.quizOwnsSpeech() && !this.isTtsActive()) {

      if (!this.isQuizCommand(norm)) {

        this.isProcessingCommand = false;

        /* The answer is being checked: show Processing, not Idle. */
        this.setState('PROCESSING');

        this.dispatch('FREEFORM', text);

        return;
      }
    }

      if (askApp?.awaitingUploadChoice && !this.isTtsActive()) {

      const rule = this.findRule(norm, false);

      const keep =
        rule &&
        ['HOME', 'BACK', 'STOP', 'PAUSE', 'CONTINUE',
         'GO_SLOW', 'GO_FASTER', 'NORMAL_SPEED'].includes(rule.intent);

      if (!keep) {
        this.isProcessingCommand = false;
        this.setState('PROCESSING');
        this.dispatch('FREEFORM', text);
        return;
      }
    }

    /*
     * ========================================================
     * TOPIC CHOICE IN REVISION
     * ========================================================
     * "one", "open topic two", "open item 3" choose a topic from
     * the revision list. They must not open History items or
     * start Scan / Upload.
     */
    if (
      this.topicPickOwnsSpeech() &&
      !this.isTtsActive() &&
      this.looksLikeTopicChoice(norm)
    ) {

      this.isProcessingCommand = false;

      this.setState('PROCESSING');

      this.dispatch('FREEFORM', text);

      return;
    }

    /*
     * ========================================================
     * DIRECT TOPIC QUESTIONS (Ask AI is NOT open)
     * ========================================================
     * "Explain photosynthesis" from any other page opens the
     * standalone Ask AI (no context) and asks the question.
     */
    const directExplain = norm.match(/^explain\s+(.+)$/i);

    const isStudyCommand =
      /^(explain this|explain it|explain the result|explain result|explain again|explain it again)$/i.test(norm);

    if (
      directExplain &&
      !isStudyCommand &&
      askApp &&
      typeof askAssistant?.ask === 'function'
    ) {

      const question = this.buildSpokenQuestion(text);

      this.isProcessingCommand = false;
      this.setState('IDLE');

      askApp.openAskAI();

      window.SoundSightTTS?.stop();

      void askAssistant
        .ask(question, { source: 'standalone' })
        .catch((error) => {
          console.error('[VOICE] Direct explanation failed:', error);
        });

      return;
    }

    /*
     * ========================================================
     * ANTI-ECHO PROTECTION
     * ========================================================
     * If TTS is active, do not process normal speech.
     * Explicit barge-in commands are already handled by
     * tryBargeInCommand().
     */
    if (this.isTtsActive()) {

      /* Emergency STOP fallback. */
      if (
        /(?:^|\s)(stop|halt|pause|silence|be quiet|shut up)(?:\s|$)/i.test(norm)
      ) {
        this.executeBargeInIntent('STOP', norm);
      }

      return;
    }

    /* Duplicate-command protection. */
    const now = Date.now();

    if (
      norm === this.lastCommandText &&
      (now - this.lastCommandTime) < 1200
    ) {

      console.log(`[VOICE] Ignoring duplicate command: "${norm}"`);

      return;

    }

    this.lastCommandText = norm;

    this.lastCommandTime = now;

    this.isProcessingCommand = true;

    /* Command feedback. */
    if (
      window.SoundSightEarcons &&
      typeof window.SoundSightEarcons.commandChime === 'function'
    ) {

      try {
        window.SoundSightEarcons.commandChime();
      } catch (e) {
        console.warn('[VOICE] Command chime error:', e);
      }

    }

    this.setState('COMMAND_DETECTED');

    /*
     * matchIntent() returns null when nothing matches.
     * Treat that as free speech instead of crashing.
     */
    const matched =
      this.matchIntent(norm, normAlternatives) ||
      { intent: 'FREEFORM', payload: text };

    const intent = matched.intent;

    const payload = matched.payload;

    console.log(`[VOICE] Final transcript: ${text}`);
    console.log(`[VOICE] Normalized transcript: ${norm}`);
    console.log(`[VOICE] Detected intent: ${intent}`);

    /* Execute command. */
    try {

      this.dispatch(intent, payload);

    } catch (error) {

      console.error(
        `[VOICE] Command execution error for ${intent}:`,
        error
      );

    } finally {

      /*
       * Command dispatch is complete.
       * Allow the next voice command immediately.
       */
      this.isProcessingCommand = false;

    }

    /*
     * Return UI to Listening.
     * TTS state will override this if speech starts.
     */
    setTimeout(() => {

      if (this.state !== 'COMMAND_DETECTED') {
        return;
      }

      if (this.isTtsActive()) {
        this.setState('SPEAKING');
        return;
      }

      if (this.shouldListen && !this.micPermissionDenied) {
        this.setState('LISTENING');
      } else {
        this.setState('IDLE');
      }

    }, 350);

  }


  /* ==========================================================
     DISPATCH
     ========================================================== */

  dispatch(intent, payload = '') {

    /* Direct registered handler. */
    if (this.commandHandlers[intent]) {

      try {
        this.commandHandlers[intent](payload);
      } catch (error) {
        console.error(`[VOICE] Handler error for ${intent}:`, error);
      }

      return;

    }

    /* Alias map. */
    const actionMap = {

      'CAPTURE': 'EXECUTE_CAPTURE',
      'EXECUTE_CAPTURE': 'CAPTURE',

      'SCAN': 'OPEN_SCANNER',
      'OPEN_SCANNER': 'SCAN',

      'UPLOAD': 'TRIGGER_UPLOAD',
      'TRIGGER_UPLOAD': 'UPLOAD',

      'HISTORY': 'OPEN_HISTORY',
      'OPEN_HISTORY': 'HISTORY',

      'REVISE': 'OPEN_REVISION',
      'OPEN_REVISION': 'REVISE',

      'HELP': 'OPEN_HELP',
      'OPEN_HELP': 'HELP',

      'SETTINGS': 'OPEN_SETTINGS',
      'OPEN_SETTINGS': 'SETTINGS',

      'HOME': 'OPEN_HOME',
      'OPEN_HOME': 'HOME',

      'BACK': 'GO_BACK',
      'GO_BACK': 'BACK',

      'EXPLAIN': 'START_EXPLANATION',
      'START_EXPLANATION': 'EXPLAIN',

      'EXPLAIN_AGAIN': 'START_EXPLANATION',

      'STOP': 'STOP_SPEECH',
      'STOP_SPEECH': 'STOP',

      'PAUSE': 'PAUSE_SPEECH',
      'PAUSE_SPEECH': 'PAUSE',

      'CONTINUE': 'CONTINUE_SPEECH',
      'CONTINUE_SPEECH': 'CONTINUE',

      'REPEAT': 'REPEAT_SPEECH',
      'REPEAT_SPEECH': 'REPEAT'

    };

    const alias = actionMap[intent];

    if (alias && this.commandHandlers[alias]) {

      try {
        this.commandHandlers[alias](payload);
      } catch (error) {
        console.error(`[VOICE] Alias handler error for ${alias}:`, error);
      }

      return;

    }

    /* FREEFORM. */
    if (intent === 'FREEFORM') {

      if (this.commandHandlers.FREEFORM) {

        try {
          this.commandHandlers.FREEFORM(payload);
        } catch (error) {
          console.error('[VOICE] FREEFORM handler error:', error);
        }

      } else {

        console.log(
          '[VOICE] No FREEFORM handler registered:',
          payload
        );

      }

      return;

    }

    console.warn('[VoiceManager] Unhandled intent:', intent, payload);

  }


  /* ==========================================================
     STATE UI
     ========================================================== */

  updateStateUI() {

    const dot = document.getElementById('voiceStatusDot');

    const label = document.getElementById('voiceStatusText');

    const micBtn = document.getElementById('micToggleBtn');

    const stateMap = {

      'IDLE': {
        text: 'Idle',
        dotClass: 'status-dot idle'
      },

      'LISTENING': {
        text: 'Listening',
        dotClass: 'status-dot listening'
      },

      'COMMAND_DETECTED': {
        text: 'Processing',
        dotClass: 'status-dot processing'
      },

      'PROCESSING': {
        text: 'Processing',
        dotClass: 'status-dot processing'
      },

      'SPEAKING': {
        text: 'Speaking',
        dotClass: 'status-dot speaking'
      }

    };

    const current = stateMap[this.state] || stateMap.IDLE;

    if (dot) {
      dot.className = current.dotClass;
    }

    if (label) {
      label.textContent = current.text;
    }

    if (micBtn) {

      const listening = this.state === 'LISTENING';

      micBtn.setAttribute('aria-pressed', listening.toString());

      if (listening) {
        micBtn.classList.add('active');
      } else {
        micBtn.classList.remove('active');
      }

    }

  }


  /* ==========================================================
     LIVE TRANSCRIPT UI
     ========================================================== */

  updateTranscriptUI(text, isFinal) {

    const element = document.getElementById('voiceTranscriptLive');

    if (!element) {
      return;
    }

    element.textContent = text ? `“${text}”` : '';

    if (isFinal) {
      element.classList.add('transcript-final');
    } else {
      element.classList.remove('transcript-final');
    }

  }

}


/* ============================================================
   GLOBAL INSTANCE
   ============================================================ */

window.SoundSightVoiceManager = new SoundSightVoiceManager();

console.log('[VOICE] Voice manager loaded successfully');