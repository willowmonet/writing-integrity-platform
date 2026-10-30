"""Iteration-3 backend tests: citation detection, flag override rules (cleared_by_citation /
cleared_by_declaration / escalated), and pending_flags exclusion for cleared statuses."""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL", "https://integrity-desk.preview.emergentagent.com"
).rstrip("/")
PROF_TOKEN = "test_session_prof_1"
STUD_TOKEN = "test_session_stud_1"

AI_LIKE = (
    "Furthermore, it is imperative to note that the multifaceted nature of justice "
    "necessitates a comprehensive analytical framework. Moreover, one must consider "
    "the intersectionality of moral obligations vis-à-vis societal constructs. "
    "In conclusion, the aforementioned principles delineate a paradigm shift. "
    "Additionally, delve into the tapestry of ethical frameworks that navigate the landscape."
)


def _c(tok):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def prof():
    return _c(PROF_TOKEN)


@pytest.fixture(scope="module")
def stud():
    return _c(STUD_TOKEN)


@pytest.fixture(scope="module")
def ctx(prof, stud):
    cname = f"TEST_IT3_{uuid.uuid4().hex[:6]}"
    r = prof.post(f"{BASE_URL}/api/courses", json={"name": cname, "description": "it3"})
    assert r.status_code == 200, r.text
    course = r.json()

    r = prof.post(f"{BASE_URL}/api/courses/{course['course_id']}/assignments",
                  json={"title": "TEST Clarify Essay", "prompt": "Discuss."})
    assert r.status_code == 200
    asg = r.json()

    r = stud.post(f"{BASE_URL}/api/courses/join", json={"code": course["code"]})
    assert r.status_code in (200, 400)

    r = stud.post(f"{BASE_URL}/api/assignments/{asg['assignment_id']}/submission")
    assert r.status_code == 200
    sub = r.json()["submission"]
    return {"course": course, "assignment": asg, "submission": sub}


def _paste(stud, sid, text):
    r = stud.post(f"{BASE_URL}/api/submissions/{sid}/events",
                  json={"type": "paste", "data": {"text": text}})
    assert r.status_code == 200, r.text
    return r.json()


# ============ Citation detection ============
class TestCitationDetection:
    def test_paste_with_paren_citation_marks_has_citation(self, stud, ctx):
        sid = ctx["submission"]["submission_id"]
        text = AI_LIKE + " (Rawls, 1971, p. 12) supports this view."
        d = _paste(stud, sid, text)
        # Long paste (>300) => still flagged by size, but flag must carry has_citation=True
        assert d.get("flagged") is True
        flag = d["flag"]
        assert flag.get("has_citation") is True
        # ai_likelihood reduced (should be well under 60 for this content)
        assert flag.get("ai_likelihood") is not None
        assert flag["ai_likelihood"] < 60

    def test_paste_with_numeric_ref_marks_has_citation(self, stud, ctx):
        sid = ctx["submission"]["submission_id"]
        text = AI_LIKE + " See [3] for details."
        d = _paste(stud, sid, text)
        assert d.get("flagged") is True
        assert d["flag"].get("has_citation") is True

    def test_paste_with_url_marks_has_citation(self, stud, ctx):
        sid = ctx["submission"]["submission_id"]
        text = AI_LIKE + " Retrieved from https://plato.stanford.edu/entries/rawls/"
        d = _paste(stud, sid, text)
        assert d.get("flagged") is True
        assert d["flag"].get("has_citation") is True

    def test_short_paste_with_citation_not_flagged(self, stud, ctx):
        """A moderate-length (<300 char) paste with a citation should escape flagging."""
        sid = ctx["submission"]["submission_id"]
        text = ('"The veil of ignorance is a device of representation" (Rawls, 1971, p. 12), '
                "and this framing shapes the argument.")
        assert len(text) < 300
        d = _paste(stud, sid, text)
        # Not flagged - ai_likelihood reduced by 30 for citation
        assert d.get("flagged") is False, f"unexpectedly flagged: {d}"

    def test_ai_like_without_citation_is_flagged_with_higher_score(self, stud, ctx):
        sid = ctx["submission"]["submission_id"]
        text = AI_LIKE * 2
        d = _paste(stud, sid, text)
        assert d.get("flagged") is True
        flag = d["flag"]
        assert flag.get("has_citation") is False
        assert flag.get("ai_likelihood", 0) >= 50


# ============ Flag override rules ============
class TestFlagOverrideRules:
    def _make_flagged_paste(self, stud, sid):
        _paste(stud, sid, AI_LIKE * 2)
        r = stud.get(f"{BASE_URL}/api/submissions/{sid}/activity")
        assert r.status_code == 200
        pending = [f for f in r.json().get("flags", []) if f["status"] == "pending_student"]
        assert pending
        return pending[-1]["flag_id"]

    def test_quoted_cited_source_clears_by_citation(self, stud, ctx):
        sid = ctx["submission"]["submission_id"]
        fid = self._make_flagged_paste(stud, sid)
        r = stud.post(f"{BASE_URL}/api/flags/{fid}/explain",
                      json={"category": "quoted_cited_source", "free_text": "quoted from book",
                            "ai_statement": ""})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "cleared_by_citation"
        r = stud.get(f"{BASE_URL}/api/flags/{fid}")
        assert r.json()["status"] == "cleared_by_citation"

    def test_ai_assisted_clears_by_declaration(self, stud, ctx):
        sid = ctx["submission"]["submission_id"]
        fid = self._make_flagged_paste(stud, sid)
        r = stud.post(f"{BASE_URL}/api/flags/{fid}/explain",
                      json={"category": "ai_assisted", "free_text": "brainstorm",
                            "ai_statement": ""})
        assert r.status_code == 200
        assert r.json()["status"] == "cleared_by_declaration"

    def test_ai_statement_non_empty_clears_by_declaration(self, stud, ctx):
        sid = ctx["submission"]["submission_id"]
        fid = self._make_flagged_paste(stud, sid)
        r = stud.post(f"{BASE_URL}/api/flags/{fid}/explain",
                      json={"category": "own_work", "free_text": "",
                            "ai_statement": "I used ChatGPT to outline"})
        assert r.status_code == 200
        assert r.json()["status"] == "cleared_by_declaration"

    def test_own_work_no_statement_escalates(self, stud, ctx):
        sid = ctx["submission"]["submission_id"]
        fid = self._make_flagged_paste(stud, sid)
        r = stud.post(f"{BASE_URL}/api/flags/{fid}/explain",
                      json={"category": "own_work", "free_text": "this is mine",
                            "ai_statement": ""})
        assert r.status_code == 200
        assert r.json()["status"] == "escalated"


# ============ Pending counts exclude cleared ============
class TestPendingCounts:
    def test_course_overview_and_assignment_exclude_cleared(self, prof, stud, ctx):
        cname = f"TEST_IT3PC_{uuid.uuid4().hex[:6]}"
        r = prof.post(f"{BASE_URL}/api/courses", json={"name": cname, "description": "pc"})
        course = r.json()
        stud.post(f"{BASE_URL}/api/courses/join", json={"code": course["code"]})
        r = prof.post(f"{BASE_URL}/api/courses/{course['course_id']}/assignments",
                      json={"title": "PC Essay", "prompt": ""})
        aid = r.json()["assignment_id"]
        r = stud.post(f"{BASE_URL}/api/assignments/{aid}/submission")
        sid = r.json()["submission"]["submission_id"]

        _paste(stud, sid, AI_LIKE * 2)
        _paste(stud, sid, AI_LIKE * 2)

        r = prof.get(f"{BASE_URL}/api/courses/{course['course_id']}/overview")
        assert r.status_code == 200
        pending_before = r.json()["pending_flags"]
        assert pending_before >= 2

        r = stud.get(f"{BASE_URL}/api/submissions/{sid}/activity")
        pending = [f for f in r.json()["flags"] if f["status"] == "pending_student"]
        assert len(pending) >= 2

        # Clear one via citation
        stud.post(f"{BASE_URL}/api/flags/{pending[0]['flag_id']}/explain",
                  json={"category": "quoted_cited_source", "free_text": "", "ai_statement": ""})
        # Escalate the other
        stud.post(f"{BASE_URL}/api/flags/{pending[1]['flag_id']}/explain",
                  json={"category": "own_work", "free_text": "mine", "ai_statement": ""})

        r = prof.get(f"{BASE_URL}/api/courses/{course['course_id']}/overview")
        pending_after = r.json()["pending_flags"]
        assert pending_after == pending_before - 1, (
            f"cleared_by_citation should be excluded: before={pending_before} after={pending_after}"
        )

        r = prof.get(f"{BASE_URL}/api/assignments/{aid}/submissions")
        assert r.status_code == 200
        s = [x for x in r.json()["submissions"] if x["submission_id"] == sid][0]
        assert s["flag_count"] >= 2
        assert s["pending_flags"] == 1  # only escalated one
