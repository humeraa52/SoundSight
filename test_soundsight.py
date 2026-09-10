"""
SoundSight Automated Verification Suite
Tests STEM classification, structural decomposition, audio script generation,
certainty evaluation, revision modes, and student answer evaluation.
"""

import sys
import os
import json

sys.path.append(os.path.join(os.path.dirname(__file__), "backend"))
from stem_engine import StemEngine

def run_tests():
    print("==================================================")
    print("  RUNNING SOUNDSIGHT STEM ENGINE VERIFICATION")
    print("==================================================")

    engine = StemEngine()
    passed = 0
    total = 0

    # Test 1: Code Classification & Structural Analysis
    total += 1
    code_snippet = """
    def bubble_sort(arr):
        n = len(arr)
        for i in range(n - 1):
            for j in range(0, n - i - 1):
                if arr[j] > arr[j + 1]:
                    arr[j], arr[j + 1] = arr[j + 1], arr[j]
        return arr
    """
    res1 = engine.analyze(code_snippet)
    assert res1["contentType"] == "Code", f"Expected Code, got {res1['contentType']}"
    assert res1["language"] == "Python"
    assert len(res1["lineByLine"]) > 0
    assert len(res1["errors"]) > 0
    assert "audioScript" in res1
    print("[PASS] Test 1 Passed: Code Classification & Structural Analysis")
    passed += 1

    # Test 2: Flowchart Classification & Sequential Traversal
    total += 1
    flowchart_snippet = """
    Start -> low = 0, high = n - 1 -> Decision: low <= high? -> Yes: mid = (low+high)/2 -> Decision: arr[mid] == target? -> Yes: Found! Return mid. -> No: is target < arr[mid]? -> Yes: high = mid - 1, No: low = mid + 1 -> Loop. If low <= high is No -> Return -1. End.
    """
    res2 = engine.analyze(flowchart_snippet)
    assert res2["contentType"] == "Flowchart", f"Expected Flowchart, got {res2['contentType']}"
    assert len(res2["structuralFlow"]) > 0
    assert any("diamond" in step.lower() for step in res2["structuralFlow"])
    assert "audioScript" in res2
    print("[PASS] Test 2 Passed: Flowchart Graph Traversal & Decision Analysis")
    passed += 1

    # Test 3: Formula Classification & Spoken Math Breakdown
    total += 1
    formula_snippet = "x = (-b ± √(b² - 4ac)) / (2a). For quadratic equation ax² + bx + c = 0."
    res3 = engine.analyze(formula_snippet)
    assert res3["contentType"] == "Formula", f"Expected Formula, got {res3['contentType']}"
    assert "spokenMath" in res3
    assert len(res3["symbols"]) >= 3
    assert "audioScript" in res3
    print("[PASS] Test 3 Passed: Formula Breakdown & Phonetic Reading")
    passed += 1

    # Test 4: Diagram Analysis & Spatial Components
    total += 1
    diagram_snippet = "Round Robin CPU Scheduling. Ready Queue -> CPU Core. Time Quantum = 4ms. Gantt chart. Preemption loop."
    res4 = engine.analyze(diagram_snippet)
    assert res4["contentType"] == "Diagram", f"Expected Diagram, got {res4['contentType']}"
    assert "spatialLayout" in res4
    assert len(res4["components"]) > 0
    print("[PASS] Test 4 Passed: Diagram Spatial Mapping & Component Identification")
    passed += 1

    # Test 5: Certainty vs Uncertainty Partitioning
    total += 1
    blurred_res = engine.analyze("Partial text...", meta={"blurred": True})
    assert blurred_res["certainty"]["isClear"] == False
    assert len(blurred_res["certainty"]["uncertain"]) > 0
    assert "unclear" in blurred_res["audioScript"].lower()
    print("[PASS] Test 5 Passed: Certainty Partitioning on Blurred/Unclear Frame")
    passed += 1

    # Test 6: Revision Modes (Quick, Detailed, Exam, Question Mode)
    total += 1
    sample_item = res1
    rev_quick = engine.generate_revision(sample_item, "quick")
    assert rev_quick["mode"] == "Quick Revision"
    assert "commonMistakes" in rev_quick

    rev_exam = engine.generate_revision(sample_item, "exam")
    assert rev_exam["mode"] == "Exam Revision"

    rev_question = engine.generate_revision(sample_item, "question")
    assert rev_question["mode"] == "Question Mode"
    assert "question" in rev_question
    print("[PASS] Test 6 Passed: Multi-Mode Revision (Quick, Exam, Question)")
    passed += 1

    # Test 7: Question Mode Evaluation
    total += 1
    eval_good = engine.evaluate_student_answer(
        rev_question["question"],
        rev_question["expectedAnswer"],
        "It achieves O(n) linear time if we check a swapped flag."
    )
    assert eval_good["score"] >= 80, f"Expected >= 80, got {eval_good['score']}"
    assert "correct" in eval_good["feedback"].lower()

    eval_vague = engine.evaluate_student_answer(
        rev_question["question"],
        rev_question["expectedAnswer"],
        "I think it does something with numbers."
    )
    assert eval_vague["score"] < 80
    print("[PASS] Test 7 Passed: Student Voice Answer Evaluation Engine")
    passed += 1

    print("\n==================================================")
    print(f"  ALL {passed}/{total} VERIFICATION SUITE TESTS PASSED!")
    print("==================================================")

if __name__ == "__main__":
    run_tests()
