"""
SoundSight STEM Understanding & AI Engine

Provides specialized structural analysis for:
- Code
- Flowcharts
- Mathematical formulas
- Technical diagrams
- Tables
- Graphs
- Theory / notes
- Certainty evaluation
- Revision modes
- Interactive question evaluation
- Gemini multimodal image analysis
- Groq vision backup when Gemini fails

Design:
- Gemini analyzes the actual captured/uploaded image when available.
- If Gemini fails, a Groq vision model (GROQ_VISION_MODEL) is tried.
- Local analysis remains available as a fallback.
- No fake generic STEM content is generated.
- Existing camera, history, TTS and revision functionality is preserved.
"""

import os
import re
import json
import base64
from typing import Dict, Any, List, Optional


class StemEngine:

    # ============================================================
    # INITIALIZATION
    # ============================================================

    def __init__(self):
        self.gemini_api_key = os.environ.get("GEMINI_API_KEY", "")
        self.gemini_client = None

        if self.gemini_api_key:
            try:
                from google import genai
                from google.genai import types

                self.gemini_client = genai.Client(
                    api_key=self.gemini_api_key,
                    http_options=types.HttpOptions(timeout=30000)
                )

                print("[SoundSight] Gemini API client initialized.")

            except Exception as e:
                print(
                    f"[SoundSight] Gemini API client initialization notice: {e}"
                )

    # ============================================================
    # CONTENT TYPE DETECTION
    # ============================================================

    def detect_content_type(
        self,
        text: str,
        meta: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:

        """
        Multi-signal content classifier.

        Detects:
        - Code
        - Flowcharts
        - Formulas
        - Diagrams
        - Tables
        - Text / Notes
        """

        text = text or ""
        lower = text.lower()
        hint = (meta or {}).get(
            "contentTypeHint",
            ""
        ).lower()

        # --------------------------------------------------------
        # Python indicators
        # --------------------------------------------------------

        python_keywords = [
            "def ",
            "import ",
            "from ",
            "class ",
            "return ",
            "if ",
            "elif ",
            "else:",
            "for ",
            "while ",
            "print(",
            "print ",
            "range(",
            "len(",
            "self.",
            "lambda ",
            "try:",
            "except:",
            "except ",
            "with ",
            "in range",
            "append(",
            "append ("
        ]

        kw_hits = sum(
            1
            for kw in python_keywords
            if kw in lower
        )

        has_colons = ":" in text

        has_def_or_print = (
            "def " in lower
            or "print" in lower
            or "return " in lower
            or "import " in lower
        )

        has_indentation = any(
            line.startswith("  ")
            or line.startswith("\t")
            for line in text.splitlines()
        )

        if (
            kw_hits >= 1
            or (has_def_or_print and has_colons)
            or (has_indentation and kw_hits >= 1)
            or hint == "code"
        ):
            return {
                "type": "Code",
                "language": "Python"
            }

        # --------------------------------------------------------
        # Other programming languages
        # --------------------------------------------------------

        if any(
            marker in lower
            for marker in [
                "public static void",
                "#include",
                "std::",
                "console.log",
                "int main"
            ]
        ):

            if "public static" in lower:
                language = "Java"
            elif "#include" in text:
                language = "C++"
            else:
                language = "JavaScript"

            return {
                "type": "Code",
                "language": language
            }

        # --------------------------------------------------------
        # Formula
        # --------------------------------------------------------

        formula_symbols = [
            "\\frac",
            "\\sqrt",
            "sum_",
            "\\int",
            "=\\pm",
            "\\times",
            "quadratic",
            "e=mc",
            "f=ma",
            "v=ir",
            "±",
            "√",
            "∫",
            "∑"
        ]

        if (
            any(sym in lower for sym in formula_symbols)
            or (
                "=" in text
                and any(
                    math_char in text
                    for math_char in [
                        "^",
                        "√",
                        "±",
                        "∫",
                        "∑",
                        "λ",
                        "θ"
                    ]
                )
            )
        ):
            return {
                "type": "Formula",
                "language": None
            }

        # --------------------------------------------------------
        # Flowchart
        # --------------------------------------------------------

        flowchart_keywords = [
            "flowchart",
            "start",
            "stop",
            "decision",
            "yes",
            "no",
            "is x >",
            "step 1",
            "step 2",
            "arrow points",
            "diamond",
            "terminal",
            "parallelogram"
        ]

        flow_hits = sum(
            1
            for keyword in flowchart_keywords
            if keyword in lower
        )

        if (
            flow_hits >= 3
            or (
                "yes" in lower
                and "no" in lower
                and (
                    "diamond" in lower
                    or "start" in lower
                    or "decision" in lower
                )
            )
        ):
            return {
                "type": "Flowchart",
                "language": None
            }

        # --------------------------------------------------------
        # Diagram
        # --------------------------------------------------------

        diagram_keywords = [
            "cpu scheduling",
            "round robin",
            "gantt chart",
            "ready queue",
            "circuit",
            "resistor",
            "voltage",
            "ammeter",
            "diagram",
            "architecture",
            "block diagram"
        ]

        if any(
            keyword in lower
            for keyword in diagram_keywords
        ):
            return {
                "type": "Diagram",
                "language": None
            }

        # --------------------------------------------------------
        # Table
        # --------------------------------------------------------

        if (
            ("|" in text and "-+-" in text)
            or (
                text.count("\t") > 5
                and text.count("\n") > 3
            )
        ):
            return {
                "type": "Table",
                "language": None
            }

        return {
            "type": "Text",
            "language": None
        }

    # ============================================================
    # MAIN ANALYSIS
    # ============================================================
    def analyze(
        self,
        raw_text: str,
        image_data: Optional[str] = None,
        meta: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:

        """
        Main SoundSight analysis entrypoint.

        Gemini performs multimodal analysis when an image is available.

        Non-STEM images are returned immediately with a minimal result.
        Genuine STEM images receive the full structural analysis.

        Local analysis remains available as a fallback.
        """

        meta = meta or {}
        raw_text = (raw_text or "").strip()

        # --------------------------------------------------------
        # Readability check
        # --------------------------------------------------------

        meaningful_chars = re.sub(
            r"[^a-zA-Z0-9]",
            "",
            raw_text
        )

        if (
            len(meaningful_chars) < 6
            and not meta.get("title")
            and not image_data
        ):
            print(
                "[PROCESS] Insufficient readable text detected "
                f"(length={len(meaningful_chars)}). "
                "Returning real error."
            )

            return {
                "isError": True,
                "error": "Unable to process the captured image.",
                "reason": "No readable text or image available",
                "message": (
                    "I could not detect readable STEM content from "
                    "this scan. Please hold your document steady "
                    "with good lighting and place it closer to "
                    "the camera."
                )
            }

        # --------------------------------------------------------
        # Local classification
        # --------------------------------------------------------

        classification = self.detect_content_type(
            raw_text,
            meta
        )

        content_type = classification.get(
            "type",
            "Text"
        )

        language = classification.get(
            "language"
        )

        # --------------------------------------------------------
        # Local confidence
        # --------------------------------------------------------

        total_tokens = len(
            raw_text.split()
        )

        unclear_tokens = len(
            re.findall(
                r"[^a-zA-Z0-9_\s\(\)\[\]\{\}\:\=\+\-\*\/\,\.\<\>\#]",
                raw_text
            )
        )

        token_clarity = 1.0 - (
            unclear_tokens /
            max(total_tokens, 1)
        )

        confidence = max(
            0.60,
            min(
                0.98,
                0.75 + (token_clarity * 0.23)
            )
        )

        is_partially_unclear = (
            token_clarity < 0.85
            or meta.get("blurred", False)
        )

        # --------------------------------------------------------
        # Local analysis
        # --------------------------------------------------------

        if content_type == "Code":

            result = self._analyze_actual_code(
                raw_text,
                language or "Python",
                meta
            )

        elif content_type == "Flowchart":

            result = self._analyze_actual_flowchart(
                raw_text,
                meta
            )

        elif content_type == "Formula":

            result = self._analyze_actual_formula(
                raw_text,
                meta
            )

        elif content_type == "Diagram":

            result = self._analyze_actual_diagram(
                raw_text,
                meta
            )

        else:

            result = self._analyze_actual_text(
                raw_text,
                meta
            )

        result["contentType"] = content_type
        result["confidence"] = round(
            confidence,
            2
        )
        result["isPartiallyUnclear"] = (
            is_partially_unclear
        )

        # --------------------------------------------------------
        # Multimodal analysis (Gemini first, Groq vision backup)
        # --------------------------------------------------------

        if image_data:

            print(
                "[PROCESS] Image available. "
                "Starting Gemini multimodal analysis..."
            )

            vision_result = self._analyze_with_gemini(
                image_data=image_data,
                raw_text=raw_text,
                meta=meta
            )

            vision_source = "Gemini"

            vision_ok = (
                isinstance(vision_result, dict)
                and not vision_result.get("isError", False)
            )

            if not vision_ok:

                print(
                    "[PROCESS] Gemini failed. "
                    "Trying Groq vision backup..."
                )

                vision_result = self._analyze_with_groq_vision(
                    image_data=image_data,
                    raw_text=raw_text,
                    meta=meta
                )

                vision_source = "Groq vision"

                vision_ok = (
                    isinstance(vision_result, dict)
                    and not vision_result.get("isError", False)
                )

            if vision_ok:

                print(
                    f"[PROCESS] {vision_source} analysis successful. "
                    f"Using {vision_source} result."
                )

                # ------------------------------------------------
                # IMPORTANT:
                # Non-STEM results are intentionally minimal.
                # Do not run them through additional local analysis.
                # ------------------------------------------------

                if vision_result.get("contentType") == "None":

                    return {
                        "isError": False,
                        "contentType": "None",
                        "title": (
                            vision_result.get("title")
                            or "Not STEM Content"
                        ),
                        "topic": (
                            vision_result.get("topic")
                            or "Non-STEM Content"
                        ),
                        "language": "",
                        "confidence": vision_result.get(
                            "confidence",
                            0.95
                        ),
                        "ocrText": raw_text,
                        "purpose": "",
                        "summary": "",
                        "overallLogic": "",
                        "keyPoints": [],
                        "lineByLine": [],
                        "functions": [],
                        "variables": [],
                        "conditions": [],
                        "loops": [],
                        "imports": [],
                        "structuralFlow": [],
                        "components": [],
                        "latex": "",
                        "spokenMath": "",
                        "significance": "",
                        "symbols": [],
                        "spatialLayout": "",
                        "errors": [],
                        "audioScript": (
                            "Not STEM Content. "
                            "This image does not contain "
                            "genuine STEM educational or "
                            "technical material."
                        ),
                        "isPartiallyUnclear": False,
                        "certainty": {
                            "isClear": True,
                            "certain": [
                                "Image classified as non-STEM content."
                            ],
                            "uncertain": [],
                            "missing": []
                        }
                    }

                # ------------------------------------------------
                # STEM result
                # ------------------------------------------------

                result = vision_result

                # Preserve useful OCR from local processing
                if not result.get("ocrText"):
                    result["ocrText"] = raw_text

                # Fill classification if the model omitted it
                if not result.get("contentType"):
                    result["contentType"] = content_type

                if not result.get("language"):
                    result["language"] = language

                # If the model does not provide confidence,
                # retain local confidence.
                if not result.get("confidence"):
                    result["confidence"] = round(
                        confidence,
                        2
                    )

            else:

                print(
                    "[PROCESS] Gemini and Groq vision both "
                    "unavailable or failed."
                )

                # Little real OCR text means local analysis
                # would be inventing content.
                if len(meaningful_chars) < 40:

                    return {
                        "isError": True,
                        "error": "Image analysis unavailable.",
                        "reason": (
                            "Vision analysis failed and OCR text "
                            "was too small to trust."
                        ),
                        "message": (
                            "I couldn't analyze this image right now. "
                            "Please try again in a moment."
                        )
                    }
                
                        # --------------------------------------------------------
        # Text-only content (PDF, Word, PowerPoint, text files)
        # --------------------------------------------------------

        if not image_data and len(meaningful_chars) >= 40:

            print("[PROCESS] Text-only content. Starting AI classification...")

            text_result = self._analyze_text_with_ai(raw_text, meta)

            if text_result and not text_result.get("isError", False):

                if text_result.get("contentType") == "None":

                    return {
                        "isError": False,
                        "contentType": "None",
                        "title": text_result.get("title") or "Not STEM Content",
                        "topic": text_result.get("topic") or "Non-STEM Content",
                        "language": "",
                        "confidence": text_result.get("confidence", 0.95),
                        "ocrText": raw_text,
                        "purpose": "",
                        "summary": "",
                        "overallLogic": "",
                        "keyPoints": [],
                        "audioScript": (
                            "Not STEM Content. This file does not contain "
                            "genuine STEM educational or technical material."
                        ),
                        "isPartiallyUnclear": False,
                        "certainty": {
                            "isClear": True,
                            "certain": ["File classified as non-STEM content."],
                            "uncertain": [],
                            "missing": []
                        }
                    }

                result = text_result

                if not result.get("ocrText"):
                    result["ocrText"] = raw_text

                if not result.get("confidence"):
                    result["confidence"] = round(confidence, 2)

        # --------------------------------------------------------
        # Normalize result
        # --------------------------------------------------------

        result["isError"] = bool(
            result.get("isError", False)
        )

        result.setdefault(
            "contentType",
            content_type
        )

        result.setdefault(
            "confidence",
            round(confidence, 2)
        )

        result.setdefault(
            "isPartiallyUnclear",
            is_partially_unclear
        )

        title = (
            result.get("title") or meta.get("title") or ""
        ).strip()

        generic_titles = {
            "stem content", "stem study notes", "stem study material",
            "educational content", "stem document", "unknown", "untitled"
        }

        if not title or title.lower() in generic_titles:
            topic_part = (result.get("topic") or "").strip()
            type_part = result.get("contentType") or ""
            title = f"{topic_part} {type_part}".strip() or "STEM Content"

        result["title"] = title[:70]

        result.setdefault(
            "topic",
            meta.get("topic", "")
        )

        result.setdefault(
            "ocrText",
            raw_text
        )

        result.setdefault(
            "language",
            language
        )

        result.setdefault(
            "purpose",
            ""
        )

        result.setdefault(
            "summary",
            ""
        )

        result.setdefault(
            "overallLogic",
            ""
        )

        result.setdefault(
            "keyPoints",
            []
        )

        result.setdefault(
            "lineByLine",
            []
        )

        result.setdefault(
            "structuralFlow",
            []
        )

        result.setdefault(
            "components",
            []
        )

        result.setdefault(
            "latex",
            ""
        )

        result.setdefault(
            "spokenMath",
            ""
        )

        result.setdefault(
            "symbols",
            []
        )

        result.setdefault(
            "spatialLayout",
            ""
        )

        result.setdefault(
            "errors",
            []
        )

        result.setdefault(
            "audioScript",
            ""
        )

        # --------------------------------------------------------
        # Certainty
        # --------------------------------------------------------

        certainty = self._partition_certainty(
            result,
            bool(
                result.get(
                    "isPartiallyUnclear",
                    is_partially_unclear
                )
            )
        )

        result["certainty"] = certainty

        # --------------------------------------------------------
        # TTS
        # --------------------------------------------------------

        result["audioScript"] = (
            self._build_audio_script(result)
        )

        print(
            "[PROCESS] Final content type: "
            f"{result.get('contentType')}"
        )

        print(
            "[PROCESS] Final topic: "
            f"{result.get('topic') or result.get('title')}"
        )

        print(
            "[PROCESS] Final confidence: "
            f"{result.get('confidence', 0)}"
        )

        return result

    # ============================================================
    # LOCAL CODE ANALYSIS
    # ============================================================

    def _analyze_actual_code(
        self,
        code_text: str,
        language: str,
        meta: Dict[str, Any]
    ) -> Dict[str, Any]:

        """
        Explains the actual scanned code line-by-line.
        Does not invent missing code.
        """

        lines = [
            line
            for line in code_text.splitlines()
            if line.strip()
        ]

        line_count = len(lines)

        functions = []
        variables = []
        conditions = []
        loops = []
        imports = []
        line_by_line = []

        for idx, line in enumerate(
            lines,
            1
        ):

            stripped = line.strip()

            # ----------------------------------------------------
            # Functions
            # ----------------------------------------------------

            func_match = re.search(
                r"def\s+([a-zA-Z_0-9]+)\s*\((.*?)\)",
                stripped
            )

            if func_match:

                fname = func_match.group(1)

                fparams = [
                    p.strip()
                    for p in func_match.group(2).split(",")
                    if p.strip()
                ]

                functions.append(
                    {
                        "name": fname,
                        "params": fparams
                    }
                )

                line_by_line.append(
                    f"Line {idx}: Defines function "
                    f"'{fname}' accepting arguments "
                    f"{', '.join(fparams) if fparams else 'none'}."
                )

                continue

            # ----------------------------------------------------
            # Imports
            # ----------------------------------------------------

            if (
                stripped.startswith("import ")
                or stripped.startswith("from ")
            ):

                imports.append(
                    stripped
                )

                line_by_line.append(
                    f"Line {idx}: '{stripped}' "
                    "imports a module or library."
                )

                continue

            # ----------------------------------------------------
            # For loop
            # ----------------------------------------------------

            for_match = re.search(
                r"for\s+([a-zA-Z_0-9]+)\s+in\s+(.*?):",
                stripped
            )

            if for_match:

                var_name = for_match.group(1)
                iterable = for_match.group(2)

                loops.append(
                    f"for loop over {iterable}"
                )

                line_by_line.append(
                    f"Line {idx}: Starts a for loop "
                    f"iterating '{var_name}' across "
                    f"'{iterable}'."
                )

                continue

            # ----------------------------------------------------
            # While loop
            # ----------------------------------------------------

            while_match = re.search(
                r"while\s+(.*?):",
                stripped
            )

            if while_match:

                condition = while_match.group(1)

                loops.append(
                    f"while loop on {condition}"
                )

                line_by_line.append(
                    f"Line {idx}: Starts a while loop "
                    f"repeating as long as condition "
                    f"'{condition}' holds true."
                )

                continue

            # ----------------------------------------------------
            # If
            # ----------------------------------------------------

            if_match = re.search(
                r"if\s+(.*?):",
                stripped
            )

            if if_match:

                condition = if_match.group(1)

                conditions.append(
                    condition
                )

                line_by_line.append(
                    f"Line {idx}: Evaluates condition "
                    f"if '{condition}'."
                )

                continue

            # ----------------------------------------------------
            # Elif
            # ----------------------------------------------------

            elif_match = re.search(
                r"elif\s+(.*?):",
                stripped
            )

            if elif_match:

                condition = elif_match.group(1)

                conditions.append(
                    condition
                )

                line_by_line.append(
                    f"Line {idx}: Evaluates alternative "
                    f"condition elif '{condition}'."
                )

                continue

            # ----------------------------------------------------
            # Else
            # ----------------------------------------------------

            if stripped.startswith("else:"):

                line_by_line.append(
                    f"Line {idx}: Else branch executes "
                    "if preceding conditions are false."
                )

                continue

            # ----------------------------------------------------
            # Return
            # ----------------------------------------------------

            if stripped.startswith("return"):

                ret_val = (
                    stripped.replace(
                        "return",
                        "",
                        1
                    ).strip()
                    or "none"
                )

                line_by_line.append(
                    f"Line {idx}: Returns result "
                    f"'{ret_val}' from the function."
                )

                continue

            # ----------------------------------------------------
            # Print
            # ----------------------------------------------------

            if (
                stripped.startswith("print(")
                and stripped.endswith(")")
            ):

                value = stripped[
                    6:-1
                ].strip()

                line_by_line.append(
                    f"Line {idx}: Prints output "
                    f"'{value}' to the console."
                )

                continue

            if stripped.startswith("print "):

                value = stripped[
                    6:
                ].strip()

                line_by_line.append(
                    f"Line {idx}: Prints output "
                    f"'{value}' to the console."
                )

                continue

            if re.search(
                r"print\s*\(",
                stripped
            ):

                value = re.sub(
                    r"^\s*print\s*\(",
                    "",
                    stripped
                ).rstrip(")")

                line_by_line.append(
                    f"Line {idx}: Prints output "
                    f"'{value}' to the console."
                )

                continue

            # ----------------------------------------------------
            # Variable assignment
            # ----------------------------------------------------

            assign_match = re.search(
                r"^([a-zA-Z_0-9]+)\s*=\s*(.*)",
                stripped
            )

            if (
                assign_match
                and not stripped.startswith("if")
            ):

                variable_name = (
                    assign_match.group(1)
                )

                expression = (
                    assign_match.group(2)
                )

                if variable_name not in [
                    item["name"]
                    for item in variables
                ]:

                    variables.append(
                        {
                            "name": variable_name,
                            "value": expression
                        }
                    )

                line_by_line.append(
                    f"Line {idx}: Sets variable "
                    f"'{variable_name}' equal to "
                    f"'{expression}'."
                )

                continue

            # ----------------------------------------------------
            # General statement
            # ----------------------------------------------------

            if stripped:

                line_by_line.append(
                    f"Line {idx}: Executes statement "
                    f"'{stripped}'."
                )

        # --------------------------------------------------------
        # Topic detection
        # --------------------------------------------------------

        lower_code = code_text.lower()

        if (
            "sort" in lower_code
            or (
                "arr" in lower_code
                and "swap" in lower_code
            )
        ):

            topic = (
                "Array Sorting and Element Ordering"
            )

            purpose = (
                "Sorts a sequence of numbers "
                "or elements in order."
            )

            overall_logic = (
                "Iterates through array elements "
                "and orders them sequentially."
            )

        elif (
            "search" in lower_code
            or "target" in lower_code
        ):

            topic = "Search Algorithm"

            purpose = (
                "Searches for a specific target "
                "value within an input data structure."
            )

            overall_logic = (
                "Inspects elements sequentially "
                "or divides search intervals until "
                "the target is located."
            )

        elif (
            "fib" in lower_code
            or "factorial" in lower_code
            or (
                "def " in lower_code
                and "return " in lower_code
                and functions
            )
        ):

            fname = (
                functions[0]["name"]
                if functions
                else "operation"
            )

            topic = (
                f"Mathematical Function ({fname})"
            )

            purpose = (
                f"Calculates computational results "
                f"via function '{fname}'."
            )

            overall_logic = (
                "Evaluates inputs through procedural "
                "arithmetic and returns the computed value."
            )

        elif functions:

            fname = functions[0]["name"]

            topic = (
                f"Python Function: {fname}"
            )

            purpose = (
                f"Executes logic defined in "
                f"function '{fname}'."
            )

            overall_logic = (
                f"Takes arguments "
                f"{', '.join(functions[0]['params'])}, "
                "processes data, and yields output."
            )

        else:

            topic = "Python Script Logic"

            purpose = (
                "Executes sequential computational "
                "statements, declarations, and transformations."
            )

            overall_logic = (
                "Declares variables, executes control "
                "flow, and emits results."
            )

        title = (
            f"Python: {functions[0]['name']}()"
            if functions
            else "Python Code Document"
        )

        return {
            "title": title,
            "topic": topic,
            "language": language,
            "purpose": purpose,
            "overallLogic": overall_logic,
            "lineByLine": line_by_line,
            "functions": functions,
            "variables": variables,
            "conditions": conditions,
            "loops": loops,
            "imports": imports,
            "ocrText": code_text,
            "keyPoints": [
                f"Written in {language}",
                purpose,
                (
                    f"Contains {len(functions)} functions "
                    f"and {len(loops)} loops."
                ),
                (
                    f"Parsed {line_count} actual scanned "
                    "lines of code."
                )
            ]
        }

    # ============================================================
    # FLOWCHART
    # ============================================================

    def _analyze_actual_flowchart(
        self,
        text: str,
        meta: Dict[str, Any]
    ) -> Dict[str, Any]:

        lines = [
            line.strip()
            for line in text.splitlines()
            if line.strip()
        ]

        title = (
            meta.get("title")
            or "STEM Flowchart Topology"
        )

        topic = (
            meta.get("topic")
            or "Algorithmic Decision Process"
        )

        structural_flow = []

        for idx, line in enumerate(
            lines,
            1
        ):

            lower = line.lower()

            if "start" in lower:

                structural_flow.append(
                    f"Step {idx}: System starts at "
                    f"terminal node labeled '{line}'."
                )

            elif (
                "?" in line
                or "decision" in lower
                or "is " in lower
            ):

                structural_flow.append(
                    f"Step {idx}: Decision diamond "
                    f"evaluating '{line}' with "
                    "branching paths."
                )

            elif (
                "yes" in lower
                or "no" in lower
            ):

                structural_flow.append(
                    f"Step {idx}: Branch path: '{line}'."
                )

            elif (
                "end" in lower
                or "stop" in lower
            ):

                structural_flow.append(
                    f"Step {idx}: Reaches termination "
                    f"node '{line}'."
                )

            else:

                structural_flow.append(
                    f"Step {idx}: Operation process "
                    f"node executing '{line}'."
                )

        if not structural_flow:

            structural_flow = [
                "Step 1: Flowchart sequence parsed "
                "from scanned diagram nodes."
            ]

        return {
            "title": title,
            "topic": topic,
            "purpose": (
                "Guides procedural execution and "
                "conditional branch resolution."
            ),
            "structuralFlow": structural_flow,
            "ocrText": text,
            "keyPoints": [
                title,
                (
                    f"Contains {len(structural_flow)} "
                    "sequential structural steps."
                ),
                (
                    "Traces execution paths from "
                    "initiation through decision branches."
                )
            ]
        }

    # ============================================================
    # FORMULA
    # ============================================================

    def _analyze_actual_formula(
        self,
        text: str,
        meta: Dict[str, Any]
    ) -> Dict[str, Any]:

        title = (
            meta.get("title")
            or "STEM Mathematical Formula"
        )

        topic = (
            meta.get("topic")
            or "Mathematical Derivation & Equations"
        )

        symbols_found = set(
            re.findall(
                r"[a-zA-Z]",
                text
            )
        )

        symbols = [
            {
                "symbol": symbol,
                "name": f"Variable {symbol}",
                "meaning": (
                    "Constituent term in the equation"
                )
            }
            for symbol in list(symbols_found)[:6]
        ]

        spoken_math = (
            f"Equation: {text}"
        )

        significance = (
            "Governs mathematical relationship "
            "and physical dimensions."
        )

        return {
            "title": title,
            "topic": topic,
            "latex": text,
            "spokenMath": spoken_math,
            "significance": significance,
            "symbols": symbols,
            "ocrText": text,
            "keyPoints": [
                f"Scanned expression: {text}",
                significance,
                (
                    f"Contains {len(symbols)} "
                    "identified mathematical parameters."
                )
            ]
        }

    # ============================================================
    # DIAGRAM
    # ============================================================

    def _analyze_actual_diagram(
        self,
        text: str,
        meta: Dict[str, Any]
    ) -> Dict[str, Any]:

        title = (
            meta.get("title")
            or "STEM Architecture Diagram"
        )

        topic = (
            meta.get("topic")
            or "System Architecture & Schematic"
        )

        lines = [
            line.strip()
            for line in text.splitlines()
            if line.strip()
        ]

        components = [
            {
                "name": line,
                "position": f"Component #{idx + 1}",
                "description": "Mapped subsystem"
            }
            for idx, line in enumerate(lines[:6])
        ]

        return {
            "title": title,
            "topic": topic,
            "purpose": (
                "Visualizes system layout, component "
                "interactions, and functional hierarchy."
            ),
            "spatialLayout": (
                "Structured spatial arrangement with "
                "interconnected functional blocks."
            ),
            "components": components,
            "ocrText": text,
            "keyPoints": [
                title,
                (
                    f"Identified {len(components)} "
                    "mapped diagram components from scan."
                ),
                (
                    "Shows operational relationships "
                    "and directional flow."
                )
            ]
        }

    # ============================================================
    # TEXT / NOTES
    # ============================================================

    def _looks_like_stem(self, text: str) -> bool:
        t = (text or "").lower()
        patterns = [
            r"[=+\-*/^]\s*\w",
            r"\bdef\b|\bclass\b|\bimport\b|\bint\b|\bprintf?\b",
            r"\bequation\b|\bformula\b|\btheorem\b|\bderivative\b|\bintegral\b",
            r"\bvoltage\b|\bcurrent\b|\bresistor\b|\bcircuit\b|\bexperiment\b",
            r"\balgorithm\b|\bfunction\b|\bmatrix\b|\bmolecule\b|\breaction\b",
        ]
        hits = sum(1 for p in patterns if re.search(p, t))
        return hits >= 2

    def _analyze_actual_text(
        self,
        text: str,
        meta: Dict[str, Any]
    ) -> Dict[str, Any]:

         # Safety net: non-STEM text ko STEM mat banao
        if not self._looks_like_stem(text):
            return {
                "isError": False,
                "contentType": "None",
                "title": "Not STEM Content",
                "topic": "Non-STEM Content",
                "confidence": 0.8,
                "ocrText": text,
                "keyPoints": [],
                "audioScript": (
                    "Not STEM Content. This file does not look like "
                    "genuine STEM material."
                ),
            }

        lines = [
            line.strip()
            for line in text.splitlines()
            if line.strip()
        ]

        first_line = (
            lines[0]
            if lines
            else "STEM Study Material"
        )

        title = (
            meta.get("title")
            or (
                first_line[:40]
                if len(first_line) > 5
                else "STEM Study Notes"
            )
        )

        topic = (
            meta.get("topic")
            or "Academic STEM Concepts"
        )

        summary = (
            " ".join(lines[:3])
            if lines
            else text
        )

        return {
            "title": title,
            "topic": topic,
            "summary": summary,
            "ocrText": text,
            "keyPoints": [
                line
                for line in lines[:5]
                if len(line) > 5
            ]
        }

    # ============================================================
    # CERTAINTY
    # ============================================================

    def _partition_certainty(
        self,
        result: Dict[str, Any],
        is_partially_unclear: bool
    ) -> Dict[str, Any]:

        content_type = result.get(
            "contentType",
            "Text"
        )

        if not is_partially_unclear:

            return {
                "isClear": True,
                "certain": [
                    (
                        f"Successfully recognized "
                        f"{content_type} structure."
                    ),
                    (
                        "Verified primary topic: "
                        f"{result.get('topic')}"
                    ),
 (
    "Core logic: "
    f"{result.get('purpose') or result.get('overallLogic') or result.get('summary')}"
)
                ],
                "uncertain": [],
                "missing": []
            }

        return {
            "isClear": False,
            "certain": [
                (
                    f"Identified {content_type} "
                    "structure and primary statements."
                ),
                (
    "Main purpose: "
    f"{result.get('purpose') or result.get('topic')}"
)
            ],
            "uncertain": [
                (
                    "A few characters or details "
                    "may be unclear."
                ),
                (
                    "Recommend verifying important "
                    "symbols and punctuation."
                )
            ],
            "missing": []
        }

    # ============================================================
    # ACCESSIBILITY TTS SCRIPT
    # ============================================================

    def _build_audio_script(
        self,
        result: Dict[str, Any]
    ) -> str:

        """
        Builds an accessibility-first explanation
        suitable for blind or visually impaired students.
        """

        content_type = result.get(
            "contentType",
            "Text"
        )

        title = result.get(
            "title",
            "Scanned Content"
        )

        parts = []

        parts.append(
            f"I detected {content_type} content."
        )

        if title:
            parts.append(
                f"The topic is {title}."
            )

        certainty = result.get(
            "certainty",
            {}
        )

        if not certainty.get(
            "isClear",
            True
        ):

            parts.append(
                "I can understand most of the content, "
                "but some characters or details may be unclear."
            )

        # --------------------------------------------------------
        # Code
        # --------------------------------------------------------

        if content_type == "Code":

            language = result.get(
                "language",
                "programming"
            )

            parts.append(
                f"This is {language} code."
            )

            if result.get("purpose"):
                parts.append(
                    f"Purpose: {result.get('purpose')}."
                )

            if result.get("overallLogic"):
                parts.append(
                    "Overall logic: "
                    f"{result.get('overallLogic')}."
                )

            functions = result.get(
                "functions",
                []
            )

            if functions:

                names = ", ".join(
                    function.get("name", "")
                    for function in functions
                    if function.get("name")
                )

                if names:

                    parts.append(
                        "The code defines the "
                        f"following functions: {names}."
                    )

            variables = result.get(
                "variables",
                []
            )

            if variables:

                parts.append(
                    "The code contains "
                    f"{len(variables)} identified variables."
                )

            line_by_line = result.get(
                "lineByLine",
                []
            )

            if line_by_line:

                parts.append(
                    "Here is the line by line explanation."
                )

                for line in line_by_line:
                    parts.append(
                        str(line)
                    )

        # --------------------------------------------------------
        # Flowchart
        # --------------------------------------------------------

        elif content_type == "Flowchart":

            if result.get("purpose"):

                parts.append(
                    f"Purpose: {result.get('purpose')}."
                )

            structural_flow = result.get(
                "structuralFlow",
                []
            )

            if structural_flow:

                parts.append(
                    "I will describe the flowchart "
                    "in execution order."
                )

                for step in structural_flow:
                    parts.append(
                        str(step)
                    )

            if result.get("overallLogic"):

                parts.append(
                    "Overall flow: "
                    f"{result.get('overallLogic')}."
                )

        # --------------------------------------------------------
        # Formula
        # --------------------------------------------------------

        elif content_type == "Formula":

            if result.get("spokenMath"):

                parts.append(
                    "The formula is: "
                    f"{result.get('spokenMath')}."
                )

            elif result.get("latex"):

                parts.append(
                    "The formula is: "
                    f"{result.get('latex')}."
                )

            if result.get("purpose"):

                parts.append(
                    f"Purpose: {result.get('purpose')}."
                )

            if result.get("symbols"):

                parts.append(
                    "The important symbols are:"
                )

                for symbol in result.get(
                    "symbols",
                    []
                ):

                    if isinstance(
                        symbol,
                        dict
                    ):

                        name = symbol.get(
                            "symbol",
                            ""
                        )

                        meaning = symbol.get(
                            "meaning",
                            ""
                        )

                        if name and meaning:

                            parts.append(
                                f"{name} means {meaning}."
                            )

        # --------------------------------------------------------
        # Diagram
        # --------------------------------------------------------

        elif content_type == "Diagram":

            if result.get("purpose"):

                parts.append(
                    f"Purpose: {result.get('purpose')}."
                )

            if result.get("spatialLayout"):

                parts.append(
                    "Layout: "
                    f"{result.get('spatialLayout')}."
                )

            components = result.get(
                "components",
                []
            )

            if components:

                parts.append(
                    "The visible components are:"
                )

                for component in components:

                    if isinstance(
                        component,
                        dict
                    ):

                        name = component.get(
                            "name",
                            ""
                        )

                        description = component.get(
                            "description",
                            ""
                        )

                        position = component.get(
                            "position",
                            ""
                        )

                        sentence = name

                        if position:
                            sentence += (
                                f", positioned at {position}"
                            )

                        if description:
                            sentence += (
                                f". {description}"
                            )

                        parts.append(
                            sentence
                        )

        # --------------------------------------------------------
        # Table / Graph
        # --------------------------------------------------------

        elif content_type in [
            "Table",
            "Graph"
        ]:

            if result.get("summary"):

                parts.append(
                    f"Summary: {result.get('summary')}."
                )

            if result.get("keyPoints"):

                parts.append(
                    "Important points:"
                )

                for point in result.get(
                    "keyPoints",
                    []
                ):

                    parts.append(
                        str(point)
                    )

        # --------------------------------------------------------
        # General text
        # --------------------------------------------------------

        else:

            if result.get("summary"):

                parts.append(
                    f"Summary: {result.get('summary')}."
                )

            if result.get("purpose"):

                parts.append(
                    f"Purpose: {result.get('purpose')}."
                )

            if result.get("keyPoints"):

                parts.append(
                    "Important points:"
                )

                for point in result.get(
                    "keyPoints",
                    []
                ):

                    parts.append(
                        str(point)
                    )

        return " ".join(
            str(part)
            for part in parts
            if part
        )

    # ============================================================
    # REVISION
    # ============================================================

    def generate_revision(
        self,
        item: Dict[str, Any],
        mode: str
    ) -> Dict[str, Any]:

        """
        Generates:
        - Quick Revision
        - Detailed Revision
        - Exam Revision
        - Question Mode
        """

        topic = item.get(
            "topic",
            "STEM Topic"
        )

        title = item.get(
            "title",
            topic
        )

        mode = (
            mode or ""
        ).lower()

        if "quick" in mode:

            speech = (
                f"Starting Quick Revision for {title}. "
                f"Topic Overview: {topic}. "
                f"Core Purpose: "
                f"{item.get('purpose') or item.get('overallLogic') or item.get('summary') or 'Key principles'}. "
                f"Key Points: {' '.join(item.get('keyPoints', []))}. "
                "Quick revision complete."
            )

            return {
                "mode": "Quick Revision",
                "title": title,
                "overview": topic,
                "keyPoints": item.get(
                    "keyPoints",
                    []
                ),
                "commonMistakes": [
                    "Ignoring zero or boundary conditions",
                    "Missing return values in functions"
                ],
                "audioScript": speech
            }

        elif "detailed" in mode:

            speech = (
                f"Starting Detailed Revision for {title}. "
                f"{item.get('audioScript', '')}"
            )

            return {
                "mode": "Detailed Revision",
                "title": title,
                "details": (
                    item.get("lineByLine")
                    or item.get("keyPoints")
                ),
                "audioScript": speech
            }

        elif "exam" in mode:

            speech = (
                f"Starting Exam Revision for {title}. "
                "Key exam focus: Make sure to clearly "
                f"state time complexity and boundary "
                f"conditions for {topic}. "
                "Exam revision complete."
            )

            return {
                "mode": "Exam Revision",
                "title": title,
                "examTips": [
                    "State asymptotic time complexity",
                    "Check edge cases"
                ],
                "audioScript": speech
            }

        else:

            question = (
                f"For {title}, what is the primary "
                "algorithmic logic and expected output?"
            )

            expected = (
                item.get("purpose")
                or item.get("overallLogic")
                or "Valid execution result"
            )

            speech = (
                f"Welcome to Question Mode for {title}. "
                f"Here is your question: {question}. "
                "Say your answer now."
            )

            return {
                "mode": "Question Mode",
                "title": title,
                "question": question,
                "expectedAnswer": expected,
                "audioScript": speech
            }

    # ============================================================
    # STUDENT ANSWER EVALUATION
    # ============================================================

    def evaluate_student_answer(
        self,
        question: str,
        expected: str,
        student_answer: str
    ) -> Dict[str, Any]:

        """
        Evaluates a student's verbal response constructively.
        """

        if (
            not student_answer
            or len(student_answer.strip()) < 3
        ):

            return {
                "score": 0,
                "feedback": (
                    "I didn't catch your answer. "
                    "Please try answering again."
                ),
                "audioScript": (
                    "I didn't catch your answer. "
                    "Please say your answer clearly."
                )
            }

        student_lower = (
            student_answer.lower()
        )

        expected_lower = (
            expected or ""
        ).lower()

        expected_words = [
            word
            for word in re.findall(
                r"\b\w{4,}\b",
                expected_lower
            )
            if word not in [
                "this",
                "that",
                "with",
                "from",
                "each"
            ]
        ]

        matches = [
            word
            for word in expected_words
            if word in student_lower
        ]

        ratio = (
            len(matches)
            / max(
                len(expected_words),
                1
            )
        )

        if (
            ratio >= 0.25
            or any(
                word in student_lower
                for word in [
                    "sort",
                    "search",
                    "function",
                    "return",
                    "loop",
                    "condition",
                    "fcfs",
                    "divide"
                ]
            )
        ):

            score = 90

            feedback = (
                "Excellent! That is correct. "
                "You explained the key concept. "
                f"{expected}"
            )

            audio = (
                "Excellent! That is correct. "
                f"{expected}"
            )

        else:

            score = 70

            feedback = (
                "Good effort! The complete concept is: "
                f"{expected}"
            )

            audio = (
                "Good effort! The complete concept is: "
                f"{expected}"
            )

        return {
            "score": score,
            "feedback": feedback,
            "audioScript": audio
        }

    # ============================================================
    # GEMINI MULTIMODAL ANALYSIS
    # ============================================================

    def _analyze_with_gemini(
        self,
        image_data: str,
        raw_text: str = "",
        meta: Optional[Dict[str, Any]] = None
    ) -> Optional[Dict[str, Any]]:

        """
        Analyze the actual captured/uploaded image using Gemini.

        Model fallback order:
        1. gemini-3.8-flash
        2. gemini-3.7-flash
        3. gemini-3.5-flash

        Each model is attempted once. Temporary failures move directly to the next model.

        Returns None if Gemini cannot analyze the image so that
        the existing local analysis can continue.
        """

        if not self.gemini_client:

            print(
                "[GEMINI] Gemini client is not initialized."
            )

            return None

        if not image_data:

            print(
                "[GEMINI] No image data supplied."
            )

            return None

        meta = meta or {}

        from google.genai import types

        try:

            # ----------------------------------------------------
            # Decode image
            # ----------------------------------------------------

            mime_type = "image/jpeg"
            encoded_image = image_data

            if "," in image_data:

                header, encoded_image = (
                    image_data.split(
                        ",",
                        1
                    )
                )

                match = re.search(
                    r"data:([^;]+);base64",
                    header
                )

                if match:
                    mime_type = match.group(1)

            try:

                image_bytes = base64.b64decode(
                    encoded_image
                )

            except Exception as e:

                print(
                    f"[GEMINI] Image base64 decoding failed: {e}"
                )

                return None

            if not image_bytes:

                print(
                    "[GEMINI] Decoded image is empty."
                )

                return None

            # ----------------------------------------------------
            # Multimodal instruction
            # ----------------------------------------------------

            prompt = """
You are the visual STEM classifier and understanding engine
for SoundSight, an accessibility application for blind and
visually impaired students.

Analyze the ACTUAL IMAGE supplied with this request.

IMPORTANT:
The image itself is the primary source of truth.

Do not invent content.
Do not infer STEM content merely from unrelated words.
Do not trust corrupted OCR when the image disagrees with it.

============================================================
STEP 1 — DETERMINE WHETHER THIS IS GENUINE STEM CONTENT
============================================================

First determine whether the actual image contains genuine
STEM educational, scientific, mathematical, computational,
or technical content.

Genuine STEM content includes:

MATHEMATICS:
- equations
- formulas
- algebra
- calculus
- geometry
- trigonometry
- matrices
- statistics
- probability
- numerical problems
- mathematical notation
- mathematical graphs
- worked mathematical examples

COMPUTER SCIENCE AND PROGRAMMING:
- Python
- C
- C++
- Java
- JavaScript
- source code
- pseudocode
- algorithms
- data structures
- flowcharts
- UML
- class diagrams
- sequence diagrams
- state diagrams
- ER/database diagrams
- software architecture
- networking diagrams

ELECTRICAL AND ELECTRONICS:
- circuit diagrams
- circuit schematics
- electronic components
- resistors
- capacitors
- inductors
- diodes
- transistors
- logic gates
- truth tables
- Boolean expressions
- waveforms
- electrical symbols
- electronic systems

PHYSICS:
- equations
- force diagrams
- free-body diagrams
- mechanics
- motion
- optics
- ray diagrams
- electricity
- magnetism
- experimental setups
- scientific graphs
- measurements

CHEMISTRY:
- chemical equations
- chemical formulas
- molecular structures
- structural formulas
- reaction diagrams
- reaction mechanisms
- laboratory diagrams
- periodic-table educational content
- chemical graphs
- chemical tables

BIOLOGY:
- cell diagrams
- anatomy diagrams
- biological structures
- genetics diagrams
- molecular biology
- biological processes
- scientific illustrations
- biological graphs
- biological tables

ENGINEERING:
- mechanical drawings
- technical drawings
- engineering schematics
- CAD-style drawings
- control-system diagrams
- process diagrams
- instrumentation diagrams
- manufacturing diagrams
- engineering block diagrams
- technical illustrations

GENERAL STEM:
- textbook pages
- lecture notes
- handwritten STEM notes
- worked examples
- experiments
- scientific tables
- scientific charts
- technical illustrations
- educational screenshots
- mixed STEM study material

============================================================
NON-STEM REJECTION
============================================================

Reject the image as non-STEM when it is primarily:

- a selfie
- portrait
- ordinary photograph
- person
- room
- building
- scenery
- logo
- decorative graphic
- promotional poster
- advertisement
- club poster
- event poster
- banner
- certificate
- invitation
- announcement
- faculty introduction
- social-media graphic
- unrelated object

unless the same image ALSO visibly contains genuine STEM
educational or technical material.

STEM-related words alone are NOT STEM evidence.

For example, these words alone do NOT mean programming:

"PROGRAMMERS CLUB"
"COMPUTER ENGINEERING"
"CODING EVENT"
"TECH FEST"
"SOFTWARE"
"ENGINEERING DEPARTMENT"
"BUILD LEARN GROW"
"PROGRAMMING"

A programmers club poster is NOT Code.

A coding-event poster is NOT Code.

An engineering department poster is NOT an engineering
technical diagram.

============================================================
STRICT TYPE RULES
============================================================

Code requires visible programming syntax, source code,
pseudocode, or clearly identifiable programming statements.

Formula requires actual mathematical or scientific notation.

Flowchart requires actual visual flowchart structure.

Diagram requires actual technical/scientific diagram structure.

Graph requires visible graph/chart structure.

Table requires visible tabular structure.

Do not classify based only on keywords.

============================================================
IMPORTANT OCR RULE
============================================================

OCR is secondary evidence only.

OCR may be:

- incomplete
- corrupted
- noisy
- wrong
- extremely short
- incorrect for handwriting
- incorrect for symbols

Never classify an image as STEM solely because OCR contains
random words or symbols.

For example, OCR such as:

"po A ¢ Saadi® my & He"

is NOT evidence of STEM content.

If OCR conflicts with the actual image, trust the image.

Do NOT reject genuine STEM content merely because OCR is poor.

A genuine STEM diagram, formula, handwritten equation,
circuit, graph, code screenshot, or technical drawing may
contain very little readable OCR.

============================================================
NON-STEM RESPONSE
============================================================

If the image is NOT genuine STEM content, return ONLY this
minimal JSON structure:

{
  "isError": false,
  "contentType": "None",
  "title": "Not STEM Content",
  "topic": "Non-STEM Content",
  "confidence": 0.95,
  "ocrText": ""
}

Do not generate:
- summary
- key points
- code explanation
- formula explanation
- diagram explanation
- generic STEM content
- invented content

============================================================
STEM RESPONSE
============================================================

If the image IS genuine STEM content, continue with the full
analysis.

TITLE RULES (very important):
The "title" must be a specific, definitive name for exactly what is
in the image, 3 to 8 words, easy to say aloud, with no colons or
special characters. Name the concept AND its form.

Good: "Binary Search Flowchart", "Quadratic Formula Derivation",
"Python Bubble Sort Code", "Ohm's Law Series Circuit",
"C Hello World Program", "Round Robin CPU Scheduling Diagram".

Never use generic titles such as "STEM Content", "Study Notes",
"Diagram", "Code", "Educational Content" or "Unknown".

The "topic" is the broader subject, for example
"Sorting Algorithms", "Algebra", "Operating Systems".

Determine the most appropriate content type:

Code
Flowchart
Formula
Diagram
Table
Graph
Text

Then:

- identify the actual topic
- read visible text
- preserve important symbols
- explain actual content
- explain code line by line when code is present
- explain flowcharts in execution order
- explain formulas using accessible spoken mathematics
- explain diagrams using observable spatial relationships
- summarize tables using actual visible information
- summarize graphs using actual visible trends and values
- identify uncertain or unreadable portions
- never fabricate missing information

A single image may contain multiple STEM forms.
Choose the primary content type while explaining important
secondary STEM elements.

============================================================
FULL STEM JSON
============================================================

Return ONLY valid JSON:

{
  "isError": false,
   "contentType": "Code | Flowchart | Formula | Diagram | Table | Graph | Text",
  "title": "",
  "topic": "",
  "language": "",
  "confidence": 0,
  "ocrText": "",
  "purpose": "",
  "summary": "",
  "overallLogic": "",
  "keyPoints": [],
  "lineByLine": [],
  "functions": [],
  "variables": [],
  "conditions": [],
  "loops": [],
  "imports": [],
  "structuralFlow": [],
  "components": [],
  "spatialLayout": "",
  "latex": "",
  "spokenMath": "",
  "significance": "",
  "symbols": [],
  "errors": [],
  "audioScript": ""
}

For code:

functions should contain objects such as:

{
  "name": "function_name",
  "params": ["parameter1"]
}

variables should contain objects such as:

{
  "name": "variable",
  "value": "actual value or expression"
}

lineByLine must describe actual visible lines only.

For formulas:

symbols should contain objects such as:

{
  "symbol": "x",
  "meaning": "actual meaning if visible or inferable"
}

For diagrams:

components should contain objects such as:

{
  "name": "actual visible component name",
  "position": "actual visible position if reasonably observable",
  "description": "actual visible description"
}

Do not invent component names, labels, positions, or
relationships.

For flowcharts:

structuralFlow must describe the actual visible sequence,
branches, and decision paths.

For graphs:

describe only visible axes, labels, trends, legends,
and values that can reasonably be read.

For tables:

describe only visible rows, columns, headings, and values.

If something cannot be read confidently, explicitly say that
it is unclear instead of inventing it.

The final explanation must be suitable for text-to-speech
and accessible to a blind student.
"""

            # ----------------------------------------------------
            # Add OCR as supporting evidence
            # ----------------------------------------------------

            if raw_text:

                prompt += (
                    "\n\nSECONDARY OCR REFERENCE ONLY:\n"
                    "--------------------------------\n"
                    f"{raw_text[:6000]}\n"
                    "--------------------------------\n"
                    "This OCR is noisy supporting evidence only. "
                    "It must NEVER override what is visibly present "
                    "in the image. Ignore OCR that appears corrupted, "
                    "random, or unrelated to the visual content."
                )
            # ----------------------------------------------------
            # Add safe metadata hints
            # ----------------------------------------------------

            metadata_hints = []

            for key in [
                "source",
                "fileName",
                "contentTypeHint",
                "title",
                "topic"
            ]:

                value = meta.get(key)

                if value:
                    metadata_hints.append(
                        f"{key}: {value}"
                    )

            if metadata_hints:

                prompt += (
                    "\n\nApplication metadata hints:\n"
                    + "\n".join(metadata_hints)
                )

            # ----------------------------------------------------
            # Available models
            # ----------------------------------------------------

            models_to_try = [
                "gemini-3.8-flash",
                "gemini-3.7-flash",
                "gemini-3.5-flash"
            ]

            last_error = None

            # ----------------------------------------------------
            # Model fallback (single attempt per model)
            # ----------------------------------------------------

            for model_name in models_to_try:


                try:

                    print(
                        f"[GEMINI] Trying {model_name}..."
                    )

                    response = self.gemini_client.models.generate_content(
                        model=model_name,
                        contents=[
                            types.Part.from_bytes(
                                data=image_bytes,
                                mime_type=mime_type
                            ),
                            prompt
                        ],
                        config=types.GenerateContentConfig(
                            response_mime_type="application/json"
                        )
                    )

                    response_text = (
                        response.text or ""
                    ).strip()

                    if not response_text:

                        print(
                            f"[GEMINI] {model_name} "
                            "returned an empty response."
                        )

                        break

                    # ------------------------------------------------
                    # Remove accidental Markdown JSON fences
                    # ------------------------------------------------

                    if response_text.startswith(
                        "```json"
                    ):

                        response_text = (
                            response_text[7:]
                            .strip()
                        )

                    elif response_text.startswith(
                        "```"
                    ):

                        response_text = (
                            response_text[3:]
                            .strip()
                        )

                    if response_text.endswith(
                        "```"
                    ):

                        response_text = (
                            response_text[:-3]
                            .strip()
                        )

                    # ------------------------------------------------
                    # Parse JSON
                    # ------------------------------------------------

                    try:

                        result = json.loads(
                            response_text
                        )

                    except json.JSONDecodeError as e:

                        print(
                            f"[GEMINI] Invalid JSON from "
                            f"{model_name}: {e}"
                        )

                        last_error = e
                        break

                    if not isinstance(
                        result,
                        dict
                    ):

                        print(
                            f"[GEMINI] {model_name} "
                            "returned non-object JSON."
                        )

                        break

                    # ------------------------------------------------
                    # Ensure expected fields
                    # ------------------------------------------------

                    result.setdefault(
                        "isError",
                        False
                    )

                    result.setdefault(
                        "contentType",
                        "Unknown"
                    )

                    result.setdefault(
                        "title",
                        ""
                    )

                    result.setdefault(
                        "topic",
                        ""
                    )

                    result.setdefault(
                        "language",
                        ""
                    )

                    result.setdefault(
                        "confidence",
                        0
                    )

                    result.setdefault(
                        "ocrText",
                        ""
                    )

                    result.setdefault(
                        "purpose",
                        ""
                    )

                    result.setdefault(
                        "summary",
                        ""
                    )

                    result.setdefault(
                        "overallLogic",
                        ""
                    )

                    result.setdefault(
                        "keyPoints",
                        []
                    )

                    result.setdefault(
                        "lineByLine",
                        []
                    )

                    result.setdefault(
                        "functions",
                        []
                    )

                    result.setdefault(
                        "variables",
                        []
                    )

                    result.setdefault(
                        "conditions",
                        []
                    )

                    result.setdefault(
                        "loops",
                        []
                    )

                    result.setdefault(
                        "imports",
                        []
                    )

                    result.setdefault(
                        "structuralFlow",
                        []
                    )

                    result.setdefault(
                        "components",
                        []
                    )

                    result.setdefault(
                        "latex",
                        ""
                    )

                    result.setdefault(
                        "spokenMath",
                        ""
                    )

                    result.setdefault(
                        "significance",
                        ""
                    )

                    result.setdefault(
                        "symbols",
                        []
                    )

                    result.setdefault(
                        "spatialLayout",
                        ""
                    )

                    result.setdefault(
                        "errors",
                        []
                    )

                    result.setdefault(
                        "audioScript",
                        ""
                    )

                    # ------------------------------------------------
                    # Ensure OCR is not lost
                    # ------------------------------------------------

                    if not result.get(
                        "ocrText"
                    ):

                        result["ocrText"] = (
                            raw_text
                        )

                    print(
                        "[GEMINI] Successful analysis "
                        f"using {model_name}."
                    )

                    return result

                except Exception as e:

                    last_error = e

                    error_text = str(e).lower()

                    print(
                        f"[GEMINI] {model_name} failed: {e}"
                    )

                    # ------------------------------------------------
                    # Authentication / API key errors
                    # ------------------------------------------------

                    auth_error = any(
                        phrase in error_text
                        for phrase in [
                            "api key",
                            "permission denied",
                            "unauthenticated",
                            "authentication",
                            "invalid api"
                        ]
                    )

                    if auth_error:

                        print(
                            "[GEMINI] Authentication/API "
                            "key error. Stopping Gemini attempts."
                        )

                        return None

                    # ------------------------------------------------
                    # Temporary error -> next model, no retry
                    # ------------------------------------------------

                    temporary_error = any(
                        phrase in error_text
                        for phrase in [
                            "503",
                            "unavailable",
                            "high demand",
                            "temporarily",
                            "timeout",
                            "deadline",
                            "resource exhausted",
                            "overloaded"
                        ]
                    )

                    if temporary_error:

                        print(
                            f"[GEMINI] {model_name} temporarily unavailable. "
                            "Skipping retry and trying next model."
                        )

                        continue

                    # ------------------------------------------------
                    # Other errors -> next model
                    # ------------------------------------------------

                    print(
                        f"[GEMINI] Non-retryable error on "
                        f"{model_name}. Trying next model."
                    )

                    continue

            # --------------------------------------------------------
            # All models failed
            # --------------------------------------------------------

            print(
                "[SoundSight] All Gemini models failed."
            )

            print(
                "[SoundSight] Last Gemini error: "
                f"{last_error}"
            )

            return None

        except Exception as e:

            print(
                f"[SoundSight] Gemini analysis error: {e}"
            )

            return None
        
            # ============================================================
    # TEXT-ONLY AI ANALYSIS (PDF, Word, PowerPoint, text files)
    # ============================================================

    def _parse_ai_json(self, reply):
        reply = re.sub(r"<think>.*?</think>", "", reply or "", flags=re.S).strip()
        start, end = reply.find("{"), reply.rfind("}")

        if start == -1 or end <= start:
            return None

        try:
            result = json.loads(reply[start:end + 1])
        except json.JSONDecodeError:
            return None

        if not isinstance(result, dict):
            return None

        defaults = {
            "isError": False, "contentType": "Text", "title": "",
            "topic": "", "language": "", "confidence": 0, "ocrText": "",
            "purpose": "", "summary": "", "overallLogic": "",
            "keyPoints": [], "lineByLine": [], "functions": [],
            "variables": [], "conditions": [], "loops": [], "imports": [],
            "structuralFlow": [], "components": [], "latex": "",
            "spokenMath": "", "significance": "", "symbols": [],
            "spatialLayout": "", "errors": [], "audioScript": ""
        }

        for field, value in defaults.items():
            result.setdefault(field, value)

        return result

    def _analyze_text_with_ai(self, raw_text, meta=None):
        """Classify and analyze document text (no image) with Gemini, then backup AI."""

        prompt = """
You are the STEM classifier and understanding engine for SoundSight,
an app for blind and visually impaired students.
Analyze the DOCUMENT TEXT below. Never invent content.

STEP 1: Is this genuine STEM study or technical content?
STEM: equations, formulas, source code or pseudocode, algorithms,
circuits, scientific or engineering explanations, lab reports, math
problems, textbook or lecture notes, technical tables and data.

NOT STEM: posters, advertisements, club or event announcements,
motivational or career text, resumes, certificates, letters, general
business or project-planning slides, social media text, news, stories.
Words like "AI", "coding", "software", "engineering" or "tech" alone
do NOT make text STEM. A plan, idea list or slogan about tools is NOT
STEM unless it actually teaches or shows technical content.

If NOT STEM, return ONLY this JSON:
{"isError": false, "contentType": "None", "title": "Not STEM Content",
 "topic": "Non-STEM Content", "confidence": 0.95, "ocrText": ""}

STEP 2: If it IS STEM, return ONLY valid JSON with these keys:
isError (false), contentType (Code, Flowchart, Formula, Diagram, Table,
Graph or Text), title (3 to 8 words, specific, no colons), topic,
language, confidence (0 to 1), ocrText, purpose, summary, overallLogic,
keyPoints (list of strings), lineByLine (list of strings, code only),
functions (list of {name, params}), variables (list of {name, value}),
conditions, loops, imports, structuralFlow, components
(list of {name, position, description}), spatialLayout, latex,
spokenMath, significance, symbols (list of {symbol, meaning}), errors,
audioScript (spoken explanation suitable for text-to-speech).
Describe only what the text says. If something is unclear, say so.

DOCUMENT TEXT:
----------------
""" + raw_text[:12000] + "\n----------------\n"

        # ---------- Gemini ----------
        if self.gemini_client:
            from google.genai import types

            for model_name in [
                "gemini-3.8-flash",
                "gemini-3.7-flash",
                "gemini-3.5-flash"
            ]:
                try:
                    print(f"[GEMINI TEXT] Trying {model_name}...")

                    response = self.gemini_client.models.generate_content(
                        model=model_name,
                        contents=prompt,
                        config=types.GenerateContentConfig(
                            response_mime_type="application/json"
                        )
                    )

                    result = self._parse_ai_json(response.text)

                    if result:
                        print(f"[GEMINI TEXT] Success using {model_name}.")
                        return result

                except Exception as e:
                    print(f"[GEMINI TEXT] {model_name} failed: {e}")

                    if any(w in str(e).lower() for w in
                           ["api key", "permission denied", "unauthenticated"]):
                        break

        # ---------- Backup AI (OpenAI-compatible) ----------
        url = os.environ.get("BACKUP_AI_URL", "").strip()
        key = os.environ.get("BACKUP_AI_KEY", "").strip()
        model = os.environ.get("BACKUP_AI_MODEL", "").strip()

        if url and key and model:
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
                        "temperature": 0.2,
                        "max_tokens": 4096
                    },
                    timeout=60
                )

                if response.status_code == 200:
                    reply = (
                        (((response.json().get("choices") or [{}])[0])
                         .get("message") or {}).get("content") or ""
                    )
                    result = self._parse_ai_json(reply)

                    if result:
                        print("[TEXT BACKUP] Success.")
                        return result
                else:
                    print(f"[TEXT BACKUP] HTTP {response.status_code}")

            except Exception as e:
                print(f"[TEXT BACKUP] Failed: {e}")

        return None


    # ============================================================
    # GROQ VISION BACKUP
    # ============================================================

    def _analyze_with_groq_vision(
        self,
        image_data: str,
        raw_text: str = "",
        meta: Optional[Dict[str, Any]] = None
    ) -> Optional[Dict[str, Any]]:

        """
        Backup image analysis through a Groq vision model.

        Environment variables:
          GROQ_VISION_MODEL  required, e.g. qwen/qwen3.8-27b
          GROQ_VISION_KEY    optional, falls back to BACKUP_AI_KEY
          GROQ_VISION_URL    optional, defaults to the Groq chat endpoint

        Returns None if it is not configured or fails.
        """

        url = os.environ.get(
            "GROQ_VISION_URL",
            "https://api.groq.com/openai/v1/chat/completions"
        ).strip()

        key = (
            os.environ.get("GROQ_VISION_KEY", "").strip()
            or os.environ.get("BACKUP_AI_KEY", "").strip()
        )

        model = os.environ.get("GROQ_VISION_MODEL", "").strip()

        if not (key and model and image_data):
            print("[GROQ VISION] Not configured or no image.")
            return None

        if len(image_data) > 4_000_000:
            print("[GROQ VISION] Image too large for backup analysis.")
            return None

        if image_data.startswith("data:"):
            data_url = image_data
        else:
            data_url = "data:image/jpeg;base64," + image_data

        prompt = """
You are the visual STEM classifier and understanding engine for
SoundSight, an app for blind and visually impaired students.
Analyze the ACTUAL IMAGE. The image is the primary source of truth.
Never invent content.

STEP 1: Decide whether the image is genuine STEM content:
equations, formulas, code, pseudocode, flowcharts, circuits,
technical or scientific diagrams, graphs, tables, textbook or
handwritten STEM notes.

NOT STEM: selfies, portraits, ordinary photos, rooms, scenery,
logos, posters, advertisements, certificates, club or event
posters, social media graphics, unrelated objects.
STEM-related words alone (for example "Programmers Club") do NOT
make an image STEM. Code requires visible programming syntax.
OCR text below is noisy secondary evidence only; trust the image.

If NOT STEM, return ONLY this JSON:
{"isError": false, "contentType": "None", "title": "Not STEM Content",
 "topic": "Non-STEM Content", "confidence": 0.95, "ocrText": ""}

STEP 2: If it IS STEM, return ONLY valid JSON with these keys:
isError (false), contentType (Code, Flowchart, Formula, Diagram,
Table, Graph or Text), title (3 to 8 words, specific, no colons),
topic, language, confidence (0 to 1), ocrText, purpose, summary,
overallLogic, keyPoints (list of strings), lineByLine (list of
strings, code only), functions (list of {name, params}), variables
(list of {name, value}), conditions, loops, imports,
structuralFlow (list of strings, flowcharts), components (list of
{name, position, description}), spatialLayout, latex, spokenMath,
significance, symbols (list of {symbol, meaning}), errors,
audioScript (a spoken explanation suitable for text-to-speech).
Describe only what is visible. If something is unclear, say so.
"""

        if raw_text:
            prompt += (
                "\nSECONDARY OCR (may be wrong):\n"
                + raw_text[:4000]
            )

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
                    "messages": [{
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {"url": data_url}
                            }
                        ]
                    }],
                    "temperature": 0.2,
                    "max_completion_tokens": 8192,
                    "response_format": {"type": "json_object"}
                },
                timeout=60
            )

            if response.status_code != 200:
                raise RuntimeError(
                    f"HTTP {response.status_code}: {response.text[:300]}"
                )

            data = response.json()

            reply = (
                (((data.get("choices") or [{}])[0]).get("message") or {})
                .get("content") or ""
            ).strip()

            # Remove any visible thinking block, then keep only the JSON object
            reply = re.sub(
                r"<think>.*?</think>",
                "",
                reply,
                flags=re.S
            ).strip()

            start = reply.find("{")
            end = reply.rfind("}")

            if start == -1 or end == -1 or end <= start:
                raise RuntimeError("no JSON object in response")

            result = json.loads(reply[start:end + 1])

            if not isinstance(result, dict):
                raise RuntimeError("response was not a JSON object")

            defaults = {
                "isError": False, "contentType": "Unknown", "title": "",
                "topic": "", "language": "", "confidence": 0,
                "ocrText": "", "purpose": "", "summary": "",
                "overallLogic": "", "keyPoints": [], "lineByLine": [],
                "functions": [], "variables": [], "conditions": [],
                "loops": [], "imports": [], "structuralFlow": [],
                "components": [], "latex": "", "spokenMath": "",
                "significance": "", "symbols": [], "spatialLayout": "",
                "errors": [], "audioScript": ""
            }

            for field, value in defaults.items():
                result.setdefault(field, value)

            if not result.get("ocrText"):
                result["ocrText"] = raw_text

            print(f"[GROQ VISION] Successful analysis using {model}.")

            return result

        except Exception as e:
            print(f"[GROQ VISION] Failed: {e}")
            return None