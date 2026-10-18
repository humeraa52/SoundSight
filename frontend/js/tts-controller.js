/**
 * ============================================================
 * SoundSight Text-to-Speech Controller
 * ============================================================
 *
 * Features:
 * - Reliable SpeechSynthesis
 * - Pause / Resume
 * - Stop
 * - Repeat
 * - Slow / Fast / Normal
 * - Voice-command speed changes
 * - Explanation replay
 * - Sentence chunking
 * - Chrome speech recovery
 * - Watchdog protection
 * - Prevents stale speech callbacks
 *
 * ============================================================
 */

class SoundSightTTS {

  constructor() {

    this.synth =
      window.speechSynthesis;

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

    this.sessionId = 0;

    this.startTimer = null;
    this.watchdogTimer = null;

    this.rearmWatchdog = null;

    this.failedChunks = 0;

    /*
     * Used to distinguish an intentional
     * pause from a real speech failure.
     */
    this.pauseRequested = false;

    /*
     * Used when restarting speech at a
     * different speed.
     */
    this.speedChangeRequested = false;

    this.initVoices();
  }


  /* ==========================================================
     VOICE INITIALIZATION
     ========================================================== */

  initVoices() {

    if (!this.synth) {
      return;
    }

    const loadVoices = () => {

      const voices =
        this.synth.getVoices();

      if (
        !voices ||
        voices.length === 0
      ) {
        return;
      }

      const english =
        voices.filter(
          voice =>
            (voice.lang || '')
              .toLowerCase()
              .startsWith('en')
        );

      const localEnglish =
        english.filter(
          voice =>
            voice.localService
        );

      const nicest =
        list =>
          list.find(
            voice =>
              /natural|enhanced|premium/i
                .test(voice.name)
          ) || list[0];

      this.selectedVoice =
        (
          localEnglish.length
            ? nicest(localEnglish)
            : null
        ) ||
        (
          english.length
            ? nicest(english)
            : null
        ) ||
        voices[0];

      console.log(
        '[TTS] Voice selected:',
        this.selectedVoice?.name
      );

    };

    loadVoices();

    if (
      this.synth.onvoiceschanged !== undefined
    ) {

      this.synth.onvoiceschanged =
        loadVoices;

    }

  }


  /* ==========================================================
     SPEED
     ========================================================== */

  setRate(rate) {

    this.currentRate =
      Math.max(
        0.5,
        Math.min(
          2.0,
          Number(rate) || 1.0
        )
      );

    console.log(
      `[TTS] Rate set to ${this.currentRate}`
    );

    return this.currentRate;
  }


  /* ----------------------------------------------------------
     GO SLOW
     ---------------------------------------------------------- */

  goSlow() {

    console.log(
      '[TTS] Voice command: GO_SLOW'
    );

    this.setRate(0.8);

    this.restartCurrentSpeechAtRate(
      0.8
    );

  }


  /* ----------------------------------------------------------
     GO FASTER
     ---------------------------------------------------------- */

  goFaster() {

    console.log(
      '[TTS] Voice command: GO_FASTER'
    );

    this.setRate(1.3);

    this.restartCurrentSpeechAtRate(
      1.3
    );

  }


  /* ----------------------------------------------------------
     NORMAL SPEED
     ---------------------------------------------------------- */

  normalSpeed() {

    console.log(
      '[TTS] Voice command: NORMAL_SPEED'
    );

    this.setRate(1.0);

    this.restartCurrentSpeechAtRate(
      1.0
    );

  }


  /* ==========================================================
     RESTART CURRENT EXPLANATION AT NEW SPEED
     ========================================================== */

  restartCurrentSpeechAtRate(rate) {
  const currentlySpeakingExplanation =
    this.lastExplanationText &&
    this.currentOptions &&
    this.currentOptions.isExplanation === true &&
    (this.isSpeaking || this.isPaused);

  /*
   * Only restart an explanation if an explanation is
   * ACTUALLY active right now.
   *
   * Do NOT use lastExplanationText by itself because it
   * contains old explanations and must not be replayed
   * just because the user changed speech speed.
   */
  if (currentlySpeakingExplanation) {
    const explanation = this.lastExplanationText;

    console.log(
      `[TTS] Restarting ACTIVE explanation at ${rate}x`
    );

    this.speedChangeRequested = true;

    this.cancelCurrent();

    this.isSpeaking = false;
    this.isPaused = false;
    this.pauseRequested = false;

    this.chunks = [];
    this.currentChunkIndex = 0;

    this.updateUIStatus(false);

    setTimeout(() => {
      this.speedChangeRequested = false;

      this.speakExplanation(
        explanation,
        {
          rate: rate
        }
      );
    }, 180);

    return;
  }

  /*
   * No explanation is currently active.
   *
   * Changing speed must NOT replay old content.
   */
  console.log(
    `[TTS] Speed changed to ${rate}x; no active explanation to restart.`
  );
}

  /* ==========================================================
     TEXT CHUNKING
     ========================================================== */

  chunkText(text) {

    const clean =
      String(
        text || ''
      ).trim();

    if (!clean) {
      return [];
    }

    const rawSentences =
      clean.match(
        /[^.!?\n]+[.!?\n]+|[^.!?\n]+$/g
      ) || [clean];

    const chunks = [];


    for (
      const sentence of rawSentences
    ) {

      const trimmed =
        sentence.trim();

      if (!trimmed) {
        continue;
      }


      /*
       * Break very long sentences.
       */
      if (
        trimmed.length > 180
      ) {

        const subParts =
          trimmed.match(
            /[^,;]+[,;]+|[^,;]+$/g
          ) || [trimmed];

        for (
          const part of subParts
        ) {

          const cleanPart =
            part.trim();

          if (cleanPart) {
            chunks.push(
              cleanPart
            );
          }

        }

      } else {

        chunks.push(
          trimmed
        );

      }

    }


    return (
      chunks.length
        ? chunks
        : [clean]
    );

  }


  /* ==========================================================
     EXPLANATION
     ========================================================== */

  speakExplanation(
    text,
    options = {}
  ) {

    if (!text) {
      return;
    }

    console.log(
      '[TTS] Explain pressed'
    );

    console.log(
      `[TTS] Explanation length: ${text.length}`
    );

    this.lastExplanationText =
      text;

    this.speak(
      text,
      {
        ...options,
        isExplanation: true
      }
    );

  }


  /* ==========================================================
     TIMER MANAGEMENT
     ========================================================== */

  clearTimers() {

    if (this.startTimer) {

      clearTimeout(
        this.startTimer
      );

      this.startTimer =
        null;

    }


    if (this.watchdogTimer) {

      clearTimeout(
        this.watchdogTimer
      );

      this.watchdogTimer =
        null;

    }

  }


  /* ==========================================================
     CANCEL CURRENT SPEECH
     ========================================================== */

  cancelCurrent() {

    /*
     * Invalidate every previous callback.
     */
    this.sessionId++;

    this.clearTimers();

    this.rearmWatchdog =
      null;

    if (this.synth) {

      try {

        /*
         * Chrome sometimes remains paused.
         * Resume before cancel so the queue
         * can be properly cleared.
         */
        if (
          this.synth.paused
        ) {

          this.synth.resume();

        }

        this.synth.cancel();

      } catch (error) {

        console.warn(
          '[TTS] Cancel error:',
          error
        );

      }

    }

    window.__soundsight_active_utterance =
      null;

  }


  /* ==========================================================
     SPEAK
     ========================================================== */

  speak(
    text,
    options = {}
  ) {

    if (!this.synth) {

      console.warn(
        '[TTS] SpeechSynthesis not supported'
      );

      if (
        options.onEnd
      ) {

        options.onEnd();

      }

      return;

    }


    if (
      !text ||
      !String(text).trim()
    ) {

      return;

    }


    /*
     * Cancel previous speech.
     */
    this.cancelCurrent();


    const id =
      this.sessionId;


    this.lastSpokenText =
      String(text);


    if (
      options.isExplanation
    ) {

      this.lastExplanationText =
        String(text);

    }


    this.chunks =
      this.chunkText(text);

    this.currentChunkIndex =
      0;

    this.currentOptions =
      options;

    this.failedChunks =
      0;

    this.pauseRequested =
      false;

    this.isSpeaking =
      true;

    this.isPaused =
      false;


    console.log(
      '[TTS] Starting speech'
    );


    /*
     * Chrome-safe delay after cancel().
     */
    setTimeout(() => {

      if (
        id === this.sessionId &&
        !this.pauseRequested
      ) {

        this.playNextChunk(
          id
        );

      }

    }, 100);

  }


  /* ==========================================================
     PLAY NEXT CHUNK
     ========================================================== */

  playNextChunk(id) {

    if (
      id !== this.sessionId
    ) {

      return;

    }


    /*
     * If user paused before the next
     * chunk started, do nothing.
     */
    if (
      this.pauseRequested ||
      this.isPaused
    ) {

      return;

    }


    /*
     * Finished all chunks.
     */
    if (
      this.currentChunkIndex >=
      this.chunks.length
    ) {

      this.finish(
        id
      );

      return;

    }


    const chunk =
      this.chunks[
        this.currentChunkIndex
      ];


    const utterance =
      new SpeechSynthesisUtterance(
        chunk
      );


    utterance.rate =
      this.currentOptions.rate ||
      this.currentRate;


    utterance.pitch =
      this.currentOptions.pitch ||
      this.currentPitch;


    if (
      this.selectedVoice
    ) {

      utterance.voice =
        this.selectedVoice;

      utterance.lang =
        this.selectedVoice.lang ||
        'en-US';

    }


    /*
     * Keep reference alive.
     */
    window.__soundsight_active_utterance =
      utterance;


    let started =
      false;

    let done =
      false;

    let abandoned =
      false;


    /* --------------------------------------------------------
       ADVANCE
       -------------------------------------------------------- */

    const advance = () => {

      if (done) {
        return;
      }

      done = true;

      this.clearTimers();

      if (
        id !== this.sessionId
      ) {

        return;

      }


      /*
       * Do not continue after pause.
       */
      if (
        this.pauseRequested ||
        this.isPaused
      ) {

        return;

      }


      this.currentChunkIndex++;

      this.playNextChunk(
        id
      );

    };


    /* --------------------------------------------------------
       ABANDON
       -------------------------------------------------------- */

    const abandon = () => {

      if (abandoned) {
        return;
      }

      abandoned =
        true;

      this.clearTimers();

      try {

        this.synth.cancel();

      } catch (e) {}


      setTimeout(
        () => {

          if (
            id === this.sessionId &&
            !this.pauseRequested
          ) {

            advance();

          }

        },
        100
      );

    };


    /* --------------------------------------------------------
       WATCHDOG
       -------------------------------------------------------- */

    const armWatchdog = () => {

      if (
        this.watchdogTimer
      ) {

        clearTimeout(
          this.watchdogTimer
        );

      }


      const rate =
        utterance.rate || 1;


      const timeout =
        Math.max(
          6000,
          (
            chunk.length *
            120
          ) / rate +
          4000
        );


      this.watchdogTimer =
        setTimeout(() => {

          if (
            abandoned ||
            done ||
            id !== this.sessionId ||
            this.isPaused ||
            this.pauseRequested
          ) {

            return;

          }


          console.warn(
            '[TTS] Speech stalled - recovering'
          );


          abandon();

        }, timeout);

    };


    this.rearmWatchdog =
      armWatchdog;


    /* --------------------------------------------------------
       ON START
       -------------------------------------------------------- */

    utterance.onstart =
      () => {

        started =
          true;

        this.failedChunks =
          0;


        if (
          abandoned ||
          id !== this.sessionId
        ) {

          return;

        }


        if (
          this.startTimer
        ) {

          clearTimeout(
            this.startTimer
          );

          this.startTimer =
            null;

        }


        if (
          this.currentChunkIndex === 0
        ) {

          console.log(
            '[TTS] Speech started'
          );

          this.isSpeaking =
            true;

          this.isPaused =
            false;

          this.updateUIStatus(
            true
          );


          if (
            window.SoundSightVoiceManager
          ) {

            window.SoundSightVoiceManager
              .setState(
                'SPEAKING'
              );

          }


          if (
            this.currentOptions.onStart
          ) {

            this.currentOptions
              .onStart();

          }

        }


        armWatchdog();

      };


    /* --------------------------------------------------------
       ON BOUNDARY
       -------------------------------------------------------- */

    utterance.onboundary =
      () => {

        if (
          started &&
          !abandoned &&
          id === this.sessionId &&
          !this.isPaused &&
          !this.pauseRequested
        ) {

          armWatchdog();

        }

      };


    /* --------------------------------------------------------
       ON END
       -------------------------------------------------------- */

    utterance.onend =
      () => {

        if (abandoned) {
          return;
        }


        window.__soundsight_active_utterance =
          null;


        /*
         * If the user paused, do not
         * advance the queue.
         */
        if (
          this.isPaused ||
          this.pauseRequested
        ) {

          return;

        }


        advance();

      };


    /* --------------------------------------------------------
       ON ERROR
       -------------------------------------------------------- */

    utterance.onerror =
      event => {

        if (abandoned) {
          return;
        }


        /*
         * Ignore stale callbacks.
         */
        if (
          id !== this.sessionId
        ) {

          return;

        }


        /*
         * "interrupted" is normal when
         * the user stops/restarts speech.
         */
        if (
          event &&
          event.error !== 'interrupted'
        ) {

          console.warn(
            '[TTS] Speech error:',
            event.error
          );

        }


        window.__soundsight_active_utterance =
          null;


        /*
         * Never advance during pause.
         */
        if (
          this.isPaused ||
          this.pauseRequested
        ) {

          return;

        }


        if (
          this.currentOptions.onError
        ) {

          const callback =
            this.currentOptions.onError;

          this.currentOptions.onError =
            null;

          try {

            callback(
              event
            );

          } catch (e) {}

        }


        advance();

      };


    /* --------------------------------------------------------
       START WATCHDOG
       -------------------------------------------------------- */

    this.startTimer =
      setTimeout(() => {

        if (
          started ||
          abandoned ||
          done ||
          id !== this.sessionId ||
          this.isPaused ||
          this.pauseRequested
        ) {

          return;

        }


        console.warn(
          '[TTS] Utterance never started'
        );


        this.failedChunks++;


        if (
          this.failedChunks >= 2
        ) {

          abandoned =
            true;

          try {

            this.synth.cancel();

          } catch (e) {}


          this.finish(
            id
          );

          return;

        }


        abandon();

      }, 4500);


    /* --------------------------------------------------------
       SPEAK
       -------------------------------------------------------- */

    try {

      if (
        this.synth.paused &&
        !this.isPaused
      ) {

        this.synth.resume();

      }


      this.synth.speak(
        utterance
      );

    } catch (error) {

      console.warn(
        '[TTS] speak() threw:',
        error
      );

      abandon();

    }

  }


  /* ==========================================================
     FINISH
     ========================================================== */

  finish(id) {

    if (
      id !== this.sessionId
    ) {

      return;

    }


    this.clearTimers();

    this.rearmWatchdog =
      null;

    window.__soundsight_active_utterance =
      null;


    console.log(
      '[TTS] Speech ended'
    );


    this.isSpeaking =
      false;

    this.isPaused =
      false;

    this.pauseRequested =
      false;


    this.updateUIStatus(
      false
    );


    const options =
      this.currentOptions ||
      {};


    this.currentOptions =
      {};


    if (
      window.SoundSightVoiceManager
    ) {

      window.SoundSightVoiceManager
        .setState(
          'LISTENING'
        );

    }


    if (
      options.onEnd
    ) {

      try {

        options.onEnd();

      } catch (e) {

        console.warn(
          '[TTS] onEnd error:',
          e
        );

      }

    }

  }


  /* ==========================================================
     STOP
     ========================================================== */

  stop() {

    console.log(
      '[TTS] STOP'
    );


    this.pauseRequested =
      false;

    this.cancelCurrent();


    this.isSpeaking =
      false;

    this.isPaused =
      false;


    this.chunks =
      [];

    this.currentChunkIndex =
      0;

    this.currentOptions =
      {};


    this.updateUIStatus(
      false
    );


    if (
      window.SoundSightVoiceManager
    ) {

      window.SoundSightVoiceManager
        .setState(
          'LISTENING'
        );

    }

  }


  /* ==========================================================
     PAUSE
     ========================================================== */

  pause() {

    console.log(
      '[TTS] PAUSE requested'
    );


    if (!this.synth) {
      return;
    }


    if (
      !this.isSpeaking ||
      this.isPaused
    ) {

      console.log(
        '[TTS] Nothing currently speaking to pause'
      );

      return;

    }


    this.pauseRequested =
      true;


    /*
     * Stop watchdog timers while paused.
     */
    this.clearTimers();


    try {

      this.synth.pause();

    } catch (error) {

      console.warn(
        '[TTS] Pause error:',
        error
      );

    }


    this.isPaused =
      true;

    this.isSpeaking =
      true;


    this.updateUIStatus(
      false,
      'paused'
    );


    /*
     * Microphone should now be allowed
     * to hear "continue".
     */
    if (
      window.SoundSightVoiceManager
    ) {

      window.SoundSightVoiceManager
        .setState(
          'LISTENING'
        );

    }


    console.log(
      '[TTS] Speech paused'
    );

  }


  /* ==========================================================
     RESUME
     ========================================================== */

  resume() {

    console.log(
      '[TTS] CONTINUE / RESUME requested'
    );


    if (!this.synth) {
      return;
    }


    if (!this.isPaused) {

      console.log(
        '[TTS] Speech is not paused'
      );

      return;

    }


    try {

      /*
       * Clear pause flag BEFORE resume.
       */
      this.pauseRequested =
        false;

      this.isPaused =
        false;

      this.isSpeaking =
        true;


      this.synth.resume();


      this.updateUIStatus(
        true
      );


      if (
        window.SoundSightVoiceManager
      ) {

        window.SoundSightVoiceManager
          .setState(
            'SPEAKING'
          );

      }


      /*
       * Restart watchdog.
       */
      if (
        this.rearmWatchdog
      ) {

        this.rearmWatchdog();

      }


      console.log(
        '[TTS] Speech resumed'
      );

    } catch (error) {

      console.warn(
        '[TTS] Resume error:',
        error
      );

    }

  }


  /* ==========================================================
     REPEAT
     ========================================================== */

  repeat() {

    console.log(
      '[TTS] Repeat triggered'
    );


    if (
      this.lastExplanationText
    ) {

      this.speakExplanation(
        this.lastExplanationText,
        {
          rate:
            this.currentRate
        }
      );

      return;

    }


    if (
      this.lastSpokenText
    ) {

      this.speak(
        this.lastSpokenText,
        {
          rate:
            this.currentRate
        }
      );

      return;

    }


    this.speak(
      'Nothing to repeat.'
    );

  }


  /* ==========================================================
     UI STATUS
     ========================================================== */

  updateUIStatus(
    isSpeaking,
    state = 'speaking'
  ) {

    const status =
      document.getElementById(
        'audioPlayingStatus'
      );


    if (!status) {
      return;
    }


    if (isSpeaking) {

      status.textContent =
        '🔊 Speaking explanation';

      status.classList.remove(
        'hidden'
      );

      return;

    }


    if (
      state === 'paused'
    ) {

      status.textContent =
        '⏸ Speech paused';

      status.classList.remove(
        'hidden'
      );

      return;

    }


    status.classList.add(
      'hidden'
    );

  }

}


/* ============================================================
   GLOBAL INSTANCE
   ============================================================ */

window.SoundSightTTS =
  new SoundSightTTS();


console.log(
  '[TTS] SoundSight TTS controller loaded'
);