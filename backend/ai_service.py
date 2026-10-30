"""Course-scoped grounded assistant: lexical retrieval over course chunks +
Claude Sonnet 4.6, constrained to answer only from the retrieved material."""
import os
import re
from typing import AsyncGenerator, Dict, List, Tuple

from dotenv import load_dotenv
from emergentintegrations.llm.chat import LlmChat, UserMessage, TextDelta, StreamDone

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
STOPWORDS = set(
    "the a an and or of to in on for is are was were be been being this that these those with as at by from it its into about "
    "what how why when where which who whom do does did can could should would will i you we they he she".split()
)


def _tokens(text: str) -> List[str]:
    return [t for t in re.findall(r"[a-z0-9]+", text.lower()) if t not in STOPWORDS and len(t) > 2]


def retrieve(question: str, chunks: List[Dict], top_k: int = 4) -> Tuple[List[Dict], float]:
    q = _tokens(question)
    if not q or not chunks:
        return [], 0.0
    qset = set(q)
    scored = []
    for ch in chunks:
        ctoks = _tokens(ch["text"])
        if not ctoks:
            continue
        cset = set(ctoks)
        overlap = qset & cset
        if not overlap:
            continue
        # coverage of query terms + frequency weighting, normalized by length
        coverage = len(overlap) / len(qset)
        freq = sum(ctoks.count(t) for t in overlap) / (len(ctoks) ** 0.5)
        score = coverage * 0.7 + min(freq / 5, 1.0) * 0.3
        scored.append((score, ch))
    scored.sort(key=lambda x: x[0], reverse=True)
    top = [c for _, c in scored[:top_k]]
    best = scored[0][0] if scored else 0.0
    return top, best


def build_system_message(course_name: str, tone: str, excerpts: List[Dict], history: List[Dict]) -> str:
    tone_line = {
        "socratic": "Guide the student with Socratic questions and hints rather than just handing over answers.",
        "direct": "Answer directly and concisely.",
        "detailed": "Give thorough, well-explained answers.",
    }.get(tone, "Answer clearly and helpfully.")

    if excerpts:
        material = "\n\n".join(
            f"[{i+1}] (from {e.get('section_label') or 'material'}):\n{e['text']}"
            for i, e in enumerate(excerpts)
        )
    else:
        material = "(No relevant course material was found for this question.)"

    hist = ""
    if history:
        hist = "\n\nRecent conversation (for context):\n" + "\n".join(
            f"{m['role'].upper()}: {m['content'][:400]}" for m in history[-4:]
        )

    return (
        f"You are the course assistant for \"{course_name}\". {tone_line}\n\n"
        "STRICT GROUNDING RULES:\n"
        "1. Answer ONLY using the COURSE MATERIAL excerpts below. Do not use outside knowledge.\n"
        "2. Cite the excerpts you use with bracketed numbers like [1], [2].\n"
        "3. If the excerpts do not contain the answer, say clearly that it is not covered in the "
        "course material provided and suggest the student ask their teacher a follow-up question. "
        "Do NOT guess or fabricate.\n"
        "4. Never invent citations or facts.\n\n"
        f"COURSE MATERIAL:\n{material}{hist}"
    )


async def stream_answer(
    session_id: str,
    course_name: str,
    tone: str,
    question: str,
    chunks: List[Dict],
    history: List[Dict],
) -> AsyncGenerator[Dict, None]:
    """Yields {'type':'delta','content':..} events then a final
    {'type':'done','answer':..,'citations':..,'grounded':..}."""
    excerpts, best = retrieve(question, chunks)
    grounded = best >= 0.12 and len(excerpts) > 0

    system_message = build_system_message(course_name, tone, excerpts, history)
    chat = LlmChat(api_key=os.environ.get("EMERGENT_LLM_KEY", ""), session_id=session_id,
                   system_message=system_message).with_model("anthropic", "claude-sonnet-4-6")

    answer = ""
    try:
        async for event in chat.stream_message(UserMessage(text=question)):
            if isinstance(event, TextDelta):
                answer += event.content
                yield {"type": "delta", "content": event.content}
            elif isinstance(event, StreamDone):
                break
    except Exception as exc:  # noqa: BLE001
        yield {"type": "error", "content": f"Assistant error: {exc}"}
        return

    citations = [
        {"n": i + 1, "section_label": e.get("section_label"), "page": e.get("page"),
         "snippet": e["text"][:220]}
        for i, e in enumerate(excerpts)
    ]
    yield {"type": "done", "answer": answer, "citations": citations, "grounded": grounded}
