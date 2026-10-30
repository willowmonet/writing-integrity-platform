import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { GraduationCap, Presentation, Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { toast } from "sonner";

export default function RoleSelect() {
  const { user, setUser, loading } = useAuth();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(null);

  if (loading) return null;
  if (!user) { navigate("/login", { replace: true }); return null; }
  if (user.role) { navigate("/", { replace: true }); return null; }

  const pick = async (role) => {
    setSaving(role);
    try {
      await api.post("/auth/role", { role });
      setUser({ ...user, role });
      navigate("/", { replace: true });
    } catch {
      toast.error("Could not set role");
      setSaving(null);
    }
  };

  const cards = [
    { role: "student", Icon: GraduationCap, title: "I'm a Student",
      desc: "Write assignments in a monitored, focused editor with a course-trained AI on the side." },
    { role: "professor", Icon: Presentation, title: "I'm a Professor",
      desc: "Build the course AI, upload materials, set monitoring strictness, and review flags." },
  ];

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-8">
      <div className="w-full max-w-3xl">
        <p className="overline-label text-muted-foreground mb-3 text-center">One-time setup</p>
        <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-center mb-3">
          How will you use Academic Integrity?
        </h1>
        <p className="text-muted-foreground text-center mb-12">Signed in as {user.email}</p>
        <div className="grid sm:grid-cols-2 gap-6">
          {cards.map(({ role, Icon, title, desc }) => (
            <button
              key={role}
              data-testid={`role-${role}-btn`}
              onClick={() => pick(role)}
              disabled={!!saving}
              className="group text-left p-8 rounded-2xl bg-card border border-border hover:border-primary hover:shadow-lg transition-[border-color,box-shadow,transform] hover:-translate-y-1 disabled:opacity-60"
            >
              <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-6 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                {saving === role ? <Loader2 className="h-6 w-6 animate-spin" /> : <Icon className="h-6 w-6" />}
              </div>
              <h3 className="font-display text-xl font-bold tracking-tight mb-2">{title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
