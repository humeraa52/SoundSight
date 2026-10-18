/*
 * SoundSight AI Assistant
 * Voice-first study companion with strict context separation.
 *
 * Sources:
 *   'standalone'  -> dashboard Ask AI (general chatbot, NO context ever)
 *   'scanner'     -> popup, explicitly supplied current scan
 *   'upload'      -> popup, explicitly supplied current upload
 *   'history'     -> popup, explicitly supplied selected history item
 *   'revision'    -> popup, explicitly supplied revision material
 *
 * Each (source + item) gets its own chat, so nothing is mixed.
 */

class SoundSightAssistant {

  constructor() {

    this.chats = {};               // { chatKey: { id, title, messages, lastAnswer } }
    this.activeSource = 'standalone';
    this.activeContext = null;     // only set by a page that passes it
    this.activeKey = 'standalone';

    this.pendingQuestions = [];
    this.isBusy = false;

    this.init();
  }

  init() {

    this.bindEvents();

    console.log('[SoundSight AI] Assistant initialized.');
  }

  /* =========================================================
     CHAT STATE
     ========================================================= */

  /*
   * Build a unique key so each source/item has its own chat.
   * Standalone never depends on any context.
   */
  makeKey(source, context) {

    if (source === 'standalone' || !context) {
      return 'standalone';
    }

    const id =
      context.id ||
      context.timestamp ||
      context.title ||
      context.topic ||
      'current';

    return `${source}:${id}`;
  }

  getChat(key = this.activeKey) {

    if (!this.chats[key]) {

      this.chats[key] = {
        id: null,
        title: 'New Chat',
        messages: [],
        lastAnswer: ''
      };
    }

    return this.chats[key];
  }

  /*
   * Called by each page BEFORE asking.
   * Pass ('standalone', null) for the dashboard Ask AI.
   */
  setSource(source, context = null) {

    this.activeSource = source || 'standalone';

    this.activeContext =
      this.activeSource === 'standalone'
        ? null
        : context;

    this.activeKey =
      this.makeKey(
        this.activeSource,
        this.activeContext
      );

    this.renderActiveChat();
  }

  /* =========================================================
     EVENTS
     ========================================================= */

  bindEvents() {

    document
      .getElementById('btnAIExplainSimple')
      ?.addEventListener('click', () => {
        this.ask('Explain this simply.');
      });

    document
      .getElementById('btnAIGiveExample')
      ?.addEventListener('click', () => {
        this.ask('Give me a simple example.');
      });

    document
      .getElementById('btnAITeachMe')
      ?.addEventListener('click', () => {
        this.ask('Teach me this topic step by step.');
      });

    document
      .getElementById('btnAIQuizMe')
      ?.addEventListener('click', () => {
        this.ask('Quiz me on this topic.');
      });

    document
      .getElementById('btnAIStop')
      ?.addEventListener('click', () => {
        window.SoundSightTTS?.stop();
      });

    document
      .getElementById('btnAIRepeat')
      ?.addEventListener('click', () => {
        this.repeatLastAnswer();
      });

    document
      .getElementById('btnAINewChat')
      ?.addEventListener('click', () => {
        this.newChat();
      });

    document
      .getElementById('btnOpenBraille')
      ?.addEventListener('click', () => {
        this.openBraille();
      });

    /* ---------- Popup (typed questions) ---------- */

    const popupForm =
      document.getElementById('askPopupForm');

    const popupInput =
      document.getElementById('askPopupInput');

    if (popupForm && popupInput) {

      popupForm.addEventListener('submit', (event) => {

        event.preventDefault();

        const value = popupInput.value.trim();

        if (!value) {
          return;
        }

        popupInput.value = '';

        this.ask(value);
      });
    }

    document
      .getElementById('btnCloseAskPopup')
      ?.addEventListener('click', () => {
        window.SoundSightApp?.closeAskPopup?.();
      });
  }


  slimContext(context) {
  if (!context || typeof context !== 'object') {
    return null;
  }
  const copy = { ...context };
  delete copy.imageData;
  delete copy.ocrImageData;
  return copy;
}

  /* =========================================================
     ASK
     ========================================================= */

  async ask(message, options = {}) {

    const text = String(message || '').trim();

    if (!text) {
      return;
    }

    const source =
      options.source || this.activeSource;

    const context =
      source === 'standalone'
        ? null
        : (
            options.context !== undefined
              ? options.context
              : this.activeContext
          );

    this.pendingQuestions.push({
      text,
      source,
      context,
      key: this.makeKey(source, context)
    });

    // If another request is running, this one is processed next.
    if (this.isBusy) {
      return;
    }

    this.isBusy = true;

    try {

      while (this.pendingQuestions.length > 0) {

        const question =
          this.pendingQuestions.shift();

        await this.sendOne(question);
      }

    } finally {

      this.isBusy = false;

      this.setVoiceState(
        'Ready',
        'Ask another question.'
      );
    }
  }

  async sendOne({ text, source, context, key }) {

    const chat = this.getChat(key);

    this.addMessage(key, 'user', text);

    this.setVoiceState(
      'Thinking',
      'SoundSight AI is preparing your answer.'
    );

    const controller = new AbortController();

    const timer = setTimeout(
      () => controller.abort(),
      45000
    );

    try {

      const response = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: text,
          source,
          context: source === 'standalone' ? null : this.slimContext(context),
          chatId: chat.id,
          // Last few turns of THIS chat only (excludes the new question).
          history: chat.messages.slice(-12, -1)
        }),
        signal: controller.signal
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.error || 'Unable to get an AI response.'
        );
      }

      chat.id = data.chatId || chat.id;
      chat.title = data.title || chat.title;
      chat.lastAnswer = data.answer || '';

      this.addMessage(
        key,
        'assistant',
        chat.lastAnswer ||
        'I received an empty answer. Please ask again.'
      );

      // Speak only if the user is still on this chat.
      if (chat.lastAnswer && key === this.activeKey) {
        window.SoundSightTTS?.speak(chat.lastAnswer);
      }

    } catch (error) {

      console.error('[SoundSight AI] Ask error:', error);

      this.addMessage(
        key,
        'assistant',
        error.name === 'AbortError'
          ? 'That is taking longer than expected. Please try again.'
          : 'I could not answer that right now. Please try again.'
      );

    } finally {

      clearTimeout(timer);
    }
  }

  /* =========================================================
     MESSAGES / RENDERING
     ========================================================= */

  addMessage(key, role, text) {

    const chat = this.getChat(key);

    chat.messages.push({
      role,
      content: text
    });

    // Draw only if this chat is the one on screen.
    if (key === this.activeKey) {
      this.renderMessage(role, text);
    }
  }

  getContainer() {

    return document.getElementById(
      this.activeSource === 'standalone'
        ? 'askAIConversation'
        : 'popupConversation'
    );
  }

  /*
   * Redraw the active chat. Called when the source changes,
   * so one page never shows another page's messages.
   */
  renderActiveChat() {

    const container = this.getContainer();

    if (!container) {
      return;
    }

    container.innerHTML = '';

    const chat = this.getChat(this.activeKey);

    if (!chat.messages.length) {

      if (this.activeSource === 'standalone') {
        container.innerHTML = this.welcomeHTML();
      }

      return;
    }

    chat.messages.forEach((m) => {
      this.renderMessage(m.role, m.content);
    });
  }

  welcomeHTML() {

    return `
      <div class="ask-ai-welcome">
        <div class="ask-ai-orb" aria-hidden="true"></div>

        <h3>What would you like to understand?</h3>

        <p>
          Ask me about your studies or any STEM topic.
        </p>
      </div>
    `;
  }

  renderMessage(role, text) {

    const container = this.getContainer();

    if (!container) {
      return;
    }

    const welcome =
      container.querySelector('.ask-ai-welcome');

    if (welcome) {
      welcome.remove();
    }

    const messageElement =
      document.createElement('div');

    messageElement.className =
      `ask-ai-message ${role}`;

    const label =
      document.createElement('span');

    label.className = 'ask-ai-message-label';

    label.textContent =
      role === 'user'
        ? 'YOU'
        : 'SOUNDSIGHT AI';

    const content =
      document.createElement('div');

    content.className = 'ask-ai-message-content';

    content.textContent = text;

    messageElement.appendChild(label);
    messageElement.appendChild(content);

    container.appendChild(messageElement);

    container.scrollTop = container.scrollHeight;
  }

  /* =========================================================
     REPEAT / NEW CHAT
     ========================================================= */

  /*
   * app.js checks assistant.lastAnswer, so keep this getter.
   */
  get lastAnswer() {

    return this.getChat(this.activeKey).lastAnswer;
  }

  repeatLastAnswer() {

    const answer = this.lastAnswer;

    if (!answer) {

      window.SoundSightTTS?.speak(
        'There is no previous AI answer to repeat.'
      );

      return;
    }

    window.SoundSightTTS?.speak(answer);
  }

  async newChat() {

    // Reset ONLY the chat currently on screen.
    this.chats[this.activeKey] = {
      id: null,
      title: 'New Chat',
      messages: [],
      lastAnswer: ''
    };

    this.renderActiveChat();

    if (this.activeSource === 'standalone') {

      const context =
        document.getElementById('askAIContextText');

      if (context) {
        context.textContent = 'Ready for your question';
      }
    }

    this.setVoiceState(
      'Ready',
      'Ask your question.'
    );

    window.SoundSightTTS?.speak(
      'New AI chat started.'
    );
  }

  /* =========================================================
     UI HELPERS
     ========================================================= */

  setVoiceState(status, hint) {

    const statusElement =
      document.getElementById('askAIVoiceStatus');

    const hintElement =
      document.getElementById('askAIVoiceHint');

    if (statusElement) {
      statusElement.textContent = status;
    }

    if (hintElement) {
      hintElement.textContent = hint;
    }
  }

  openBraille() {

    window.SoundSightTTS?.speak(
      'Virtual Braille keyboard is ready for accessibility demonstration.'
    );

    console.log(
      '[SoundSight AI] Braille keyboard requested.'
    );
  }

}


/*
 * Global assistant instance.
 *
 * app.js and voice-manager.js use:
 *   window.SoundSightAssistant.ask(...)
 *   window.SoundSightAssistant.setSource(...)
 */

window.SoundSightAssistant =
  new SoundSightAssistant();