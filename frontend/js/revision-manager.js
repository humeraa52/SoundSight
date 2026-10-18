/**
 * Calls the backend and always returns parsed JSON.
 * Throws ROUTE_MISSING for a 404 page, or SERVER_ERROR for any
 * other non-JSON reply, instead of a raw "Unexpected token '<'".
 */
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
 * Flow: topic list (STEM only) -> mode -> Quiz / Quick / Detailed / Exam / Ask AI
 * Quiz: one question at a time. Correct -> next. Wrong -> explain, then next.
 *
 * During a quiz the voice manager sends (almost) everything the student
 * says to handleSpeech() as an answer. Say "repeat" to hear the question
 * again, "skip" to pass, and "stop quiz" to leave.
 */

class SoundSightRevisionManager {
  constructor() {
    this.currentRevisionItem = null;
    this.currentMode = null;
    this.topics = [];
    this.awaitingTopic = false;
    this.awaitingMode = false;
    this.isAwaitingAnswer = false;
    this.quiz = null;
    this.busy = false;
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
    /*
     * Only real STEM topics. Old non-STEM saves (from before the
     * detection fix) are hidden here as a safety net.
     */
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
    this.isAwaitingAnswer = false;
    this.quiz = null;
    this.busy = false;
  }

  /** app.js asks this before treating free speech as Ask AI. */
  wantsSpeech() {
    if (window.SoundSightApp?.currentView !== 'revision') {
      this.resetState();
      return false;
    }
    return this.awaitingTopic || this.awaitingMode || this.isAwaitingAnswer;
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

    // Sets app.currentRevisionItem too, so the Ask AI button works.
    window.SoundSightApp?.displayRevisionView(item);

    this.awaitingMode = true;

    this.say(
      `You chose ${item.title || 'this topic'}. Say Quiz, Quick Revision, ` +
      'Detailed Revision, Exam Revision, or Ask AI. Say Back to choose another topic.'
    );
  }

  /** "Revise <topic>" voice command. */
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
      this.awaitingMode = true;
      this.say('Quiz stopped. Say Quiz, Quick Revision, Detailed Revision, Exam Revision, or Back.');
      return;
    }

    if (this.isAwaitingAnswer) {

      /* "Repeat" reads the QUESTION again; it is not an answer. */
      if (/^(repeat|repeat that|repeat the question|say again|say that again)$/.test(spoken)) {
        this.askQuestion('');
        return;
      }

      if (/^(skip|next|pass|i (do not|don'?t) know|don'?t know)$/.test(spoken)) {
        await this.submitStudentAnswer(text, true);
      } else {
        await this.submitStudentAnswer(text);
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
      await this.startQuiz();
      return;
    }

    this.isAwaitingAnswer = false;
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

  async startQuiz() {
    const item = this.currentRevisionItem;

    this.busy = true;
    this.awaitingMode = false;
    this.isAwaitingAnswer = false;

    this.say('Preparing your quiz. Please wait a moment.');

       try {
      const { imageData, ocrImageData, ...slim } = item;

      const data = await fetchJSON('/api/revise/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.id, item: slim, count: 5 })
      });

      if (!data.success || !data.questions?.length) {
        throw new Error(data.error || 'No questions');
      }

      this.quiz = { questions: data.questions, index: 0, score: 0 };
      this.busy = false;

      this.askQuestion(
        `Quiz on ${item.title}. ${data.questions.length} questions. ` +
        'Answer each one by speaking. Say skip if you do not know, or repeat to hear a question again. '
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
    this.renderQuiz(
      `Question ${quiz.index + 1} of ${quiz.questions.length}`,
      q.question,
      prefix.includes('Correct') || prefix.includes('Not quite') ? prefix : ''
    );

    this.say(`${prefix}Question ${quiz.index + 1} of ${quiz.questions.length}. ${q.question}`);
  }

  async submitStudentAnswer(studentAnswer, forceWrong = false) {
    const quiz = this.quiz;
    if (!quiz || !this.isAwaitingAnswer || this.busy) return;

    this.isAwaitingAnswer = false;
    this.busy = true;

    const q = quiz.questions[quiz.index];
    let correct = false;

    if (!forceWrong) {
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

        /* Do not punish the student: keep the same question open. */
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
      feedback =
        `Not quite. The right answer is: ${q.answer}. ` +
        `${q.explanation ? q.explanation + ' ' : ''}`;
    }

    quiz.index += 1;

    if (quiz.index < quiz.questions.length) {
      this.askQuestion(feedback);
      return;
    }

    // Finished
    const total = quiz.questions.length;
    const score = quiz.score;

    this.quiz = null;
    this.awaitingMode = true;

    this.renderQuiz(
      'Quiz complete',
      `You scored ${score} out of ${total}.`,
      feedback
    );

    this.say(
      `${feedback}Quiz complete. You scored ${score} out of ${total}. ` +
      'Say Quiz to try again, say another revision mode, or say Back to choose another topic.'
    );
  }

  /* ---------- rendering ---------- */

  renderQuiz(label, text, feedback = '') {
    const container = document.getElementById('revisionContentDisplay');
    if (!container) return;

    container.innerHTML = `
      <div class="revision-mode-badge">Quiz</div>
      <h2 class="revision-topic-title">${this.esc(this.currentRevisionItem?.title || '')}</h2>
      ${feedback ? `<p class="evaluation-feedback-text">${this.esc(feedback)}</p>` : ''}
      <div class="revision-question-card">
        <span class="question-label">${this.esc(label)}</span>
        <p class="question-text">${this.esc(text)}</p>
      </div>
    `;
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