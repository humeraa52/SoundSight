"""
SoundSight Application Server
Serves the accessible frontend and handles STEM AI analysis, revision flows,
file extraction, and the Ask AI assistant.

History:
  PER_USER_HISTORY = True  -> history lives in each user's own browser
                              (localStorage). The server stores none.
  PER_USER_HISTORY = False -> old behaviour: shared history.json on the server.

Ask AI rules (enforced in /api/ai-chat):
  - source "standalone": general-purpose assistant. NO scan/upload/history/
    revision context is ever used, even if the client sends some.
  - source "scanner" | "upload" | "history" | "revision": ONLY the context
    sent in that request is used.
  - Each chat is stored separately (source + context fingerprint).
  - Gemini first; the configured backup AI is used if Gemini fails.

Optional environment variables for the backup AI (OpenAI-compatible API):
  BACKUP_AI_URL, BACKUP_AI_KEY, BACKUP_AI_MODEL
"""

import os
import sys
import json
import uuid
import hashlib
import io
import re
import base64
import mimetypes
import tempfile
from datetime import datetime
from PIL import Image
from flask import Flask, request, jsonify, send_from_directory

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

# Load keys from the project's .env file (if present).
# Variables already set in the environment take priority over .env.
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(BASE_DIR, "..", ".env"))
except ImportError:
    print("[SoundSight] python-dotenv is not installed. Using system environment only.")

from stem_engine import StemEngine

FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "frontend"))
DATA_FILE = os.path.join(BASE_DIR, "data", "history.json")
AI_CHATS_FILE = os.path.join(BASE_DIR, "data", "ai_chats.json")

# True: each visitor's history stays in their own browser (use this online).
# False: shared history.json on the server (old local behaviour).
PER_USER_HISTORY = True

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")
stem_engine = StemEngine()


# ============================================================
# HISTORY STORAGE (only used when PER_USER_HISTORY is False)
# ============================================================

def load_history():
    if not os.path.exists(DATA_FILE):
        return []
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"[SoundSight] Error loading history: {e}")
        return []


def save_history(data):
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _is_real_stem(item):
    title = (item.get("title") or "").strip().lower()
    topic = (item.get("topic") or "").strip().lower()

    if item.get("contentType") in (None, "", "None", "Unknown"):
        return False
    if item.get("isError"):
        return False
    if title in ("no stem content detected", "not stem content"):
        return False
    # Default topic of the old poster bug; real scans never use it now.
    if topic in ("non-stem content", "academic stem concepts"):
        return False
    return True


# ============================================================
# ASK AI CHAT STORAGE
# ============================================================

def load_ai_chats():
    if not os.path.exists(AI_CHATS_FILE):
        return []

    try:
        with open(AI_CHATS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)

        return data if isinstance(data, list) else []

    except Exception as e:
        print(f"[SoundSight] Error loading AI chats: {e}")
        return []


def save_ai_chats(chats):
    os.makedirs(os.path.dirname(AI_CHATS_FILE), exist_ok=True)

    with open(AI_CHATS_FILE, "w", encoding="utf-8") as f:
        json.dump(chats, f, indent=2, ensure_ascii=False)


def build_ai_history_context(messages):
    context = []

    for message in messages[-20:]:

        role = message.get("role", "user")

        content = (message.get("content") or "").strip()

        if not content:
            continue

        speaker = "SoundSight AI" if role == "assistant" else "Student"

        context.append(f"{speaker}: {content}")

    return "\n".join(context)


def create_ai_chat(mode="standalone", context_key=""):
    now = datetime.now().isoformat()

    return {
        "id": f"chat_{uuid.uuid4().hex[:12]}",
        "title": "New Study Conversation",
        "topic": "",
        "mode": mode,                 # the Ask AI source
        "contextKey": context_key,
        "createdAt": now,
        "updatedAt": now,
        "messages": []
    }


def generate_ai_title(message):
    clean = " ".join((message or "").strip().split())

    if not clean:
        return "New Study Conversation"

    words = clean.split()

    title = " ".join(words[:7])

    if len(words) > 7:
        title += "..."

    return title.capitalize()


# ============================================================
# ASK AI: CONTEXT HANDLING
# ============================================================

ASK_AI_SOURCES = {
    "standalone",
    "scanner",
    "upload",
    "history",
    "revision"
}

MAX_QUESTION_CHARS = 2000
MAX_CONTEXT_CHARS = 18000

# Only these study-content fields are ever read from a context.
# Images (imageData) and anything else are ignored on purpose.
CONTEXT_FIELDS = [
    "title", "topic", "contentType", "language",
    "purpose", "summary", "overallLogic", "keyPoints",
    "lineByLine", "structuralFlow", "components", "spatialLayout",
    "symbols", "latex", "spokenMath", "significance",
    "graphAnalysis", "errors", "functions", "variables",
    "conditions", "loops", "imports", "ocrText", "audioScript",
    # revision material
    "mode", "overview", "details", "question",
    "expectedAnswer", "examTips", "commonMistakes"
]


def _shrink(value, depth=0):
    """Recursively limit string and list sizes."""
    if isinstance(value, str):
        return value[:6000]

    if isinstance(value, (int, float, bool)) or value is None:
        return value

    if isinstance(value, list):
        return [_shrink(v, depth + 1) for v in value[:60]]

    if isinstance(value, dict) and depth < 3:
        return {
            str(k)[:60]: _shrink(v, depth + 1)
            for k, v in list(value.items())[:30]
        }

    return str(value)[:500]


def slim_context(context):
    """Keep only the study-content fields of an explicit context."""
    if not isinstance(context, dict):
        return {}

    slim = {}

    for field in CONTEXT_FIELDS:
        value = context.get(field)

        if value in (None, "", [], {}):
            continue

        slim[field] = _shrink(value)

    return slim


def context_fingerprint(source, slim):
    canonical = json.dumps(
        {"source": source, "context": slim},
        ensure_ascii=False,
        sort_keys=True
    )

    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def plain_text(answer):
    """Remove markdown that text-to-speech would read aloud."""
    text = str(answer or "")
    text = re.sub(r"```.*?```", " ", text, flags=re.S)
    text = re.sub(r"[*`#>]+", "", text)
    text = re.sub(r"^\s*[-•]\s+", "", text, flags=re.M)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# ============================================================
# ASK AI: PROMPTS
# ============================================================

ASK_AI_BASE_PROMPT = """
You are SoundSight AI, a fast, voice-first STEM study companion
for blind and visually impaired students.

Your goal is to give clear, useful answers that are easy to listen to.

RESPONSE STYLE:
- Answer the student's actual question directly.
- Use simple, natural, student-friendly language.
- Keep NORMAL answers short, focused, and COMPLETE.
- Do not make normal answers unnecessarily long.
- Do not apply the short-answer style when the student explicitly
  requests a detailed, step-by-step, long, or 10-mark answer.
- When the student requests more detail, substantially increase the
  depth and useful information instead of simply repeating or
  rephrasing the short answer.
- Do not add unnecessary introductions, greetings, conclusions,
  or repetition.
- Do not repeat information the student already knows from the
  conversation.
- Prefer short, natural sentences that are easy to understand when
  spoken aloud.
- Explain technical words briefly when needed.
- Use examples when they make the concept easier to understand.
- If a simple answer is enough, stop after the answer is complete.

FOLLOW-UP CONVERSATION:
- Remember the previous conversation.
- Understand follow-up questions such as "why?", "how?",
  "explain that", "give another example", "continue", "tell me more".
- Treat follow-up questions as part of the same conversation.
- If the student says "the same", "same topic", "above topic", or
  similar, use the immediately relevant topic from the conversation.
- If the student asks to change only the answer format or depth,
  keep the original topic and change only the requested format,
  depth, or length.

ANSWER LENGTH:
- NORMAL QUESTION: a concise but complete answer, about 2 to 5 short
  paragraphs. Never cut a sentence or thought in half.
- DETAILED REQUEST ("explain in detail", "tell me more", "step by
  step", "go deeper", "elaborate"): a genuinely detailed, organized
  explanation with examples, important terms, working, advantages,
  limitations or applications when relevant.
- EXAM / 10-MARK REQUEST: a complete exam-oriented answer with a
  definition or introduction, organized main explanation, important
  steps or formulas, an example or application, advantages and
  limitations when relevant, and a short conclusion.
- Match depth and structure to the student's explicit request, such
  as an exact number of points. Do not make every answer long.

RESPONSE COMPLETENESS:
- Every response must be complete before it is returned.
- Never stop in the middle of a sentence or return a fragment.
- Always finish the sentence being written and make sure the
  student's actual question has been answered.

STEM CONTENT:
- For calculations, show the necessary steps.
- For formulas, explain what the important symbols mean.
- For code, explain the relevant part clearly.
- For diagrams and flowcharts, describe the structure and sequence.

VOICE OUTPUT:
- Return normal natural-language text. Do not output JSON.
- Do not use markdown symbols such as asterisks, hash signs or
  code fences. For lists, say "First", "Second", "Third" or use
  numbered sentences.
- Spell out math in words when possible.
"""

ASK_AI_STANDALONE_RULES = """
MODE: STANDALONE (general assistant)
- Behave like a general-purpose AI assistant. Answer whatever the
  student asks: STEM questions, study help, concepts, and general
  questions.
- Use ONLY the student's current message and the conversation below.
- You have NO access to the student's scans, uploads, saved history,
  or revision sessions. Never claim to know or remember them. If the
  student asks about one, say they can open Ask AI from that section.
"""

ASK_AI_SOURCE_LABEL = {
    "scanner": "the content the student just scanned",
    "upload": "the file the student just uploaded",
    "history": "the saved history item the student opened",
    "revision": "the revision topic the student is studying",
}

ASK_AI_CONTEXT_RULES = """
MODE: SECTION POPUP
- The student opened Ask AI from one specific page and is asking about
  {label}.
- The CURRENT CONTENT below is the ONLY study material you may use.
  Do not use or mention any other scan, upload, history item or
  revision session.
- Explain it, simplify it, give examples, prepare exam answers or
  practice questions based on it. You may add standard textbook
  knowledge needed to explain it.
- If the question is clearly unrelated to this content, say briefly
  that this window is for the current content and that the student
  can use Ask AI from the dashboard for other questions.
- If a detail is unclear or missing in the content, say so instead of
  inventing it.
"""


def build_ask_prompt(source, message, conversation_context, study_context):
    prompt = ASK_AI_BASE_PROMPT

    if source == "standalone":
        prompt += "\n" + ASK_AI_STANDALONE_RULES
    else:
        prompt += "\n" + ASK_AI_CONTEXT_RULES.format(
            label=ASK_AI_SOURCE_LABEL.get(source, "the current content")
        )

        prompt += (
            "\nCURRENT CONTENT:\n"
            "----------------\n"
            f"{study_context}\n"
            "----------------\n"
        )

    if conversation_context:
        prompt += (
            "\nPREVIOUS CONVERSATION (this chat only):\n"
            "-------------------------\n"
            f"{conversation_context}\n"
            "-------------------------\n"
        )

    prompt += (
        "\nSTUDENT'S CURRENT MESSAGE:\n"
        "---------------------------\n"
        f"{message}\n"
        "---------------------------\n\n"
        "Answer the student directly."
    )

    return prompt


# ============================================================
# ASK AI: PROVIDERS (Gemini first, backup second)
# ============================================================

def ask_gemini(prompt):
    if not stem_engine.gemini_client:
        return {
            "success": False,
            "error": "Gemini AI is not configured. Please check GEMINI_API_KEY."
        }

    models_to_try = [
        "gemini-3.8-flash",
        "gemini-3.7-flash",
        "gemini-3.5-flash"
    ]

    last_error = None

    from google.genai import types

    for model_name in models_to_try:

        try:

            print(f"[ASK AI] Trying {model_name}...")

            def generate(max_tokens):
                return stem_engine.gemini_client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        temperature=0.4,
                        max_output_tokens=max_tokens
                    )
                )

            def finish_name(resp):
                candidates = getattr(resp, "candidates", None) or []
                reason = (
                    getattr(candidates[0], "finish_reason", None)
                    if candidates
                    else None
                )
                return getattr(
                    reason,
                    "name",
                    str(reason or "UNKNOWN")
                ).upper()

            response = generate(8192)
            finish = finish_name(response)

            print("[ASK AI] Finish reason:", finish)

            # Hit the output limit: retry once with a bigger budget.
            if "MAX_TOKENS" in finish:
                print("[ASK AI] Output limit reached. Retrying with 12288...")
                response = generate(12288)
                finish = finish_name(response)
                print("[ASK AI] Retry finish reason:", finish)

            text = (response.text or "").strip()

            print("[ASK AI] Response length:", len(text))

            if text:
                return {
                    "success": True,
                    "answer": text,
                    "model": model_name,
                    "provider": "gemini"
                }

        except Exception as e:

            last_error = e

            print(f"[ASK AI] {model_name} failed: {e}")

            err = str(e).lower()

            stop_words = [
                "api key", "api_key_invalid", "permission denied",
                "unauthenticated", "invalid api", "503", "unavailable",
                "high demand", "overloaded", "resource exhausted",
                "quota", "429", "timeout", "deadline"
            ]

            if any(word in err for word in stop_words):
                print(
                    "[ASK AI] Gemini unavailable. "
                    "Skipping remaining Gemini models."
                )
                break

            continue

    print(f"[ASK AI] All Gemini models failed: {last_error}")

    return {
        "success": False,
        "error": "Gemini is temporarily unavailable."
    }


def ask_backup_ai(prompt):
    """OpenAI-compatible backup (Groq, OpenRouter, etc.)."""
    url = os.environ.get("BACKUP_AI_URL", "").strip()
    key = os.environ.get("BACKUP_AI_KEY", "").strip()
    model = os.environ.get("BACKUP_AI_MODEL", "").strip()

    if not (url and key and model):
        return {
            "success": False,
            "error": "Backup AI is not configured."
        }

    try:
        import requests

        response = requests.post(
            url,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {key}"
            },
            json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.4,
                "max_tokens": 4096
            },
            timeout=40
        )

        if response.status_code != 200:
            raise RuntimeError(
                f"HTTP {response.status_code}: {response.text[:200]}"
            )

        data = response.json()

        text = (
            (((data.get("choices") or [{}])[0]).get("message") or {})
            .get("content") or ""
        ).strip()

        if not text:
            raise RuntimeError("empty answer")

        return {
            "success": True,
            "answer": text,
            "model": model,
            "provider": "backup"
        }

    except Exception as e:
        print(f"[ASK AI] Backup AI failed: {e}")

        return {
            "success": False,
            "error": "Backup AI failed."
        }


def get_ai_answer(prompt):
    result = ask_gemini(prompt)

    if result.get("success"):
        return result

    print("[ASK AI] Gemini failed. Trying backup AI...")

    backup = ask_backup_ai(prompt)

    if backup.get("success"):
        return backup

    return {
        "success": False,
        "error": (
            "SoundSight AI is temporarily unavailable. "
            "Please try again in a moment."
        )
    }


# ============================================================
# STATIC / HEALTH
# ============================================================

@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/<path:path>")
def static_proxy(path):
    return send_from_directory(FRONTEND_DIR, path)


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status": "healthy",
        "service": "SoundSight STEM Audio Workspace",
        "version": "1.0.0",
        "timestamp": datetime.now().isoformat()
    })


# ============================================================
# ANALYZE
# ============================================================

@app.route("/api/analyze", methods=["POST"])
def analyze_content():
    try:
        payload = request.get_json(force=True) or {}
        raw_text = (payload.get("rawText") or "").strip()
        image_data = payload.get("imageData", None)
        meta = payload.get("meta", {})

        if image_data:
            print("[PROCESS] Image received")
            try:
                b64_str = image_data.split(",", 1)[1] if "," in image_data else image_data
                raw_bytes = base64.b64decode(b64_str)
                print(f"[PROCESS] Image size: {len(raw_bytes)} bytes")
                img = Image.open(io.BytesIO(raw_bytes))
                print(f"[PROCESS] Image decoded successfully: {img.width}x{img.height}")
                print("[PROCESS] Running image preprocessing")
            except Exception as dec_err:
                print(f"[PROCESS] Image decoding notice: {dec_err}")

        print(f"[PROCESS] Running OCR: text length {len(raw_text)}")
        print(f"[PROCESS] OCR result length: {len(raw_text)}")

        result = stem_engine.analyze(raw_text, image_data=image_data, meta=meta)

        c_type = result.get("contentType", "Text")
        if result.get("isError"):
            c_type = "Unreadable/Error"
        print(f"[PROCESS] Detected content type: {c_type}")

        # If image data provided, attach to result
        if image_data:
            result["imageData"] = image_data

        return jsonify({"success": True, "result": result})
    except Exception as e:
        print(f"[SoundSight] Analysis error: {e}")
        return jsonify({
            "success": False,
            "error": "I could not complete the explanation. Please try again.",
            "detail": str(e)
        }), 500


# ============================================================
# HISTORY API
# With PER_USER_HISTORY the server keeps nothing: every browser keeps
# its own history in localStorage (see history-manager.js).
# ============================================================

@app.route("/api/history", methods=["GET"])
def get_history():
    if PER_USER_HISTORY:
        return jsonify({"success": True, "items": [], "count": 0})

    items = [i for i in load_history() if _is_real_stem(i)]
    return jsonify({"success": True, "items": items, "count": len(items)})


@app.route("/api/history", methods=["POST"])
def add_history_item():
    try:
        payload = request.get_json(force=True) or {}
        if payload.get("contentType") == "None" or payload.get("isError"):
            return jsonify({
                "success": False,
                "error": "Only STEM content is saved."
            }), 400

        # Per-user mode: never store anything on the server.
        if PER_USER_HISTORY:
            payload.pop("imageData", None)
            payload.setdefault("id", f"item_{uuid.uuid4().hex[:8]}")
            payload.setdefault("timestamp", datetime.now().isoformat())
            return jsonify({"success": True, "item": payload})

        items = [i for i in load_history() if i.get("contentType") != "None"]

        new_item = {
            "id": payload.get("id") or f"item_{uuid.uuid4().hex[:8]}",
            "title": payload.get("title", "STEM Learning Item"),
            "topic": payload.get("topic", "General STEM"),
            "contentType": payload.get("contentType", "Text"),
            "timestamp": payload.get("timestamp") or datetime.now().isoformat(),
            "confidence": payload.get("confidence", 0.95),
            "isPartiallyUnclear": payload.get("isPartiallyUnclear", False),
            "purpose": payload.get("purpose", ""),
            "keyPoints": payload.get("keyPoints", []),
            "ocrText": payload.get("ocrText", ""),
            "audioScript": payload.get("audioScript", ""),
            "certainty": payload.get("certainty", {"isClear": True, "certain": [], "uncertain": [], "missing": []}),
            "imageData": payload.get("imageData", ""),

            # Structural fields, so flowcharts, diagrams, formulas and
            # code keep their structure when reopened from History.
            "language": payload.get("language", ""),
            "summary": payload.get("summary", ""),
            "overallLogic": payload.get("overallLogic", ""),
            "lineByLine": payload.get("lineByLine", []),
            "structuralFlow": payload.get("structuralFlow", []),
            "components": payload.get("components", []),
            "spatialLayout": payload.get("spatialLayout", ""),
            "symbols": payload.get("symbols", []),
            "latex": payload.get("latex", ""),
            "spokenMath": payload.get("spokenMath", ""),
            "significance": payload.get("significance", ""),
            "graphAnalysis": payload.get("graphAnalysis", {}),
            "functions": payload.get("functions", []),
            "variables": payload.get("variables", []),
            "conditions": payload.get("conditions", []),
            "loops": payload.get("loops", []),
            "imports": payload.get("imports", []),
            "errors": payload.get("errors", [])
        }

        # Place new item at top
        items.insert(0, new_item)
        save_history(items)
        return jsonify({"success": True, "item": new_item})
    except Exception as e:
        print(f"[SoundSight] Save history error: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/history/<item_id>", methods=["GET"])
def get_single_history_item(item_id):
    if PER_USER_HISTORY:
        return jsonify({"success": False, "error": "Item not found"}), 404

    items = [i for i in load_history() if i.get("contentType") != "None"]
    for item in items:
        if item.get("id") == item_id:
            return jsonify({"success": True, "item": item})
    return jsonify({"success": False, "error": "Item not found"}), 404


# ============================================================
# REVISION API
# The browser sends the whole "item"; the server only falls back to
# history.json when running with PER_USER_HISTORY = False.
# ============================================================

def _client_item(payload):
    """The study item sent by the browser, if it looks valid."""
    item = payload.get("item")

    if (
        isinstance(item, dict)
        and item.get("contentType") not in (None, "", "None")
        and not item.get("isError")
    ):
        return item

    return None


@app.route("/api/revise/generate", methods=["POST"])
def generate_revision():
    try:
        payload = request.get_json(force=True) or {}
        item_id = payload.get("itemId")
        topic_query = (payload.get("topic") or "").strip().lower()
        mode = payload.get("mode", "quick")

        target_item = _client_item(payload)

        if target_item is None:
            items = [i for i in load_history() if i.get("contentType") != "None"]

            if item_id:
                for it in items:
                    if it.get("id") == item_id:
                        target_item = it
                        break
            elif topic_query:
                # Semantic / fuzzy match across titles and topics
                for it in items:
                    title_lower = (it.get("title") or "").lower()
                    topic_lower = (it.get("topic") or "").lower()
                    if (topic_query in title_lower or topic_query in topic_lower or
                        any(w in title_lower for w in topic_query.split()) or
                        any(w in topic_lower for w in topic_query.split())):
                        target_item = it
                        break

            if not target_item and items:
                # Fallback to most recent item
                target_item = items[0]

        if not target_item:
            return jsonify({
                "success": False,
                "error": "No matching study item found."
            }), 404

        revision_data = stem_engine.generate_revision(target_item, mode)
        revision_data["targetItem"] = target_item
        return jsonify({"success": True, "revision": revision_data})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/revise/evaluate", methods=["POST"])
def evaluate_revision_answer():
    try:
        payload = request.get_json(force=True) or {}
        question = payload.get("question", "")
        expected = payload.get("expectedAnswer", "")
        student_answer = payload.get("studentAnswer", "")

        eval_result = stem_engine.evaluate_student_answer(question, expected, student_answer)
        return jsonify({"success": True, "evaluation": eval_result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================
# REVISION QUIZ (question mode)
# ============================================================

def _extract_json(text):
    text = re.sub(r"<think>.*?</think>", "", text or "", flags=re.S)
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        data = json.loads(text[start:end + 1])
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        return None


def _keywords(text):
    stop = {"the", "a", "an", "is", "are", "of", "to", "and", "in",
            "it", "that", "for", "on", "with", "as", "by", "this", "be"}
    return {
        w for w in re.findall(r"[a-z0-9]+", (text or "").lower())
        if w not in stop and len(w) > 1
    }


@app.route("/api/revise/quiz", methods=["POST"])
def revision_quiz():
    try:
        payload = request.get_json(force=True) or {}
        item_id = payload.get("itemId")

        try:
            count = int(payload.get("count", 5))
        except (TypeError, ValueError):
            count = 5
        count = min(max(count, 3), 10)

        item = _client_item(payload)

        if item is None:
            item = next(
                (i for i in load_history()
                 if i.get("id") == item_id and i.get("contentType") != "None"),
                None
            )

        if not item:
            return jsonify({"success": False,
                            "error": "Topic not found."}), 404

        study = json.dumps(
            slim_context(item), ensure_ascii=False
        )[:MAX_CONTEXT_CHARS]

        prompt = f"""
You are a quiz maker for blind students who answer by VOICE.
Create {count} questions ONLY from the STUDY CONTENT below.

RULES:
- Each question must be answerable aloud in a few words or one sentence.
- No questions about images, colors, layout or "which option below".
- Start easy, then get slightly harder.
- "answer" is the correct answer in one short sentence.
- "explanation" is 1 or 2 short sentences explaining why.
- Plain spoken text only. No markdown, no symbols that sound odd aloud.
- Return ONLY JSON in this exact shape:
{{"questions": [{{"question": "...", "answer": "...", "explanation": "..."}}]}}

STUDY CONTENT:
----------------
{study}
----------------
"""

        result = get_ai_answer(prompt)
        if not result.get("success"):
            return jsonify({"success": False,
                            "error": result.get("error")}), 503

        data = _extract_json(result.get("answer"))
        questions = []

        for q in (data or {}).get("questions", []):
            if (isinstance(q, dict)
                    and str(q.get("question", "")).strip()
                    and str(q.get("answer", "")).strip()):
                questions.append({
                    "question": plain_text(q["question"]),
                    "answer": plain_text(q["answer"]),
                    "explanation": plain_text(q.get("explanation", ""))
                })

        if not questions:
            return jsonify({"success": False,
                            "error": "Could not create a quiz."}), 503

        return jsonify({"success": True, "questions": questions[:count]})

    except Exception as e:
        print(f"[SoundSight] Quiz error: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/revise/check", methods=["POST"])
def revision_check():
    try:
        payload = request.get_json(force=True) or {}
        question = str(payload.get("question", ""))[:1000]
        expected = str(payload.get("expectedAnswer", ""))[:1000]
        student = str(payload.get("studentAnswer", ""))[:1000]

        prompt = f"""
Mark a student's SPOKEN answer. The text comes from speech recognition,
so ignore small spelling or sound-alike mistakes. Accept answers that
mean the same as the correct answer, even if worded differently.
Mark wrong if the key idea is missing or wrong.

Question: {question}
Correct answer: {expected}
Student answer: {student}

Return ONLY JSON: {{"correct": true}} or {{"correct": false}}
"""
        result = get_ai_answer(prompt)
        data = _extract_json(result.get("answer")) if result.get("success") else None

        if data is not None and "correct" in data:
            return jsonify({"success": True,
                            "correct": bool(data["correct"])})

        # Fallback if the AI is down: simple keyword overlap.
        exp, stu = _keywords(expected), _keywords(student)
        correct = bool(exp) and len(exp & stu) / len(exp) >= 0.5
        return jsonify({"success": True, "correct": correct,
                        "fallback": True})

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================
# ASK AI CHAT API
# ============================================================

@app.route("/api/ai-chats", methods=["GET"])
def get_ai_chats():
    # The list would show every visitor's chats, so it is never shared.
    return jsonify({"success": True, "chats": []})


@app.route("/api/ai-chats/<chat_id>", methods=["GET"])
def get_ai_chat(chat_id):

    chats = load_ai_chats()

    for chat in chats:

        if chat.get("id") == chat_id:

            return jsonify({
                "success": True,
                "chat": chat
            })

    return jsonify({
        "success": False,
        "error": "AI conversation not found."
    }), 404


@app.route("/api/ai-chat", methods=["POST"])
def ai_chat():

    try:

        payload = request.get_json(force=True) or {}

        # 1. Validate the current question.
        message = (payload.get("message") or "").strip()

        if not message:
            return jsonify({
                "success": False,
                "error": "No question was provided."
            }), 400

        message = message[:MAX_QUESTION_CHARS]

        chat_id = (payload.get("chatId") or "").strip()

        # 2. Which page/feature started this request.
        source = (payload.get("source") or "standalone").strip().lower()

        if source not in ASK_AI_SOURCES:
            return jsonify({
                "success": False,
                "error": "Unknown Ask AI source."
            }), 400

        # 3. Use ONLY the context explicitly supplied for this request.
        #    The legacy "askAIContext" field is deliberately ignored.
        if source == "standalone":
            slim = {}
            study_context = ""
            context_key = ""
        else:
            slim = slim_context(payload.get("context"))

            if not slim:
                return jsonify({
                    "success": False,
                    "error": "There is no content here to ask about yet."
                }), 400

            study_context = json.dumps(
                slim,
                ensure_ascii=False,
                indent=2
            )[:MAX_CONTEXT_CHARS]

            context_key = context_fingerprint(source, slim)

        # 4. Find this chat. It must match BOTH the source and the
        #    context fingerprint, so chats never merge across pages/items.
        chats = load_ai_chats()
        chat = None

        if chat_id:
            for existing_chat in chats:
                if (
                    existing_chat.get("id") == chat_id
                    and existing_chat.get("mode") == source
                    and existing_chat.get("contextKey", "") == context_key
                ):
                    chat = existing_chat
                    break

        if chat is None:
            chat = create_ai_chat(mode=source, context_key=context_key)
            chats.insert(0, chat)

        messages = chat.setdefault("messages", [])

        if slim:
            chat["topic"] = (
                slim.get("topic")
                or slim.get("title")
                or chat.get("topic", "")
            )

        print(f"[ASK AI] source={source} contextual={bool(slim)}")

        # 5. Build the prompt (this chat's own conversation only).
        conversation_context = build_ai_history_context(messages)

        prompt = build_ask_prompt(
            source=source,
            message=message,
            conversation_context=conversation_context,
            study_context=study_context
        )

        # 6. Gemini first, then the backup AI.
        ai_result = get_ai_answer(prompt)

        if not ai_result.get("success"):

            return jsonify({
                "success": False,
                "error": ai_result.get("error", "AI response failed.")
            }), 503

        answer = plain_text(ai_result.get("answer") or "")

        if not answer:
            return jsonify({
                "success": False,
                "error": "I received an empty answer. Please ask again."
            }), 503

        # Save messages
        now = datetime.now().isoformat()

        messages.append({
            "role": "user",
            "content": message,
            "timestamp": now
        })

        messages.append({
            "role": "assistant",
            "content": answer,
            "timestamp": datetime.now().isoformat(),
            "model": ai_result.get("model", ""),
            "provider": ai_result.get("provider", "")
        })

        # Conversation title
        if (
            not chat.get("title")
            or chat.get("title") == "New Study Conversation"
        ):

            if chat.get("topic"):
                chat["title"] = f"Study: {chat['topic']}"
            else:
                chat["title"] = generate_ai_title(message)

        chat["updatedAt"] = datetime.now().isoformat()

        save_ai_chats(chats)

        # 7. Return the complete answer to the correct page and its TTS.
        return jsonify({
            "success": True,
            "chatId": chat.get("id"),
            "title": chat.get("title"),
            "topic": chat.get("topic", ""),
            "source": source,
            "answer": answer,
            "model": ai_result.get("model", ""),
            "provider": ai_result.get("provider", ""),
            "messageCount": len(messages)
        })

    except Exception as e:

        print(f"[SoundSight] Ask AI error: {e}")

        return jsonify({
            "success": False,
            "error": "I could not complete the AI conversation.",
            "detail": str(e)
        }), 500


# ============================================================
# FILE READING HELPERS
# The server folder (VOICE_UPLOADS_DIR) is for the developer on
# localhost only. Everyone else picks files from their own device.
#
# Supported files:
#   images    png, jpg, jpeg, webp, gif, bmp, tif, tiff, heic, heif
#   documents pdf, docx, pptx, txt, md, csv
#
# Extra packages (a type is hidden if its package is missing):
#   pip install pillow-heif pymupdf python-docx python-pptx
# ============================================================

import importlib.util
from PIL import ImageOps

VOICE_UPLOADS_DIR = (
    os.environ.get("VOICE_UPLOADS_DIR", "").strip()
    or os.path.join(BASE_DIR, "data", "voice_uploads")
)

MAX_VOICE_FILE_MB = 25
MAX_VOICE_TEXT_CHARS = 60000

# Browsers and the AI read these directly.
BROWSER_IMAGE_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}

# Converted to JPEG before sending.
CONVERT_IMAGE_EXT = {".bmp", ".tif", ".tiff"}

IMAGE_EXT = set(BROWSER_IMAGE_MIME) | CONVERT_IMAGE_EXT
DOC_EXT = {".txt", ".md", ".csv"}


def _has_module(name):
    return importlib.util.find_spec(name) is not None


if _has_module("pillow_heif"):
    from pillow_heif import register_heif_opener
    register_heif_opener()
    IMAGE_EXT |= {".heic", ".heif"}
else:
    print("[SoundSight] HEIC photos disabled. Run: pip install pillow-heif")

if _has_module("pymupdf") or _has_module("fitz"):
    DOC_EXT.add(".pdf")
else:
    print("[SoundSight] PDF files disabled. Run: pip install pymupdf")

if _has_module("docx"):
    DOC_EXT.add(".docx")
else:
    print("[SoundSight] Word files disabled. Run: pip install python-docx")

if _has_module("pptx"):
    DOC_EXT.add(".pptx")
else:
    print("[SoundSight] PowerPoint files disabled. Run: pip install python-pptx")

VOICE_UPLOAD_EXT = IMAGE_EXT | DOC_EXT

print(f"[SoundSight] Voice uploads folder: {VOICE_UPLOADS_DIR}")
print(f"[SoundSight] Folder exists: {os.path.isdir(VOICE_UPLOADS_DIR)}")


def _data_url(raw, mime):
    return f"data:{mime};base64,{base64.b64encode(raw).decode('utf-8')}"


def _image_file_to_data_url(path, ext):
    if ext in BROWSER_IMAGE_MIME:
        with open(path, "rb") as f:
            return _data_url(f.read(), BROWSER_IMAGE_MIME[ext])

    # HEIC, TIFF, BMP: browsers cannot always show these, so convert to JPEG.
    with Image.open(path) as img:
        img = ImageOps.exif_transpose(img)  # keep phone photos upright
        if img.mode != "RGB":
            img = img.convert("RGB")
        buffer = io.BytesIO()
        img.save(buffer, "JPEG", quality=90)

    return _data_url(buffer.getvalue(), "image/jpeg")


def _read_pdf(path, page_number):
    try:
        import pymupdf as fitz
    except ImportError:  # older PyMuPDF versions only have the "fitz" name
        import fitz

    with fitz.open(path) as doc:
        if doc.needs_pass:
            raise ValueError("This PDF is password protected.")

        page_count = doc.page_count

        if page_count == 0:
            raise ValueError("This PDF has no pages.")

        parts = []

        for page in doc:
            text = page.get_text().strip()
            if text:
                parts.append(text)

        text = "\n\n".join(parts)

        if len(text) >= 40:
            return {
                "rawText": text[:MAX_VOICE_TEXT_CHARS],
                "imageData": "",
                "pageCount": page_count
            }

        # Scanned PDF: no text layer, so return one page as an image.
        index = min(max(page_number, 1), page_count) - 1
        png = doc[index].get_pixmap(dpi=150).tobytes("png")

        return {
            "rawText": "",
            "imageData": _data_url(png, "image/png"),
            "pageCount": page_count,
            "page": index + 1,
            "scanned": True
        }


def _read_docx(path):
    from docx import Document
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    document = Document(path)
    lines = []

    # Walk the body in order so tables stay between the right paragraphs.
    for child in document.element.body.iterchildren():
        if child.tag.endswith("}p"):
            text = Paragraph(child, document).text.strip()
            if text:
                lines.append(text)

        elif child.tag.endswith("}tbl"):
            for row in Table(child, document).rows:
                cells = [cell.text.strip() for cell in row.cells]
                if any(cells):
                    lines.append(" | ".join(cells))

    return {
        "rawText": "\n".join(lines)[:MAX_VOICE_TEXT_CHARS],
        "imageData": ""
    }


def _read_pptx(path):
    from pptx import Presentation

    presentation = Presentation(path)
    slides = []

    for number, slide in enumerate(presentation.slides, start=1):
        texts = []

        for shape in slide.shapes:
            if shape.has_text_frame:
                text = shape.text_frame.text.strip()
                if text:
                    texts.append(text)

            elif getattr(shape, "has_table", False) and shape.has_table:
                for row in shape.table.rows:
                    cells = [cell.text.strip() for cell in row.cells]
                    if any(cells):
                        texts.append(" | ".join(cells))

        if texts:
            slides.append(f"Slide {number}:\n" + "\n".join(texts))

    return {
        "rawText": "\n\n".join(slides)[:MAX_VOICE_TEXT_CHARS],
        "imageData": ""
    }


def _read_plain_text(path):
    with open(path, "r", encoding="utf-8-sig", errors="replace") as f:
        return {
            "rawText": f.read(MAX_VOICE_TEXT_CHARS),
            "imageData": ""
        }


# ============================================================
# EXTRACT TEXT FROM A FILE THE USER PICKED (PDF / Word / PowerPoint)
# Nothing is saved: the file is read and deleted right away.
# ============================================================

@app.route("/api/extract-file", methods=["POST"])
def extract_file():
    upload = request.files.get("file")

    if not upload or not upload.filename:
        return jsonify({"success": False, "error": "No file received."}), 400

    ext = os.path.splitext(upload.filename)[1].lower()

    if ext not in (".pdf", ".docx", ".pptx") or ext not in DOC_EXT:
        return jsonify({
            "success": False,
            "error": "This file type is not supported."
        }), 415

    data = upload.read()

    if len(data) > MAX_VOICE_FILE_MB * 1024 * 1024:
        return jsonify({"success": False, "error": "This file is too large."}), 413

    path = None

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
            tmp.write(data)
            path = tmp.name

        if ext == ".pdf":
            result = _read_pdf(path, 1)
        elif ext == ".docx":
            result = _read_docx(path)
        else:
            result = _read_pptx(path)

        if not result.get("rawText", "").strip() and not result.get("imageData"):
            return jsonify({
                "success": False,
                "error": "I could not find any readable text in this file."
            }), 422

        return jsonify({"success": True, **result})

    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 422

    except Exception as e:
        print(f"[SoundSight] Extract file error: {e}")
        return jsonify({
            "success": False,
            "error": "I could not open this file."
        }), 500

    finally:
        if path and os.path.exists(path):
            try:
                os.remove(path)
            except OSError:
                pass


# ============================================================
# DEVELOPER VOICE FOLDER (localhost only)
# Other visitors get an empty list and a 404, so nobody can read
# files from the computer that runs the server.
# ============================================================

def _voice_folder_allowed():
    host = (request.host or "").split(":")[0].lower()
    return host in ("localhost", "127.0.0.1", "[::1]")


@app.route("/api/voice-files", methods=["GET"])
def list_voice_files():
    if not _voice_folder_allowed():
        return jsonify({
            "success": True,
            "files": [],
            "folder": "",
            "folderExisted": True,
            "ignored": [],
            "disabled": True
        })

    try:
        folder_existed = os.path.isdir(VOICE_UPLOADS_DIR)

        os.makedirs(VOICE_UPLOADS_DIR, exist_ok=True)

        files = []
        ignored = []

        for name in os.listdir(VOICE_UPLOADS_DIR):
            # Skip hidden files and Office lock files such as "~$notes.docx".
            if name.startswith(("~$", ".")):
                continue

            path = os.path.join(VOICE_UPLOADS_DIR, name)
            ext = os.path.splitext(name)[1].lower()

            if os.path.isfile(path) and ext in VOICE_UPLOAD_EXT:
                files.append({
                    "name": name,
                    "kind": "image" if ext in IMAGE_EXT else "document",
                    "modified": os.path.getmtime(path)
                })
            elif os.path.isfile(path):
                ignored.append(name)

        files.sort(key=lambda item: item["modified"], reverse=True)

        return jsonify({
            "success": True,
            "files": files,
            "folder": VOICE_UPLOADS_DIR,
            "folderExisted": folder_existed,
            "ignored": ignored[:10]
        })

    except Exception as e:
        print(f"[SoundSight] Voice upload folder error: {e}")
        return jsonify({"success": False, "files": [], "error": str(e)}), 500


@app.route("/api/voice-files/<path:filename>", methods=["GET"])
def get_voice_file(filename):
    if not _voice_folder_allowed():
        return jsonify({"success": False, "error": "File not found."}), 404

    # basename() blocks "../" tricks, so only files inside the folder open.
    safe_name = os.path.basename(filename)
    path = os.path.join(VOICE_UPLOADS_DIR, safe_name)
    ext = os.path.splitext(safe_name)[1].lower()

    if (
        safe_name.startswith(("~$", "."))
        or ext not in VOICE_UPLOAD_EXT
        or not os.path.isfile(path)
    ):
        return jsonify({"success": False, "error": "File not found."}), 404

    if os.path.getsize(path) > MAX_VOICE_FILE_MB * 1024 * 1024:
        return jsonify({
            "success": False,
            "error": f"This file is larger than {MAX_VOICE_FILE_MB} MB."
        }), 413

    try:
        if ext in IMAGE_EXT:
            kind = "image"
            result = {
                "rawText": "",
                "imageData": _image_file_to_data_url(path, ext)
            }

        else:
            kind = "document"

            if ext == ".pdf":
                page_number = request.args.get("page", 1, type=int) or 1
                result = _read_pdf(path, page_number)
            elif ext == ".docx":
                result = _read_docx(path)
            elif ext == ".pptx":
                result = _read_pptx(path)
            else:
                result = _read_plain_text(path)

            if not result.get("rawText", "").strip() and not result.get("imageData"):
                return jsonify({
                    "success": False,
                    "error": "I could not find any readable text in this file."
                }), 422

        return jsonify({
            "success": True,
            "name": safe_name,
            "kind": kind,
            **result
        })

    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 422

    except Exception as e:
        print(f"[SoundSight] Voice file read error: {e}")
        return jsonify({
            "success": False,
            "error": "I could not open this file.",
            "detail": str(e)
        }), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"\n=======================================================")
    print(f"  SOUNDSIGHT - AI Assistive STEM Workspace")
    print(f"  Active on http://127.0.0.1:{port}")
    print(f"=======================================================\n")
    app.run(host="0.0.0.0", port=port, debug=False)