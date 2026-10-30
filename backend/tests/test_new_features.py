"""Iteration-2 backend tests: snapshots, revisions, integrity summary, submit-with-declaration,
assignment submissions listing for professor. Also lightweight regression for flag resolve."""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://integrity-desk.preview.emergentagent.com").rstrip("/")
PROF_TOKEN = "test_session_prof_1"
STUD_TOKEN = "test_session_stud_1"


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
    """Create a fresh TEST course, add material, assignment, enroll student, open submission."""
    # Create course
    cname = f"TEST_IT2_{uuid.uuid4().hex[:6]}"
    r = prof.post(f"{BASE_URL}/api/courses", json={"name": cname, "description": "it2"})
    assert r.status_code == 200, r.text
    course = r.json()

    # Add text material so AI endpoint can work
    r = prof.post(f"{BASE_URL}/api/courses/{course['course_id']}/materials/text",
                  data={"title": "Rawls", "content": "The veil of ignorance is a device of representation."},
                  headers={"Content-Type": "application/x-www-form-urlencoded",
                           "Authorization": f"Bearer {PROF_TOKEN}"})
    assert r.status_code == 200, r.text

    # Assignment
    r = prof.post(f"{BASE_URL}/api/courses/{course['course_id']}/assignments",
                  json={"title": "TEST Essay", "prompt": "Discuss."})
    assert r.status_code == 200
    asg = r.json()

    # Enroll student
    r = stud.post(f"{BASE_URL}/api/courses/join", json={"code": course["code"]})
    assert r.status_code == 200

    # Open submission
    r = stud.post(f"{BASE_URL}/api/assignments/{asg['assignment_id']}/submission")
    assert r.status_code == 200
    sub = r.json()["submission"]

    return {"course": course, "assignment": asg, "submission": sub}


# ----------------------- Snapshots + revisions -----------------------
class TestSnapshotsAndRevisions:
    def test_snapshot_records_sequence_and_delta(self, stud, ctx):
        sid = ctx["submission"]["submission_id"]
        r1 = stud.post(f"{BASE_URL}/api/submissions/{sid}/snapshot",
                       json={"content": "Hello world.", "word_count": 2, "trigger": "autosave"})
        assert r1.status_code == 200
        d1 = r1.json()
        assert d1["seq"] == 0
        assert d1["delta"] == len("Hello world.")

        r2 = stud.post(f"{BASE_URL}/api/submissions/{sid}/snapshot",
                       json={"content": "Hello world. More text here.", "word_count": 5, "trigger": "autosave"})
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["seq"] == 1
        assert d2["delta"] == len("Hello world. More text here.") - len("Hello world.")

    def test_paste_snapshot_large_positive_delta(self, stud, ctx):
        sid = ctx["submission"]["submission_id"]
        big = "Hello world. More text here." + (" " + "pasted content" * 30)
        r = stud.post(f"{BASE_URL}/api/submissions/{sid}/snapshot",
                      json={"content": big, "word_count": 60, "trigger": "paste"})
        assert r.status_code == 200
        assert r.json()["delta"] > 100

    def test_list_revisions_sorted(self, stud, ctx):
        sid = ctx["submission"]["submission_id"]
        r = stud.get(f"{BASE_URL}/api/submissions/{sid}/revisions")
        assert r.status_code == 200
        revs = r.json()
        assert len(revs) >= 3
        seqs = [x["seq"] for x in revs]
        assert seqs == sorted(seqs)
        assert any(x["trigger"] == "paste" for x in revs)
        # Fields present
        for x in revs:
            assert "content" in x and "char_count" in x and "delta" in x and "created_at" in x

    def test_professor_can_list_revisions(self, prof, ctx):
        sid = ctx["submission"]["submission_id"]
        r = prof.get(f"{BASE_URL}/api/submissions/{sid}/revisions")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_other_student_cannot_snapshot(self, ctx):
        # Unauthenticated call is 401
        sid = ctx["submission"]["submission_id"]
        r = requests.post(f"{BASE_URL}/api/submissions/{sid}/snapshot",
                          json={"content": "x", "trigger": "autosave"})
        assert r.status_code == 401


# ----------------------- Integrity summary -----------------------
class TestIntegritySummary:
    def test_summary_includes_counts_and_flags(self, stud, ctx):
        sid = ctx["submission"]["submission_id"]
        # Generate a paste event that will flag
        ai_like = ("Furthermore, it is imperative to note that the multifaceted nature of justice "
                   "necessitates a comprehensive analytical framework. Moreover, one must consider "
                   "the intersectionality of moral obligations vis-à-vis societal constructs. "
                   "In conclusion, the aforementioned principles delineate a paradigm shift.") * 3
        r = stud.post(f"{BASE_URL}/api/submissions/{sid}/events",
                      json={"type": "paste", "data": {"text": ai_like}})
        assert r.status_code == 200

        # tab_switch event
        stud.post(f"{BASE_URL}/api/submissions/{sid}/events",
                  json={"type": "tab_switch", "data": {"count": 1, "away_ms": 2000}})

        r = stud.get(f"{BASE_URL}/api/submissions/{sid}/integrity-summary")
        assert r.status_code == 200
        s = r.json()
        for k in ("word_count", "typed_chars", "pasted_chars", "paste_count",
                  "tab_switches", "ai_questions", "flags", "unexplained_flags"):
            assert k in s
        assert s["paste_count"] >= 1
        assert s["tab_switches"] >= 1
        assert s["pasted_chars"] >= len(ai_like)
        assert isinstance(s["flags"], list)
        assert len(s["flags"]) >= 1
        assert s["unexplained_flags"] >= 1


# ----------------------- Assignment submissions (professor) -----------------------
class TestAssignmentSubmissionsListing:
    def test_professor_lists_submissions(self, prof, ctx):
        aid = ctx["assignment"]["assignment_id"]
        r = prof.get(f"{BASE_URL}/api/assignments/{aid}/submissions")
        assert r.status_code == 200
        d = r.json()
        assert "assignment" in d and "submissions" in d
        assert d["assignment"]["assignment_id"] == aid
        assert len(d["submissions"]) >= 1
        s0 = d["submissions"][0]
        assert "flag_count" in s0 and "pending_flags" in s0
        assert s0["flag_count"] >= 1  # from the paste flag above

    def test_student_cannot_list_submissions(self, stud, ctx):
        aid = ctx["assignment"]["assignment_id"]
        r = stud.get(f"{BASE_URL}/api/assignments/{aid}/submissions")
        assert r.status_code == 403


# ----------------------- Submit with declaration -----------------------
class TestSubmitWithDeclaration:
    def test_submit_saves_declaration_and_locks(self, stud, ctx):
        sid = ctx["submission"]["submission_id"]
        declaration = "I used AI only for brainstorming, not for generating final text."
        r = stud.post(f"{BASE_URL}/api/submissions/{sid}/submit",
                      json={"declaration": declaration})
        assert r.status_code == 200

        # GET verifies persistence
        r = stud.get(f"{BASE_URL}/api/submissions/{sid}")
        assert r.status_code == 200
        sub = r.json()["submission"]
        assert sub["status"] == "submitted"
        assert sub.get("declaration") == declaration
        assert sub.get("submitted_at")

        # Editor is locked: further save returns 400
        r = stud.put(f"{BASE_URL}/api/submissions/{sid}",
                     json={"content": "should not save", "word_count": 3})
        assert r.status_code == 400

    def test_submit_without_declaration_accepted(self, prof, stud, ctx):
        # Create another submission (new assignment) to test empty declaration
        r = prof.post(f"{BASE_URL}/api/courses/{ctx['course']['course_id']}/assignments",
                      json={"title": "TEST Essay 2", "prompt": ""})
        aid = r.json()["assignment_id"]
        r = stud.post(f"{BASE_URL}/api/assignments/{aid}/submission")
        sid = r.json()["submission"]["submission_id"]
        r = stud.post(f"{BASE_URL}/api/submissions/{sid}/submit", json={})
        assert r.status_code == 200
        r = stud.get(f"{BASE_URL}/api/submissions/{sid}")
        assert r.json()["submission"]["declaration"] == ""


# ----------------------- Regression: activity endpoint & flag resolve -----------------------
class TestRegression:
    def test_activity_returns_events_and_flags(self, prof, ctx):
        sid = ctx["submission"]["submission_id"]
        r = prof.get(f"{BASE_URL}/api/submissions/{sid}/activity")
        assert r.status_code == 200
        d = r.json()
        assert "events" in d and "flags" in d
        assert len(d["events"]) >= 2  # paste + tab_switch
        assert len(d["flags"]) >= 1
        # Events sorted asc by created_at
        times = [e["created_at"] for e in d["events"]]
        assert times == sorted(times)

    def test_professor_resolve_flag(self, prof, ctx):
        cid = ctx["course"]["course_id"]
        r = prof.get(f"{BASE_URL}/api/courses/{cid}/flags")
        assert r.status_code == 200
        flags = r.json()
        pending = [f for f in flags if not f["status"].startswith("resolved")]
        assert pending, "expected at least one open flag"
        fid = pending[0]["flag_id"]
        r = prof.post(f"{BASE_URL}/api/flags/{fid}/resolve",
                      json={"outcome": "legitimate", "note": "cleared"})
        assert r.status_code == 200
        r = prof.get(f"{BASE_URL}/api/flags/{fid}")
        assert r.json()["status"] == "resolved_legitimate"
