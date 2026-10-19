/**  APP.JS
 * SoundSight Main Application Coordinator
 * Accessible STEM learning application
 *
 * Ask AI architecture:
 *   - Dashboard "Ask AI" (view-ask-ai) is STANDALONE: no scan/upload/
 *     history/revision context, ever.
 *   - Each section (scanner, upload, history, revision) opens a small
 *     popup via openAskPopup(source, context) and passes ONLY its own
 *     explicit context.
 *   - Nothing here assigns Ask AI context automatically.
 */

class SoundSightApp {
  constructor() {
    this.currentView = 'welcome';
    this.currentAnalysis = null;
    this.uploadOverlay = null;

    /* Ask AI state */
    this.askPopupSource = null;        // null = popup closed
    this.askAIWaitingForTopic = false;

    /* Voice upload state */
    this.awaitingUploadChoice = false;
    this.voiceUploadFiles = [];

    /* Explicit section items (set ONLY by their own section) */
    this.selectedHistoryItem = null;
    this.currentRevisionItem = null;

    /* Last scan/upload input, kept so "try again" can re-send it */
    this.lastProcessingInput = null;

    /* Voice commands are registered once, even if the voice manager
       loads after this file. */
    this.voiceCommandsReady = false;

    /* Wait for the DOM so every element id exists before binding. */
    if (document.readyState === 'loading') {
      document.addEventListener(
        'DOMContentLoaded',
        () => this.init(),
        { once: true }
      );
    } else {
      this.init();
    }
  }

  init() {
    this.bindEvents();

    /*
     * If the voice manager script has not loaded yet, keep trying for
     * a few seconds instead of silently running without voice commands.
     */
    if (!this.setupVoiceCommands()) {
      let tries = 0;

      const timer = setInterval(() => {
        tries += 1;

        if (this.setupVoiceCommands() || tries >= 40) {
          clearInterval(timer);
        }
      }, 250);
    }

    this.setupAccessibilityShortcuts();
    this.renderBenchmarkCards();

    const startBtn = document.getElementById('startSoundSightBtn');

    if (startBtn) {
      setTimeout(() => {
        try {
          startBtn.focus();
        } catch (e) {}
      }, 100);
    }
  }

  /* =========================================================
     HELPERS
     ========================================================= */

  /** True when the standalone page OR a section popup is open. */
  isAskAIOpen() {
    return this.currentView === 'ask-ai' || !!this.askPopupSource;
  }

  /* =========================================================
     EVENT BINDING
     ========================================================= */

  bindEvents() {
    /* ---------- START ---------- */

    document
      .getElementById('startSoundSightBtn')
      ?.addEventListener('click', () => {
        this.startSoundSight();
      });

    /* ---------- MICROPHONE ---------- */

    const micToggleBtn = document.getElementById('micToggleBtn');

    if (micToggleBtn) {
      micToggleBtn.addEventListener('click', () => {
        console.log('[MIC BUTTON] CLICKED');
        window.SoundSightVoiceManager?.toggleListening();
      });
    } else {
      console.error('[MIC BUTTON] micToggleBtn NOT FOUND');
    }

    /* ---------- DASHBOARD CARDS ---------- */

    const dashboardActions = {
      cardScan: () => this.openScanner(),
      cardUpload: () => this.triggerUpload(),
      cardHistory: () => this.openHistory(),
      cardRevise: () => this.openRevision(),
      cardHelp: () => this.openHelp(),
      cardSettings: () => this.openSettings(),
      cardAskAI: () => this.openAskAI()
    };

    Object.entries(dashboardActions).forEach(([id, action]) => {
      const card = document.getElementById(id);

      if (!card) {
        return;
      }

      card.addEventListener('click', () => {
        action();
      });

      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          action();
        }
      });
    });

    /* ---------- FILE INPUT ---------- */

    const fileInput = document.getElementById('fileUploadInput');

    if (fileInput) {
      fileInput.addEventListener('change', (event) => {
        this.handleFileUpload(event);
      });
    }

    /* ---------- AUDIO CONTROLS ---------- */

    document
      .getElementById('btnAudioExplain')
      ?.addEventListener('click', () => {
        this.startExplanation();
      });

    document
      .getElementById('btnAudioStop')
      ?.addEventListener('click', () => {
        window.SoundSightTTS?.stop();
      });

    document
      .getElementById('btnAudioPause')
      ?.addEventListener('click', () => {
        window.SoundSightTTS?.pause();
      });

    document
      .getElementById('btnAudioResume')
      ?.addEventListener('click', () => {
        window.SoundSightTTS?.resume();
      });

    document
      .getElementById('btnAudioRepeat')
      ?.addEventListener('click', () => {
        window.SoundSightTTS?.repeat();
      });

    document
      .getElementById('btnAudioSlow')
      ?.addEventListener('click', () => {
        window.SoundSightTTS?.goSlow();
      });

    document
      .getElementById('btnAudioNormal')
      ?.addEventListener('click', () => {
        window.SoundSightTTS?.normalSpeed();
      });

    document
      .getElementById('btnAudioFast')
      ?.addEventListener('click', () => {
        window.SoundSightTTS?.goFaster();
      });

    /* ---------- ASK AI DASHBOARD BUTTON ---------- */

    document
      .getElementById('btnAskAIDashboard')
      ?.addEventListener('click', () => {
        this.goToDashboard();
      });

    /* ---------- ASK AI SECTION POPUP BUTTONS ----------
     * Each button passes ONLY its own section's context.
     * (Add the buttons with these ids to index.html.)
     */

    // Explanation / scanned / uploaded / opened-from-history result
    ['btnAskAIExplanation', 'btnAskAIScanner', 'btnAskAIUpload']
      .forEach((id) => {
        document
          .getElementById(id)
          ?.addEventListener('click', () => {
            this.askAboutCurrentExplanation();
          });
      });

    document
      .getElementById('btnAskAIHistory')
      ?.addEventListener('click', () => {
        this.openAskPopup('history', this.selectedHistoryItem);
      });

    document
      .getElementById('btnAskAIRevision')
      ?.addEventListener('click', () => {
        this.openAskPopup('revision', this.currentRevisionItem);
      });

    /* ---------- HOME BUTTONS ---------- */

    document
      .querySelectorAll('.btn-nav-home')
      .forEach((button) => {
        button.addEventListener('click', () => {
          this.goToDashboard();
        });
      });

    /* ---------- CAMERA ---------- */

    document
      .getElementById('btnManualCapture')
      ?.addEventListener('click', () => {
        if (
          window.SoundSightCameraScanner &&
          window.SoundSightCameraScanner.isRunning
        ) {
          window.SoundSightCameraScanner.requestCapture();
        }
      });

    document
      .getElementById('btnCloseScanner')
      ?.addEventListener('click', () => {
        window.SoundSightCameraScanner?.stop();
        this.goToDashboard();
      });

    /* ---------- MODALS ---------- */

    document
      .getElementById('btnCloseHelp')
      ?.addEventListener('click', () => {
        this.closeModals();
      });

    document
      .getElementById('btnCloseSettings')
      ?.addEventListener('click', () => {
        this.closeModals();
      });

    /* ---------- BENCHMARKS ---------- */

    document
      .getElementById('btnToggleBenchmarks')
      ?.addEventListener('click', () => {
        const container = document.getElementById('benchmarkListings');
        const button = document.getElementById('btnToggleBenchmarks');

        if (!container) {
          return;
        }

        const hidden = container.classList.toggle('hidden');

        if (button) {
          button.setAttribute('aria-expanded', String(!hidden));
        }
      });

    /* ---------- SIMULATED VOICE ---------- */

    const simForm = document.getElementById('simVoiceForm');
    const simInput = document.getElementById('simVoiceInput');

    if (simForm && simInput) {
      simForm.addEventListener('submit', (event) => {
        event.preventDefault();

        const value = simInput.value.trim();

        if (!value) {
          return;
        }

        window.SoundSightVoiceManager?.processCommand(value);

        simInput.value = '';
      });
    }

    /* ---------- REVISION ---------- */

    document
      .getElementById('btnRevQuick')
      ?.addEventListener('click', () => {
        window.SoundSightRevisionManager?.selectMode('quick');
      });

    document
      .getElementById('btnRevDetailed')
      ?.addEventListener('click', () => {
        window.SoundSightRevisionManager?.selectMode('detailed');
      });

    document
      .getElementById('btnRevExam')
      ?.addEventListener('click', () => {
        window.SoundSightRevisionManager?.selectMode('exam');
      });

    document
      .getElementById('btnRevQuestion')
      ?.addEventListener('click', () => {
        window.SoundSightRevisionManager?.selectMode('question');
      });
  }

  /* =========================================================
     VOICE COMMANDS
     ========================================================= */

  /**
   * Registers every voice command. Returns true when done (or already
   * done) and false when the voice manager is not available yet.
   */
  setupVoiceCommands() {
    if (this.voiceCommandsReady) {
      return true;
    }

    const vm = window.SoundSightVoiceManager;

    if (!vm) {
      console.warn('[APP] VoiceManager not available yet.');
      return false;
    }

    this.voiceCommandsReady = true;

    /* ---------- START ---------- */

    vm.registerCommand('START', () => {
      this.startSoundSight();
    });

    vm.registerCommand('START_SOUNDSIGHT', () => {
      this.startSoundSight();
    });

    /* ---------- SCAN ---------- */

    vm.registerCommand('SCAN', () => {
      this.openScanner();
    });

    vm.registerCommand('OPEN_SCANNER', () => {
      this.openScanner();
    });

    /* ---------- CAPTURE ---------- */

    const captureAction = () => {
      const scanner = window.SoundSightCameraScanner;

      if (scanner && scanner.isRunning) {
        scanner.requestCapture();
        return;
      }

      if (this.currentView === 'dashboard') {
        this.openScanner();
      }
    };

    vm.registerCommand('CAPTURE', captureAction);
    vm.registerCommand('EXECUTE_CAPTURE', captureAction);

    /* ---------- CLOSE CAMERA ---------- */

    vm.registerCommand('CLOSE_CAMERA', () => {
      window.SoundSightCameraScanner?.stop();
      window.SoundSightTTS?.stop();

      if (this.currentView === 'scanner') {
        this.switchView('dashboard');
      }
    });

    /* ---------- RETRY FAILED SCAN ---------- */

    vm.registerCommand('RETRY_SCAN', () => {
      this.retryLastScan();
    });

    /* ---------- UPLOAD ---------- */

    vm.registerCommand('UPLOAD', () => {
      this.openVoiceUpload();
    });

    vm.registerCommand('TRIGGER_UPLOAD', () => {
      this.openVoiceUpload();
    });

    /* ---------- HISTORY ---------- */

    vm.registerCommand('HISTORY', () => {
      this.openHistory();
    });

    vm.registerCommand('OPEN_HISTORY', () => {
      this.openHistory();
    });

    /* ---------- OPEN ITEM ---------- */

    vm.registerCommand('OPEN_ITEM', (text) => {
      /*
       * Prefer the history manager's own handler; fall back to the
       * one in this file so "Open item one" always works.
       */
      const manager = window.SoundSightHistoryManager;

      if (manager && typeof manager.openItemByVoice === 'function') {
        manager.openItemByVoice(text);
      } else {
        this.openHistoryItemByVoice(text);
      }
    });

    /* ---------- REVISION ---------- */

    vm.registerCommand('REVISE', (topic) => {
      window.SoundSightRevisionManager?.handleReviseCommand(topic);
    });

    vm.registerCommand('OPEN_REVISION', (topic) => {
      window.SoundSightRevisionManager?.handleReviseCommand(topic);
    });

    vm.registerCommand('REVISE_MODE', (mode) => {
      window.SoundSightRevisionManager?.selectMode(mode);
    });

    /* ---------- EXPLANATION ---------- */

    vm.registerCommand('EXPLAIN', () => {
      /*
       * Inside a section popup: explain THAT section's content.
       */
      if (this.askPopupSource) {
        window.SoundSightAssistant?.ask('Explain this content.');
        return;
      }

      /*
       * Standalone Ask AI has no content of its own, so ask
       * the student which topic they want.
       */
      if (this.currentView === 'ask-ai') {
        this.askAIWaitingForTopic = true;

        window.SoundSightTTS?.speak(
          'What topic would you like me to explain?'
        );

        return;
      }

      this.startExplanation();
    });

    vm.registerCommand('START_EXPLANATION', () => {
      this.startExplanation();
    });

    vm.registerCommand('EXPLAIN_AGAIN', () => {
      if (this.isAskAIOpen()) {
        const assistant = window.SoundSightAssistant;

        if (assistant?.lastAnswer) {
          assistant.repeatLastAnswer();
        } else {
          window.SoundSightTTS?.speak(
            'There is no previous Ask AI answer to repeat yet.'
          );
        }

        return;
      }

      if (this.currentView === 'explanation' && this.currentAnalysis) {
        this.startExplanation();
        return;
      }

      window.SoundSightTTS?.speak(
        'There is no active explanation to repeat.'
      );
    });

    /* ---------- STOP ---------- */

    vm.registerCommand('STOP', () => {
      window.SoundSightTTS?.stop();
    });

    vm.registerCommand('STOP_SPEECH', () => {
      window.SoundSightTTS?.stop();
    });

    /* ---------- PAUSE ---------- */

    vm.registerCommand('PAUSE', () => {
      window.SoundSightTTS?.pause();
    });

    vm.registerCommand('PAUSE_SPEECH', () => {
      window.SoundSightTTS?.pause();
    });

    /* ---------- CONTINUE ---------- */

    vm.registerCommand('CONTINUE', () => {
      window.SoundSightTTS?.resume();
    });

    vm.registerCommand('CONTINUE_SPEECH', () => {
      window.SoundSightTTS?.resume();
    });

    /* ---------- REPEAT ---------- */

    vm.registerCommand('REPEAT', () => {
      window.SoundSightTTS?.repeat();
    });

    vm.registerCommand('REPEAT_SPEECH', () => {
      window.SoundSightTTS?.repeat();
    });

    /* ---------- SPEED ---------- */

    vm.registerCommand('GO_SLOW', () => {
      window.SoundSightTTS?.goSlow();
    });

    vm.registerCommand('GO_FASTER', () => {
      window.SoundSightTTS?.goFaster();
    });

    vm.registerCommand('NORMAL_SPEED', () => {
      window.SoundSightTTS?.normalSpeed();
    });

    /* ---------- HELP ---------- */

    vm.registerCommand('HELP', () => {
      this.openHelp();
    });

    vm.registerCommand('OPEN_HELP', () => {
      this.openHelp();
    });

    /* ---------- SETTINGS ---------- */

    vm.registerCommand('SETTINGS', () => {
      this.openSettings();
    });

    vm.registerCommand('OPEN_SETTINGS', () => {
      this.openSettings();
    });

    /* ---------- ASK AI (standalone) ---------- */

    vm.registerCommand('ASK_AI', () => {
      this.openAskAI();
    });

    /* ---------- ASK AI (section popup) ---------- */

    vm.registerCommand('ASK_ABOUT_THIS', () => {
      if (this.askPopupSource) {
        return; // already open
      }

      if (this.currentView === 'explanation') {
        // Scan, upload or history item. The source is picked automatically.
        this.askAboutCurrentExplanation();
        return;
      }

      if (this.currentView === 'revision') {
        this.openAskPopup('revision', this.currentRevisionItem);
        return;
      }

      window.SoundSightTTS?.speak(
        'Open a scan, upload, saved item or revision topic first. Say Ask AI for general questions.'
      );
    });

    vm.registerCommand('CLOSE_ASK', () => {
      if (this.askPopupSource) {
        this.closeAskPopup();
        window.SoundSightTTS?.speak('Ask AI closed.');
      }
    });

    /* ---------- HOME ---------- */

    vm.registerCommand('HOME', () => {
      this.goToDashboard();
    });

    vm.registerCommand('OPEN_HOME', () => {
      this.goToDashboard();
    });

    /* ---------- BACK ---------- */

    const backAction = () => {
      const rm = window.SoundSightRevisionManager;

      /* Inside Revision with a topic chosen, Back returns to the topic list. */
      if (
        this.currentView === 'revision' &&
        rm &&
        (rm.awaitingMode || rm.currentRevisionItem)
      ) {
        rm.openTopicList();
        return;
      }

      this.goToDashboard();
    };

    vm.registerCommand('BACK', backAction);
    vm.registerCommand('GO_BACK', backAction);

    /* ---------- FREEFORM ---------- */

    vm.registerCommand('FREEFORM', async (text) => {
      const cleanText = (text || '').trim();

      if (!cleanText) {
        return;
      }

      /*
       * Revision (topic choice, mode choice, quiz answers) has priority.
       */
      if (window.SoundSightRevisionManager?.wantsSpeech()) {
        await window.SoundSightRevisionManager.handleSpeech(cleanText);
        return;
      }

      /*
       * Choosing a file from the voice upload folder.
       */
      if (this.awaitingUploadChoice) {
        await this.handleUploadChoice(cleanText);
        return;
      }

      /*
       * Free speech only makes sense inside Ask AI
       * (standalone page OR a section popup).
       * Anywhere else it is background noise.
       */
      if (!this.isAskAIOpen()) {
        console.log(
          '[VOICE] FREEFORM ignored outside Ask AI:',
          cleanText
        );
        return;
      }

      /*
       * Safety guard:
       * Navigation, playback and application commands
       * must NEVER become Ask AI questions.
       */
      const commandOnlyPatterns = [
        /^(go\s+)?back$/i,
        /^(go\s+)?home$/i,
        /^(go\s+)?to\s+(the\s+)?dashboard$/i,
        /^return\s+to\s+(the\s+)?dashboard$/i,
        /^open\s+history$/i,
        /^open\s+scanner$/i,
        /^scan$/i,
        /^upload$/i,
        /^open\s+upload$/i,
        /^open\s+revision$/i,
        /^revise$/i,
        /^open\s+help$/i,
        /^open\s+settings$/i,
        /^settings$/i,
        /^help$/i,
        /^explain$/i,
        /^explain\s+again$/i,
        /^repeat$/i,
        /^stop$/i,
        /^pause$/i,
        /^(continue|resume)$/i,
        /^go\s+(slower|slow)$/i,
        /^go\s+faster$/i,
        /^speed\s+up$/i,
        /^slow\s+down$/i,
        /^normal\s+speed$/i,
        /^open\s+ask\s+ai$/i,
        /^ask\s+ai$/i
      ];

      const isCommand = commandOnlyPatterns.some(
        (pattern) => pattern.test(cleanText)
      );

      if (isCommand) {
        console.log(
          '[VOICE] FREEFORM ignored application command:',
          cleanText
        );
        return;
      }

      /*
       * The student said "Explain" on the standalone page and we asked
       * for a topic. This reply is that topic.
       */
      let question = cleanText;

      if (this.askAIWaitingForTopic) {
        this.askAIWaitingForTopic = false;
        question = `Explain ${cleanText}.`;
      }

      /*
       * Genuine question: the assistant uses its CURRENT source
       * (standalone = no context; popup = that section's context).
       */
      if (
        window.SoundSightAssistant &&
        typeof window.SoundSightAssistant.ask === 'function'
      ) {
        await window.SoundSightAssistant.ask(question);
      }
    });

    return true;
  }

  /* =========================================================
     ACCESSIBILITY KEYBOARD SUPPORT
     ========================================================= */

  setupAccessibilityShortcuts() {
    window.addEventListener('keydown', (event) => {
      const tag = document.activeElement?.tagName;

      const typing =
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT';

      /* ---------- ESCAPE ---------- */

      if (event.key === 'Escape') {
        window.SoundSightTTS?.stop();

        /* Close the Ask AI popup first, and stay on the same page. */
        if (this.askPopupSource) {
          this.closeAskPopup();
          return;
        }

        if (this.currentView === 'scanner') {
          window.SoundSightCameraScanner?.stop();
          this.goToDashboard();
        } else {
          this.closeModals();
          this.removeUploadOverlay();
        }

        return;
      }

      /* ---------- SPACE ---------- */

      if (event.code === 'Space' && !typing) {
        /*
         * Something else (a dashboard card, the upload overlay) already
         * handled this Space press, so do not also toggle the mic.
         */
        if (event.defaultPrevented) {
          return;
        }

        event.preventDefault();

        /* Holding the key down must not flip the mic on and off. */
        if (event.repeat) {
          return;
        }

        window.SoundSightVoiceManager?.toggleListening();
        return;
      }

      /* Never fire number shortcuts while typing a question. */
      if (typing) {
        return;
      }

      /* ---------- DASHBOARD SHORTCUTS ---------- */

      if (this.currentView === 'dashboard') {
        if (event.key === '1') {
          this.openScanner();
        }

        if (event.key === '2') {
          this.triggerUpload();
        }

        if (event.key === '3') {
          this.openHistory();
        }

        if (event.key === '4') {
          this.openRevision();
        }

        if (event.key === '5') {
          this.openHelp();
        }

        if (event.key === '6') {
          this.openSettings();
        }
      }

      /* ---------- SCANNER ---------- */

      if (this.currentView === 'scanner') {
        if (
          event.key === 'c' ||
          event.key === 'C' ||
          event.key === 'Enter'
        ) {
          if (
            window.SoundSightCameraScanner &&
            window.SoundSightCameraScanner.isRunning
          ) {
            window.SoundSightCameraScanner.requestCapture();
          }
        }
      }
    });
  }

  /* =========================================================
     VIEW MANAGEMENT
     ========================================================= */

  switchView(viewName) {
    this.removeUploadOverlay();
    this.awaitingUploadChoice = false;
    this.askAIWaitingForTopic = false;

    /*
     * Navigating anywhere closes a section popup, so its context
     * can never follow the student to another page.
     */
    if (this.askPopupSource) {
      this.askPopupSource = null;
      this.hideAskPopupElement();
      window.SoundSightAssistant?.setSource('standalone', null);
    }

    /*
     * Leaving History clears the selected item, so Ask AI never
     * assumes which record the student means.
     */
    if (viewName !== 'explanation' && viewName !== 'history') {
      this.selectedHistoryItem = null;
    }

    if (viewName !== 'revision') {
      this.currentRevisionItem = null;
    }

    this.currentView = viewName;

    document
      .querySelectorAll('.view-section')
      .forEach((section) => {
        section.classList.remove('active-view');
        section.setAttribute('aria-hidden', 'true');
      });

    const active = document.getElementById(`view-${viewName}`);

    if (active) {
      active.classList.add('active-view');
      active.setAttribute('aria-hidden', 'false');

      try {
        active.focus();
      } catch (e) {}
    }
  }

  /* =========================================================
     START SOUNDSIGHT
     ========================================================= */

  async startSoundSight() {
    window.SoundSightEarcons?.init();

    this.switchView('dashboard');

    window.SoundSightVoiceManager?.startListening();

    let micAllowed = false;

    try {
      if (navigator.permissions && navigator.permissions.query) {
        const permission = await navigator.permissions.query({
          name: 'microphone'
        });

        micAllowed = permission.state === 'granted';
      }
    } catch (error) {}

    if (window.SoundSightTTS) {
      window.SoundSightTTS.speak(
        micAllowed
          ? 'SoundSight is ready. You can say Scan, Upload, History, Revision, Help, Settings, or Ask AI.'
          : 'Starting SoundSight. Please allow microphone access when your browser asks. Then you can say Scan, Upload, History, Revision, Help, Settings, or Ask AI.'
      );
    }
  }

  /* =========================================================
     DASHBOARD
     ========================================================= */

  goToDashboard() {
    this.closeModals();

    window.SoundSightCameraScanner?.stop();
    window.SoundSightTTS?.stop();

    this.switchView('dashboard');

    if (window.SoundSightTTS) {
      window.SoundSightTTS.speak(
        'SoundSight dashboard. You can say Scan, Upload, History, Revision, Help, Settings, or Ask AI.'
      );
    }
  }

  /* =========================================================
     SCANNER
     ========================================================= */

  async openScanner() {
    if (
      window.SoundSightCameraScanner?.isRunning ||
      window.SoundSightCameraScanner?.isStarting
    ) {
      return;
    }

    window.SoundSightTTS?.stop();

    this.switchView('scanner');

    const video = document.getElementById('cameraVideo');
    const canvas = document.getElementById('scannerCanvas');
    const scanner = window.SoundSightCameraScanner;

    if (!scanner) {
      console.error('[APP] Camera scanner unavailable.');

      window.SoundSightTTS?.speak(
        'The camera scanner is not available. You can say Upload to use a file instead.'
      );

      return;
    }

    scanner.init(video, canvas, (imageData) => {
      this.handleCaptureComplete(imageData);
    });

    try {
      await scanner.start();

      window.SoundSightTTS?.speak(
        'Scanner ready. Point the camera at your STEM content and say Capture when ready.'
      );
    } catch (error) {
      console.error('[APP] Camera failed:', error);

      let message =
        'I could not open the camera. You can say Upload to use a file instead.';

      if (!window.isSecureContext) {
        message =
          'The camera needs a secure connection. Please use the HTTPS link or localhost. You can also say Upload.';
      } else if (error?.name === 'NotAllowedError') {
        message =
          'Camera permission is blocked. Please allow the camera in your browser address bar, then say Scan again. You can also say Upload.';
      } else if (error?.name === 'NotFoundError') {
        message =
          'No camera was found. You can say Upload to use a file instead.';
      } else if (error?.name === 'NotReadableError') {
        message =
          'The camera is being used by another app. Please close it and try again, or say Upload.';
      }

      try {
        scanner.stop();
      } catch (e) {}

      /* Leave the empty camera screen, THEN speak (no dashboard greeting). */
      this.switchView('dashboard');

      window.SoundSightTTS?.speak(message);
    }
  }

  /* =========================================================
     UPLOAD
     ========================================================= */

  triggerUpload(notice = '') {
    window.SoundSightTTS?.stop();

    const input = document.getElementById('fileUploadInput');

    if (!input) {
      console.error('[APP] fileUploadInput not found.');

      window.SoundSightTTS?.speak(
        'The upload control is not available.'
      );

      return;
    }

    /*
     * Browser security:
     * A voice callback is NOT a trusted user activation, so
     * JavaScript cannot safely force the file picker from it.
     * We show a FULL SCREEN activation layer instead; the student
     * can tap ANYWHERE on the screen.
     */

    if (
      navigator.userActivation &&
      navigator.userActivation.isActive
    ) {
      try {
        input.click();
        return;
      } catch (error) {
        console.warn('[APP] Direct upload click failed:', error);
      }
    }

    this.showFullScreenUploadPrompt(input, notice);
  }

  showFullScreenUploadPrompt(input, notice = '') {
    this.removeUploadOverlay();

    const overlay = document.createElement('div');

    overlay.id = 'soundSightUploadOverlay';

    overlay.setAttribute('role', 'button');
    overlay.setAttribute('tabindex', '0');

    overlay.setAttribute(
      'aria-label',
      'Upload a STEM file. Press Enter or Space, or tap anywhere on the screen, to choose a file.'
    );

    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 999999;
      background: rgba(5, 10, 20, 0.96);
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      cursor: pointer;
      padding: 30px;
      box-sizing: border-box;
    `;

    overlay.innerHTML = `
      <div
        style="
          max-width: 760px;
          width: 90%;
          padding: 50px 30px;
          border: 3px solid #ffd900;
          border-radius: 24px;
          background: #111827;
          box-sizing: border-box;
        "
      >

        <div
          style="
            font-size: 72px;
            margin-bottom: 20px;
          "
          aria-hidden="true"
        >
          📁
        </div>

        <h1
          style="
            margin: 0 0 18px;
            color: #ffd900;
            font-size: clamp(30px, 5vw, 52px);
          "
        >
          Upload STEM Content
        </h1>

        <p
          style="
            margin: 0;
            color: white;
            font-size: clamp(20px, 3vw, 30px);
            line-height: 1.5;
          "
        >
          Tap or click anywhere on the screen
          to choose your file.
        </p>

        <p
          style="
            margin-top: 22px;
            color: #cbd5e1;
            font-size: 18px;
          "
        >
          You do not need to find a specific
          upload button.
        </p>

        <div
          style="
            margin-top: 28px;
            color: #ffd900;
            font-size: 20px;
            font-weight: 700;
          "
        >
          Press Escape to cancel
        </div>

      </div>
    `;

    /* Say WHY the voice upload folder was not used. */
    if (notice) {
      const note = document.createElement('p');

      note.textContent = notice;

      note.style.cssText = `
        margin: 22px 0 0;
        padding: 14px 18px;
        border: 2px solid #ffd900;
        border-radius: 12px;
        color: #ffd900;
        font-size: 18px;
        line-height: 1.4;
      `;

      overlay.firstElementChild?.appendChild(note);
    }

    const openPicker = (event) => {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }

      this.removeUploadOverlay();

      setTimeout(() => {
        try {
          input.click();
        } catch (error) {
          console.error('[APP] File picker failed:', error);

          window.SoundSightTTS?.speak(
            'I could not open the file picker.'
          );
        }
      }, 20);
    };

    overlay.addEventListener('click', openPicker);

    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();

        this.removeUploadOverlay();

        window.SoundSightTTS?.speak('Upload cancelled.');

        return;
      }

      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openPicker(event);
      }
    });

    document.body.appendChild(overlay);

    this.uploadOverlay = overlay;

    try {
      overlay.focus();
    } catch (e) {}

    window.SoundSightTTS?.speak(
      (notice ? `${notice} ` : '') +
      'Upload is ready. Press Enter or Space to choose a file, or tap anywhere on the screen.'
    );
  }

  removeUploadOverlay() {
    const overlay = document.getElementById('soundSightUploadOverlay');

    if (overlay) {
      overlay.remove();
    }

    this.uploadOverlay = null;
  }

    async handleFileUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    window.SoundSightTTS?.stop();
    window.SoundSightTTS?.speak('File received. I will analyze it now.');

    const ext = file.name.split('.').pop().toLowerCase();

    /* PDF, Word, PowerPoint: the server extracts the text. */
    if (['pdf', 'docx', 'pptx'].includes(ext)) {
      try {
        const form = new FormData();
        form.append('file', file);

        const res = await fetch('/api/extract-file', {
          method: 'POST',
          body: form
        });

        const data = await res.json();

        if (!data.success) {
          throw new Error(data.error || 'Could not read this file.');
        }

        this.startProcessingPipeline(data.imageData || '', {
          fileName: file.name,
          source: 'upload',
          rawText: data.rawText || '',
          fileKind: 'document'
        });
      } catch (error) {
        console.error('[APP] Extract failed:', error);
        window.SoundSightTTS?.speak(
          error.message || 'I could not open that file. Please try another.'
        );
      }

      return;
    }

    /* Plain text files are read in the browser. */
    if (['txt', 'md', 'csv'].includes(ext)) {
      const text = await file.text();

      this.startProcessingPipeline('', {
        fileName: file.name,
        source: 'upload',
        rawText: text.slice(0, 60000),
        fileKind: 'document'
      });

      return;
    }

    /* Images: same as before. */
    const reader = new FileReader();

    reader.onload = (loadEvent) => {
      this.startProcessingPipeline(loadEvent.target.result, {
        fileName: file.name,
        source: 'upload'
      });
    };

    reader.onerror = () => {
      window.SoundSightTTS?.speak(
        'I could not read that file. Please try another file.'
      );
    };

    reader.readAsDataURL(file);
  }

  /* =========================================================
     CAMERA CAPTURE
     ========================================================= */

  handleCaptureComplete(imageData) {
    window.SoundSightTTS?.stop();

    window.SoundSightTTS?.speak(
      'Content captured. I will analyze it now.'
    );

    this.startProcessingPipeline(imageData, {
      source: 'camera'
    });
  }

  /* =========================================================
     PROCESSING PIPELINE
     ========================================================= */

  async startProcessingPipeline(imageData, meta = {}) {
    /*
     * An image OR readable text (PDF, Word, PowerPoint, text file)
     * is enough to start the analysis.
     */
    const hasText = String(meta.rawText || '').trim().length > 0;

    if (!imageData && !hasText) {
      window.SoundSightTTS?.speak(
        'No content was received. Please try again.'
      );

      return;
    }

    this.lastProcessingInput = { imageData, meta };

    this.switchView('processing');

    /*
     * A brand-new scan/upload replaces whatever was selected
     * before; nothing old can leak into its Ask AI popup.
     */
    this.selectedHistoryItem = null;

    const steps = [
      {
        text: 'Detecting content',
        audio: 'Detecting content.'
      },
      {
        text: 'Improving image',
        audio: 'Improving image.'
      },
      {
        text: 'Reading content',
        audio: 'Reading content.'
      },
      {
        text: 'Understanding content',
        audio: 'Understanding the STEM content.'
      },
      {
        text: 'Preparing explanation',
        audio: 'Preparing explanation.'
      }
    ];

    const elements = document.querySelectorAll('.proc-step-item');

    const updateStep = (index) => {
      elements.forEach((element, i) => {
        if (i < index) {
          element.className = 'proc-step-item complete';
        } else if (i === index) {
          element.className = 'proc-step-item active';
        } else {
          element.className = 'proc-step-item';
        }
      });

      const live = document.getElementById('processingLiveStatus');

      if (live && steps[index]) {
        live.textContent = steps[index].text;
      }
    };

    try {
      updateStep(0);

      window.SoundSightTTS?.speak(steps[0].audio);

      await new Promise((resolve) => setTimeout(resolve, 350));

      updateStep(1);

      window.SoundSightTTS?.speak(steps[1].audio);

      if (!window.SoundSightStemAnalyzer) {
        throw new Error('SoundSight STEM Analyzer is not loaded.');
      }

      /*
       * Race the analysis against a 2 minute timeout, and always
       * clear the timer so it cannot fire later.
       */
      let timeoutId;
      let analysis;

      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('Analysis timed out')),
          120000
        );
      });

      try {
        analysis = await Promise.race([
          window.SoundSightStemAnalyzer.analyzeContent({
            rawText: meta.rawText || '',
            imageData,
            meta,
            onProgress: (stage) => {
              if (stage === 'ocr') {
                updateStep(2);
                window.SoundSightTTS?.speak(steps[2].audio);
              }

              if (stage === 'stem') {
                updateStep(3);
                window.SoundSightTTS?.speak(steps[3].audio);
              }
            }
          }),
          timeout
        ]);
      } finally {
        clearTimeout(timeoutId);
      }

      if (!analysis || typeof analysis !== 'object') {
        throw new Error('The analyzer returned no result.');
      }

      if (meta && meta.source) {
        analysis.source = meta.source;
      }

      updateStep(4);

      window.SoundSightTTS?.speak(steps[4].audio);

      await new Promise((resolve) => setTimeout(resolve, 350));

      /*
       * Only the current analysis is stored. Ask AI does NOT
       * receive it automatically; the section popup passes it
       * explicitly when the student opens it.
       */
      this.currentAnalysis = analysis;

      /* Success: nothing left to retry. Errors keep the input. */
      if (!analysis.isError) {
        this.lastProcessingInput = null;
      }

      if (
        !analysis.isError &&
        analysis.contentType !== 'None' &&
        window.SoundSightHistoryManager
      ) {
        try {
          const { imageData: _drop, ...slimAnalysis } = analysis;
          await window.SoundSightHistoryManager.saveItem(slimAnalysis);
        } catch (historyError) {
          console.warn('[APP] History save failed:', historyError);
        }
      }

      this.displayExplanation(analysis);

      const notStem = analysis.contentType === 'None';

      if (window.SoundSightEarcons) {
        if (analysis.isError || notStem) {
          window.SoundSightEarcons.errorTone();
        } else {
          window.SoundSightEarcons.analysisCompleteChime();
        }
      }

      if (analysis.isError) {
        window.SoundSightTTS?.speak(
          (analysis.message ||
          'I could not clearly understand the content.') +
          ' Say try again to analyze the same image again, or say Scan to take a new one.'
        );
      } else if (notStem) {
        window.SoundSightTTS?.speak(
          'This does not look like STEM content. Please scan a page, equation, diagram or code.'
        );
      } else {
        window.SoundSightTTS?.speak(
          'Analysis complete. Say Explain when you are ready.'
        );
      }
    } catch (error) {
      console.error('[APP] Processing failed:', error);

      const failed = {
        isError: true,
        message: 'I could not complete the analysis. Please try again.',
        error: String(error?.message || error)
      };

      this.currentAnalysis = failed;

      this.displayExplanation(failed);

      window.SoundSightEarcons?.errorTone();

      window.SoundSightTTS?.speak(
        failed.message +
        ' Say try again to analyze the same image again, or say Scan to take a new one.'
      );
    }
  }

  retryLastScan() {
    const saved = this.lastProcessingInput;

    if (
      !saved ||
      this.currentView === 'processing' ||
      !this.currentAnalysis?.isError
    ) {
      window.SoundSightTTS?.speak(
        'There is no failed scan to try again. Say Scan or Upload to start.'
      );
      return;
    }

    window.SoundSightTTS?.stop();
    window.SoundSightTTS?.speak('Trying again with the same image.');

    this.startProcessingPipeline(saved.imageData, saved.meta || {});
  }

  /* =========================================================
     EXPLANATION VIEW
     ========================================================= */

  displayExplanation(item) {
    this.currentAnalysis = item;
    this.switchView('explanation');

    const errorBanner = document.getElementById('expErrorBanner');
    const codeWrapper = document.getElementById('expDetectedCodeWrapper');
    const codeBlock = document.getElementById('expDetectedCodeBlock');
    const summary = document.getElementById('expSummarySection');
    const keyPoints = document.getElementById('expKeyPointsSection');
    const structure = document.getElementById('expStructureContainer');

    if (item.isError) {
      if (errorBanner) {
        errorBanner.textContent =
          item.message ||
          item.error ||
          'Unable to read content clearly.';

        errorBanner.classList.remove('hidden');
      }

      this.setText('expTitle', 'Scan Unclear');
      this.setText('expTopic', 'Camera Quality & Lighting');
      this.setText('expContentType', 'Unclear');
      this.setText('expConfidence', 'Low Confidence');

      codeWrapper?.classList.add('hidden');
      summary?.classList.add('hidden');
      keyPoints?.classList.add('hidden');

      if (structure) {
        structure.innerHTML = '';
      }

      return;
    }

    errorBanner?.classList.add('hidden');

    const rawConfidence = Number(item.confidence);

    const confidence = Number.isFinite(rawConfidence)
      ? (rawConfidence > 1 ? rawConfidence / 100 : rawConfidence)
      : 0.95;

    const confidenceText = `${Math.round(confidence * 100)}% Confidence`;

    /* ----------------------------------------------------
       NON-STEM CONTENT
       Keep the result short and accessible.
       ---------------------------------------------------- */

    if (item.contentType === 'None') {
      summary?.classList.add('hidden');
      keyPoints?.classList.add('hidden');
      codeWrapper?.classList.add('hidden');

      if (structure) {
        structure.innerHTML = '';
      }

      this.setText('expTitle', 'Not STEM Content');
      this.setText(
        'expTopic',
        'This image does not look like STEM study material. Try a page, equation, diagram or code.'
      );
      this.setText('expContentType', 'None');
      this.setText('expConfidence', confidenceText);

      return;
    }

    summary?.classList.remove('hidden');
    keyPoints?.classList.remove('hidden');

    this.setText('expTitle', item.title || 'STEM Content');
    this.setText('expTopic', item.topic || 'Educational Content');

    this.setText(
      'expContentType',
      item.contentType === 'Code'
        ? `${item.language || 'Python'} Code`
        : (item.contentType || 'STEM')
    );

    this.setText('expConfidence', confidenceText);

    if (item.contentType === 'Code' && codeBlock) {
      codeBlock.textContent = item.ocrText || '';
      codeWrapper?.classList.remove('hidden');
    } else {
      codeWrapper?.classList.add('hidden');
    }

    const summaryText = document.getElementById('expSummaryText');

    if (summaryText) {
      summaryText.textContent =
        item.purpose ||
        item.summary ||
        item.overallLogic ||
        'STEM educational content.';
    }

    const keyList = document.getElementById('expKeyPointsList');

    if (keyList) {
      const points = Array.isArray(item.keyPoints)
        ? item.keyPoints
        : [item.title || 'STEM content detected.'];

      keyList.innerHTML = '';

      points.forEach((point) => {
        if (!point) {
          return;
        }

        const li = document.createElement('li');

        li.textContent = this.valueToText(point);

        keyList.appendChild(li);
      });
    }

    if (structure) {
      structure.innerHTML = this.buildStructureHTML(item);
    }
  }

  /* =========================================================
     STRUCTURE RENDERING
     ========================================================= */

  buildStructureHTML(item) {
    const type = item.contentType;

    let html = '';

    if (type === 'Code') {
      const lines = Array.isArray(item.lineByLine) ? item.lineByLine : [];
      const errors = Array.isArray(item.errors) ? item.errors : [];

      html += `
        <h3>Code Logic</h3>

        <p>
          <strong>Language:</strong>
          ${this.escapeHTML(item.language || 'Python')}
        </p>

        <p>
          <strong>Algorithmic Logic:</strong>
          ${this.escapeHTML(item.overallLogic || '')}
        </p>

        <h4>Line by Line:</h4>

        <ol>
          ${lines
            .map(
              (line) =>
                `<li>${this.escapeHTML(this.valueToText(line))}</li>`
            )
            .join('')}
        </ol>
      `;

      if (errors.length) {
        html += `
          <p style="margin-top:10px;">
            <strong>Optimization Tip:</strong>
            ${this.escapeHTML(
              this.valueToText(errors[0]?.fix || errors[0])
            )}
          </p>
        `;
      }

      return html;
    }

    if (type === 'Flowchart') {
      const flow = Array.isArray(item.structuralFlow)
        ? item.structuralFlow
        : [];

      html += `
        <h3>Flowchart Structure</h3>
        <ol>
      `;

      if (!flow.length) {
        html += `
          <li>
            The flowchart structure
            could not be determined
            reliably from the image.
          </li>
        `;
      } else {
        flow.forEach((step) => {
          html += `
            <li>
              ${this.escapeHTML(this.valueToText(step))}
            </li>
          `;
        });
      }

      html += `
        </ol>
      `;

      return html;
    }

    if (type === 'Formula') {
      const symbols = Array.isArray(item.symbols) ? item.symbols : [];

      html += `
        <h3>
          Formula & Spoken Reading
        </h3>

        <p
          style="
            font-family:var(--font-mono);
            font-size:22px;
            margin-bottom:8px;
          "
        >
          ${this.escapeHTML(item.latex || item.ocrText || '')}
        </p>

        <p>
          <strong>
            Spoken Reading:
          </strong>
          ${this.escapeHTML(item.spokenMath || '')}
        </p>

        <h4>Symbols:</h4>

        <ul>
          ${symbols
            .map(
              (symbol) => `
                <li>
                  <strong>
                    ${this.escapeHTML(symbol?.symbol || '')}
                  </strong>

                  (${this.escapeHTML(symbol?.name || '')}):

                  ${this.escapeHTML(symbol?.meaning || '')}
                </li>
              `
            )
            .join('')}
        </ul>
      `;

      return html;
    }

    if (type === 'Diagram') {
      const components = Array.isArray(item.components)
        ? item.components
        : [];

      html += `
        <h3>
          Diagram Components
        </h3>

        <p>
          <strong>
            Spatial Layout:
          </strong>

          ${this.escapeHTML(item.spatialLayout || '')}
        </p>

        <ul>
          ${components
            .map(
              (component) => `
                <li>
                  <strong>
                    ${this.escapeHTML(component?.name || '')}
                  </strong>:

                  ${this.escapeHTML(component?.description || '')}
                </li>
              `
            )
            .join('')}
        </ul>
      `;

      return html;
    }

    if (type === 'Graph') {
      const graph = item.graphAnalysis || {};

      html += `
        <h3>
          Graph Structure
        </h3>

        <p>
          <strong>
            Title:
          </strong>

          ${this.escapeHTML(graph.title || '')}
        </p>

        <p>
          <strong>
            X-axis:
          </strong>

          ${this.escapeHTML(graph.xAxis || '')}
        </p>

        <p>
          <strong>
            Y-axis:
          </strong>

          ${this.escapeHTML(graph.yAxis || '')}
        </p>

        <p>
          <strong>
            Trend:
          </strong>

          ${this.escapeHTML(graph.trend || '')}
        </p>
      `;

      return html;
    }

    if (type === 'Table') {
      html += `
        <h3>
          Table Structure
        </h3>

        <p>
          ${this.escapeHTML(
            item.overallLogic || item.summary || 'A table was detected.'
          )}
        </p>
      `;

      return html;
    }

    html += `
      <h3>
        Content Structure
      </h3>

      <p>
        ${this.escapeHTML(
          item.overallLogic ||
          item.summary ||
          'The content structure was identified from the uploaded STEM material.'
        )}
      </p>
    `;

    return html;
  }

  /* =========================================================
     EXPLAIN
     ========================================================= */

  startExplanation() {
    if (!this.currentAnalysis) {
      console.warn('[APP] Explain requested but no analysis exists.');

      window.SoundSightTTS?.speak(
        'There is no analyzed content to explain yet. Please scan or upload STEM content first.'
      );

      return;
    }

    const item = this.currentAnalysis;

    if (item.isError) {
      window.SoundSightTTS?.speak(
        'The last scan was not clear. Say try again to analyze it again, or say Scan to take a new one.'
      );

      return;
    }

    if (item.contentType === 'None') {
      window.SoundSightTTS?.stop();

      window.SoundSightTTS?.speak(
        'Not STEM Content. This image does not contain STEM study material.'
      );

      return;
    }

    let script = String(item.audioScript || '').trim();

    /*
     * Fallback for older analysis objects that do not have
     * audioScript.
     */

    if (!script) {
      const parts = [];

      if (item.title) {
        parts.push(`This is ${item.title}.`);
      }

      if (item.purpose || item.summary) {
        parts.push(String(item.purpose || item.summary));
      }

      if (Array.isArray(item.keyPoints)) {
        item.keyPoints.slice(0, 6).forEach((point) => {
          if (point) {
            parts.push(this.valueToText(point));
          }
        });
      }

      if (
        item.contentType === 'Flowchart' &&
        Array.isArray(item.structuralFlow)
      ) {
        parts.push('The flowchart structure is:');

        item.structuralFlow.slice(0, 10).forEach((step, index) => {
          parts.push(`Step ${index + 1}: ${this.valueToText(step)}.`);
        });
      }

      script = parts.join(' ').trim();
    }

    if (!script) {
      script =
        'I found the content, but I do not have enough structured information to explain it accurately.';
    }

    console.log('[APP] Starting explanation. Length:', script.length);

    window.SoundSightTTS?.speakExplanation(script);
  }

  /* =========================================================
     VOICE UPLOAD (files from the voice upload folder)
     ========================================================= */

  async openVoiceUpload() {
    window.SoundSightTTS?.stop();

    let files = [];
    let notice = '';

    try {
      const res = await fetch('/api/voice-files');
      const data = await res.json();

       if (data.disabled) {
        this.triggerUpload();
        return;
      }


      files = Array.isArray(data.files) ? data.files : [];

      console.log('[APP] Voice upload folder:', data);

      if (!data.success) {
        notice = 'The voice upload folder could not be read.';
      } else if (!files.length) {
        if (data.folderExisted === false) {
          notice =
            'The voice upload folder was not found, so an empty one was created. ' +
            'Check VOICE_UPLOADS_DIR in the dot env file.';
        } else if (Array.isArray(data.ignored) && data.ignored.length) {
          notice =
            'The voice upload folder has no files I can open. ' +
            `Skipped: ${data.ignored.slice(0, 3).join(', ')}.`;
        } else {
          notice = 'The voice upload folder is empty.';
        }
      }
    } catch (error) {
      console.warn('[APP] Voice file list failed:', error);
      notice = 'I could not reach the SoundSight server.';
    }

    if (!files.length) {
      /* Folder empty or unreachable: use the keypress / tap overlay. */
      this.triggerUpload(notice);
      return;
    }

    this.voiceUploadFiles = files;
    this.awaitingUploadChoice = true;

    const readable = (name) =>
      name.replace(/\.[^.]+$/, '').replace(/[_\-.]+/g, ' ');

    const countText = files.length === 1 ? '1 file' : `${files.length} files`;

    const listed = files
      .slice(0, 8)
      .map((file, i) => `File ${i + 1}: ${readable(file.name)}.`)
      .join(' ');

    const extra = files.length > 8
      ? ` And ${files.length - 8} more. Say part of a file name to open it.`
      : '';

    window.SoundSightTTS?.speak(
      `I found ${countText}. ${listed}${extra} ` +
      'Say the file number or part of its name. Say cancel to stop.'
    );
  }

  async handleUploadChoice(text) {
    const spoken = String(text || '').toLowerCase().trim();
    const files = this.voiceUploadFiles;

    if (/^(cancel|never mind|exit)\b/.test(spoken)) {
      this.awaitingUploadChoice = false;
      window.SoundSightTTS?.speak('Upload cancelled.');
      return;
    }

    const numberWords = {
      one: 1, won: 1, first: 1,
      two: 2, to: 2, too: 2, second: 2,
      three: 3, third: 3,
      four: 4, for: 4, fourth: 4,
      five: 5, fifth: 5,
      six: 6, sixth: 6,
      seven: 7, seventh: 7,
      eight: 8, eighth: 8
    };

    const filler = new Set([
      'file', 'number', 'item', 'option', 'the', 'open',
      'select', 'choose', 'please', 'a', 'an'
    ]);

    const tokens = spoken
      .split(/\s+/)
      .filter((word) => word && !filler.has(word));

    let index = -1;

    /* Only numbers, such as "two", "file 2" or "the second one". */
    const isNumber = (word) =>
      /^\d+$/.test(word) || numberWords[word] !== undefined;

    if (tokens.length && tokens.every(isNumber)) {
      const ordinals = [
        'first', 'second', 'third', 'fourth',
        'fifth', 'sixth', 'seventh', 'eighth'
      ];

      /* "the second one" -> use "second", not "one". */
      const token = tokens.find((word) => ordinals.includes(word)) || tokens[0];

      index = /^\d+$/.test(token)
        ? Number(token) - 1
        : numberWords[token] - 1;
    }

    /* Otherwise match words from the file name. */
    if (index < 0) {
      let best = 0;

      files.forEach((file, i) => {
        const name = file.name.toLowerCase().replace(/[_\-.]+/g, ' ');

        const score = tokens.filter(
          (word) => word.length > 1 && name.includes(word)
        ).length;

        if (score > best) {
          best = score;
          index = i;
        }
      });
    }

    if (index < 0 || index >= files.length) {
      window.SoundSightTTS?.speak(
        'I did not find that file. Say the file number or part of its name, or say cancel.'
      );
      return;
    }

    this.awaitingUploadChoice = false;

    await this.loadVoiceFile(files[index].name);
  }

  async loadVoiceFile(name) {
    window.SoundSightTTS?.speak('Opening that file. I will analyze it now.');

    try {
      const res = await fetch(
        `/api/voice-files/${encodeURIComponent(name)}`
      );

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || 'File could not be loaded.');
      }

      /*
       * Images come back as imageData. Documents (PDF, Word,
       * PowerPoint, text) come back as rawText. A scanned PDF
       * comes back as an image of one page.
       */
      this.startProcessingPipeline(data.imageData || '', {
        fileName: name,
        source: 'upload',
        rawText: data.rawText || '',
        fileKind: data.kind || 'image'
      });
    } catch (error) {
      console.error('[APP] Voice file load failed:', error);

      window.SoundSightTTS?.speak(
        'I could not open that file. Please try again.'
      );
    }
  }

  /* =========================================================
     HISTORY
     ========================================================= */

  openHistory() {
    window.SoundSightTTS?.stop();

    this.switchView('history');

    const container = document.getElementById('historyCardsContainer');

    const manager = window.SoundSightHistoryManager;

    const items =
      manager && Array.isArray(manager.items) ? manager.items : [];

    if (!container) {
      return;
    }

    if (!items.length) {
      container.innerHTML = `
        <div class="history-empty-box">

          <p class="history-empty-text">
            No saved learning items yet.
          </p>

          <p class="history-empty-sub">
            Say Scan or Upload to analyze your first STEM document.
          </p>

          <button
            type="button"
            class="btn btn-primary btn-sm"
            id="historyScanNowButton"
          >
            Scan Now
          </button>

        </div>
      `;

      document
        .getElementById('historyScanNowButton')
        ?.addEventListener('click', () => {
          this.openScanner();
        });
    } else {
      container.innerHTML = '';

      items.forEach((item, index) => {
        const card = document.createElement('div');

        card.className = 'history-topic-card';
        card.tabIndex = 0;

        card.setAttribute('role', 'button');

        card.setAttribute(
          'aria-label',
          `Item ${index + 1}: ${item.title || 'STEM content'}`
        );

        const info = document.createElement('div');

        info.className = 'history-card-info';

        const title = document.createElement('span');

        title.className = 'history-card-title';
        title.textContent = item.title || 'STEM Content';

        const topic = document.createElement('span');

        topic.className = 'history-card-topic';

        topic.textContent =
          `${item.topic || 'Educational Content'} • ${item.contentType || 'STEM'}`;

        const date = document.createElement('span');

        date.className = 'history-card-date';

        date.textContent =
          `Scanned • ${
            item.timestamp
              ? new Date(item.timestamp).toLocaleDateString()
              : 'Recently'
          }`;

        info.appendChild(title);
        info.appendChild(topic);
        info.appendChild(date);

        const button = document.createElement('button');

        button.type = 'button';
        button.className = 'btn btn-secondary btn-sm';
        button.textContent = 'Open';

        button.addEventListener('click', (event) => {
          event.stopPropagation();
          this.openHistoryItem(index);
        });

        card.addEventListener('click', () => {
          this.openHistoryItem(index);
        });

        card.addEventListener('keydown', (event) => {
          /* Ignore keys pressed on the inner Open button. */
          if (event.target !== card) {
            return;
          }

          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            this.openHistoryItem(index);
          }
        });

        card.appendChild(info);
        card.appendChild(button);

        container.appendChild(card);
      });
    }

    manager?.announceHistory?.();
  }

  openHistoryItem(index) {
    const manager = window.SoundSightHistoryManager;

    const items =
      manager && Array.isArray(manager.items) ? manager.items : [];

    const item = items[index];

    if (!item) {
      window.SoundSightTTS?.speak('That history item could not be found.');
      return;
    }

    this.currentAnalysis = item;

    this.displayExplanation(item);

    /*
     * displayExplanation() clears selectedHistoryItem when
     * switching views, so set it AFTER. This is the ONLY place
     * a history item becomes "selected" for Ask AI.
     */
    this.selectedHistoryItem = item;

    window.SoundSightTTS?.speak(
      `Opened ${item.title || 'saved STEM content'}. Say Explain to hear the explanation.`
    );
  }

  openHistoryItemByVoice(text) {
    const manager = window.SoundSightHistoryManager;

    const items =
      manager && Array.isArray(manager.items) ? manager.items : [];

    if (!items.length) {
      window.SoundSightTTS?.speak('There are no saved items yet.');
      return;
    }

    const normalized = String(text || '').toLowerCase().trim();

    /*
     * Match "item one", "item 1", etc.
     */

    const match = normalized.match(/(?:item|number|topic)\s*(\d+)/);

    let index = -1;

    if (match) {
      index = Number(match[1]) - 1;
    } else {
      const words = {
        one: 0,
        first: 0,
        two: 1,
        second: 1,
        three: 2,
        third: 2,
        four: 3,
        fourth: 3,
        five: 4,
        fifth: 4,
        six: 5,
        sixth: 5,
        seven: 6,
        seventh: 6,
        eight: 7,
        eighth: 7,
        nine: 8,
        ninth: 8,
        ten: 9,
        tenth: 9
      };

      for (const word of Object.keys(words)) {
        if (normalized.includes(word)) {
          index = words[word];
          break;
        }
      }
    }

    /*
     * If no item number is provided, try title matching.
     */

    if (index < 0) {
      index = items.findIndex((item) => {
        const title = String(item.title || '').toLowerCase();

        return title && normalized.includes(title);
      });
    }

    if (index >= 0 && index < items.length) {
      this.openHistoryItem(index);
      return;
    }

    window.SoundSightTTS?.speak(
      'I could not find that saved item. Say Open Item One, Open Item Two, or say History to hear the available items.'
    );
  }

  /* =========================================================
     REVISION
     ========================================================= */

  openRevision() {
    window.SoundSightTTS?.stop();
    window.SoundSightRevisionManager?.openTopicList();
  }

  displayRevisionView(item) {
    this.switchView('revision');

    /*
     * The revision topic chosen for THIS revision session.
     * This is the only context the Revision popup receives.
     */
    this.currentRevisionItem = item || null;

    const container = document.getElementById('revisionContentDisplay');

    if (!container) {
      return;
    }

    container.innerHTML = `
      <h4
        style="
          font-size:24px;
          color:var(--accent-primary);
          margin-bottom:6px;
        "
      >
        ${this.escapeHTML(item?.title || 'STEM Topic')}
      </h4>

      <p
        style="
          color:var(--text-secondary);
          font-size:17px;
        "
      >
        Choose a revision mode above, or say
        Quiz, Quick Revision, Detailed Revision,
        Exam Revision, or Ask AI.
      </p>

      <button
        type="button"
        id="btnRevBackToTopics"
        class="btn btn-secondary btn-sm"
        style="margin-top:12px;"
      >
        ← Back to topics
      </button>
    `;

    document
      .getElementById('btnRevBackToTopics')
      ?.addEventListener('click', () => {
        window.SoundSightRevisionManager?.openTopicList();
      });
  }

  /* =========================================================
     HELP
     ========================================================= */

  openHelp() {
    const modal = document.getElementById('helpModal');

    if (modal) {
      modal.classList.add('active');
      modal.setAttribute('aria-hidden', 'false');
    }

    window.SoundSightTTS?.speak(
      'Help menu open. Say Scan to use the camera, or Upload to open a file. ' +
      'Say History to hear saved topics, and Revision to practice with a quiz. ' +
      'Say Ask AI to talk to the assistant. ' +
      'Say Explain to hear an explanation, and Pause, Continue, Repeat, Slower, Faster or Stop to control it. ' +
      'Say Home to return to the dashboard.'
    );
  }

  /* =========================================================
     SETTINGS
     ========================================================= */

  openSettings() {
    const modal = document.getElementById('settingsModal');

    if (!modal) {
      console.error('[APP] settingsModal was not found in index.html.');

      window.SoundSightTTS?.speak('The settings panel is not available.');

      return;
    }

    this.ensureSettingsContent(modal);

    modal.classList.add('active');

    modal.setAttribute('aria-hidden', 'false');

    modal.style.display = 'flex';
    modal.style.visibility = 'visible';
    modal.style.opacity = '1';
    modal.style.zIndex = '10000';

    const currentRate = Number(window.SoundSightTTS?.currentRate);

    let speedName = 'Normal';

    if (currentRate <= 0.85) {
      speedName = 'Slow';
    } else if (currentRate >= 1.2) {
      speedName = 'Fast';
    }

    window.SoundSightTTS?.speak(
      `Settings. Speech speed is ${speedName}. Say Slow, Normal, or Fast to change speech speed. Say Dashboard, Home, or Back to return to the dashboard.`
    );
  }

  ensureSettingsContent(modal) {
    const oldContent = modal.querySelector(
      '[data-soundsight-settings-content]'
    );

    if (oldContent) {
      oldContent.remove();
    }

    const closeButton = modal.querySelector('#btnCloseSettings');

    let container =
      modal.querySelector('.modal-content') ||
      modal.querySelector('.modal-surface');

    if (!container) {
      container = document.createElement('div');

      container.style.cssText = `
        width:min(92vw,520px);
        max-height:90vh;
        overflow:auto;
        background:#111827;
        color:white;
        border:2px solid #334155;
        border-radius:22px;
        padding:24px;
        box-sizing:border-box;
      `;

      modal.appendChild(container);
    }

    const content = document.createElement('div');

    content.setAttribute('data-soundsight-settings-content', 'true');

    content.innerHTML = `
      <div
        style="
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:16px;
          margin-bottom:22px;
        "
      >

        <h2
          style="
            margin:0;
            color:#ffd900;
            font-size:28px;
          "
        >
          SoundSight Settings
        </h2>

        ${
          closeButton
            ? ''
            : `
              <button
                type="button"
                id="generatedCloseSettings"
                aria-label="Close settings"
                style="
                  font-size:22px;
                  background:#1e293b;
                  color:white;
                  border:1px solid #475569;
                  border-radius:10px;
                  padding:8px 13px;
                  cursor:pointer;
                "
              >
                X
              </button>
            `
        }

      </div>

      <section
        aria-label="Speech speed"
        style="
          padding:20px;
          margin-bottom:18px;
          background:#0f172a;
          border-radius:16px;
          border:1px solid #334155;
        "
      >

        <h3
          style="
            margin:0 0 8px 0;
            color:#ffd900;
            font-size:21px;
          "
        >
          Speech Speed
        </h3>

        <p
          id="soundSightCurrentSpeed"
          style="
            margin:0 0 16px 0;
            color:#cbd5e1;
            font-size:17px;
          "
        >
          Current: Normal
        </p>

        <div
          style="
            display:grid;
            grid-template-columns:1fr 1fr 1fr;
            gap:10px;
          "
        >

          <button
            type="button"
            id="settingsSlow"
            style="
              padding:14px 8px;
              border:1px solid #64748b;
              border-radius:10px;
              background:#1e293b;
              color:white;
              font-size:17px;
              font-weight:700;
              cursor:pointer;
            "
          >
            Slow
          </button>

          <button
            type="button"
            id="settingsNormal"
            style="
              padding:14px 8px;
              border:1px solid #64748b;
              border-radius:10px;
              background:#1e293b;
              color:white;
              font-size:17px;
              font-weight:700;
              cursor:pointer;
            "
          >
            Normal
          </button>

          <button
            type="button"
            id="settingsFast"
            style="
              padding:14px 8px;
              border:1px solid #64748b;
              border-radius:10px;
              background:#1e293b;
              color:white;
              font-size:17px;
              font-weight:700;
              cursor:pointer;
            "
          >
            Fast
          </button>

        </div>

      </section>

      <button
        type="button"
        id="soundSightReturnDashboard"
        style="
          width:100%;
          padding:16px;
          border:0;
          border-radius:12px;
          background:#ffd900;
          color:#050505;
          font-size:18px;
          font-weight:700;
          cursor:pointer;
        "
      >
        Return to Dashboard
      </button>
    `;

    container.appendChild(content);

    const getSpeedName = () => {
      const currentRate = Number(window.SoundSightTTS?.currentRate);

      if (currentRate <= 0.85) {
        return 'Slow';
      }

      if (currentRate >= 1.2) {
        return 'Fast';
      }

      return 'Normal';
    };

    const updateSpeedLabel = () => {
      const label = content.querySelector('#soundSightCurrentSpeed');

      if (label) {
        label.textContent = `Current: ${getSpeedName()}`;
      }
    };

    const setSlow = () => {
      window.SoundSightTTS?.goSlow();
      updateSpeedLabel();
      window.SoundSightTTS?.speak('Speech speed set to Slow.');
    };

    const setNormal = () => {
      window.SoundSightTTS?.normalSpeed();
      updateSpeedLabel();
      window.SoundSightTTS?.speak('Speech speed set to Normal.');
    };

    const setFast = () => {
      window.SoundSightTTS?.goFaster();
      updateSpeedLabel();
      window.SoundSightTTS?.speak('Speech speed set to Fast.');
    };

    content
      .querySelector('#settingsSlow')
      ?.addEventListener('click', setSlow);

    content
      .querySelector('#settingsNormal')
      ?.addEventListener('click', setNormal);

    content
      .querySelector('#settingsFast')
      ?.addEventListener('click', setFast);

    content
      .querySelector('#soundSightReturnDashboard')
      ?.addEventListener('click', () => {
        this.goToDashboard();
      });

    content
      .querySelector('#generatedCloseSettings')
      ?.addEventListener('click', () => {
        this.goToDashboard();
      });

    updateSpeedLabel();
  }

  /* =========================================================
     ASK AI — STANDALONE (dashboard)
     =========================================================
     A general-purpose chatbot. It NEVER inherits scans, uploads,
     history or revision content. Only the student's own question
     and this chat's own conversation are used.
     ========================================================= */

  openAskAI() {
    window.SoundSightTTS?.stop();

    this.closeModals();
    this.removeUploadOverlay();

    /* Make sure no section popup state survives. */
    this.askPopupSource = null;
    this.askAIWaitingForTopic = false;

    window.SoundSightAssistant?.setSource('standalone', null);

    this.switchView('ask-ai');

    const contextText = document.getElementById('askAIContextText');

    if (contextText) {
      contextText.textContent = 'Ready for your question';
    }

    window.SoundSightTTS?.speak(
      'SoundSight AI is ready. Ask your question.'
    );
  }

  /* =========================================================
     ASK AI — SECTION POPUP
     =========================================================
     Used only when Ask AI is opened from a specific section:
       Scanner / Explanation, Upload, History, Revision.
     The caller MUST explicitly provide the context.
     ========================================================= */

  /**
   * The explanation view is shared by scanned, uploaded and
   * history items. Pick the right source for the item on screen.
   */
  askAboutCurrentExplanation() {
    const item = this.currentAnalysis;

    if (!item || item.isError || item.contentType === 'None') {
      window.SoundSightTTS?.speak(
        'There is no clear content here to ask about yet.'
      );

      return;
    }

    let source = 'scanner';

    if (this.selectedHistoryItem && this.selectedHistoryItem === item) {
      source = 'history';
    } else if (item.source === 'upload') {
      source = 'upload';
    }

    this.openAskPopup(source, item);
  }

  openAskPopup(source, context) {
    if (!context || context.isError) {
      window.SoundSightTTS?.speak(
        'There is nothing here to ask about yet.'
      );

      return;
    }

    window.SoundSightTTS?.stop();

    /*
     * Only the context passed in by the calling section is used.
     */
    window.SoundSightAssistant?.setSource(source, context);

    this.askPopupSource = source;
    this.askAIWaitingForTopic = false;

    const popup = document.getElementById('askPopup');

    popup?.classList.add('active');
    popup?.setAttribute('aria-hidden', 'false');

    const title = context.title || context.topic || 'this content';

    const contextText = document.getElementById('askPopupContextText');

    if (contextText) {
      contextText.textContent = `Asking about: ${title}`;
    }

    try {
      document.getElementById('askPopupInput')?.focus();
    } catch (e) {}

    window.SoundSightTTS?.speak(
      `Ask AI is open for ${title}. Ask your question.`
    );
  }

  hideAskPopupElement() {
    const popup = document.getElementById('askPopup');

    popup?.classList.remove('active');
    popup?.setAttribute('aria-hidden', 'true');
  }

  closeAskPopup() {
    window.SoundSightTTS?.stop();

    this.hideAskPopupElement();

    this.askPopupSource = null;

    window.SoundSightAssistant?.setSource('standalone', null);
  }

  /* =========================================================
     MODAL CLOSE
     ========================================================= */

  closeModals() {
    document
      .querySelectorAll('.modal-backdrop')
      .forEach((modal) => {
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');

        modal.style.removeProperty('display');
        modal.style.removeProperty('visibility');
        modal.style.removeProperty('opacity');
      });

    /*
     * The Ask AI popup is a modal too. Closing it must also hide it
     * and reset the assistant to standalone so context cannot linger.
     */
    if (this.askPopupSource) {
      this.askPopupSource = null;
      this.hideAskPopupElement();
      window.SoundSightAssistant?.setSource('standalone', null);
    }
  }

  /* =========================================================
     BENCHMARKS
     ========================================================= */

  renderBenchmarkCards() {
    const container = document.getElementById('benchmarkListings');

    if (!container || !window.SOUNDSIGHT_BENCHMARKS) {
      return;
    }

    container.innerHTML = '';

    window.SOUNDSIGHT_BENCHMARKS.forEach((benchmark) => {
      const card = document.createElement('div');

      card.className = 'benchmark-card-item';
      card.tabIndex = 0;

      card.setAttribute('role', 'button');

      card.setAttribute(
        'aria-label',
        `Test STEM benchmark: ${benchmark.title}`
      );

      card.innerHTML = `
        <span
          class="benchmark-card-tag"
        >
          ${this.escapeHTML(benchmark.contentType || 'STEM')}
        </span>

        <h5
          class="benchmark-card-title"
        >
          ${this.escapeHTML(benchmark.title || 'Benchmark')}
        </h5>

        <button
          type="button"
          class="btn btn-secondary btn-sm"
          style="
            width:100%;
            margin-top:8px;
          "
        >
          Test Live Pipeline
        </button>
      `;

      card.addEventListener('click', () => {
        this.loadBenchmark(benchmark.id);
      });

      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.loadBenchmark(benchmark.id);
        }
      });

      container.appendChild(card);
    });
  }

  loadBenchmark(id) {
    const benchmark = window.SOUNDSIGHT_BENCHMARKS?.find(
      (item) => item.id === id
    );

    if (!benchmark) {
      return;
    }

    window.SoundSightTTS?.speak(`Loading ${benchmark.title} benchmark.`);

    if (typeof window.svgToDataUrl !== 'function') {
      console.error('[APP] svgToDataUrl is unavailable.');
      return;
    }

    const dataUrl = window.svgToDataUrl(benchmark.svgContent);

    this.startProcessingPipeline(dataUrl, {
      title: benchmark.title,
      topic: benchmark.topic,
      contentTypeHint: benchmark.contentType,
      rawText: benchmark.rawText
    });
  }

  /* =========================================================
     UTILITIES
     ========================================================= */

  setText(id, value) {
    const element = document.getElementById(id);

    if (element) {
      element.textContent = value == null ? '' : String(value);
    }
  }

  valueToText(value) {
    if (value === null || value === undefined) {
      return '';
    }

    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    if (typeof value === 'object') {
      if (typeof value.text === 'string') {
        return value.text;
      }

      if (typeof value.description === 'string') {
        return value.description;
      }

      if (typeof value.step === 'string') {
        return value.step;
      }

      if (typeof value.action === 'string') {
        return value.action;
      }

      try {
        return JSON.stringify(value);
      } catch (e) {
        return '';
      }
    }

    return String(value);
  }

  escapeHTML(value) {
    const text = this.valueToText(value);

    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

/* =========================================================
   GLOBAL INSTANCE
   ========================================================= */

window.SoundSightApp = new SoundSightApp();