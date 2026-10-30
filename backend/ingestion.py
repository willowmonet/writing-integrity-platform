"""Parse uploaded course material (PDF / plain text) into semantic chunks."""
import io
import re
from typing import List, Dict

MAX_CHUNK_CHARS = 1100
MIN_CHUNK_CHARS = 200


def parse_pdf(data: bytes) -> List[Dict]:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    segments = []
    for i, page in enumerate(reader.pages):
        text = (page.extract_text() or "").strip()
        if text:
            segments.append({"text": text, "section_label": f"Page {i + 1}", "page": i + 1})
    return segments


def parse_text(data: bytes) -> List[Dict]:
    text = data.decode("utf-8", errors="ignore")
    segments = []
    # Split on markdown-ish headings or blank-line paragraphs, keep a label
    blocks = re.split(r"\n\s*\n", text)
    label = "Section 1"
    idx = 1
    for block in blocks:
        block = block.strip()
        if not block:
            continue
        first = block.splitlines()[0].strip()
        if len(first) < 80 and (first.isupper() or re.match(r"^#+\s", first) or first.endswith(":")):
            label = re.sub(r"^#+\s*", "", first).rstrip(":")
            idx += 1
        segments.append({"text": block, "section_label": label, "page": None})
    if not segments and text.strip():
        segments.append({"text": text.strip(), "section_label": "Document", "page": None})
    return segments


def chunk_segments(segments: List[Dict]) -> List[Dict]:
    """Group segments by section within a size band; split oversized segments."""
    chunks: List[Dict] = []
    buf = ""
    label = None
    page = None

    def flush():
        nonlocal buf, label, page
        if buf.strip():
            chunks.append({"text": buf.strip(), "section_label": label or "Document", "page": page})
        buf = ""

    for seg in segments:
        text = seg["text"]
        if label is None:
            label, page = seg["section_label"], seg["page"]
        # New section boundary
        if seg["section_label"] != label and buf:
            flush()
            label, page = seg["section_label"], seg["page"]
        # Oversized single segment: hard split
        while len(text) > MAX_CHUNK_CHARS:
            if buf:
                flush()
                label, page = seg["section_label"], seg["page"]
            cut = text.rfind(". ", 0, MAX_CHUNK_CHARS)
            cut = cut + 1 if cut > MIN_CHUNK_CHARS else MAX_CHUNK_CHARS
            chunks.append({"text": text[:cut].strip(), "section_label": seg["section_label"], "page": seg["page"]})
            text = text[cut:].strip()
        if len(buf) + len(text) > MAX_CHUNK_CHARS:
            flush()
            label, page = seg["section_label"], seg["page"]
        buf = (buf + "\n\n" + text).strip() if buf else text
    flush()
    return chunks


def ingest(filename: str, content_type: str, data: bytes) -> List[Dict]:
    name = (filename or "").lower()
    if name.endswith(".pdf") or (content_type or "").endswith("pdf"):
        segments = parse_pdf(data)
    else:
        segments = parse_text(data)
    return chunk_segments(segments)
