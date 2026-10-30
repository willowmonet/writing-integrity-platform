import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, API } from "@/lib/api";
import TopBar from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "sonner";
import {
  ArrowLeft, Upload, FileText, Trash2, Plus, ShieldAlert, Users, MessageCircleQuestion,
  Loader2, ClipboardCopy, AlertTriangle, Clipboard, MousePointerClick, Keyboard, Download,
  CheckCircle2, XCircle,
} from "lucide-react";

const STRICTNESS_INFO = {
  lenient: "Flags only very large or highly AI-like pastes. Tab switching not flagged.",
  standard: "Balanced. Flags moderate pastes, AI-like content, and excessive tab switching.",
  strict: "Aggressive. Flags small pastes, most AI-like content, and frequent tab switches.",
};

const TYPE_ICON = { paste: Clipboard, tab_switch: MousePointerClick, keystroke: Keyboard };

function StatCard({ label, value, tone = "primary", Icon }) {
  return (
    <div className="p-5 rounded-xl bg-card border border-border">
      <div className="flex items-center justify-between mb-3">
        <span className="overline-label text-muted-foreground">{label}</span>
        <Icon className={`h-4 w-4 text-${tone}`} />
      </div>
      <div className="font-display text-3xl font-bold tracking-tight">{value}</div>
    </div>
  );
}

export default function CoursePage() {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const [course, setCourse] = useState(null);
  const [overview, setOverview] = useState(null);
  const [materials, setMaterials] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [students, setStudents] = useState([]);
  const [flags, setFlags] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [activeFlag, setActiveFlag] = useState(null);

  const loadAll = useCallback(async () => {
    const [c, ov, mat, asg, st, fl, q] = await Promise.all([
      api.get(`/courses/${courseId}`),
      api.get(`/courses/${courseId}/overview`),
      api.get(`/courses/${courseId}/materials`),
      api.get(`/courses/${courseId}/assignments`),
      api.get(`/courses/${courseId}/students`),
      api.get(`/courses/${courseId}/flags`),
      api.get(`/courses/${courseId}/questions`),
    ]);
    setCourse(c.data); setOverview(ov.data); setMaterials(mat.data);
    setAssignments(asg.data); setStudents(st.data); setFlags(fl.data); setQuestions(q.data);
  }, [courseId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  if (!course) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  const copyCode = () => { navigator.clipboard.writeText(course.code); toast.success("Join code copied"); };

  const updateConfig = async (patch) => {
    const { data } = await api.patch(`/courses/${courseId}`, patch);
    setCourse((c) => ({ ...c, ...data }));
    toast.success("Settings updated");
  };

  return (
    <div className="min-h-screen bg-background">
      <TopBar />
      <main className="max-w-6xl mx-auto px-5 sm:px-8 py-8">
        <button data-testid="back-btn" onClick={() => navigate("/")} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors">
          <ArrowLeft className="h-4 w-4" /> All courses
        </button>
        <div className="flex flex-wrap items-center gap-3 mb-8">
          <div className="flex-1 min-w-0">
            <h1 className="font-display text-3xl font-bold tracking-tight truncate">{course.name}</h1>
            <p className="text-sm text-muted-foreground mt-1">{course.description}</p>
          </div>
          <button data-testid="copy-code-btn" onClick={copyCode} className="flex items-center gap-2 px-4 h-11 rounded-xl bg-primary/10 text-primary font-mono font-semibold hover:bg-primary/15 transition-colors">
            {course.code} <ClipboardCopy className="h-4 w-4" />
          </button>
        </div>

        <Tabs defaultValue="overview">
          <TabsList className="mb-6 flex-wrap h-auto">
            <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="materials" data-testid="tab-materials">AI Material</TabsTrigger>
            <TabsTrigger value="assignments" data-testid="tab-assignments">Assignments</TabsTrigger>
            <TabsTrigger value="flags" data-testid="tab-flags">
              Flags {overview?.pending_flags > 0 && <span className="ml-1.5 text-xs bg-destructive text-white rounded-full px-1.5">{overview.pending_flags}</span>}
            </TabsTrigger>
            <TabsTrigger value="questions" data-testid="tab-questions">
              Questions {overview?.open_questions > 0 && <span className="ml-1.5 text-xs bg-accent text-white rounded-full px-1.5">{overview.open_questions}</span>}
            </TabsTrigger>
            <TabsTrigger value="settings" data-testid="tab-settings">Monitoring</TabsTrigger>
          </TabsList>

          {/* OVERVIEW */}
          <TabsContent value="overview">
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <StatCard label="Students" value={overview?.students ?? 0} Icon={Users} />
              <StatCard label="Total flags" value={overview?.total_flags ?? 0} tone="accent" Icon={ShieldAlert} />
              <StatCard label="Needs review" value={overview?.pending_flags ?? 0} tone="destructive" Icon={AlertTriangle} />
              <StatCard label="Open questions" value={overview?.open_questions ?? 0} tone="accent" Icon={MessageCircleQuestion} />
            </div>
            <div className="grid sm:grid-cols-3 gap-4">
              {["paste", "tab_switch", "keystroke"].map((t) => {
                const Icon = TYPE_ICON[t];
                return (
                  <div key={t} className="p-5 rounded-xl bg-card border border-border flex items-center gap-4">
                    <div className="h-11 w-11 rounded-lg bg-secondary flex items-center justify-center"><Icon className="h-5 w-5 text-primary" /></div>
                    <div>
                      <div className="font-display text-2xl font-bold">{overview?.flags_by_type?.[t] ?? 0}</div>
                      <div className="text-xs text-muted-foreground capitalize">{t.replace("_", " ")} flags</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </TabsContent>

          {/* MATERIALS */}
          <TabsContent value="materials">
            <MaterialsTab courseId={courseId} materials={materials} reload={loadAll} />
          </TabsContent>

          {/* ASSIGNMENTS */}
          <TabsContent value="assignments">
            <AssignmentsTab courseId={courseId} assignments={assignments} reload={loadAll} />
          </TabsContent>

          {/* FLAGS */}
          <TabsContent value="flags">
            <FlagsTab courseId={courseId} flags={flags} onOpen={setActiveFlag} />
          </TabsContent>

          {/* QUESTIONS */}
          <TabsContent value="questions">
            <QuestionsTab questions={questions} reload={loadAll} />
          </TabsContent>

          {/* SETTINGS */}
          <TabsContent value="settings">
            <div className="max-w-xl space-y-8">
              <div>
                <label className="overline-label text-muted-foreground">Monitoring strictness</label>
                <Select value={course.strictness} onValueChange={(v) => updateConfig({ strictness: v })}>
                  <SelectTrigger data-testid="strictness-select" className="mt-2 h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lenient">Lenient</SelectItem>
                    <SelectItem value="standard">Standard</SelectItem>
                    <SelectItem value="strict">Strict</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground mt-2">{STRICTNESS_INFO[course.strictness]}</p>
              </div>
              <div>
                <label className="overline-label text-muted-foreground">Course AI answer style</label>
                <Select value={course.ai_tone || "socratic"} onValueChange={(v) => updateConfig({ ai_tone: v })}>
                  <SelectTrigger data-testid="tone-select" className="mt-2 h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="socratic">Socratic (guides with questions)</SelectItem>
                    <SelectItem value="direct">Direct (concise answers)</SelectItem>
                    <SelectItem value="detailed">Detailed (thorough explanations)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground mt-2">The AI always answers strictly from your uploaded material, regardless of style.</p>
              </div>
              <div className="pt-4 border-t border-border">
                <label className="overline-label text-muted-foreground">Enrolled students</label>
                <div className="mt-3 space-y-2">
                  {students.length === 0 && <p className="text-sm text-muted-foreground">No students yet. Share the join code <b>{course.code}</b>.</p>}
                  {students.map((s) => (
                    <div key={s.enrollment_id} className="flex items-center gap-3 text-sm p-2 rounded-lg bg-secondary/50">
                      <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">{(s.student_name || "?").slice(0,1)}</div>
                      <span className="font-medium">{s.student_name}</span>
                      <span className="text-muted-foreground text-xs">{s.student_email}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </main>

      <FlagDetail flag={activeFlag} onClose={() => setActiveFlag(null)} reload={loadAll} />
    </div>
  );
}

function MaterialsTab({ courseId, materials, reload }) {
  const [uploading, setUploading] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      await api.post(`/courses/${courseId}/materials`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(`Added ${file.name}`);
      await reload();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Upload failed");
    } finally { setUploading(false); e.target.value = ""; }
  };

  const addText = async () => {
    if (!title.trim() || !content.trim()) return;
    const fd = new FormData();
    fd.append("title", title); fd.append("content", content);
    try {
      await api.post(`/courses/${courseId}/materials/text`, fd);
      toast.success("Material added"); setTextOpen(false); setTitle(""); setContent("");
      await reload();
    } catch { toast.error("Could not add text"); }
  };

  const del = async (id) => {
    await api.delete(`/materials/${id}`); toast.success("Removed"); await reload();
  };

  return (
    <div>
      <div className="rounded-2xl border border-border bg-card p-6 mb-6">
        <h3 className="font-display text-lg font-bold mb-1">Build the course AI's knowledge</h3>
        <p className="text-sm text-muted-foreground mb-5">Upload PDFs or paste text. The assistant answers students strictly from this material — nothing else.</p>
        <div className="flex flex-wrap gap-3">
          <label data-testid="upload-material-btn" className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-primary text-primary-foreground font-medium cursor-pointer hover:opacity-90 transition-opacity">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload PDF / text file
            <input type="file" accept=".pdf,.txt,.md,text/plain" className="hidden" onChange={onFile} disabled={uploading} />
          </label>
          <Dialog open={textOpen} onOpenChange={setTextOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" data-testid="paste-text-btn" className="h-11 gap-2"><Plus className="h-4 w-4" /> Paste text</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle className="font-display">Add text material</DialogTitle></DialogHeader>
              <div className="space-y-3 py-2">
                <Input placeholder="Title (e.g. Lecture 3 Notes)" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="text-material-title" />
                <Textarea placeholder="Paste the course text here..." value={content} onChange={(e) => setContent(e.target.value)} rows={10} data-testid="text-material-content" />
              </div>
              <DialogFooter><Button onClick={addText} data-testid="save-text-material">Add material</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {materials.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-10">No material yet. The AI can't answer questions until you add some.</p>
      ) : (
        <div className="space-y-3" data-testid="materials-list">
          {materials.map((m) => (
            <div key={m.material_id} className="flex items-center gap-4 p-4 rounded-xl bg-card border border-border">
              <div className="h-10 w-10 rounded-lg bg-accent/10 text-accent flex items-center justify-center"><FileText className="h-5 w-5" /></div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{m.filename}</div>
                <div className="text-xs text-muted-foreground">{m.chunk_count} passages indexed</div>
              </div>
              <Button variant="ghost" size="icon" data-testid={`delete-material-${m.material_id}`} onClick={() => del(m.material_id)} className="text-muted-foreground hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AssignmentsTab({ courseId, assignments, reload }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [subs, setSubs] = useState([]);
  const [loadingSubs, setLoadingSubs] = useState(false);

  const create = async () => {
    if (!title.trim()) return;
    try {
      await api.post(`/courses/${courseId}/assignments`, { title, prompt });
      toast.success("Assignment created"); setOpen(false); setTitle(""); setPrompt("");
      await reload();
    } catch { toast.error("Could not create"); }
  };

  const toggle = async (a) => {
    if (expanded === a.assignment_id) { setExpanded(null); return; }
    setExpanded(a.assignment_id); setLoadingSubs(true); setSubs([]);
    try {
      const { data } = await api.get(`/assignments/${a.assignment_id}/submissions`);
      setSubs(data.submissions);
    } finally { setLoadingSubs(false); }
  };

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button data-testid="new-assignment-btn" className="gap-2"><Plus className="h-4 w-4" /> New assignment</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle className="font-display">New assignment</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <Input placeholder="Title (e.g. Essay 1: Justice)" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="assignment-title-input" />
              <Textarea placeholder="Prompt / instructions for students" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} data-testid="assignment-prompt-input" />
            </div>
            <DialogFooter><Button onClick={create} data-testid="create-assignment-submit">Create</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {assignments.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-10">No assignments yet.</p>
      ) : (
        <div className="space-y-3" data-testid="prof-assignments-list">
          {assignments.map((a) => (
            <div key={a.assignment_id} className="rounded-xl bg-card border border-border overflow-hidden">
              <button data-testid={`assignment-toggle-${a.assignment_id}`} onClick={() => toggle(a)} className="w-full p-5 flex items-center gap-3 text-left hover:bg-secondary/30 transition-colors">
                <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center"><FileText className="h-4 w-4" /></div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold">{a.title}</div>
                  <div className="text-xs text-muted-foreground">{a.submission_count} submissions · tap to review</div>
                </div>
              </button>
              {expanded === a.assignment_id && (
                <div className="border-t border-border p-4 bg-secondary/20">
                  {loadingSubs ? (
                    <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
                  ) : subs.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-3">No submissions yet.</p>
                  ) : (
                    <div className="space-y-2" data-testid={`submissions-${a.assignment_id}`}>
                      {subs.map((s) => (
                        <button key={s.submission_id} data-testid={`review-submission-${s.submission_id}`}
                          onClick={() => navigate(`/submission/${s.submission_id}/review`)}
                          className="w-full flex items-center gap-3 p-3 rounded-lg bg-card border border-border hover:border-primary transition-colors text-left">
                          <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">{(s.student_name || "?").slice(0,1)}</div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{s.student_name}</div>
                            <div className="text-xs text-muted-foreground">{s.word_count} words · <span className="capitalize">{s.status}</span></div>
                          </div>
                          {s.pending_flags > 0 && <Badge className="bg-destructive text-white text-xs">{s.pending_flags} to review</Badge>}
                          {s.flag_count > 0 && s.pending_flags === 0 && <Badge variant="secondary" className="text-xs">{s.flag_count} flags</Badge>}
                          <span className="text-xs text-primary">Review →</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {a.prompt && expanded !== a.assignment_id && <p className="text-sm text-muted-foreground px-5 pb-4 -mt-2 pl-[4.25rem]">{a.prompt}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FlagsTab({ courseId, flags, onOpen }) {
  const sevColor = { high: "bg-destructive text-white", medium: "bg-amber-500 text-white", low: "bg-secondary text-secondary-foreground" };
  const statusLabel = {
    pending_student: "Awaiting student", escalated: "Needs your review",
    cleared_by_citation: "Cleared · cited", cleared_by_declaration: "Cleared · AI disclosed",
    resolved_legitimate: "Cleared", resolved_violation: "Violation",
  };
  const statusColor = (s) =>
    s === "escalated" ? "text-destructive font-medium"
    : s?.startsWith("cleared") || s === "resolved_legitimate" ? "text-accent"
    : s === "resolved_violation" ? "text-destructive" : "text-muted-foreground";
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-muted-foreground">{flags.length} flagged item{flags.length !== 1 && "s"}</p>
        <a href={`${API}/courses/${courseId}/flags/export`} data-testid="export-flags-btn"
          className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
          <Download className="h-4 w-4" /> Export CSV
        </a>
      </div>
      {flags.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-10">No flags yet. Flags appear here as students write.</p>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden" data-testid="flags-table">
          {flags.map((f) => {
            const Icon = TYPE_ICON[f.type] || ShieldAlert;
            return (
              <button key={f.flag_id} data-testid={`flag-row-${f.flag_id}`} onClick={() => onOpen(f)}
                className="w-full flex items-center gap-4 p-4 border-b border-border last:border-0 bg-card hover:bg-secondary/40 transition-colors text-left">
                <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{f.student_name}</span>
                    {f.type === "paste" && <span className="text-xs text-muted-foreground font-mono">{f.ai_likelihood}% AI · {f.likely_source}</span>}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{f.detail}</div>
                </div>
                <Badge className={`${sevColor[f.severity]} capitalize shrink-0`}>{f.severity}</Badge>
                <span className={`text-xs w-36 text-right shrink-0 ${statusColor(f.status)}`}>{statusLabel[f.status]}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FlagDetail({ flag, onClose, reload }) {
  const navigate = useNavigate();
  const [note, setNote] = useState("");
  useEffect(() => { setNote(""); }, [flag]);
  if (!flag) return null;

  const resolve = async (outcome) => {
    try {
      await api.post(`/flags/${flag.flag_id}/resolve`, { outcome, note });
      toast.success("Flag resolved");
      onClose(); await reload();
    } catch { toast.error("Could not resolve"); }
  };
  const resolved = flag.status?.startsWith("resolved");

  return (
    <Sheet open={!!flag} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto scroll-thin">
        <SheetHeader><SheetTitle className="font-display capitalize">{flag.type.replace("_", " ")} flag</SheetTitle></SheetHeader>
        <div className="mt-6 space-y-6">
          <div>
            <p className="overline-label text-muted-foreground mb-1">Student</p>
            <p className="font-medium">{flag.student_name}</p>
          </div>
          <div>
            <p className="overline-label text-muted-foreground mb-1">Detail</p>
            <p className="text-sm">{flag.detail}</p>
          </div>
          <Button variant="outline" size="sm" data-testid="flag-view-timeline-btn"
            onClick={() => navigate(`/submission/${flag.submission_id}/review`)} className="gap-2 w-full">
            <MousePointerClick className="h-4 w-4" /> View full activity timeline & playback
          </Button>
          {flag.type === "paste" && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-destructive/5 border border-destructive/20">
                  <p className="overline-label text-destructive mb-1">AI likelihood</p>
                  <p className="font-display text-2xl font-bold text-destructive">{flag.ai_likelihood}%</p>
                  <p className="text-xs text-muted-foreground mt-1">estimate</p>
                </div>
                <div className="p-4 rounded-xl bg-secondary/60 border border-border">
                  <p className="overline-label text-muted-foreground mb-1">Likely source</p>
                  <p className="font-display text-lg font-bold">{flag.likely_source}</p>
                  <p className="text-xs text-muted-foreground mt-1">low confidence</p>
                </div>
              </div>
              {flag.signals?.length > 0 && (
                <div>
                  <p className="overline-label text-muted-foreground mb-2">Signals detected</p>
                  <div className="flex flex-wrap gap-2">
                    {flag.signals.map((s, i) => <Badge key={i} variant="outline" className="text-xs">{s}</Badge>)}
                  </div>
                </div>
              )}
              {flag.snippet && (
                <div>
                  <p className="overline-label text-muted-foreground mb-2">Pasted content</p>
                  <div className="p-3 rounded-lg bg-secondary/50 text-sm font-serif-doc max-h-48 overflow-y-auto scroll-thin whitespace-pre-wrap">{flag.snippet}</div>
                </div>
              )}
            </>
          )}
          <div className="pt-4 border-t border-border">
            <p className="overline-label text-muted-foreground mb-2">Student's explanation</p>
            {flag.status?.startsWith("cleared") && (
              <Badge className="bg-accent mb-2">{flag.status === "cleared_by_citation" ? "Student marked as cited source" : "Student disclosed AI use"}</Badge>
            )}
            {flag.explanation ? (
              <div className="space-y-2">
                <Badge variant="secondary" className="capitalize">{flag.explanation.category.replace(/_/g, " ")}</Badge>
                {flag.explanation.ai_statement && <p className="text-sm"><b>AI-usage statement:</b> {flag.explanation.ai_statement}</p>}
                {flag.explanation.free_text && <p className="text-sm text-muted-foreground">{flag.explanation.free_text}</p>}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">The student has not explained this flag yet.</p>
            )}
          </div>

          {resolved ? (
            <div className="p-4 rounded-xl bg-secondary/60 text-sm">
              <p className="font-medium capitalize mb-1">Resolved: {flag.status.replace("resolved_", "")}</p>
              {flag.resolution_note && <p className="text-muted-foreground">{flag.resolution_note}</p>}
            </div>
          ) : (
            <div className="pt-4 border-t border-border space-y-3">
              <p className="overline-label text-muted-foreground">Resolve</p>
              <Textarea placeholder="Optional note..." value={note} onChange={(e) => setNote(e.target.value)} data-testid="resolve-note-input" />
              <div className="flex gap-3">
                <Button data-testid="resolve-legitimate-btn" onClick={() => resolve("legitimate")} className="flex-1 gap-2 bg-accent hover:bg-accent/90">
                  <CheckCircle2 className="h-4 w-4" /> Legitimate
                </Button>
                <Button data-testid="resolve-violation-btn" onClick={() => resolve("violation")} variant="destructive" className="flex-1 gap-2">
                  <XCircle className="h-4 w-4" /> Violation
                </Button>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function QuestionsTab({ questions, reload }) {
  const [answering, setAnswering] = useState(null);
  const [text, setText] = useState("");
  const submit = async (id) => {
    if (!text.trim()) return;
    try {
      await api.post(`/questions/${id}/answer`, { answer: text });
      toast.success("Answer sent"); setAnswering(null); setText(""); await reload();
    } catch { toast.error("Could not send"); }
  };
  if (questions.length === 0) return <p className="text-sm text-muted-foreground text-center py-10">No student questions yet.</p>;
  return (
    <div className="space-y-4" data-testid="questions-list">
      {questions.map((q) => (
        <div key={q.question_id} className="p-5 rounded-xl bg-card border border-border">
          <div className="flex items-center gap-2 mb-2">
            <span className="font-medium text-sm">{q.student_name}</span>
            {q.status === "answered" ? <Badge className="bg-accent">Answered</Badge> : <Badge variant="destructive">Open</Badge>}
          </div>
          <p className="text-sm mb-3">{q.question}</p>
          {q.answer ? (
            <div className="pl-4 border-l-2 border-accent text-sm"><b>You:</b> {q.answer}</div>
          ) : answering === q.question_id ? (
            <div className="space-y-2">
              <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Your reply..." data-testid={`answer-input-${q.question_id}`} />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => submit(q.question_id)} data-testid={`send-answer-${q.question_id}`}>Send</Button>
                <Button size="sm" variant="ghost" onClick={() => setAnswering(null)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setAnswering(q.question_id)} data-testid={`reply-btn-${q.question_id}`}>Reply</Button>
          )}
        </div>
      ))}
    </div>
  );
}
