"""
SoundSight Local Application Server
Serves accessible frontend and handles STEM AI analysis, history persistence, and revision flows.
"""

import os
import sys
import json
import uuid
import io
import base64
from datetime import datetime
from PIL import Image
from flask import Flask, request, jsonify, send_from_directory

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from stem_engine import StemEngine

FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "frontend"))
DATA_FILE = os.path.join(BASE_DIR, "data", "history.json")

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")
stem_engine = StemEngine()

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

@app.route("/api/history", methods=["GET"])
def get_history():
    items = load_history()
    return jsonify({"success": True, "items": items, "count": len(items)})

@app.route("/api/history", methods=["POST"])
def add_history_item():
    try:
        payload = request.get_json(force=True) or {}
        items = load_history()
        
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
            "imageData": payload.get("imageData", "")
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
    items = load_history()
    for item in items:
        if item.get("id") == item_id:
            return jsonify({"success": True, "item": item})
    return jsonify({"success": False, "error": "Item not found"}), 404

@app.route("/api/revise/generate", methods=["POST"])
def generate_revision():
    try:
        payload = request.get_json(force=True) or {}
        item_id = payload.get("itemId")
        topic_query = payload.get("topic", "").strip().lower()
        mode = payload.get("mode", "quick")

        items = load_history()
        target_item = None

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
                text_lower = (it.get("ocrText") or "").lower()
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
                "error": "No matching study item found in learning history."
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

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"\n=======================================================")
    print(f"  SOUNDSIGHT - AI Assistive STEM Workspace")
    print(f"  Active on http://127.0.0.1:{port}")
    print(f"=======================================================\n")
    app.run(host="0.0.0.0", port=port, debug=False)
