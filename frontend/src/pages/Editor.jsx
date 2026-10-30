import React, { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, streamAsk } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  RadioGroup, RadioGroupItem,
} from "@/components/ui/radio-group";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  ArrowLeft, Send, Sparkles, BookOpen, Loader2, ShieldCheck, CircleDot, Clipboard,
  MousePointerClick, CheckCircle2, GraduationCap, MessageCircleQuestion, Quote, AlertTriangle, Lock,
} from "lucide-react";

function countWords(t) { return t.trim() ? t.trim().split(/\s+/).length : 0; }

const CLARIFY_CATEGORIES = [
  ["quoted_cited_source", "Quoted / cited source"],
  ["own_work", "My own earlier work"],
  ["ai_assisted", "I used AI (disclose below)"],
  ["assistive_tech", "Dictation / assistive tech"],
  ["accommodation", "Documented accommodation"],
  ["other", "Other"],
];

const CLEARED_LABEL = {
  cleared_by_citation: ["Cleared — cited source", "text-accent"],
  cleared_by_declaration: ["Cleared — AI use disclosed", "text-accent"],
  escalated: ["Sent to professor for review", "text-primary"],
};

function FlagClarifyRow({ flag, onCleared }) {
  const [category, setCategory] = useState(flag.has_citation ? "quoted_cited_source" : "own_work");
  const [aiStatement, setAiStatement] = useState("");
  const [freeText, setFreeText] = useState("");
  const [busy, setBusy] = useState(false);

  const cleared = flag.status && flag.status !== "pending_student";
  if (cleared) {
    const [label, cls] = CLEARED_LABEL[flag.status] || ["Explained", "text-muted-foreground"];
    return (
      <div className="rounded-lg border border-border bg-card p-3 flex items-center gap-2 text-sm">
        <CheckCircle2 className={`h-4 w-4 ${cls}`} />
        <span className="capitalize font-medium">{flag.type.replace("_", " ")}</span>
        <span className={`ml-auto text-xs ${cls}`}>{label}</span>
      </div>
    );
  }

  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/flags/${flag.flag_id}/explain`, { category, ai_statement: aiStatement, free_text: freeText });
      toast.success("Clarification recorded");
      onCleared?.();
    } catch { toast.error("Could not save"); setBusy(false); }
  };

  const willClear = category === "quoted_cited_source" || category === "ai_assisted" || aiStatement.trim();

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50/60 p-3 space-y-2.5" data-testid={`clarify-flag-${flag.flag_id}`}>
      <div className="flex items-center gap-2 text-xs">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
        <span className="capitalize font-medium text-amber-900">{flag.type.replace("_", " ")}</span>
        {flag.type === "paste" && <span className="text-amber-800/70">{flag.ai_likelihood}% AI · {flag.likely_source}</span>}
        {flag.has_citation && <Badge variant="outline" className="text-[10px] border-accent/40 text-accent">citation detected</Badge>}
      </div>
      {flag.snippet && <div className="text-xs text-amber-900/70 bg-white/60 rounded px-2 py-1 max-h-16 overflow-y-auto scroll-thin line-clamp-3">{flag.snippet}</div>}
      <Select value={category} onValueChange={setCategory}>
        <SelectTrigger data-testid={`clarify-category-${flag.flag_id}`} className="h-9 bg-white text-sm"><SelectValue /></SelectTrigger>
        <SelectContent>
          {CLARIFY_CATEGORIES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
        </SelectContent>
      </Select>
      {(category === "ai_assisted") && (
        <Textarea data-testid={`clarify-ai-statement-${flag.flag_id}`} value={aiStatement} onChange={(e) => setAiStatement(e.target.value)}
          rows={2} className="bg-white text-sm" placeholder="Describe exactly how you used AI here (per your institution's policy)." />
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" data-testid={`clarify-submit-${flag.flag_id}`} onClick={submit} disabled={busy}
          className={willClear ? "bg-accent hover:bg-accent/90 gap-1.5" : "gap-1.5"}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          {willClear ? "Clear this flag" : "Send to professor"}
        </Button>
        <span className="text-[11px] text-amber-800/70">
          {willClear ? "This disclosure clears the flag." : "This will be reviewed by your professor."}
        </span>
      </div>
    </div>
  );
}

export default function Editor() {
  const { submissionId } = useParams();
  const navigate = useNavigate();
  const [ctx, setCtx] = useState(null);
  const [content, setContent] = useState("");
  const [saveState, setSaveState] = useState("saved");
  const [monitor, setMonitor] = useState({ pastes: 0, tabs: 0, ai: 0 });

  // AI panel
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const aiScrollRef = useRef(null);

  // teacher
  const [teacherOpen, setTeacherOpen] = useState(false);
  const [teacherMsgs, setTeacherMsgs] = useState([]);
  const [teacherQ, setTeacherQ] = useState("");

  // flag explain
  const [flagToExplain, setFlagToExplain] = useState(null);

  // pre-submit integrity summary
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summary, setSummary] = useState(null);
  const [declaration, setDeclaration] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const lastSnapLen = useRef(0);
  const contentRef = useRef("");

  const saveTimer = useRef(null);
  const typedSinceSend = useRef(0);
  const typeWindowStart = useRef(Date.now());
  const blurStart = useRef(null);
  const submitted = ctx?.submission?.status === "submitted";

  const load = useCallback(async () => {
    const { data } = await api.get(`/submissions/${submissionId}`);
    setCtx(data);
    setContent(data.submission.content || "");
    contentRef.current = data.submission.content || "";
    lastSnapLen.current = (data.submission.content || "").length;
    const [m, tq] = await Promise.all([
      api.get(`/submissions/${submissionId}/ai/messages`),
      api.get(`/courses/${data.course.course_id}/questions`),
    ]);
    setMessages(m.data);
    setTeacherMsgs(tq.data);
  }, [submissionId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    aiScrollRef.current?.scrollTo({ top: aiScrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const sendEvent = useCallback(async (type, data) => {
    try {
      const { data: res } = await api.post(`/submissions/${submissionId}/events`, { type, data });
      return res;
    } catch { return null; }
  }, [submissionId]);

  const snapshot = useCallback(async (trigger) => {
    const text = contentRef.current;
    if (text.length === lastSnapLen.current && trigger === "autosave") return;
    lastSnapLen.current = text.length;
    try { await api.post(`/submissions/${submissionId}/snapshot`, { content: text, word_count: countWords(text), trigger }); } catch {}
  }, [submissionId]);

  // Periodic revision snapshot for playback
  useEffect(() => {
    if (submitted) return;
    const t = setInterval(() => snapshot("autosave"), 12000);
    return () => clearInterval(t);
  }, [snapshot, submitted]);

  // Tab-switch monitoring
  useEffect(() => {
    if (submitted) return;
    let tabCount = 0;
    const onBlur = () => { blurStart.current = Date.now(); };
    const onFocus = async () => {
      if (blurStart.current) {
        const away = Date.now() - blurStart.current;
        blurStart.current = null;
        if (away > 800) {
          tabCount += 1;
          setMonitor((m) => ({ ...m, tabs: m.tabs + 1 }));
          const res = await sendEvent("tab_switch", { count: tabCount, away_ms: away });
          if (res?.flagged) toast.warning("Tab switch recorded and flagged for review.");
        }
      }
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => { window.removeEventListener("blur", onBlur); window.removeEventListener("focus", onFocus); };
  }, [sendEvent, submitted]);

  // Periodic keystroke stats
  useEffect(() => {
    if (submitted) return;
    const t = setInterval(async () => {
      const typed = typedSinceSend.current;
      if (typed > 0) {
        const minutes = (Date.now() - typeWindowStart.current) / 60000;
        const wpm = minutes > 0 ? (typed / 5) / minutes : 0;
        typedSinceSend.current = 0;
        typeWindowStart.current = Date.now();
        await sendEvent("keystroke", { typed_chars: typed, wpm });
      }
    }, 15000);
    return () => clearInterval(t);
  }, [sendEvent, submitted]);

  const doSave = useCallback(async (text) => {
    setSaveState("saving");
    try {
      await api.put(`/submissions/${submissionId}`, { content: text, word_count: countWords(text) });
      setSaveState("saved");
    } catch { setSaveState("error"); }
  }, [submissionId]);

  const onChange = (e) => {
    const val = e.target.value;
    const delta = val.length - content.length;
    if (delta > 0) typedSinceSend.current += delta;
    setContent(val);
    contentRef.current = val;
    setSaveState("unsaved");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => doSave(val), 1200);
  };

  const onPaste = async (e) => {
    const text = e.clipboardData.getData("text");
    if (!text) return;
    setMonitor((m) => ({ ...m, pastes: m.pastes + 1 }));
    const res = await sendEvent("paste", { text });
    setTimeout(() => snapshot("paste"), 300);
    if (res?.flagged) {
      setMonitor((m) => ({ ...m, ai: m.ai + 1 }));
      toast.warning(`Paste flagged (${res.flag.ai_likelihood}% AI-likelihood). You can explain it from your Inbox.`, { duration: 6000 });
    } else if (res?.ai_likelihood != null) {
      toast.info(`Paste recorded (${res.ai_likelihood}% AI-likelihood estimate).`);
    }
  };

  const ask = async () => {
    const q = question.trim();
    if (!q || asking) return;
    if (ctx.course.material_count === 0) { toast.error("No course material has been added yet."); return; }
    setQuestion("");
    setAsking(true);
    setMessages((prev) => [...prev, { role: "user", content: q },
      { role: "assistant", content: "", citations: [], streaming: true }]);
    await streamAsk(submissionId, q, {
      onDelta: (c) => setMessages((prev) => {
        const copy = [...prev]; copy[copy.length - 1] = { ...copy[copy.length - 1], content: copy[copy.length - 1].content + c }; return copy;
      }),
      onDone: (payload) => setMessages((prev) => {
        const copy = [...prev]; copy[copy.length - 1] = { role: "assistant", content: payload.answer, citations: payload.citations, grounded: payload.grounded }; return copy;
      }),
      onError: (msg) => { toast.error(msg); setMessages((prev) => prev.slice(0, -1)); },
    });
    setAsking(false);
  };

  const openSummary = async () => {
    await doSave(content);
    await snapshot("submit");
    try {
      const { data } = await api.get(`/submissions/${submissionId}/integrity-summary`);
      setSummary(data);
      setSummaryOpen(true);
    } catch { toast.error("Could not load summary"); }
  };

  const refreshSummary = async () => {
    try { const { data } = await api.get(`/submissions/${submissionId}/integrity-summary`); setSummary(data); } catch {}
  };

  const confirmSubmit = async () => {
    setSubmitting(true);
    try {
      await api.post(`/submissions/${submissionId}/submit`, { declaration });
      toast.success("Assignment submitted");
      setCtx((c) => ({ ...c, submission: { ...c.submission, status: "submitted" } }));
      setSummaryOpen(false);
    } catch { toast.error("Could not submit"); }
    finally { setSubmitting(false); }
  };

  const sendTeacher = async () => {
    if (!teacherQ.trim()) return;
    try {
      await api.post(`/courses/${ctx.course.course_id}/questions`, { question: teacherQ, submission_id: submissionId });
      toast.success("Sent to your teacher");
      setTeacherQ("");
      const { data } = await api.get(`/courses/${ctx.course.course_id}/questions`);
      setTeacherMsgs(data);
    } catch { toast.error("Could not send"); }
  };

  if (!ctx) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#F9F9F8]">
      {/* Top bar */}
      <header className="h-14 shrink-0 border-b border-border bg-card/80 backdrop-blur-xl flex items-center px-4 sm:px-6 gap-4 z-20">
        <button data-testid="editor-back-btn" onClick={() => navigate("/")} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Exit</span>
        </button>
        <div className="h-5 w-px bg-border" />
        <div className="min-w-0">
          <div className="font-medium text-sm truncate">{ctx.assignment?.title}</div>
          <div className="text-xs text-muted-foreground truncate">{ctx.course.name}</div>
        </div>
        <div className="flex-1" />
        {/* Live monitoring transparency */}
        <div className="hidden md:flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5 text-destructive/80"><CircleDot className="h-3 w-3 animate-pulse" /> Monitored</span>
          <span className="flex items-center gap-1" data-testid="monitor-pastes"><Clipboard className="h-3.5 w-3.5" /> {monitor.pastes}</span>
          <span className="flex items-center gap-1" data-testid="monitor-tabs"><MousePointerClick className="h-3.5 w-3.5" /> {monitor.tabs}</span>
        </div>
        <span className="text-xs text-muted-foreground w-16 text-right" data-testid="save-state">
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Error" : "Editing…"}
        </span>
        {submitted ? (
          <Badge className="bg-accent gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Submitted</Badge>
        ) : (
          <Button size="sm" data-testid="submit-assignment-btn" onClick={openSummary} className="gap-1.5">
            <ShieldCheck className="h-4 w-4" /> Submit
          </Button>
        )}
      </header>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
        {/* Editor canvas */}
        <div className="lg:col-span-8 xl:col-span-9 overflow-y-auto scroll-thin doc-canvas">
          <div className="max-w-3xl mx-auto px-6 sm:px-10 py-14">
            {ctx.assignment?.prompt && (
              <div className="mb-8 p-4 rounded-xl bg-white border border-border">
                <p className="overline-label text-muted-foreground mb-1.5">Prompt</p>
                <p className="text-sm text-muted-foreground font-serif-doc leading-relaxed">{ctx.assignment.prompt}</p>
              </div>
            )}
            <textarea
              data-testid="editor-textarea"
              value={content}
              onChange={onChange}
              onPaste={onPaste}
              readOnly={submitted}
              placeholder="Begin writing your response here…"
              spellCheck
              className="w-full min-h-[60vh] bg-transparent resize-none border-0 outline-none font-serif-doc text-lg leading-[1.9] text-[#1a2230] placeholder:text-[#9aa5b1]"
            />
            <div className="mt-6 flex items-center gap-4 text-xs text-muted-foreground border-t border-border pt-4">
              <span data-testid="word-count">{countWords(content)} words</span>
              {submitted && <span className="flex items-center gap-1 text-accent"><Lock className="h-3 w-3" /> This submission is locked</span>}
            </div>
          </div>
        </div>

        {/* AI sidebar */}
        <aside className="lg:col-span-4 xl:col-span-3 border-l border-border bg-white flex flex-col overflow-hidden shadow-[-4px_0_24px_rgba(0,0,0,0.02)] z-10">
          <div className="shrink-0 px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-accent text-accent-foreground flex items-center justify-center"><Sparkles className="h-4 w-4" /></div>
              <div>
                <div className="font-display font-bold text-sm tracking-tight">Course Assistant</div>
                <div className="text-[11px] text-muted-foreground">Answers only from {ctx.course.name} material</div>
              </div>
            </div>
          </div>

          <div ref={aiScrollRef} className="flex-1 overflow-y-auto scroll-thin px-5 py-5 space-y-5">
            {messages.length === 0 && (
              <div className="text-center py-10">
                <BookOpen className="h-8 w-8 mx-auto text-accent/40 mb-3" />
                <p className="text-sm text-muted-foreground leading-relaxed px-2">
                  Ask about the course material. I'll answer using your professor's uploaded content and cite it.
                  I won't use outside knowledge.
                </p>
                {ctx.course.material_count === 0 && (
                  <Badge variant="outline" className="mt-4 text-amber-600 border-amber-300">No material added yet</Badge>
                )}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`ai-msg-fade ${m.role === "user" ? "flex justify-end" : ""}`}>
                {m.role === "user" ? (
                  <div className="bg-primary text-primary-foreground rounded-2xl rounded-br-sm px-4 py-2.5 text-sm max-w-[85%]">{m.content}</div>
                ) : (
                  <div className="max-w-full">
                    <div className="bg-[#F0F7F7] border border-accent/10 rounded-2xl rounded-bl-sm px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap text-[#16303a]">
                      {m.content || (m.streaming && <span className="inline-flex gap-1"><Loader2 className="h-3.5 w-3.5 animate-spin" /> thinking…</span>)}
                    </div>
                    {m.grounded === false && m.content && (
                      <div className="flex items-center gap-1.5 mt-2 text-xs text-amber-600">
                        <AlertTriangle className="h-3.5 w-3.5" /> Not found in course material — try Ask the Teacher.
                      </div>
                    )}
                    {m.citations?.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        {m.citations.map((c) => (
                          <div key={c.n} className="flex gap-2 text-[11px] text-muted-foreground bg-secondary/50 rounded-lg px-2.5 py-1.5">
                            <Quote className="h-3 w-3 shrink-0 mt-0.5 text-accent" />
                            <span><b>[{c.n}] {c.section_label}{c.page ? ` · p.${c.page}` : ""}</b> — {c.snippet}…</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="shrink-0 border-t border-border p-3 space-y-2">
            <div className="flex items-end gap-2">
              <Textarea
                data-testid="ai-question-input"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } }}
                placeholder="Ask about the material…"
                rows={1}
                className="resize-none min-h-[42px] max-h-32"
              />
              <Button data-testid="ai-ask-btn" size="icon" onClick={ask} disabled={asking} className="h-[42px] w-[42px] shrink-0 bg-accent hover:bg-accent/90">
                {asking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
            <button data-testid="ask-teacher-btn" onClick={() => setTeacherOpen(true)}
              className="w-full flex items-center justify-center gap-1.5 text-xs text-primary hover:underline py-1">
              <GraduationCap className="h-3.5 w-3.5" /> Still stuck? Ask your teacher
            </button>
          </div>
        </aside>
      </div>

      {/* Ask the teacher dialog */}
      <Dialog open={teacherOpen} onOpenChange={setTeacherOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><MessageCircleQuestion className="h-5 w-5" /> Ask your teacher</DialogTitle></DialogHeader>
          <div className="max-h-72 overflow-y-auto scroll-thin space-y-3 py-2">
            {teacherMsgs.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No questions yet. Ask a follow-up your professor will see.</p>}
            {teacherMsgs.map((q) => (
              <div key={q.question_id} className="text-sm">
                <div className="bg-secondary/60 rounded-xl px-3 py-2">{q.question}</div>
                {q.answer ? (
                  <div className="mt-1.5 ml-4 pl-3 border-l-2 border-accent"><b>Teacher:</b> {q.answer}</div>
                ) : <Badge variant="outline" className="mt-1.5 text-xs">Waiting for reply</Badge>}
              </div>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <Textarea value={teacherQ} onChange={(e) => setTeacherQ(e.target.value)} placeholder="Type your question…" data-testid="teacher-question-input" rows={2} />
            <Button onClick={sendTeacher} data-testid="send-teacher-btn" className="h-11"><Send className="h-4 w-4" /></Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Pre-submit integrity summary */}
      <Dialog open={summaryOpen} onOpenChange={setSummaryOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-accent" /> Before you submit</DialogTitle>
            <DialogDescription>Review your writing session and clarify any flagged items before final submission.</DialogDescription>
          </DialogHeader>
          {summary && (
            <div className="space-y-5 py-1">
              <p className="text-sm text-muted-foreground">Here's a transparent summary of your writing session. Nothing here blocks submission — it's for your awareness and honesty.</p>
              <div className="grid grid-cols-3 gap-3">
                {[
                  ["Words", summary.word_count],
                  ["Pastes", summary.paste_count],
                  ["Tab switches", summary.tab_switches],
                  ["AI questions", summary.ai_questions],
                  ["Typed chars", summary.typed_chars],
                  ["Pasted chars", summary.pasted_chars],
                ].map(([label, val]) => (
                  <div key={label} className="p-3 rounded-xl bg-secondary/50 border border-border text-center">
                    <div className="font-display text-xl font-bold" data-testid={`summary-${label.toLowerCase().replace(/ /g,'-')}`}>{val}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{label}</div>
                  </div>
                ))}
              </div>

              {summary.flags.length > 0 ? (
                <div className="space-y-2.5">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    {summary.flags.length} flagged item{summary.flags.length !== 1 && "s"} — clarify before submitting
                  </div>
                  <p className="text-xs text-muted-foreground -mt-1">
                    Disclosing AI use or marking a quoted/cited source clears the flag. Other reasons are sent to your professor.
                  </p>
                  <div className="space-y-2 max-h-64 overflow-y-auto scroll-thin pr-1" data-testid="pre-submit-flags">
                    {summary.flags.map((f) => (
                      <FlagClarifyRow key={f.flag_id} flag={f} onCleared={refreshSummary} />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-accent/30 bg-[#F0F7F7] p-4 flex items-center gap-2 text-sm text-accent">
                  <CheckCircle2 className="h-4 w-4" /> No items were flagged during this session.
                </div>
              )}

              <div>
                <p className="overline-label text-muted-foreground mb-2">AI-usage declaration (optional)</p>
                <Textarea data-testid="declaration-input" value={declaration} onChange={(e) => setDeclaration(e.target.value)} rows={2}
                  placeholder="State how you used AI on this assignment, if at all (per your institution's policy)." />
              </div>

              <div className="flex gap-3">
                <Button variant="ghost" className="flex-1" onClick={() => setSummaryOpen(false)}>Keep writing</Button>
                <Button data-testid="confirm-submit-btn" onClick={confirmSubmit} disabled={submitting} className="flex-1 gap-2">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Submit assignment
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
