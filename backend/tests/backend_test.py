"""End-to-end backend integration tests for Scriptorium Integrity Platform."""
import json
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://integrity-desk.preview.emergentagent.com").rstrip("/")
PROF_TOKEN = "test_session_prof_1"
STUD_TOKEN = "test_session_stud_1"


def _client(token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def prof():
    return _client(PROF_TOKEN)


@pytest.fixture(scope="session")
def stud():
    return _client(STUD_TOKEN)


@pytest.fixture(scope="session")
def state():
    return {}


# ----------------------------- Auth -----------------------------
class TestAuth:
    def test_prof_me(self, prof):
        r = prof.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200
        d = r.json()
        assert d["email"] == "prof@school.edu"
        assert d["role"] == "professor"

    def test_stud_me(self, stud):
        r = stud.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200
        assert r.json()["role"] == "student"

    def test_unauth(self):
        r = requests.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 401


# ----------------------------- Professor create course/material/assignment -----------------------------
class TestProfessorFlow:
    def test_create_course(self, prof, state):
        name = f"TEST_Course_{uuid.uuid4().hex[:6]}"
        r = prof.post(f"{BASE_URL}/api/courses", json={"name": name, "description": "test"})
        assert r.status_code == 200
        d = r.json()
        assert d["name"] == name
        assert d["code"]
        assert d["professor_id"] == "test-prof-1"
        state["course_id"] = d["course_id"]
        state["course_code"] = d["code"]

    def test_list_courses(self, prof, state):
        r = prof.get(f"{BASE_URL}/api/courses")
        assert r.status_code == 200
        assert any(c["course_id"] == state["course_id"] for c in r.json())

    def test_upload_text_material(self, prof, state):
        cid = state["course_id"]
        # multipart form
        r = requests.post(
            f"{BASE_URL}/api/courses/{cid}/materials/text",
            headers={"Authorization": f"Bearer {PROF_TOKEN}"},
            data={
                "title": "TEST_Rawls",
                "content": (
                    "John Rawls proposes the original position, a thought experiment where rational "
                    "agents choose principles of justice behind a veil of ignorance. The two principles "
                    "of justice are: equal basic liberties, and the difference principle which permits "
                    "inequalities only if they benefit the least advantaged. The veil of ignorance ensures "
                    "impartiality by hiding one's social position, talents, and conception of the good."
                ) * 3,
            },
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["chunk_count"] >= 1
        state["material_id"] = d["material_id"]

    def test_create_assignment(self, prof, state):
        cid = state["course_id"]
        r = prof.post(
            f"{BASE_URL}/api/courses/{cid}/assignments",
            json={"title": "TEST_Essay on Justice", "prompt": "Discuss Rawls' veil of ignorance."},
        )
        assert r.status_code == 200
        d = r.json()
        assert d["title"] == "TEST_Essay on Justice"
        state["assignment_id"] = d["assignment_id"]


# ----------------------------- Student join + submission -----------------------------
class TestStudentFlow:
    def test_join_course(self, stud, state):
        r = stud.post(f"{BASE_URL}/api/courses/join", json={"code": state["course_code"]})
        assert r.status_code == 200
        assert r.json()["course_id"] == state["course_id"]

    def test_open_submission(self, stud, state):
        r = stud.post(f"{BASE_URL}/api/assignments/{state['assignment_id']}/submission")
        assert r.status_code == 200
        d = r.json()
        assert d["submission"]["status"] == "draft"
        state["submission_id"] = d["submission"]["submission_id"]

    def test_get_submission(self, stud, state):
        r = stud.get(f"{BASE_URL}/api/submissions/{state['submission_id']}")
        assert r.status_code == 200
        assert r.json()["course"]["name"].startswith("TEST_")


# ----------------------------- AI grounded / out-of-scope -----------------------------
def _parse_sse(resp):
    """Return final 'done' event dict from SSE response text."""
    final = None
    for line in resp.text.splitlines():
        if line.startswith("data: "):
            try:
                ev = json.loads(line[6:])
            except Exception:
                continue
            if ev.get("type") == "done":
                final = ev
    return final


class TestAIGrounding:
    def test_ai_grounded_in_scope(self, stud, state):
        r = requests.post(
            f"{BASE_URL}/api/submissions/{state['submission_id']}/ai/ask",
            headers={"Authorization": f"Bearer {STUD_TOKEN}", "Content-Type": "application/json"},
            json={"question": "What is the veil of ignorance in Rawls' theory?"},
            timeout=90,
        )
        assert r.status_code == 200
        done = _parse_sse(r)
        assert done is not None, f"No done event. Body: {r.text[:500]}"
        assert done.get("grounded") is True, f"Expected grounded=True, got {done}"
        assert isinstance(done.get("citations"), list) and len(done["citations"]) >= 1
        assert done.get("answer")

    def test_ai_out_of_scope_fallback(self, stud, state):
        r = requests.post(
            f"{BASE_URL}/api/submissions/{state['submission_id']}/ai/ask",
            headers={"Authorization": f"Bearer {STUD_TOKEN}", "Content-Type": "application/json"},
            json={"question": "How do I bake sourdough bread at home?"},
            timeout=90,
        )
        assert r.status_code == 200
        done = _parse_sse(r)
        assert done is not None
        assert done.get("grounded") is False, f"Expected grounded=False, got {done}"


# ----------------------------- Monitoring events / flagging -----------------------------
class TestMonitoring:
    def test_small_human_paste_not_flagged(self, stud, state):
        r = stud.post(
            f"{BASE_URL}/api/submissions/{state['submission_id']}/events",
            json={"type": "paste", "data": {"text": "hey, i copied this bit lol"}},
        )
        assert r.status_code == 200
        d = r.json()
        assert d["flagged"] is False
        assert "ai_likelihood" in d

    def test_large_ai_paste_flagged(self, stud, state):
        ai_text = (
            "Furthermore, it is important to note that the aforementioned framework provides a "
            "comprehensive and multifaceted approach to understanding the underlying principles. "
            "In addition, one must consider the various implications that emerge from this analysis. "
            "Moreover, the systematic evaluation of these factors reveals significant patterns. "
            "Consequently, it becomes evident that a nuanced perspective is essential. "
        ) * 6
        r = stud.post(
            f"{BASE_URL}/api/submissions/{state['submission_id']}/events",
            json={"type": "paste", "data": {"text": ai_text}},
        )
        assert r.status_code == 200
        d = r.json()
        assert d["flagged"] is True, f"Expected flagged. Got {d}"
        flag = d["flag"]
        assert flag["type"] == "paste"
        assert "ai_likelihood" in flag
        assert "likely_source" in flag
        assert "signals" in flag
        state["flag_id"] = flag["flag_id"]

    def test_tab_switch_event(self, stud, state):
        r = stud.post(
            f"{BASE_URL}/api/submissions/{state['submission_id']}/events",
            json={"type": "tab_switch", "data": {"count": 8, "away_ms": 12000}},
        )
        assert r.status_code == 200

    def test_keystroke_event(self, stud, state):
        r = stud.post(
            f"{BASE_URL}/api/submissions/{state['submission_id']}/events",
            json={"type": "keystroke", "data": {"typed_chars": 50, "wpm": 60}},
        )
        assert r.status_code == 200


# ----------------------------- Student inbox / explanation -----------------------------
class TestInboxExplain:
    def test_student_sees_flag(self, stud, state):
        r = stud.get(f"{BASE_URL}/api/flags/mine")
        assert r.status_code == 200
        assert any(f["flag_id"] == state["flag_id"] for f in r.json())

    def test_submit_explanation(self, stud, state):
        r = stud.post(
            f"{BASE_URL}/api/flags/{state['flag_id']}/explain",
            json={"category": "ai_assisted", "ai_statement": "Used AI to draft an outline.",
                  "free_text": "I paraphrased the model output."},
        )
        assert r.status_code == 200

    def test_flag_status_escalated(self, stud, state):
        r = stud.get(f"{BASE_URL}/api/flags/{state['flag_id']}")
        assert r.status_code == 200
        d = r.json()
        assert d["status"] == "escalated"
        assert d["explanation"]["category"] == "ai_assisted"


# ----------------------------- Professor flags resolution -----------------------------
class TestProfResolve:
    def test_prof_lists_flags(self, prof, state):
        r = prof.get(f"{BASE_URL}/api/courses/{state['course_id']}/flags")
        assert r.status_code == 200
        assert any(f["flag_id"] == state["flag_id"] for f in r.json())

    def test_resolve_legitimate(self, prof, state):
        r = prof.post(
            f"{BASE_URL}/api/flags/{state['flag_id']}/resolve",
            json={"outcome": "legitimate", "note": "ok"},
        )
        assert r.status_code == 200

    def test_verify_resolution(self, prof, state):
        r = prof.get(f"{BASE_URL}/api/flags/{state['flag_id']}")
        assert r.status_code == 200
        assert r.json()["status"] == "resolved_legitimate"


# ----------------------------- Ask teacher -----------------------------
class TestAskTeacher:
    def test_student_asks(self, stud, state):
        r = stud.post(
            f"{BASE_URL}/api/courses/{state['course_id']}/questions",
            json={"question": "Can I use a quote from Rawls directly?",
                  "submission_id": state["submission_id"]},
        )
        assert r.status_code == 200
        state["question_id"] = r.json()["question_id"]

    def test_prof_sees_and_answers(self, prof, state):
        r = prof.get(f"{BASE_URL}/api/courses/{state['course_id']}/questions")
        assert r.status_code == 200
        assert any(q["question_id"] == state["question_id"] for q in r.json())
        r2 = prof.post(
            f"{BASE_URL}/api/questions/{state['question_id']}/answer",
            json={"answer": "Yes, with citation."},
        )
        assert r2.status_code == 200

    def test_student_sees_answer(self, stud, state):
        r = stud.get(f"{BASE_URL}/api/courses/{state['course_id']}/questions")
        items = r.json()
        me = next(q for q in items if q["question_id"] == state["question_id"])
        assert me["status"] == "answered"
        assert me["answer"] == "Yes, with citation."


# ----------------------------- Submit locks editor -----------------------------
class TestSubmitLock:
    def test_submit(self, stud, state):
        r = stud.post(f"{BASE_URL}/api/submissions/{state['submission_id']}/submit")
        assert r.status_code == 200

    def test_cannot_save_after_submit(self, stud, state):
        r = stud.put(
            f"{BASE_URL}/api/submissions/{state['submission_id']}",
            json={"content": "after submit", "word_count": 2},
        )
        assert r.status_code == 400
