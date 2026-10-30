import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import TopBar from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Presentation, Users, FileText, FolderOpen, Loader2, ChevronRight } from "lucide-react";

export default function ProfessorHome() {
  const navigate = useNavigate();
  const [courses, setCourses] = useState([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [creating, setCreating] = useState(false);

  const load = async () => {
    const { data } = await api.get("/courses");
    setCourses(data);
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const { data } = await api.post("/courses", { name, description: desc });
      toast.success("Course created");
      setOpen(false); setName(""); setDesc("");
      navigate(`/course/${data.course_id}`);
    } catch {
      toast.error("Could not create course");
    } finally { setCreating(false); }
  };

  return (
    <div className="min-h-screen bg-background">
      <TopBar />
      <main className="max-w-6xl mx-auto px-5 sm:px-8 py-10">
        <div className="flex items-end justify-between mb-8 gap-4">
          <div>
            <p className="overline-label text-muted-foreground mb-2">Instructor dashboard</p>
            <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight">Your courses</h1>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button data-testid="new-course-btn" className="gap-2 h-11"><Plus className="h-4 w-4" /> New course</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle className="font-display">Create a course</DialogTitle></DialogHeader>
              <div className="space-y-4 py-2">
                <div>
                  <label className="overline-label text-muted-foreground">Course name</label>
                  <Input data-testid="course-name-input" value={name} onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Introduction to Political Theory" className="mt-1.5" />
                </div>
                <div>
                  <label className="overline-label text-muted-foreground">Description</label>
                  <Textarea data-testid="course-desc-input" value={desc} onChange={(e) => setDesc(e.target.value)}
                    placeholder="What is this course about?" className="mt-1.5" />
                </div>
              </div>
              <DialogFooter>
                <Button data-testid="create-course-submit" onClick={create} disabled={creating} className="gap-2">
                  {creating && <Loader2 className="h-4 w-4 animate-spin" />} Create course
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {courses.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-16 text-center">
            <Presentation className="h-10 w-10 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-display text-lg font-bold mb-1">No courses yet</h3>
            <p className="text-muted-foreground text-sm mb-6">Create your first course, upload materials, and build its AI.</p>
            <Button onClick={() => setOpen(true)} className="gap-2"><Plus className="h-4 w-4" /> New course</Button>
          </div>
        ) : (
          <div className="grid md:grid-cols-3 gap-5" data-testid="professor-courses">
            {courses.map((c) => (
              <button
                key={c.course_id}
                data-testid={`course-card-${c.course_id}`}
                onClick={() => navigate(`/course/${c.course_id}`)}
                className="text-left p-6 rounded-2xl bg-card border border-border hover:border-primary hover:shadow-md transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 group"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                    <Presentation className="h-5 w-5" />
                  </div>
                  <Badge variant="outline" className="font-mono text-xs">{c.code}</Badge>
                </div>
                <h3 className="font-display font-bold text-lg tracking-tight mb-1">{c.name}</h3>
                <p className="text-xs text-muted-foreground line-clamp-2 mb-4 min-h-[2rem]">{c.description || "No description"}</p>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {c.student_count}</span>
                  <span className="flex items-center gap-1"><FolderOpen className="h-3.5 w-3.5" /> {c.material_count}</span>
                  <span className="flex items-center gap-1"><FileText className="h-3.5 w-3.5" /> {c.assignment_count}</span>
                  <ChevronRight className="h-4 w-4 ml-auto text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
