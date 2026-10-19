async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options);
  const type = res.headers.get('content-type') || '';

  if (!type.includes('application/json')) {
    throw new Error(res.status === 404 ? 'ROUTE_MISSING' : `SERVER_ERROR_${res.status}`);
  }

  return res.json();
}

/**
 * SoundSight Voice-Based Revision Manager
 * Flow: topic list -> mode -> Quiz (Rapid or Normal) / Quick / Detailed / Exam / Ask AI
 */

class SoundSightRevisionManager {
  constructor() {
    this.currentRevisionItem = null;
    this.currentMode = null;
    this.topics = [];
    this.awaitingTopic = false;
    this.awaitingMode = false;
    this.awaitingQuizType = false;
    this.isAwaitingAnswer = false;
    this.quiz = null;
    this.busy = false;

    this.bindQuizButtons();
  }

  bindQuizButtons() {
    document.getElementById('btnRevRapid')
      ?.addEventListener('click', () => this.selectMode('rapid'));
    document.getElementById('btnRevNormal')
      ?.addEventListener('click', () => this.selectMode('normal'));
  }

  /* ---------- helpers ---------- */

  say(text) {
    window.SoundSightTTS?.speak(text);
  }

  esc(value) {
    return window.SoundSightApp
      ? window.SoundSightApp.escapeHTML(value)
      : String(value ?? '');
  }

  getStemItems() {
    const items = window.SoundSightHistoryManager
      ? window.SoundSightHistoryManager.items
      : [];
    return (items || []).filter((i) =>
      i &&
      !i.isError &&
      i.contentType !== 'None' &&
      !/^(no stem content detected|not stem content)$/i.test(
        String(i.title || '').trim()
      ) &&
      String(i.topic || '').toLowerCase() !== 'non-stem content'
    );
  }

  resetState() {
    this.awaitingTopic = false;
    this.awaitingMode = false;
    this.awaitingQuizType = false;
    this.isAwaitingAnswer = false;
    this.quiz = null;
    this.busy = false;
  }

  wantsSpeech() {
    if (window.SoundSightApp?.currentView !== 'revision') {
      this.resetState();
      return false;
    }
    return (
      this.awaitingTopic ||
      this.awaitingMode ||
      this.awaitingQuizType ||
      this.isAwaitingAnswer
    );
  }

  parseNumber(spoken) {
    const words = {
      one: 1, won: 1, first: 1, two: 2, to: 2, too: 2, second: 2,
      three: 3, third: 3, four: 4, for: 4, fourth: 4, five: 5, fifth: 5,
      six: 6, sixth: 6, seven: 7, seventh: 7, eight: 8, eighth: 8,
      nine: 9, ninth: 9, ten: 10, tenth: 10
    };
    const ordinals = [
      'first', 'second', 'third', 'fourth', 'fifth',
      'sixth', 'seventh', 'eighth', 'ninth', 'tenth'
    ];
    const filler = new Set([
      'topic', 'number', 'item', 'option', 'the', 'open',
      'select', 'choose', 'pick', 'please', 'a', 'an'
    ]);

    const tokens = spoken.split(/\s+/).filter((w) => w && !filler.has(w));
    const isNum = (w) => /^\d+$/.test(w) || words[w] !== undefined;

    if (!tokens.length || !tokens.every(isNum)) return -1;

    const token = tokens.find((w) => ordinals.includes(w)) || tokens[0];
    return /^\d+$/.test(token) ? Number(token) : words[token];
  }

  normalizeMode(text) {
    const s = String(text || '').toLowerCase();
    if (/rapid|multiple choice|mcq|options/.test(s)) return 'rapid';
    if (/normal quiz|question answer|spoken quiz|written quiz/.test(s)) return 'normal';
    if (/quiz|question|test me|practice/.test(s)) return 'question';
    if (/quick/.test(s)) return 'quick';
    if (/detail/.test(s)) return 'detailed';
    if (/exam/.test(s)) return 'exam';
    return null;
  }

  /* ---------- topic list ---------- */

  openTopicList() {
    window.SoundSightApp?.switchView('revision');
    this.resetState();
    this.currentRevisionItem = null;

    const container = document.getElementById('revisionContentDisplay');
    const topics = this.getStemItems();
    this.topics = topics;

    if (!topics.length) {
      if (container) {
        container.innerHTML =
          '<p>No STEM topics are saved yet. Please scan or upload STEM content first.</p>';
      }
      this.say(
        'There are no saved STEM topics yet. Please scan or upload content first.'
      );
      return;
    }

    if (container) {
      container.innerHTML = '';

      const heading = document.createElement('h3');
      heading.textContent = 'Choose a topic to revise';
      container.appendChild(heading);

      topics.forEach((item, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-secondary';
        button.style.cssText = 'display:block;width:100%;margin:8px 0;text-align:left;';
        button.textContent =
          `${index + 1}. ${item.title || 'STEM Content'} (${item.contentType || 'STEM'})`;
        button.addEventListener('click', () => this.chooseTopic(index));
        container.appendChild(button);
      });
    }

    this.awaitingTopic = true;

    const readable = topics
      .slice(0, 8)
      .map((t, i) => `Topic ${i + 1}: ${t.title || 'STEM content'}.`)
      .join(' ');
    const extra = topics.length > 8
      ? ` And ${topics.length - 8} more. Say part of a topic name to open it.`
      : '';

    this.say(
      `You have ${topics.length} saved ${topics.length === 1 ? 'topic' : 'topics'}. ` +
      `${readable}${extra} Say the topic number or part of its name.`
    );
  }

  pickTopicBySpeech(spoken) {
    let index = -1;
    const number = this.parseNumber(spoken);

    if (number > 0) {
      index = number - 1;
    } else {
      const tokens = spoken.split(/\s+/).filter((w) => w.length > 2);
      let best = 0;
      this.topics.forEach((item, i) => {
        const name = `${item.title || ''} ${item.topic || ''}`.toLowerCase();
        const score = tokens.filter((w) => name.includes(w)).length;
        if (score > best) { best = score; index = i; }
      });
    }

    if (index < 0 || index >= this.topics.length) {
      this.say('I did not find that topic. Say the topic number or part of its name.');
      return;
    }

    this.chooseTopic(index);
  }

  chooseTopic(index) {
    const item = this.topics[index];
    if (!item) return;

    window.SoundSightTTS?.stop();
    this.resetState();
    this.currentRevisionItem = item;

    window.SoundSightApp?.displayRevisionView(item);

    this.awaitingMode = true;

    this.say(
      `You chose ${item.title || 'this topic'}. Say Quiz, Quick Revision, ` +
      'Detailed Revision, Exam Revision, or Ask AI. Say Back to choose another topic.'
    );
  }

  async handleReviseCommand(topicQuery) {
    const topics = this.getStemItems();
    const query = String(topicQuery || '').toLowerCase().trim();

    if (!topics.length || !query) {
      this.openTopicList();
      return;
    }

    const tokens = query.split(/\s+/).filter((w) => w.length > 2);
    let best = 0;
    let found = -1;

    topics.forEach((item, i) => {
      const name = `${item.title || ''} ${item.topic || ''}`.toLowerCase();
      const score = tokens.filter((w) => name.includes(w)).length;
      if (score > best) { best = score; found = i; }
    });

    if (found < 0) {
      this.openTopicList();
      return;
    }

    window.SoundSightApp?.switchView('revision');
    this.topics = topics;
    this.chooseTopic(found);
  }

  /* ---------- free speech router ---------- */

  async handleSpeech(text) {
    const spoken = String(text || '').toLowerCase().trim();
    if (!spoken || this.busy) return;

    if (/(exit|stop|end|quit|cancel) (the )?quiz/.test(spoken)) {
      this.quiz = null;
      this.isAwaitingAnswer = false;
      this.awaitingQuizType = false;
      this.awaitingMode = true;
      window.SoundSightApp?.displayRevisionView(this.currentRevisionItem);
      this.say('Quiz stopped. Say Quiz, Quick Revision, Detailed Revision, Exam Revision, or Back.');
      return;
    }

    if (this.isAwaitingAnswer) {
      if (/^(repeat|repeat that|repeat the question|say again|say that again)$/.test(spoken)) {
        this.askQuestion('');
        return;
      }

      if (/^(skip|next|pass|i (do not|don'?t) know|don'?t know)$/.test(spoken)) {
        await this.submitAnswer(text, { skip: true });
      } else if (this.quiz?.type === 'rapid') {
        const idx = this.parseOption(spoken, this.quiz.questions[this.quiz.index].options);
        if (idx < 0) {
          this.say('I did not catch the option. Say A, B, C or D, or say repeat.');
          return;
        }
        await this.submitAnswer(text, { optionIndex: idx });
      } else {
        await this.submitAnswer(text);
      }
      return;
    }

    if (this.awaitingQuizType) {
      if (/^(back|go back|cancel)$/.test(spoken)) {
        this.awaitingQuizType = false;
        this.awaitingMode = true;
        window.SoundSightApp?.displayRevisionView(this.currentRevisionItem);
        this.say('Say Quiz, Quick Revision, Detailed Revision, Exam Revision, or Ask AI.');
        return;
      }
      const mode = this.normalizeMode(spoken);
      if (mode === 'rapid' || mode === 'normal') {
        await this.startQuiz(mode);
      } else {
        this.say('Please say Rapid quiz for multiple choice, or Normal quiz for spoken answers.');
      }
      return;
    }

    if (this.awaitingTopic) {
      this.pickTopicBySpeech(spoken);
      return;
    }

    if (this.awaitingMode) {
      if (/\bask\b.*\bai\b/.test(spoken)) {
        window.SoundSightApp?.openAskPopup('revision', this.currentRevisionItem);
        return;
      }
      if (/^(back|go back|topics|change topic|another topic)$/.test(spoken)) {
        this.openTopicList();
        return;
      }
      const mode = this.normalizeMode(spoken);
      if (mode) {
        await this.selectMode(mode);
      } else {
        this.say('Please say Quiz, Quick Revision, Detailed Revision, Exam Revision, or Ask AI.');
      }
    }
  }

  /* ---------- modes ---------- */

  async selectMode(rawMode) {
    const mode = this.normalizeMode(rawMode) || rawMode;

    if (!this.currentRevisionItem) {
      const items = this.getStemItems();
      if (!items.length) return;
      this.currentRevisionItem = items[0];
    }

    this.currentMode = mode;

    if (mode === 'question') {
      this.askQuizType();
      return;
    }

    if (mode === 'rapid' || mode === 'normal') {
      await this.startQuiz(mode);
      return;
    }

    this.isAwaitingAnswer = false;
    this.awaitingQuizType = false;
    this.quiz = null;
    this.awaitingMode = true;

    try {
      const { imageData, ocrImageData, ...slim } = this.currentRevisionItem;

      const data = await fetchJSON('/api/revise/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: this.currentRevisionItem.id,
          topic: this.currentRevisionItem.topic,
          mode,
          item: slim
        })
      });

      if (data.success && data.revision) {
        this.renderRevisionData(data.revision);
        if (data.revision.audioScript) {
          this.say(data.revision.audioScript);
        }
        return;
      }
    } catch (e) {
      console.warn('[Revision] Server revision error, using local fallback:', e);
    }

    this.executeLocalRevision(mode);
  }

  executeLocalRevision(mode) {
    const item = this.currentRevisionItem;
    let speech = '';

    if (mode === 'quick') {
      speech = `Quick Revision for ${item.title}. Topic: ${item.topic}. Key points: ${(item.keyPoints || []).join('. ')}.`;
    } else if (mode === 'detailed') {
      speech = `Detailed Revision for ${item.title}. ${item.audioScript || item.summary || item.purpose || ''}`;
    } else {
      speech = `Exam Revision for ${item.title}. Key points to remember: ${(item.keyPoints || []).join('. ')}.`;
    }

    this.say(speech);
  }

  /* ---------- quiz ---------- */

  askQuizType() {
    this.awaitingMode = false;
    this.awaitingQuizType = true;
    this.isAwaitingAnswer = false;

    const container = document.getElementById('revisionContentDisplay');
    if (container) {
      container.innerHTML = `
        <div class="revision-mode-badge">Quiz</div>
        <h2 class="revision-topic-title">${this.esc(this.currentRevisionItem?.title || '')}</h2>
        <p>Choose a quiz type:</p>
        <button type="button" id="quizTypeRapid" class="btn btn-primary" style="display:block;width:100%;margin:8px 0;">
          ⚡ Rapid Quiz (choose A, B, C or D)
        </button>
        <button type="button" id="quizTypeNormal" class="btn btn-secondary" style="display:block;width:100%;margin:8px 0;">
          🗣️ Normal Quiz (speak your answer)
        </button>
      `;
      document.getElementById('quizTypeRapid')
        ?.addEventListener('click', () => this.startQuiz('rapid'));
      document.getElementById('quizTypeNormal')
        ?.addEventListener('click', () => this.startQuiz('normal'));
    }

    this.say(
      'Which quiz? Say Rapid quiz for multiple choice questions, ' +
      'or Normal quiz to answer in your own words.'
    );
  }

  async startQuiz(type = 'normal') {
    const item = this.currentRevisionItem;
    if (!item) return;

    this.busy = true;
    this.awaitingMode = false;
    this.awaitingQuizType = false;
    this.isAwaitingAnswer = false;

    this.say('Preparing your quiz. Please wait a moment.');

    try {
      const { imageData, ocrImageData, ...slim } = item;

      const data = await fetchJSON('/api/revise/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: item.id,
          item: slim,
          count: 5,
          quizType: type
        })
      });

      if (!data.success || !data.questions?.length) {
        throw new Error(data.error || 'No questions');
      }

      this.quiz = { type, questions: data.questions, index: 0, score: 0 };
      this.busy = false;

      const how = type === 'rapid'
        ? 'Each question has four options. Say A, B, C or D. '
        : 'Answer each one by speaking. ';

      this.askQuestion(
        `${type === 'rapid' ? 'Rapid' : 'Normal'} quiz on ${item.title}. ` +
        `${data.questions.length} questions. ${how}` +
        'Say skip if you do not know, or repeat to hear a question again. '
      );
    } catch (e) {
      console.warn('[Revision] Quiz failed:', e);
      this.busy = false;
      this.quiz = null;
      this.awaitingMode = true;

      this.say(
        e.message === 'ROUTE_MISSING'
          ? 'The quiz service is not available. Please restart the SoundSight server, then try again.'
          : 'I could not prepare the quiz right now. Please try again, or choose another mode.'
      );
    }
  }

  askQuestion(prefix = '') {
    const quiz = this.quiz;
    if (!quiz) return;

    const q = quiz.questions[quiz.index];
    if (!q) return;

    this.isAwaitingAnswer = true;

    const label = `Question ${quiz.index + 1} of ${quiz.questions.length}`;
    const showFeedback = prefix.includes('Correct') || prefix.includes('Not quite') ? prefix : '';

    this.renderQuiz(label, q.question, showFeedback, q.options);

    let speech = `${prefix}${label}. ${q.question}`;

    if (quiz.type === 'rapid' && Array.isArray(q.options)) {
      const letters = ['A', 'B', 'C', 'D'];
      speech += ' ' + q.options
        .map((opt, i) => `Option ${letters[i]}: ${opt}.`)
        .join(' ');
    }

    this.say(speech);
  }

  /** Works out which option was said: "a", "option b", "see", "two", or its text. */
  parseOption(spoken, options) {
    const letterWords = {
      a: 0, ay: 0, eh: 0, hey: 0,
      b: 1, be: 1, bee: 1,
      c: 2, see: 2, sea: 2, si: 2,
      d: 3, dee: 3
    };
    const numberWords = {
      one: 0, won: 0, first: 0, '1': 0,
      two: 1, to: 1, too: 1, second: 1, '2': 1,
      three: 2, third: 2, '3': 2,
      four: 3, for: 3, fourth: 3, '4': 3
    };
    const filler = new Set([
      'option', 'answer', 'choice', 'the', 'is', 'it', 'number', 'i', 'choose',
      'select', 'pick', 'say', 'my', 'please'
    ]);

    const tokens = spoken
      .replace(/[.,!?]/g, ' ')
      .split(/\s+/)
      .filter((w) => w && !filler.has(w));

    if (tokens.length === 1) {
      if (letterWords[tokens[0]] !== undefined) return letterWords[tokens[0]];
      if (numberWords[tokens[0]] !== undefined) return numberWords[tokens[0]];
    }

    // Otherwise match the words of an option.
    let best = 0;
    let found = -1;
    let tie = false;

    (options || []).forEach((opt, i) => {
      const optTokens = String(opt).toLowerCase().split(/\W+/).filter((w) => w.length > 1);
      const score = tokens.filter((w) => optTokens.includes(w)).length;
      if (score > best) { best = score; found = i; tie = false; }
      else if (score === best && score > 0) { tie = true; }
    });

    return best > 0 && !tie ? found : -1;
  }

  /** opts: { skip: true } or { optionIndex: n } (rapid) or nothing (normal). */
  async submitAnswer(studentAnswer, opts = {}) {
    const quiz = this.quiz;
    if (!quiz || !this.isAwaitingAnswer || this.busy) return;

    this.isAwaitingAnswer = false;
    this.busy = true;

    const q = quiz.questions[quiz.index];
    const letters = ['A', 'B', 'C', 'D'];
    let correct = false;

    if (opts.skip) {
      correct = false;
    } else if (quiz.type === 'rapid') {
      correct = opts.optionIndex === q.answerIndex;
    } else {
      try {
        const data = await fetchJSON('/api/revise/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: q.question,
            expectedAnswer: q.answer,
            studentAnswer
          })
        });

        correct = !!(data.success && data.correct);
      } catch (e) {
        console.warn('[Revision] Answer check failed:', e);
        this.busy = false;
        this.isAwaitingAnswer = true;

        this.say(
          e.message === 'ROUTE_MISSING'
            ? 'I cannot check answers right now. Please restart the SoundSight server.'
            : 'I could not check your answer. Please say it again, or say skip.'
        );
        return;
      }
    }

    this.busy = false;

    let feedback;
    if (correct) {
      quiz.score += 1;
      feedback = 'Correct! ';
    } else {
      const rightAnswer = quiz.type === 'rapid'
        ? `option ${letters[q.answerIndex]}, ${q.answer}`
        : q.answer;
      feedback =
        `Not quite. The right answer is: ${rightAnswer}. ` +
        `${q.explanation ? q.explanation + ' ' : ''}`;
    }

    quiz.index += 1;

    if (quiz.index < quiz.questions.length) {
      this.askQuestion(feedback);
      return;
    }

    const total = quiz.questions.length;
    const score = quiz.score;
    const typeName = quiz.type === 'rapid' ? 'Rapid' : 'Normal';

    this.quiz = null;
    this.awaitingMode = true;

    this.renderQuiz(
      `${typeName} quiz complete`,
      `You scored ${score} out of ${total}.`,
      feedback
    );

    this.say(
      `${feedback}Quiz complete. You scored ${score} out of ${total}. ` +
      'Say Quiz to try again, say another revision mode, or say Back to choose another topic.'
    );
  }

  /* ---------- rendering ---------- */

  renderQuiz(label, text, feedback = '', options = null) {
    const container = document.getElementById('revisionContentDisplay');
    if (!container) return;

    const type = this.quiz?.type;
    const badge = type === 'rapid' ? 'Rapid Quiz'
      : type === 'normal' ? 'Normal Quiz'
      : 'Quiz';

    const letters = ['A', 'B', 'C', 'D'];

    const optionsHtml = (type === 'rapid' && Array.isArray(options))
      ? options.map((opt, i) => `
          <button type="button" class="btn btn-secondary quiz-option"
                  data-index="${i}"
                  style="display:block;width:100%;margin:8px 0;text-align:left;"
                  aria-label="Option ${letters[i]}: ${this.esc(opt)}">
            <strong>${letters[i]}.</strong> ${this.esc(opt)}
          </button>`).join('')
      : '';

    container.innerHTML = `
      <div class="revision-mode-badge">${this.esc(badge)}</div>
      <h2 class="revision-topic-title">${this.esc(this.currentRevisionItem?.title || '')}</h2>
      ${feedback ? `<p class="evaluation-feedback-text">${this.esc(feedback)}</p>` : ''}
      <div class="revision-question-card">
        <span class="question-label">${this.esc(label)}</span>
        <p class="question-text">${this.esc(text)}</p>
        ${optionsHtml}
      </div>
    `;

    container.querySelectorAll('.quiz-option').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.SoundSightTTS?.stop();
        this.submitAnswer('', { optionIndex: Number(btn.dataset.index) });
      });
    });
  }

  renderRevisionData(revData) {
    const container = document.getElementById('revisionContentDisplay');
    if (!container) return;

    const list = (arr, cls = '') =>
      (arr || []).map((p) => `<li class="${cls}">${this.esc(p)}</li>`).join('');

    let html = `
      <div class="revision-mode-badge">${this.esc(revData.mode)}</div>
      <h2 class="revision-topic-title">${this.esc(revData.title)}</h2>
    `;

    if (revData.mode === 'Quick Revision') {
      html += `
        <div class="revision-section"><h3>Topic Overview</h3><p>${this.esc(revData.overview || '')}</p></div>
        <div class="revision-section"><h3>Key Points</h3><ul>${list(revData.keyPoints)}</ul></div>
        <div class="revision-section"><h3>Common Mistakes</h3><ul>${list(revData.commonMistakes, 'text-warning')}</ul></div>
      `;
    } else if (revData.mode === 'Exam Revision') {
      html += `
        <div class="revision-section"><h3>High-Yield Exam Strategy</h3><ul>${list(revData.examTips)}</ul></div>
      `;
    } else {
      html += `
        <div class="revision-section">
          <h3>Detailed Conceptual Review</h3>
          <p>${this.esc(this.currentRevisionItem?.purpose || '')}</p>
          <ul>${list(this.currentRevisionItem?.keyPoints)}</ul>
        </div>
      `;
    }

    container.innerHTML = html;
  }
}

window.SoundSightRevisionManager = new SoundSightRevisionManager();