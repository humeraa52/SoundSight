/**
 * SoundSight Learning History Manager
 * Automatically persists scanned/uploaded STEM items and handles verbal retrieval.
 */

class SoundSightHistoryManager {
  constructor() {
    this.items = [];
    this.onHistoryUpdated = null;
    this.loadHistory();
  }

  async loadHistory() {
    try {
      const resp = await fetch('/api/history');
      if (resp.ok) {
        const data = await resp.json();
        if (data.success && Array.isArray(data.items)) {
          this.items = data.items;
          if (this.onHistoryUpdated) this.onHistoryUpdated(this.items);
          return this.items;
        }
      }
    } catch (err) {
      console.warn('[History] Failed to fetch server history, loading from localStorage:', err);
    }

    // Fallback to local storage
    const local = localStorage.getItem('soundsight_history');
    if (local) {
      try {
        this.items = JSON.parse(local);
      } catch (e) {
        this.items = [];
      }
    }
    if (this.onHistoryUpdated) this.onHistoryUpdated(this.items);
    return this.items;
  }

  async saveItem(item) {
    if (!item.title) {
      item.title = this.autoGenerateTitle(item);
    }
    item.timestamp = item.timestamp || new Date().toISOString();

    try {
      const resp = await fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item)
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.success && data.item) {
          this.items.unshift(data.item);
          localStorage.setItem('soundsight_history', JSON.stringify(this.items));
          if (this.onHistoryUpdated) this.onHistoryUpdated(this.items);
          return data.item;
        }
      }
    } catch (err) {
      console.warn('[History] Backend save failed, saving locally:', err);
    }

    // Local save fallback
    this.items.unshift(item);
    localStorage.setItem('soundsight_history', JSON.stringify(this.items));
    if (this.onHistoryUpdated) this.onHistoryUpdated(this.items);
    return item;
  }

  autoGenerateTitle(item) {
    if (item.title && item.title !== "STEM Learning Item") return item.title;
    if (item.topic) return item.topic;
    
    const cType = item.contentType || "Document";
    const text = (item.ocrText || "").toLowerCase();
    
    if (text.includes("round robin")) return "Round Robin CPU Scheduling";
    if (text.includes("binary search")) return "Binary Search Flowchart";
    if (text.includes("quadratic")) return "Quadratic Formula and Root Equation";
    if (text.includes("bubble sort")) return "Python Bubble Sort Algorithm";
    if (text.includes("ohm")) return "Ohm's Law Series Circuit";

    return `STEM ${cType} - ${new Date().toLocaleDateString()}`;
  }

  /**
   * Verbally lists history items when user says "History"
   */
  announceHistory() {
    const count = this.items.length;
    if (count === 0) {
      const msg = "You have no saved learning items yet. Say Scan to scan your first STEM document.";
      if (window.SoundSightTTS) window.SoundSightTTS.speak(msg);
      return;
    }

    let speech = `You have ${count} saved learning items. `;
    const previewCount = Math.min(count, 5);
    for (let i = 0; i < previewCount; i++) {
      const numWords = ["one", "two", "three", "four", "five"];
      speech += `Item ${numWords[i] || (i + 1)}: ${this.items[i].title}. `;
    }

    if (count > previewCount) {
      speech += `And ${count - previewCount} more. `;
    }

    speech += "You can say: Open item one, or Revise followed by a topic.";
    if (window.SoundSightTTS) {
      window.SoundSightTTS.speak(speech);
    }
  }

  /**
   * Opens an item by verbal index (e.g. "open item one" or "item 2")
   */
  openItemByVoice(commandText) {
    const wordsToNum = {
      'one': 0, '1': 0, 'first': 0,
      'two': 1, '2': 1, 'second': 1,
      'three': 2, '3': 2, 'third': 2,
      'four': 3, '4': 3, 'fourth': 3,
      'five': 4, '5': 4, 'fifth': 4,
      'six': 5, '6': 5, 'sixth': 5,
      'seven': 6, '7': 6, 'seventh': 6,
      'eight': 7, '8': 7, 'eighth': 7
    };

    const lower = commandText.toLowerCase();
    let index = -1;

    for (const [word, idx] of Object.entries(wordsToNum)) {
      if (lower.includes(word)) {
        index = idx;
        break;
      }
    }

    if (index >= 0 && index < this.items.length) {
      const item = this.items[index];
      if (window.SoundSightApp) {
        window.SoundSightApp.displayExplanation(item);
      }
      if (window.SoundSightTTS) {
        window.SoundSightTTS.speak(`Opened item ${index + 1}: ${item.title}. Say Explain to hear the explanation, or Revise to review.`);
      }
      return item;
    } else {
      if (window.SoundSightTTS) {
        window.SoundSightTTS.speak(`I could not find that item number. You have ${this.items.length} items.`);
      }
      return null;
    }
  }
}

window.SoundSightHistoryManager = new SoundSightHistoryManager();
