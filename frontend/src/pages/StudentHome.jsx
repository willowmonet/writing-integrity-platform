import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import TopBar from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { BookOpen, Plus, FileText, ChevronRight, Loader2, PenLine } from "lucide-react";

export default function StudentHome() {
  const navigate = useNavigate();
  const [courses, setCourses] = useState([]);
  const [selected, setSelected] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [code, setCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [opening, setOpening] = useState(null);

  const loadCourses = async () => {
    const { data } = await api.get("/courses");
    setCourses(data);
  };
  useEffect(() => { loadCourses(); }, []);

  const openCourse = async (c) => {
    setSelected(c);
    const { data } = await api.get(`/courses/${c.course_id}/assignments`);
    setAssignments(data);
  };

  const join = async () => {
    if (!code.trim()) return;
    setJoining(true);
    try {
      await api.post("/courses/join", { code });
      toast.success("Joined course");
      setCode("");
      await loadCourses();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not join");
    } finally { setJoining(false); }
  };

  const openAssignment = async (a) => {
    setOpening(a.assignment_id);
    try {
      const { data } = await api.post(`/assignments/${a.assignment_id}/submission`);
      navigate(`/editor/${data.submission.submission_id}`);
    } catch {
      toast.error("Could not open assignment");
      setOpening(null);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <TopBar />
      <main className="max-w-6xl mx-auto px-5 sm:px-8 py-10">
        <p className="overline-label text-muted-foreground mb-2">Student workspace</p>
        <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight mb-8">Your courses</h1>

        <div className="flex flex-col sm:flex-row gap-3 mb-10 max-w-xl">
          <Input
            data-testid="join-code-input"
            placeholder="Enter course join code (e.g. AB12CD)"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="h-11 uppercase"
          />
          <Button data-testid="join-course-btn" onClick={join} disabled={joining} className="h-11 gap-2 shrink-0">
            {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Join course
          </Button>
        </div>

        {courses.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-16 text-center">
            <BookOpen className="h-10 w-10 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-display text-lg font-bold mb-1">No courses yet</h3>
            <p className="text-muted-foreground text-sm">Ask your professor for a join code and enter it above.</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-3 gap-5" data-testid="student-courses">
            {courses.map((c) => (
              <button
                key={c.course_id}
                data-testid={`course-card-${c.course_id}`}
                onClick={() => openCourse(c)}
                className={`text-left p-6 rounded-2xl bg-card border transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:shadow-md ${
                  selected?.course_id === c.course_id ? "border-primary shadow-md" : "border-border"
                }`}
              >
                <div className="h-10 w-10 rounded-lg bg-accent/10 text-accent flex items-center justify-center mb-4">
                  <BookOpen className="h-5 w-5" />
                </div>
                <h3 className="font-display font-bold text-lg tracking-tight mb-1">{c.name}</h3>
                <p className="text-xs text-muted-foreground mb-3">{c.professor_name}</p>
                <div className="flex gap-2">
                  <Badge variant="secondary" className="text-xs">{c.assignment_count} assignments</Badge>
                </div>
              </button>
            ))}
          </div>
        )}

        {selected && (
          <div className="mt-10">
            <div className="flex items-center gap-3 mb-4">
              <h2 className="font-display text-xl font-bold tracking-tight">{selected.name} — Assignments</h2>
            </div>
            {assignments.length === 0 ? (
              <p className="text-muted-foreground text-sm">No assignments posted yet.</p>
            ) : (
              <div className="space-y-3" data-testid="assignments-list">
                {assignments.map((a) => (
                  <div key={a.assignment_id} className="flex items-center gap-4 p-5 rounded-xl bg-card border border-border">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">{a.title}</div>
                      <div className="text-xs text-muted-foreground truncate">{a.prompt || "No prompt provided"}</div>
                    </div>
                    {a.submission?.status === "submitted" && <Badge className="bg-accent">Submitted</Badge>}
                    {a.submission?.status === "draft" && <Badge variant="secondary">Draft</Badge>}
                    <Button
                      data-testid={`open-assignment-${a.assignment_id}`}
                      size="sm"
                      onClick={() => openAssignment(a)}
                      disabled={opening === a.assignment_id}
                      className="gap-1.5"
                    >
                      {opening === a.assignment_id ? <Loader2 className="h-4 w-4 animate-spin" /> :
                        a.submission ? <><PenLine className="h-4 w-4" /> Continue</> : <>Start <ChevronRight className="h-4 w-4" /></>}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
