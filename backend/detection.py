"""Heuristic AI-likelihood estimation for paste events.

This is an ESTIMATE, never a certainty. It combines size, structural and
stylometric signals into a 0-100 likelihood and a low-confidence guess at
which assistant a paste may have come from. Always surfaced to students as an
estimate they can contest with an explanation and an AI-usage statement.
"""
import re
from typing import Dict, List

# Stylistic markers frequently seen in LLM output
AI_PHRASES = [
    "certainly", "in conclusion", "furthermore", "moreover", "however",
    "it is important to note", "overall", "in summary", "additionally",
    "firstly", "secondly", "delve", "it's worth noting", "a testament to",
    "navigating the", "in the realm of", "plays a crucial role", "as an ai",
    "i cannot", "landscape of", "tapestry",
]

SOURCE_MARKERS = {
    "ChatGPT": ["certainly!", "here's", "sure!", "i hope this helps", "let me know if"],
    "Claude": ["i'd be happy to", "here's a", "i should note", "to be clear", "that said"],
    "Gemini": ["here are", "sure, here", "absolutely", "key takeaways", "in essence"],
}


def _sentences(text: str) -> List[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]


def detect_citation(text: str) -> bool:
    """Heuristic: does this paste look like a quoted / cited source?"""
    lower = text.lower()
    patterns = [
        r"\([A-Z][A-Za-z.\-]+(?:\s+(?:et al\.|and|&)\s+[A-Z][A-Za-z.\-]+)*,?\s*\d{4}[a-z]?(?:,?\s*p{1,2}\.?\s*\d+)?\)",  # (Author, 2020) / (Smith & Lee, 2019, p. 12)
        r"\[\d+\]",                       # [1] numeric references
        r"\bet al\.",                    # et al.
        r"\bdoi:\s*\S+",                 # doi:
        r"https?://\S+",                 # URLs
        r"\bpp?\.\s*\d+",                # p. 12 / pp. 12-15
        r"\bibid\b|\bcf\.\b|\bibidem\b",  # scholarly refs
        r"\bretrieved from\b|\baccessed\b",
    ]
    for p in patterns:
        if re.search(p, text if p[0] != "\\" else lower):
            return True
    # Quotation marks wrapping a meaningful chunk
    quoted = re.findall(r"[\"“”][^\"“”]{15,}[\"“”]", text)
    if quoted and sum(len(q) for q in quoted) >= max(40, 0.3 * len(text)):
        return True
    return False


def analyze_paste(text: str, size_chars: int) -> Dict:
    lower = text.lower()
    signals: List[str] = []
    score = 0.0

    # 1) Size — large pastes are inherently more suspicious in a writing tool
    if size_chars >= 800:
        score += 30; signals.append("Very large paste (800+ chars)")
    elif size_chars >= 300:
        score += 18; signals.append("Large paste (300+ chars)")
    elif size_chars >= 120:
        score += 8; signals.append("Moderate paste")

    # 2) Phrase markers
    hits = [p for p in AI_PHRASES if p in lower]
    if hits:
        score += min(len(hits) * 7, 28)
        signals.append(f"AI-typical phrasing ({len(hits)} markers)")

    # 3) Uniform sentence length (LLMs tend to be even)
    sents = _sentences(text)
    if len(sents) >= 4:
        lengths = [len(s) for s in sents]
        mean = sum(lengths) / len(lengths)
        var = sum((l - mean) ** 2 for l in lengths) / len(lengths)
        cv = (var ** 0.5) / mean if mean else 0
        if cv < 0.45:
            score += 16; signals.append("Unusually uniform sentence length")

    # 4) Clean prose — no typos / double spaces, heavy punctuation polish
    if "  " not in text and size_chars > 200 and not re.search(r"\b(teh|recieve|dont|im|cant)\b", lower):
        score += 8; signals.append("Highly polished, error-free prose")

    # 5) Markdown / list structure
    if re.search(r"(^|\n)\s*(\d+\.|[-*•])\s", text) or "**" in text or "###" in text:
        score += 10; signals.append("Structured markdown / lists")

    # 6) Em-dash density (common in LLM output)
    if text.count("—") >= 2:
        score += 6; signals.append("Frequent em-dashes")

    score = max(0, min(100, round(score)))

    # Citations / quotes strongly reduce AI-likelihood (legitimate scholarly practice)
    has_citation = detect_citation(text)
    if has_citation:
        score = max(0, score - 30)
        signals.append("Appears to include quotes / cited sources")

    # Likely source — deliberately low confidence
    likely_source = "Unknown"
    best = 0
    for name, markers in SOURCE_MARKERS.items():
        c = sum(1 for m in markers if m in lower)
        if c > best:
            best, likely_source = c, name
    if has_citation and score < 40:
        likely_source = "Cited source"
    elif score < 35:
        likely_source = "Unlikely AI"

    return {
        "ai_likelihood": score,
        "likely_source": likely_source,
        "signals": signals,
        "has_citation": has_citation,
    }
