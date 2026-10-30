import os
import io
import csv
import json
import uuid
import logging
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import List, Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, UploadFile, File, Form, Body
from fastapi.responses import StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field

import ingestion
import detection
import ai_service

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("integrity")

app = FastAPI(title="Academic Integrity — Monitored Writing Platform")
api = APIRouter(prefix="/api")

AUTH_SESSION_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def gen_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


# ----------------------------- Models -----------------------------
class RoleIn(BaseModel):
    role: str


class CourseIn(BaseModel):
    name: str
    code: Optional[str] = None
    description: Optional[str] = ""


class CourseConfigIn(BaseModel):
    strictness: Optional[str] = None       # lenient | standard | strict
    ai_tone: Optional[str] = None          # socratic | direct | detailed
    description: Optional[str] = None
    name: Optional[str] = None


class JoinIn(BaseModel):
    code: str


class AssignmentIn(BaseModel):
    title: str
    prompt: Optional[str] = ""


class SaveContentIn(BaseModel):
    content: str
    word_count: Optional[int] = 0


class AskIn(BaseModel):
    question: str


class EventIn(BaseModel):
    type: str                              # paste | tab_switch | keystroke
    data: dict = {}


class ExplainIn(BaseModel):
    category: str                          # own_work | assistive_tech | accommodation | ai_assisted | other
    ai_statement: str = ""
    free_text: str = ""


class ResolveIn(BaseModel):
    outcome: str                           # legitimate | violation
    note: str = ""


class TeacherQuestionIn(BaseModel):
    question: str
    submission_id: Optional[str] = None


class AnswerIn(BaseModel):
    answer: str


class SnapshotIn(BaseModel):
    content: str
    word_count: int = 0
    trigger: str = "autosave"


class SubmitIn(BaseModel):
    declaration: Optional[str] = ""


STRICTNESS = {
    "lenient":  {"paste_threshold": 600, "ai_cutoff": 70, "flag_tabs": False, "tab_limit": 12},
    "standard": {"paste_threshold": 300, "ai_cutoff": 50, "flag_tabs": True,  "tab_limit": 6},
    "strict":   {"paste_threshold": 120, "ai_cutoff": 35, "flag_tabs": True,  "tab_limit": 3},
}


# ----------------------------- Auth -----------------------------
async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("session_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    sess = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not sess:
        raise HTTPException(status_code=401, detail="Invalid session")
    expires_at = sess["expires_at"]
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired")
    user = await db.users.find_one({"user_id": sess["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


async def require_professor(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "professor":
        raise HTTPException(status_code=403, detail="Professor access required")
    return user


@api.post("/auth/session")
async def auth_session(request: Request, response: Response):
    body = await request.json()
    session_id = body.get("session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id required")
    async with httpx.AsyncClient() as hc:
        r = await hc.get(AUTH_SESSION_URL, headers={"X-Session-ID": session_id})
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Auth exchange failed")
    data = r.json()
    email = data["email"]
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one({"user_id": user_id}, {"$set": {"name": data.get("name"), "picture": data.get("picture")}})
        user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    else:
        user_id = gen_id("user")
        user = {
            "user_id": user_id,
            "email": email,
            "name": data.get("name"),
            "picture": data.get("picture"),
            "role": None,
            "created_at": now_iso(),
        }
        await db.users.insert_one(dict(user))
        user.pop("_id", None)

    session_token = data["session_token"]
    expires = datetime.now(timezone.utc) + timedelta(days=7)
    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": expires.isoformat(),
        "created_at": now_iso(),
    })
    response.set_cookie("session_token", session_token, httponly=True, secure=True,
                        samesite="none", path="/", max_age=7 * 24 * 3600)
    return {"user": {k: user.get(k) for k in ("user_id", "email", "name", "picture", "role")},
            "session_token": session_token}


@api.get("/auth/me")
async def auth_me(user: dict = Depends(get_current_user)):
    return {k: user.get(k) for k in ("user_id", "email", "name", "picture", "role")}


@api.post("/auth/role")
async def set_role(body: RoleIn, user: dict = Depends(get_current_user)):
    if body.role not in ("professor", "student"):
        raise HTTPException(status_code=400, detail="Invalid role")
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"role": body.role}})
    return {"role": body.role}


@api.post("/auth/logout")
async def logout(request: Request, response: Response):
    token = request.cookies.get("session_token")
    auth = request.headers.get("Authorization", "")
    if not token and auth.startswith("Bearer "):
        token = auth[7:]
    if token:
        await db.user_sessions.delete_one({"session_token": token})
    response.delete_cookie("session_token", path="/")
    return {"ok": True}


# ----------------------------- Courses -----------------------------
async def load_course(course_id: str) -> dict:
    c = await db.courses.find_one({"course_id": course_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Course not found")
    return c


async def assert_enrolled(course_id: str, user: dict):
    if user.get("role") == "professor":
        c = await load_course(course_id)
        if c["professor_id"] != user["user_id"]:
            raise HTTPException(status_code=403, detail="Not your course")
        return
    e = await db.enrollments.find_one({"course_id": course_id, "student_id": user["user_id"]})
    if not e:
        raise HTTPException(status_code=403, detail="Not enrolled")


@api.post("/courses")
async def create_course(body: CourseIn, user: dict = Depends(require_professor)):
    course = {
        "course_id": gen_id("course"),
        "professor_id": user["user_id"],
        "professor_name": user.get("name"),
        "name": body.name,
        "code": (body.code or uuid.uuid4().hex[:6]).upper(),
        "description": body.description or "",
        "strictness": "standard",
        "ai_tone": "socratic",
        "created_at": now_iso(),
    }
    await db.courses.insert_one(dict(course))
    course.pop("_id", None)
    return course


@api.get("/courses")
async def list_courses(user: dict = Depends(get_current_user)):
    if user.get("role") == "professor":
        courses = await db.courses.find({"professor_id": user["user_id"]}, {"_id": 0}).to_list(200)
    else:
        enr = await db.enrollments.find({"student_id": user["user_id"]}, {"_id": 0}).to_list(200)
        ids = [e["course_id"] for e in enr]
        courses = await db.courses.find({"course_id": {"$in": ids}}, {"_id": 0}).to_list(200)
    for c in courses:
        c["material_count"] = await db.materials.count_documents({"course_id": c["course_id"]})
        c["assignment_count"] = await db.assignments.count_documents({"course_id": c["course_id"]})
        c["student_count"] = await db.enrollments.count_documents({"course_id": c["course_id"]})
    return courses


@api.get("/courses/{course_id}")
async def get_course(course_id: str, user: dict = Depends(get_current_user)):
    await assert_enrolled(course_id, user)
    c = await load_course(course_id)
    c["material_count"] = await db.materials.count_documents({"course_id": course_id})
    c["student_count"] = await db.enrollments.count_documents({"course_id": course_id})
    return c


@api.patch("/courses/{course_id}")
async def update_course(course_id: str, body: CourseConfigIn, user: dict = Depends(require_professor)):
    await assert_enrolled(course_id, user)
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if "strictness" in updates and updates["strictness"] not in STRICTNESS:
        raise HTTPException(status_code=400, detail="Invalid strictness")
    if updates:
        await db.courses.update_one({"course_id": course_id}, {"$set": updates})
    return await load_course(course_id)


@api.post("/courses/join")
async def join_course(body: JoinIn, user: dict = Depends(get_current_user)):
    if user.get("role") != "student":
        raise HTTPException(status_code=403, detail="Only students join courses")
    course = await db.courses.find_one({"code": body.code.strip().upper()}, {"_id": 0})
    if not course:
        raise HTTPException(status_code=404, detail="No course with that code")
    exists = await db.enrollments.find_one({"course_id": course["course_id"], "student_id": user["user_id"]})
    if not exists:
        await db.enrollments.insert_one({
            "enrollment_id": gen_id("enr"),
            "course_id": course["course_id"],
            "student_id": user["user_id"],
            "student_name": user.get("name"),
            "student_email": user.get("email"),
            "created_at": now_iso(),
        })
    return course


@api.get("/courses/{course_id}/students")
async def course_students(course_id: str, user: dict = Depends(require_professor)):
    await assert_enrolled(course_id, user)
    enr = await db.enrollments.find({"course_id": course_id}, {"_id": 0}).to_list(500)
    return enr


# ----------------------------- Materials -----------------------------
@api.post("/courses/{course_id}/materials")
async def upload_material(course_id: str, file: UploadFile = File(...), user: dict = Depends(require_professor)):
    await assert_enrolled(course_id, user)
    data = await file.read()
    try:
        chunks = ingestion.ingest(file.filename, file.content_type, data)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Could not parse file: {exc}")
    if not chunks:
        raise HTTPException(status_code=400, detail="No text could be extracted from this file")
    material_id = gen_id("mat")
    await db.materials.insert_one({
        "material_id": material_id,
        "course_id": course_id,
        "filename": file.filename,
        "chunk_count": len(chunks),
        "created_at": now_iso(),
    })
    docs = [{
        "chunk_id": gen_id("chunk"),
        "material_id": material_id,
        "course_id": course_id,
        "text": ch["text"],
        "section_label": ch["section_label"],
        "page": ch["page"],
        "order": i,
    } for i, ch in enumerate(chunks)]
    await db.chunks.insert_many(docs)
    return {"material_id": material_id, "filename": file.filename, "chunk_count": len(chunks)}


@api.post("/courses/{course_id}/materials/text")
async def add_text_material(course_id: str, title: str = Form(...), content: str = Form(...),
                            user: dict = Depends(require_professor)):
    await assert_enrolled(course_id, user)
    chunks = ingestion.ingest(f"{title}.txt", "text/plain", content.encode("utf-8"))
    if not chunks:
        raise HTTPException(status_code=400, detail="No text provided")
    material_id = gen_id("mat")
    await db.materials.insert_one({
        "material_id": material_id, "course_id": course_id, "filename": title,
        "chunk_count": len(chunks), "created_at": now_iso(),
    })
    docs = [{
        "chunk_id": gen_id("chunk"), "material_id": material_id, "course_id": course_id,
        "text": ch["text"], "section_label": ch["section_label"], "page": ch["page"], "order": i,
    } for i, ch in enumerate(chunks)]
    await db.chunks.insert_many(docs)
    return {"material_id": material_id, "filename": title, "chunk_count": len(chunks)}


@api.get("/courses/{course_id}/materials")
async def list_materials(course_id: str, user: dict = Depends(get_current_user)):
    await assert_enrolled(course_id, user)
    mats = await db.materials.find({"course_id": course_id}, {"_id": 0}).sort("created_at", 1).to_list(200)
    return mats


@api.delete("/materials/{material_id}")
async def delete_material(material_id: str, user: dict = Depends(require_professor)):
    mat = await db.materials.find_one({"material_id": material_id}, {"_id": 0})
    if not mat:
        raise HTTPException(status_code=404, detail="Not found")
    await assert_enrolled(mat["course_id"], user)
    await db.materials.delete_one({"material_id": material_id})
    await db.chunks.delete_many({"material_id": material_id})
    return {"ok": True}


# ----------------------------- Assignments & submissions -----------------------------
@api.post("/courses/{course_id}/assignments")
async def create_assignment(course_id: str, body: AssignmentIn, user: dict = Depends(require_professor)):
    await assert_enrolled(course_id, user)
    a = {
        "assignment_id": gen_id("asg"), "course_id": course_id,
        "title": body.title, "prompt": body.prompt or "", "created_at": now_iso(),
    }
    await db.assignments.insert_one(dict(a))
    a.pop("_id", None)
    return a


@api.get("/courses/{course_id}/assignments")
async def list_assignments(course_id: str, user: dict = Depends(get_current_user)):
    await assert_enrolled(course_id, user)
    asg = await db.assignments.find({"course_id": course_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    if user.get("role") == "student":
        for a in asg:
            sub = await db.submissions.find_one(
                {"assignment_id": a["assignment_id"], "student_id": user["user_id"]}, {"_id": 0})
            a["submission"] = sub
    else:
        for a in asg:
            a["submission_count"] = await db.submissions.count_documents({"assignment_id": a["assignment_id"]})
    return asg


async def get_or_create_submission(assignment_id: str, user: dict) -> dict:
    sub = await db.submissions.find_one(
        {"assignment_id": assignment_id, "student_id": user["user_id"]}, {"_id": 0})
    if sub:
        return sub
    asg = await db.assignments.find_one({"assignment_id": assignment_id}, {"_id": 0})
    if not asg:
        raise HTTPException(status_code=404, detail="Assignment not found")
    await assert_enrolled(asg["course_id"], user)
    sub = {
        "submission_id": gen_id("sub"), "assignment_id": assignment_id,
        "course_id": asg["course_id"], "student_id": user["user_id"],
        "student_name": user.get("name"), "student_email": user.get("email"),
        "content": "", "word_count": 0, "status": "draft",
        "typed_chars": 0, "pasted_chars": 0,
        "created_at": now_iso(), "updated_at": now_iso(),
    }
    await db.submissions.insert_one(dict(sub))
    sub.pop("_id", None)
    return sub


@api.post("/assignments/{assignment_id}/submission")
async def open_submission(assignment_id: str, user: dict = Depends(get_current_user)):
    sub = await get_or_create_submission(assignment_id, user)
    asg = await db.assignments.find_one({"assignment_id": assignment_id}, {"_id": 0})
    course = await load_course(sub["course_id"])
    return {"submission": sub, "assignment": asg,
            "course": {"course_id": course["course_id"], "name": course["name"],
                       "strictness": course["strictness"], "ai_tone": course.get("ai_tone", "socratic")}}


async def load_submission(submission_id: str, user: dict) -> dict:
    sub = await db.submissions.find_one({"submission_id": submission_id}, {"_id": 0})
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")
    if user.get("role") == "professor":
        await assert_enrolled(sub["course_id"], user)
    elif sub["student_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not your submission")
    return sub


@api.get("/submissions/{submission_id}")
async def get_submission(submission_id: str, user: dict = Depends(get_current_user)):
    sub = await load_submission(submission_id, user)
    asg = await db.assignments.find_one({"assignment_id": sub["assignment_id"]}, {"_id": 0})
    course = await load_course(sub["course_id"])
    material_count = await db.materials.count_documents({"course_id": sub["course_id"]})
    return {"submission": sub, "assignment": asg,
            "course": {"course_id": course["course_id"], "name": course["name"],
                       "strictness": course["strictness"], "ai_tone": course.get("ai_tone", "socratic"),
                       "material_count": material_count}}


@api.put("/submissions/{submission_id}")
async def save_submission(submission_id: str, body: SaveContentIn, user: dict = Depends(get_current_user)):
    sub = await load_submission(submission_id, user)
    if sub["status"] == "submitted":
        raise HTTPException(status_code=400, detail="Already submitted")
    await db.submissions.update_one({"submission_id": submission_id},
        {"$set": {"content": body.content, "word_count": body.word_count, "updated_at": now_iso()}})
    return {"ok": True}


@api.post("/submissions/{submission_id}/submit")
async def submit_submission(submission_id: str, body: SubmitIn = Body(default_factory=SubmitIn), user: dict = Depends(get_current_user)):
    sub = await load_submission(submission_id, user)
    declaration = (body.declaration if body else "") or ""
    await db.submissions.update_one({"submission_id": submission_id},
        {"$set": {"status": "submitted", "submitted_at": now_iso(), "updated_at": now_iso(),
                  "declaration": declaration}})
    return {"ok": True}


@api.post("/submissions/{submission_id}/snapshot")
async def save_snapshot(submission_id: str, body: SnapshotIn, user: dict = Depends(get_current_user)):
    sub = await load_submission(submission_id, user)
    if sub["student_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Only the author records revisions")
    last = await db.revisions.find_one({"submission_id": submission_id}, {"_id": 0}, sort=[("seq", -1)])
    prev_len = len(last["content"]) if last else 0
    seq = (last["seq"] + 1) if last else 0
    delta = len(body.content) - prev_len
    await db.revisions.insert_one({
        "revision_id": gen_id("rev"), "submission_id": submission_id, "seq": seq,
        "content": body.content, "word_count": body.word_count, "char_count": len(body.content),
        "delta": delta, "trigger": body.trigger, "created_at": now_iso(),
    })
    return {"seq": seq, "delta": delta}


@api.get("/submissions/{submission_id}/revisions")
async def list_revisions(submission_id: str, user: dict = Depends(get_current_user)):
    await load_submission(submission_id, user)
    revs = await db.revisions.find({"submission_id": submission_id}, {"_id": 0}).sort("seq", 1).to_list(2000)
    return revs


@api.get("/submissions/{submission_id}/integrity-summary")
async def integrity_summary(submission_id: str, user: dict = Depends(get_current_user)):
    sub = await load_submission(submission_id, user)
    events = await db.events.find({"submission_id": submission_id}, {"_id": 0}).to_list(2000)
    flags = await db.flags.find({"submission_id": submission_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    pastes = [e for e in events if e["type"] == "paste"]
    tabs = [e for e in events if e["type"] == "tab_switch"]
    ai_msgs = await db.ai_messages.count_documents({"submission_id": submission_id, "role": "user"})
    unexplained = [f for f in flags if f["status"] == "pending_student"]
    return {
        "word_count": sub.get("word_count", 0),
        "typed_chars": sub.get("typed_chars", 0),
        "pasted_chars": sub.get("pasted_chars", 0),
        "paste_count": len(pastes),
        "tab_switches": len(tabs),
        "ai_questions": ai_msgs,
        "flags": flags,
        "unexplained_flags": len(unexplained),
    }


@api.get("/assignments/{assignment_id}/submissions")
async def assignment_submissions(assignment_id: str, user: dict = Depends(require_professor)):
    asg = await db.assignments.find_one({"assignment_id": assignment_id}, {"_id": 0})
    if not asg:
        raise HTTPException(status_code=404, detail="Assignment not found")
    await assert_enrolled(asg["course_id"], user)
    subs = await db.submissions.find({"assignment_id": assignment_id}, {"_id": 0}).to_list(500)
    for s in subs:
        s["flag_count"] = await db.flags.count_documents({"submission_id": s["submission_id"]})
        s["pending_flags"] = await db.flags.count_documents(
            {"submission_id": s["submission_id"], "status": {"$in": ["pending_student", "escalated"]}})
    return {"assignment": asg, "submissions": subs}


# ----------------------------- Monitoring / events -----------------------------
async def create_flag(sub: dict, ftype: str, severity: str, detail: str, extra: dict):
    flag = {
        "flag_id": gen_id("flag"), "submission_id": sub["submission_id"],
        "course_id": sub["course_id"], "student_id": sub["student_id"],
        "student_name": sub.get("student_name"), "type": ftype, "severity": severity,
        "detail": detail, "status": "pending_student", "created_at": now_iso(),
        **extra,
    }
    await db.flags.insert_one(dict(flag))
    flag.pop("_id", None)
    return flag


@api.post("/submissions/{submission_id}/events")
async def log_event(submission_id: str, body: EventIn, user: dict = Depends(get_current_user)):
    sub = await load_submission(submission_id, user)
    course = await load_course(sub["course_id"])
    cfg = STRICTNESS.get(course["strictness"], STRICTNESS["standard"])
    result = {"flagged": False}

    event = {
        "event_id": gen_id("evt"), "submission_id": submission_id,
        "course_id": sub["course_id"], "student_id": sub["student_id"],
        "type": body.type, "data": body.data, "created_at": now_iso(),
    }
    await db.events.insert_one(dict(event))

    if body.type == "paste":
        text = body.data.get("text", "")
        size = len(text)
        analysis = detection.analyze_paste(text, size)
        await db.submissions.update_one({"submission_id": submission_id},
            {"$inc": {"pasted_chars": size}})
        should_flag = size >= cfg["paste_threshold"] or analysis["ai_likelihood"] >= cfg["ai_cutoff"]
        if should_flag:
            severity = "high" if analysis["ai_likelihood"] >= 60 or size >= 800 else "medium"
            flag = await create_flag(sub, "paste", severity,
                f"Pasted {size} characters. AI-likelihood estimate {analysis['ai_likelihood']}%.",
                {"ai_likelihood": analysis["ai_likelihood"], "likely_source": analysis["likely_source"],
                 "signals": analysis["signals"], "snippet": text[:600], "size_chars": size,
                 "has_citation": analysis.get("has_citation", False)})
            result = {"flagged": True, "flag": flag}
        else:
            result = {"flagged": False, "ai_likelihood": analysis["ai_likelihood"],
                      "has_citation": analysis.get("has_citation", False)}

    elif body.type == "tab_switch":
        count = int(body.data.get("count", 1))
        away_ms = int(body.data.get("away_ms", 0))
        if cfg["flag_tabs"] and count >= cfg["tab_limit"]:
            flag = await create_flag(sub, "tab_switch", "medium",
                f"Left the writing tab {count} times (away {round(away_ms/1000)}s total).",
                {"count": count, "away_ms": away_ms})
            result = {"flagged": True, "flag": flag}

    elif body.type == "keystroke":
        typed = int(body.data.get("typed_chars", 0))
        wpm = float(body.data.get("wpm", 0))
        await db.submissions.update_one({"submission_id": submission_id}, {"$inc": {"typed_chars": typed}})
        if wpm > 180 and typed > 200:
            flag = await create_flag(sub, "keystroke", "low",
                f"Unusually fast sustained typing (~{round(wpm)} WPM) — possible transcription/paste-around.",
                {"wpm": round(wpm)})
            result = {"flagged": True, "flag": flag}

    return result


@api.get("/submissions/{submission_id}/activity")
async def submission_activity(submission_id: str, user: dict = Depends(get_current_user)):
    sub = await load_submission(submission_id, user)
    events = await db.events.find({"submission_id": submission_id}, {"_id": 0}).sort("created_at", 1).to_list(1000)
    flags = await db.flags.find({"submission_id": submission_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"submission": sub, "events": events, "flags": flags}


# ----------------------------- AI assistant -----------------------------
@api.get("/submissions/{submission_id}/ai/messages")
async def ai_messages(submission_id: str, user: dict = Depends(get_current_user)):
    await load_submission(submission_id, user)
    msgs = await db.ai_messages.find({"submission_id": submission_id}, {"_id": 0}).sort("created_at", 1).to_list(500)
    return msgs


@api.post("/submissions/{submission_id}/ai/ask")
async def ai_ask(submission_id: str, body: AskIn, user: dict = Depends(get_current_user)):
    sub = await load_submission(submission_id, user)
    course = await load_course(sub["course_id"])
    chunks = await db.chunks.find({"course_id": sub["course_id"]}, {"_id": 0}).to_list(2000)
    history = await db.ai_messages.find({"submission_id": submission_id}, {"_id": 0}).sort("created_at", 1).to_list(50)

    await db.ai_messages.insert_one({
        "message_id": gen_id("msg"), "submission_id": submission_id, "course_id": sub["course_id"],
        "role": "user", "content": body.question, "created_at": now_iso(),
    })

    async def gen():
        collected = {}
        async for ev in ai_service.stream_answer(
            session_id=submission_id, course_name=course["name"],
            tone=course.get("ai_tone", "socratic"), question=body.question,
            chunks=chunks, history=history,
        ):
            if ev["type"] == "done":
                collected = ev
            yield f"data: {json.dumps(ev)}\n\n"
        await db.ai_messages.insert_one({
            "message_id": gen_id("msg"), "submission_id": submission_id, "course_id": sub["course_id"],
            "role": "assistant", "content": collected.get("answer", ""),
            "citations": collected.get("citations", []), "grounded": collected.get("grounded", False),
            "created_at": now_iso(),
        })

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ----------------------------- Flags -----------------------------
@api.get("/courses/{course_id}/flags")
async def course_flags(course_id: str, status: Optional[str] = None, user: dict = Depends(require_professor)):
    await assert_enrolled(course_id, user)
    q = {"course_id": course_id}
    if status:
        q["status"] = status
    flags = await db.flags.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)
    for f in flags:
        f["explanation"] = await db.explanations.find_one({"flag_id": f["flag_id"]}, {"_id": 0})
    return flags


@api.get("/flags/mine")
async def my_flags(user: dict = Depends(get_current_user)):
    flags = await db.flags.find({"student_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    for f in flags:
        f["explanation"] = await db.explanations.find_one({"flag_id": f["flag_id"]}, {"_id": 0})
    return flags


@api.get("/flags/{flag_id}")
async def get_flag(flag_id: str, user: dict = Depends(get_current_user)):
    f = await db.flags.find_one({"flag_id": flag_id}, {"_id": 0})
    if not f:
        raise HTTPException(status_code=404, detail="Flag not found")
    if user.get("role") == "professor":
        await assert_enrolled(f["course_id"], user)
    elif f["student_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not your flag")
    f["explanation"] = await db.explanations.find_one({"flag_id": flag_id}, {"_id": 0})
    return f


@api.post("/flags/{flag_id}/explain")
async def explain_flag(flag_id: str, body: ExplainIn, user: dict = Depends(get_current_user)):
    f = await db.flags.find_one({"flag_id": flag_id}, {"_id": 0})
    if not f or f["student_id"] != user["user_id"]:
        raise HTTPException(status_code=404, detail="Flag not found")
    exp = {
        "explanation_id": gen_id("exp"), "flag_id": flag_id,
        "category": body.category, "ai_statement": body.ai_statement,
        "free_text": body.free_text, "created_at": now_iso(),
    }
    await db.explanations.replace_one({"flag_id": flag_id}, dict(exp), upsert=True)

    # Self-clearing rules: disclosing AI use or declaring a cited source overrides the flag.
    ai_statement = (body.ai_statement or "").strip()
    if body.category == "quoted_cited_source":
        status = "cleared_by_citation"
    elif body.category == "ai_assisted" or ai_statement:
        status = "cleared_by_declaration"
    else:
        status = "escalated"
    await db.flags.update_one({"flag_id": flag_id}, {"$set": {"status": status}})
    return {"ok": True, "status": status}


@api.post("/flags/{flag_id}/resolve")
async def resolve_flag(flag_id: str, body: ResolveIn, user: dict = Depends(require_professor)):
    f = await db.flags.find_one({"flag_id": flag_id}, {"_id": 0})
    if not f:
        raise HTTPException(status_code=404, detail="Flag not found")
    await assert_enrolled(f["course_id"], user)
    if body.outcome not in ("legitimate", "violation"):
        raise HTTPException(status_code=400, detail="Invalid outcome")
    await db.flags.update_one({"flag_id": flag_id}, {"$set": {
        "status": f"resolved_{body.outcome}", "resolution_note": body.note,
        "resolved_by": user["user_id"], "resolved_at": now_iso(),
    }})
    return {"ok": True}


# ----------------------------- Ask the teacher -----------------------------
@api.post("/courses/{course_id}/questions")
async def ask_teacher(course_id: str, body: TeacherQuestionIn, user: dict = Depends(get_current_user)):
    await assert_enrolled(course_id, user)
    q = {
        "question_id": gen_id("q"), "course_id": course_id, "student_id": user["user_id"],
        "student_name": user.get("name"), "submission_id": body.submission_id,
        "question": body.question, "answer": None, "status": "open", "created_at": now_iso(),
    }
    await db.teacher_questions.insert_one(dict(q))
    q.pop("_id", None)
    return q


@api.get("/courses/{course_id}/questions")
async def list_questions(course_id: str, user: dict = Depends(get_current_user)):
    await assert_enrolled(course_id, user)
    q = {"course_id": course_id}
    if user.get("role") == "student":
        q["student_id"] = user["user_id"]
    items = await db.teacher_questions.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return items


@api.post("/questions/{question_id}/answer")
async def answer_question(question_id: str, body: AnswerIn, user: dict = Depends(require_professor)):
    q = await db.teacher_questions.find_one({"question_id": question_id}, {"_id": 0})
    if not q:
        raise HTTPException(status_code=404, detail="Not found")
    await assert_enrolled(q["course_id"], user)
    await db.teacher_questions.update_one({"question_id": question_id},
        {"$set": {"answer": body.answer, "status": "answered", "answered_at": now_iso()}})
    return {"ok": True}


# ----------------------------- Professor overview -----------------------------
@api.get("/courses/{course_id}/overview")
async def course_overview(course_id: str, user: dict = Depends(require_professor)):
    await assert_enrolled(course_id, user)
    total_flags = await db.flags.count_documents({"course_id": course_id})
    pending = await db.flags.count_documents({"course_id": course_id, "status": {"$in": ["pending_student", "escalated"]}})
    high = await db.flags.count_documents({"course_id": course_id, "severity": "high"})
    students = await db.enrollments.count_documents({"course_id": course_id})
    open_q = await db.teacher_questions.count_documents({"course_id": course_id, "status": "open"})
    by_type = {}
    for t in ("paste", "tab_switch", "keystroke"):
        by_type[t] = await db.flags.count_documents({"course_id": course_id, "type": t})
    return {"total_flags": total_flags, "pending_flags": pending, "high_severity": high,
            "students": students, "open_questions": open_q, "flags_by_type": by_type}


@app.get("/api/courses/{course_id}/flags/export")
async def export_flags(course_id: str, request: Request):
    user = await get_current_user(request)
    if user.get("role") != "professor":
        raise HTTPException(status_code=403, detail="Professor only")
    await assert_enrolled(course_id, user)
    flags = await db.flags.find({"course_id": course_id}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["flag_id", "student", "type", "severity", "ai_likelihood", "likely_source", "status", "detail", "created_at"])
    for f in flags:
        w.writerow([f["flag_id"], f.get("student_name"), f["type"], f["severity"],
                    f.get("ai_likelihood", ""), f.get("likely_source", ""), f["status"],
                    f["detail"], f["created_at"]])
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=flags_{course_id}.csv"})


@api.get("/")
async def root():
    return {"status": "ok", "product": "Academic Integrity — Monitored Writing Platform"}


app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown():
    client.close()
