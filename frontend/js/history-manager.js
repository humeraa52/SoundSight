/**
 * ============================================================
 * SoundSight Learning History Manager
 * ============================================================
 * - Server history persistence (+ compact localStorage backup)
 * - Voice history retrieval: "History", "Open item one",
 *   "Open System Architecture" (fuzzy matching)
 * - Non-STEM / error results are never saved
 *
 * Large Base64 image data is NEVER stored in localStorage.
 * ============================================================
 */

class SoundSightHistoryManager {

  constructor() {
    this.items = [];
    this.onHistoryUpdated = null;
    this.isLoading = false;

    this.loadHistory();
  }


  /* ==========================================================
     LOAD HISTORY
     ========================================================== */

  async loadHistory() {

    if (this.isLoading) {
      return this.items;
    }

    this.isLoading = true;

    try {

      const response = await fetch('/api/history', {
        method: 'GET',
        cache: 'no-store'
      });

      if (response.ok) {

        const data = await response.json();

        if (data && data.success && Array.isArray(data.items) && data.items.length > 0) {

          this.items = data.items;

          console.log(
            `[History] Loaded ${this.items.length} items from backend`
          );

          this.notifyHistoryUpdated();
          this.saveCompactLocalHistory();

          this.isLoading = false;

          return this.items;
        }
      }

    } catch (error) {

      console.warn('[History] Backend history unavailable:', error);
    }

    /* ---------- localStorage fallback ---------- */

    try {

      const local = localStorage.getItem('soundsight_history');

      if (local) {

        const parsed = JSON.parse(local);

        this.items = Array.isArray(parsed)
          ? parsed.filter((item) => item && item.contentType !== 'None')
          : [];

        console.log(
          `[History] Loaded ${this.items.length} items from localStorage`
        );

      } else {

        this.items = [];
      }

    } catch (error) {

      console.warn('[History] Local history could not be loaded:', error);

      this.items = [];
    }

    this.notifyHistoryUpdated();

    this.isLoading = false;

    return this.items;
  }


  notifyHistoryUpdated() {

    if (typeof this.onHistoryUpdated === 'function') {

      try {
        this.onHistoryUpdated(this.items);
      } catch (error) {
        console.warn('[History] UI update callback failed:', error);
      }
    }
  }


  /* ==========================================================
     COMPACT LOCAL BACKUP (no images)
     ========================================================== */

  createCompactItem(item) {

    if (!item) {
      return null;
    }

    return {

      id:
        item.id ||
        item._id ||
        `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,

      title: item.title || this.autoGenerateTitle(item),
      topic: item.topic || '',
      contentType: item.contentType || item.type || 'Document',
      language: item.language || '',

      summary: item.summary || '',
      purpose: item.purpose || '',
      overallLogic: item.overallLogic || '',
      explanation: item.explanation || '',
      audioScript: item.audioScript || '',

      keyPoints: Array.isArray(item.keyPoints)
        ? item.keyPoints.slice(0, 30)
        : [],

      lineByLine: Array.isArray(item.lineByLine)
        ? item.lineByLine.slice(0, 60)
        : [],

      structuralFlow: Array.isArray(item.structuralFlow)
        ? item.structuralFlow.slice(0, 40)
        : [],

      components: Array.isArray(item.components)
        ? item.components.slice(0, 40)
        : [],

      symbols: Array.isArray(item.symbols)
        ? item.symbols.slice(0, 40)
        : [],

      spatialLayout: item.spatialLayout || '',
      latex: item.latex || '',
      spokenMath: item.spokenMath || '',
      significance: item.significance || '',
      graphAnalysis: item.graphAnalysis || null,

      confidence: item.confidence ?? null,
      certainty: item.certainty || null,

      ocrText: item.ocrText || '',
      rawText: item.rawText || '',

      timestamp: item.timestamp || new Date().toISOString(),
      scannedAt: item.scannedAt || item.timestamp || new Date().toISOString(),

      metadata: item.metadata || item.meta || null
    };
  }


  saveCompactLocalHistory() {

    try {

      const compactItems = this.items.map(
        (item) => this.createCompactItem(item)
      );

      localStorage.setItem(
        'soundsight_history',
        JSON.stringify(compactItems)
      );

      console.log(
        `[History] Compact local backup saved: ${compactItems.length} items`
      );

      return true;

    } catch (error) {

      console.warn('[History] Local history backup skipped:', error);

      try {

        const smaller = this.items
          .slice(0, 5)
          .map((item) => this.createCompactItem(item));

        localStorage.setItem(
          'soundsight_history',
          JSON.stringify(smaller)
        );

        console.warn('[History] Saved reduced five-item local backup');

        return true;

      } catch (secondError) {

        console.error('[History] Unable to save local history:', secondError);

        return false;
      }
    }
  }


  /* ==========================================================
     SAVE HISTORY ITEM
     ========================================================== */

  async saveItem(item) {

    if (!item) {
      console.warn('[History] Cannot save empty item');
      return null;
    }

    /* Only genuine STEM content is ever saved. */
    if (item.contentType === 'None' || item.isError) {
      console.log('[History] Skipped saving non-STEM or error result');
      return null;
    }

    const itemToSave = { ...item };

    if (!itemToSave.title || itemToSave.title === 'STEM Learning Item') {
      itemToSave.title = this.autoGenerateTitle(itemToSave);
    }

    itemToSave.timestamp =
      itemToSave.timestamp || new Date().toISOString();

    /* ---------- backend save ---------- */

    try {

      const response = await fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(itemToSave)
      });

      if (response.ok) {

        const data = await response.json();

        if (data && data.success && data.item) {

          const savedItem = data.item;

          const savedId = savedItem.id || savedItem._id;

          if (savedId) {
            this.items = this.items.filter(
              (existing) => (existing.id || existing._id) !== savedId
            );
          }

          this.items.unshift(savedItem);

          this.saveCompactLocalHistory();
          this.notifyHistoryUpdated();

          console.log('[History] Item saved successfully');

          return savedItem;
        }
      }

    } catch (error) {

      console.warn(
        '[History] Backend save failed, using local fallback:',
        error
      );
    }

    /* ---------- local fallback ---------- */

    const localItem = this.createCompactItem(itemToSave);

    if (!localItem) {
      return null;
    }

    this.items.unshift(localItem);

    this.items = this.items.slice(0, 50);

    this.saveCompactLocalHistory();
    this.notifyHistoryUpdated();

    console.log('[History] Item saved to local fallback');

    return localItem;
  }


  /* ==========================================================
     AUTO TITLE
     ========================================================== */

  autoGenerateTitle(item) {

    if (item && item.title && item.title !== 'STEM Learning Item') {
      return item.title;
    }

    if (item && item.topic) {
      return item.topic;
    }

    const contentType =
      item && item.contentType ? item.contentType : 'Document';

    const text = (
      (item && (item.ocrText || item.rawText || '')) || ''
    ).toLowerCase();

    if (text.includes('round robin')) {
      return 'Round Robin CPU Scheduling';
    }

    if (text.includes('binary search')) {
      return 'Binary Search Flowchart';
    }

    if (text.includes('quadratic')) {
      return 'Quadratic Formula and Root Equation';
    }

    if (text.includes('bubble sort')) {
      return 'Python Bubble Sort Algorithm';
    }

    if (text.includes('ohm')) {
      return "Ohm's Law Series Circuit";
    }

    return `STEM ${contentType} - ${new Date().toLocaleDateString()}`;
  }


  /* ==========================================================
     TEXT HELPERS
     ========================================================== */

  normalizeText(value) {

    return String(value || '')
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }


  extractTopicFromCommand(commandText) {

    let text = this.normalizeText(commandText);

    const prefixes = [
      'open item',
      'open the item',
      'open topic',
      'open the topic',
      'open',
      'show item',
      'show topic',
      'show',
      'select item',
      'select topic',
      'select'
    ];

    prefixes.sort((a, b) => b.length - a.length);

    for (const prefix of prefixes) {

      if (text === prefix) {
        return '';
      }

      if (text.startsWith(prefix + ' ')) {
        text = text.slice(prefix.length).trim();
        break;
      }
    }

    return text;
  }


  getNumericIndex(commandText) {

    const text = this.normalizeText(commandText);

    const numberMap = {
      one: 0, first: 0, '1': 0,
      two: 1, second: 1, '2': 1,
      three: 2, third: 2, '3': 2,
      four: 3, fourth: 3, '4': 3,
      five: 4, fifth: 4, '5': 4,
      six: 5, sixth: 5, '6': 5,
      seven: 6, seventh: 6, '7': 6,
      eight: 7, eighth: 7, '8': 7,
      nine: 8, ninth: 8, '9': 8,
      ten: 9, tenth: 9, '10': 9
    };

    const patterns = [
      /^open item (.+)$/,
      /^open the item (.+)$/,
      /^item (.+)$/,
      /^show item (.+)$/,
      /^select item (.+)$/,
      /^open (.+)$/
    ];

    let candidate = null;

    for (const pattern of patterns) {

      const match = text.match(pattern);

      if (match) {
        candidate = match[1].trim();
        break;
      }
    }

    if (!candidate) {
      return -1;
    }

    if (Object.prototype.hasOwnProperty.call(numberMap, candidate)) {
      return numberMap[candidate];
    }

    return -1;
  }


  /* ==========================================================
     FUZZY MATCHING (voice-friendly)
     ========================================================== */

  collapse(value) {
    return this.normalizeText(value).replace(/\s+/g, '');
  }

  similarity(a, b) {

    if (!a || !b) {
      return 0;
    }

    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);

    for (let i = 1; i <= a.length; i++) {

      const cur = [i];

      for (let j = 1; j <= b.length; j++) {

        cur[j] = Math.min(
          prev[j] + 1,
          cur[j - 1] + 1,
          prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }

      prev = cur;
    }

    return 1 - prev[b.length] / Math.max(a.length, b.length);
  }

  scoreItem(query, item) {

    const q = this.collapse(query);

    if (!q) {
      return 0;
    }

    let best = 0;

    [item.title, item.topic].forEach((field) => {

      const f = this.collapse(field);

      if (!f) {
        return;
      }

      if (f === q) {
        best = Math.max(best, 1);
      } else if (f.includes(q) || q.includes(f)) {
        best = Math.max(best, 0.9);
      } else {
        best = Math.max(best, this.similarity(q, f));
      }

      const fTokens = this.normalizeText(field)
        .split(' ')
        .filter((w) => w.length > 2);

      const qTokens = new Set(this.normalizeText(query).split(' '));

      if (fTokens.length) {
        const shared = fTokens.filter((w) => qTokens.has(w)).length;
        best = Math.max(best, shared / fTokens.length);
      }
    });

    return best;
  }

  /* Returns [{ index, score }], best match first. */
  findMatches(query) {

    return this.items
      .map((item, index) => ({
        index,
        score: this.scoreItem(query, item)
      }))
      .filter((m) => m.score >= 0.65)
      .sort((a, b) => b.score - a.score);
  }


  /* ==========================================================
     ANNOUNCE HISTORY
     ========================================================== */

  announceHistory() {

    const count = this.items.length;

    if (count === 0) {

      window.SoundSightTTS?.speak(
        'You have no saved learning items yet. ' +
        'Say Scan to scan your first STEM document.'
      );

      return;
    }

    const numberWords = [
      'one', 'two', 'three', 'four', 'five',
      'six', 'seven', 'eight', 'nine', 'ten'
    ];

    let speech =
      `You have ${count} saved learning topic${count === 1 ? '' : 's'}. `;

    const previewCount = Math.min(count, 5);

    for (let i = 0; i < previewCount; i++) {

      const item = this.items[i];

      const title =
        item.title || item.topic || this.autoGenerateTitle(item);

      speech += `Item ${numberWords[i] || String(i + 1)}: ${title}. `;
    }

    if (count > previewCount) {
      speech += `There are ${count - previewCount} more saved topics. `;
    }

    speech +=
      'You can say Open item one, or Open followed by the topic name.';

    window.SoundSightTTS?.speak(speech);
  }


  /* ==========================================================
     OPEN ITEM BY VOICE
     ========================================================== */

  openItemByVoice(commandText) {

    if (!commandText) {

      window.SoundSightTTS?.speak(
        'Please say the item number or topic name you want to open.'
      );

      return null;
    }

    const originalCommand = String(commandText);

    console.log('[History] Voice open request:', originalCommand);

    /* 1. Item number: "open item two" */

    const numericIndex = this.getNumericIndex(originalCommand);

    if (numericIndex >= 0) {

      if (numericIndex < this.items.length) {
        return this.openHistoryItem(
          numericIndex,
          `item ${numericIndex + 1}`
        );
      }

      window.SoundSightTTS?.speak(
        `I could not find that item. You have ${this.items.length} ` +
        `saved topic${this.items.length === 1 ? '' : 's'}.`
      );

      return null;
    }

    /* 2. Topic name (fuzzy) */

    const topicQuery = this.extractTopicFromCommand(originalCommand);

    if (!topicQuery) {

      window.SoundSightTTS?.speak(
        'Please say an item number or a topic name. ' +
        'For example, Open item two or Open System Architecture.'
      );

      return null;
    }

    const found = this.findMatches(topicQuery);

    if (found.length) {

      const top = found[0];

      const close = found.filter((m) => top.score - m.score < 0.08);

      if (close.length === 1) {
        return this.openHistoryItem(top.index, 'that topic');
      }

      let message = 'I found more than one matching topic. ';

      close.slice(0, 3).forEach((m, i) => {

        const it = this.items[m.index];

        message +=
          `Option ${i + 1}: ${it.title || it.topic || `Item ${m.index + 1}`}. `;
      });

      message += 'Please say the item number, for example Open item one.';

      window.SoundSightTTS?.speak(message);

      return null;
    }

    /* 3. Nothing found */

    window.SoundSightTTS?.speak(
      `I could not find a saved topic matching ${topicQuery}. ` +
      'Say History to hear your saved topics.'
    );

    return null;
  }


  /* ==========================================================
     OPEN ITEM BY INDEX
     ========================================================== */

  openItem(index) {

    const numericIndex = Number(index);

    if (!Number.isInteger(numericIndex)) {
      console.warn('[History] Invalid item index:', index);
      return null;
    }

    return this.openHistoryItem(numericIndex, `item ${numericIndex + 1}`);
  }


  /* ==========================================================
     OPEN HISTORY ITEM
     ========================================================== */

  openHistoryItem(index, referenceText = 'item') {

    const numericIndex = Number(index);

    if (
      !Number.isInteger(numericIndex) ||
      numericIndex < 0 ||
      numericIndex >= this.items.length
    ) {

      console.warn('[History] Invalid history item:', index);

      window.SoundSightTTS?.speak('That history item is not available.');

      return null;
    }

    const item = this.items[numericIndex];

    if (!item) {
      return null;
    }

    console.log(
      '[History] Opening item:',
      numericIndex,
      item.title || item.topic
    );

    let displayed = false;

    const app = window.SoundSightApp;

    if (app) {

      /*
       * Preferred: app.openHistoryItem(index) marks the item as the
       * selected History item (so Ask AI uses the "history" source)
       * and speaks the "Opened ..." confirmation itself.
       */
      if (typeof app.openHistoryItem === 'function') {

        try {
          app.openHistoryItem(numericIndex);
          displayed = true;
        } catch (error) {
          console.error('[History] App openHistoryItem failed:', error);
        }
      }

      if (!displayed && typeof app.displayExplanation === 'function') {

        try {
          app.displayExplanation(item);
          displayed = true;
        } catch (error) {
          console.error('[History] displayExplanation failed:', error);
        }
      }
    }

    if (!displayed) {

      console.warn(
        '[History] History item was found, but app.js has no compatible display method.'
      );
    }

    /* app.openHistoryItem already spoke; only speak as a fallback. */
    if (!displayed || !app || typeof app.openHistoryItem !== 'function') {

      const title = item.title || item.topic || 'saved topic';

      window.SoundSightTTS?.speak(
        `Opened ${referenceText}: ${title}. ` +
        'Say Explain to hear the explanation, or Revise to review.'
      );
    }

    return item;
  }


  getItem(index) {

    const numericIndex = Number(index);

    if (!Number.isInteger(numericIndex)) {
      return null;
    }

    return this.items[numericIndex] || null;
  }


  clearLocalBackup() {

    try {

      localStorage.removeItem('soundsight_history');

      console.log('[History] Local history backup cleared');

      return true;

    } catch (error) {

      console.warn('[History] Could not clear local history:', error);

      return false;
    }
  }
}


/* ============================================================
   GLOBAL INSTANCE
   ============================================================ */

window.SoundSightHistoryManager = new SoundSightHistoryManager();

console.log('[HISTORY] SoundSight History Manager loaded');