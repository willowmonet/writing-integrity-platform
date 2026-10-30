# Academic Integrity — Monitored Writing Platform (PRD)

## Original problem statement
An integrated browser for assignment submissions across schools/universities. Students write essays/assignments in a monitored editor (keystroke, paste, tab-switch monitoring) with a "course-specified AI" built by the professor that answers ONLY from uploaded course material. Professors upload PDFs/text to build the AI, set monitoring strictness, review flagged items (paste with AI-likelihood + likely source, tab switching, keystroke anomalies) and activity logs. Students can submit explanations + AI-usage statements for flags, and ask the teacher follow-up questions. Design: sleek like Grammarly (editor + AI on the side), professional.

## Stack / Architecture
- Frontend: React (CRA), Tailwind + shadcn/ui, framer motion, react-router. Serif (Spectral) document canvas + Archivo/IBM Plex Sans UI.
- Backend: FastAPI (/api prefix), Motor/MongoDB.
- Auth: Emergent-managed Google OAuth, session_token httpOnly cookie, role selection (professor/student).
- AI: Claude Sonnet 4.6 via Emergent Universal LLM key (emergentintegrations), SSE streaming. Lexical retrieval over course chunks + strict grounding system prompt with citations + out-of-scope fallback.
- Ingestion: pypdf + text parser -> semantic chunks in Mongo.
- Detection: heuristic AI-likelihood estimate (size, phrasing, uniformity, polish, structure) + low-confidence likely-source guess.

## Personas
- Professor: builds course AI (uploads material), sets strictness + AI tone, reviews/resolves flags, answers student questions.
- Student: writes in monitored editor, uses course AI, receives flags, submits explanations + AI-usage statement, asks teacher.

## Core requirements (static)
1. Monitored writing editor (keystroke/paste/tab-switch) — transparent to student.
2. Course-scoped AI grounded strictly in professor material, with citations + fallback.
3. Professor material upload (PDF/text) to build the AI.
4. Configurable monitoring strictness (lenient/standard/strict).
5. Flag list with AI-likelihood + likely source, tab-switch, keystroke; activity log.
6. Student explanation + AI-usage statement before escalation; professor resolves.
7. Ask-the-teacher follow-up thread.

## Implemented (2026-06 / iteration 1) — verified 27/27 backend + UI flows
- Google OAuth + role select; professor & student dashboards.
- Course create + join by code; enrollment.
- Material upload (PDF via pypdf, and paste-text) -> chunk indexing.
- Assignments; per-student submissions with autosave + submit-lock.
- Grammarly-style editor: serif canvas + right-side streaming Course Assistant (Claude), citations, grounded/out-of-scope handling, live monitoring counters.
- Monitoring events: paste flagging (AI-likelihood + source + signals), tab-switch, keystroke; strictness thresholds.
- Student inbox: explanation categories + AI-usage statement -> escalate.
- Professor course page tabs: Overview KPIs, AI Material, Assignments, Flags (detail sheet + resolve legitimate/violation + CSV export), Questions (reply), Monitoring settings (strictness + AI tone + roster).
- Ask-the-teacher thread.

## Backlog / remaining
- P1: Dense activity timeline chart (Recharts) per submission on professor side; keystroke playback/revision diffs.
- P1: Accommodation pre-declaration affecting thresholds (fairness).
- P2: Embedding-based retrieval (currently lexical) for paraphrase robustness.
- P2: Auto-escalation timeout when student never explains; "resolved_by" audit on legitimate resolutions.
- P2: a11y — add DialogDescription/aria-describedby on sheets/dialogs.
- P2: LMS/LTI roster sync; scheduled retention/deletion jobs.

## Implemented (2026-06 / iteration 2)
- Revision snapshots (POST /submissions/{id}/snapshot; throttled autosave + on paste + on submit) and GET /submissions/{id}/revisions.
- Professor **Submission Review** page (/submission/{id}/review): revision growth line chart with large-jump highlighting, **Revision Playback** (slider + play/pause stepping through content), and a chronological **Activity Timeline** of pastes/tab-switches/keystroke bursts + flags.
- Professor Assignments tab now expands to list each submission (with flag counts) linking to the review page; flag detail sheet links to the timeline.
- Student **Pre-Submit Summary** dialog: session stats (words, pastes, tab switches, AI questions, typed/pasted chars), list of flags with an "explain first" nudge, and an optional AI-usage declaration saved on submit (GET /submissions/{id}/integrity-summary).
- Verified: 12/12 new backend tests + full UI flows (iteration_2), no functional bugs.

## Next tasks
- Add per-submission activity timeline + revision snapshots for professors.
- Wire strictness "keystroke anomaly" richer signals; show student a pre-submit integrity summary.
