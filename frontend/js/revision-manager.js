/**
 * SoundSight Voice-Based Revision Manager
 * Handles semantic topic search, mode prompt, and 4 specialized revision modes:
 * - Quick Revision
 * - Detailed Revision
 * - Exam Revision
 * - Question Mode (interactive voice Q&A)
 */

class SoundSightRevisionManager {
  constructor() {
    this.currentRevisionItem = null;
    this.currentMode = null;
    this.activeQuestion = null;
    this.expectedAnswer = null;
    this.isAwaitingAnswer = false;
  }

  /**
   * User says: "Revise Round Robin Scheduling"
   */
  async handleReviseCommand(topicQuery) {
    console.log('[Revision] Handling revise command for:', topicQuery);

    const historyItems = window.SoundSightHistoryManager ? window.SoundSightHistoryManager.items : [];
    if (!historyItems || historyItems.length === 0) {
      if (window.SoundSightTTS) {
        window.SoundSightTTS.speak("You have no saved learning materials to revise. Please scan or upload content first.");
      }
      return;
    }

    let targetItem = null;

    if (topicQuery && topicQuery.trim()) {
      const q = topicQuery.toLowerCase().trim();
      targetItem = historyItems.find(item => {
        const title = (item.title || '').toLowerCase();
        const topic = (item.topic || '').toLowerCase();
        const text = (item.ocrText || '').toLowerCase();
        return title.includes(q) || topic.includes(q) || q.split(' ').some(w => w.length > 3 && (title.includes(w) || topic.includes(w)));
      });
    }

    // Default to most recent item if query not matched
    if (!targetItem) {
      targetItem = historyItems[0];
    }

    this.currentRevisionItem = targetItem;

    if (window.SoundSightApp) {
      window.SoundSightApp.displayRevisionView(targetItem);
    }

    // Speak the required confirmation prompt
    const prompt = `I found your ${targetItem.title} material. Would you like a quick revision or detailed revision? You can also say Exam Revision or Question Mode.`;
    if (window.SoundSightTTS) {
      window.SoundSightTTS.speak(prompt);
    }
  }

  /**
   * User selects mode verbally or via button
   */
  async selectMode(mode) {
    if (!this.currentRevisionItem) {
      const history = window.SoundSightHistoryManager ? window.SoundSightHistoryManager.items : [];
      if (history.length > 0) {
        this.currentRevisionItem = history[0];
      } else {
        return;
      }
    }

    this.currentMode = mode;
    console.log(`[Revision] Activating mode: ${mode} for:`, this.currentRevisionItem.title);

    try {
      const resp = await fetch('/api/revise/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: this.currentRevisionItem.id,
          topic: this.currentRevisionItem.topic,
          mode: mode
        })
      });

      if (resp.ok) {
        const data = await resp.json();
        if (data.success && data.revision) {
          this.renderRevisionData(data.revision);
          if (mode === 'question') {
            this.activeQuestion = data.revision.question;
            this.expectedAnswer = data.revision.expectedAnswer;
            this.isAwaitingAnswer = true;
          } else {
            this.isAwaitingAnswer = false;
          }

          if (window.SoundSightTTS && data.revision.audioScript) {
            window.SoundSightTTS.speak(data.revision.audioScript);
          }
          return;
        }
      }
    } catch (e) {
      console.warn('[Revision] Server revision fetch error, using local fallback:', e);
    }

    // Fallback mode execution
    this.executeLocalRevision(mode);
  }

  executeLocalRevision(mode) {
    const item = this.currentRevisionItem;
    let speech = '';

    if (mode === 'quick') {
      speech = `Starting Quick Revision for ${item.title}. Topic: ${item.topic}. Key Points: ${(item.keyPoints || []).join('. ')}. Common mistake: Confusing theoretical runtime with practical execution. Quick revision complete.`;
    } else if (mode === 'detailed') {
      speech = `Starting Detailed Revision for ${item.title}. ${item.audioScript || ''}`;
    } else if (mode === 'exam') {
      speech = `Starting Exam Revision for ${item.title}. Be ready to state time complexity and boundary edge cases. Always state the governing equations clearly.`;
    } else {
      speech = `Question Mode for ${item.title}: In your own words, what is the main purpose of this STEM concept? Say your answer now.`;
      this.isAwaitingAnswer = true;
      this.activeQuestion = "Explain the main purpose of this concept.";
      this.expectedAnswer = item.purpose || item.topic;
    }

    if (window.SoundSightTTS) {
      window.SoundSightTTS.speak(speech);
    }
  }

  /**
   * Evaluates student's verbal answer in Question Mode
   */
  async submitStudentAnswer(studentAnswer) {
    if (!this.isAwaitingAnswer || !studentAnswer) return;
    this.isAwaitingAnswer = false;

    console.log('[Revision] Submitting student voice answer:', studentAnswer);

    try {
      const resp = await fetch('/api/revise/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: this.activeQuestion,
          expectedAnswer: this.expectedAnswer,
          studentAnswer: studentAnswer
        })
      });

      if (resp.ok) {
        const data = await resp.json();
        if (data.success && data.evaluation) {
          const evalResult = data.evaluation;
          this.renderEvaluationFeedback(evalResult, studentAnswer);
          if (window.SoundSightTTS && evalResult.audioScript) {
            window.SoundSightTTS.speak(evalResult.audioScript);
          }
          return;
        }
      }
    } catch (e) {
      console.warn('[Revision] Evaluation server error:', e);
    }

    // Local evaluation fallback
    const fb = `Good effort! Your response was: “${studentAnswer}”. The ideal concept to keep in mind is: ${this.expectedAnswer}`;
    if (window.SoundSightTTS) {
      window.SoundSightTTS.speak(fb);
    }
  }

  renderRevisionData(revData) {
    const container = document.getElementById('revisionContentDisplay');
    if (!container) return;

    let html = `
      <div class="revision-mode-badge">${revData.mode}</div>
      <h2 class="revision-topic-title">${revData.title}</h2>
    `;

    if (revData.mode === 'Quick Revision') {
      html += `
        <div class="revision-section">
          <h3>Topic Overview</h3>
          <p>${revData.overview || ''}</p>
        </div>
        <div class="revision-section">
          <h3>Key Points</h3>
          <ul>${(revData.keyPoints || []).map(p => `<li>${p}</li>`).join('')}</ul>
        </div>
        <div class="revision-section">
          <h3>Common Mistakes</h3>
          <ul>${(revData.commonMistakes || []).map(m => `<li class="text-warning">${m}</li>`).join('')}</ul>
        </div>
      `;
    } else if (revData.mode === 'Exam Revision') {
      html += `
        <div class="revision-section">
          <h3>High-Yield Exam Strategy</h3>
          <ul>${(revData.examTips || []).map(t => `<li>${t}</li>`).join('')}</ul>
        </div>
      `;
    } else if (revData.mode === 'Question Mode') {
      html += `
        <div class="revision-question-card">
          <span class="question-label">CONCEPT QUESTION:</span>
          <p class="question-text">${revData.question}</p>
          <p class="question-hint">Speak your answer into the microphone. SoundSight will evaluate your conceptual understanding.</p>
        </div>
        <div id="studentAnswerFeedback" class="student-feedback-box hidden"></div>
      `;
    } else {
      html += `
        <div class="revision-section">
          <h3>Detailed Conceptual Review</h3>
          <p>${this.currentRevisionItem.purpose || ''}</p>
          <ul>${(this.currentRevisionItem.keyPoints || []).map(p => `<li>${p}</li>`).join('')}</ul>
        </div>
      `;
    }

    container.innerHTML = html;
  }

  renderEvaluationFeedback(evalResult, studentAnswer) {
    const box = document.getElementById('studentAnswerFeedback');
    if (!box) return;

    box.classList.remove('hidden');
    box.innerHTML = `
      <div class="evaluation-score">Evaluation Score: ${evalResult.score}%</div>
      <p><strong>Your Spoken Answer:</strong> “${studentAnswer}”</p>
      <p class="evaluation-feedback-text"><strong>Tutor Feedback:</strong> ${evalResult.feedback}</p>
    `;
  }
}

window.SoundSightRevisionManager = new SoundSightRevisionManager();
