import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import TopBar from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "sonner";
import { ShieldAlert, Clipboard, MousePointerClick, Keyboard, Inbox, AlertTriangle } from "lucide-react";

const TYPE_ICON = { paste: Clipboard, tab_switch: MousePointerClick, keystroke: Keyboard };
const CATEGORIES = [
  ["quoted_cited_source", "This is a quoted / cited source"],
  ["own_work", "This is my own earlier work"],
  ["assistive_tech", "I used dictation / assistive technology"],
  ["accommodation", "I have a documented accommodation"],
  ["ai_assisted", "I used AI — see my statement below"],
  ["other", "Other (explain below)"],
];
const STATUS = {
  pending_student: ["Awaiting your explanation", "bg-amber-500 text-white"],
  escalated: ["Sent to professor", "bg-primary text-primary-foreground"],
  cleared_by_citation: ["Cleared — cited source", "bg-accent text-white"],
  cleared_by_declaration: ["Cleared — AI disclosed", "bg-accent text-white"],
  resolved_legitimate: ["Cleared", "bg-accent text-white"],
  resolved_violation: ["Marked violation", "bg-destructive text-white"],
};

export default function StudentInbox() {
  const [flags, setFlags] = useState([]);
  const [active, setActive] = useState(null);
  const [category, setCategory] = useState("own_work");
  const [aiStatement, setAiStatement] = useState("");
  const [freeText, setFreeText] = useState("");

  const load = async () => { const { data } = await api.get("/flags/mine"); setFlags(data); };
  useEffect(() => { load(); }, []);

  const openFlag = (f) => {
    setActive(f);
    setCategory(f.explanation?.category || (f.has_citation ? "quoted_cited_source" : "own_work"));
    setAiStatement(f.explanation?.ai_statement || "");
    setFreeText(f.explanation?.free_text || "");
  };

  const submit = async () => {
    try {
      const { data } = await api.post(`/flags/${active.flag_id}/explain`, { category, ai_statement: aiStatement, free_text: freeText });
      toast.success(data.status?.startsWith("cleared") ? "Flag cleared by your disclosure" : "Explanation sent to your professor");
      setActive(null); await load();
    } catch { toast.error("Could not submit"); }
  };

  return (
    <div className="min-h-screen bg-background">
      <TopBar />
      <main className="max-w-4xl mx-auto px-5 sm:px-8 py-10">
        <p className="overline-label text-muted-foreground mb-2">Integrity inbox</p>
        <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight mb-2">Your flagged items</h1>
        <p className="text-muted-foreground text-sm mb-8 max-w-2xl">
          These are activity items the system flagged for review. Flags are an <b>estimate</b>, not an accusation.
          Add an explanation and, if relevant, an AI-usage statement — your professor sees it before deciding anything.
        </p>

        {flags.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-16 text-center">
            <Inbox className="h-10 w-10 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-display text-lg font-bold mb-1">Nothing flagged</h3>
            <p className="text-muted-foreground text-sm">You have no flagged items. Keep writing with integrity.</p>
          </div>
        ) : (
          <div className="space-y-3" data-testid="student-flags-list">
            {flags.map((f) => {
              const Icon = TYPE_ICON[f.type] || ShieldAlert;
              const [label, cls] = STATUS[f.status] || ["", ""];
              return (
                <button key={f.flag_id} data-testid={`student-flag-${f.flag_id}`} onClick={() => openFlag(f)}
                  className="w-full flex items-center gap-4 p-5 rounded-xl bg-card border border-border hover:border-primary transition-colors text-left">
                  <div className="h-10 w-10 rounded-lg bg-secondary flex items-center justify-center shrink-0"><Icon className="h-5 w-5 text-primary" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium capitalize">{f.type.replace("_", " ")} flag</div>
                    <div className="text-xs text-muted-foreground truncate">{f.detail}</div>
                  </div>
                  <Badge className={`${cls} shrink-0`}>{label}</Badge>
                </button>
              );
            })}
          </div>
        )}
      </main>

      <Sheet open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto scroll-thin">
          {active && (
            <>
              <SheetHeader><SheetTitle className="font-display capitalize">{active.type.replace("_", " ")} flag</SheetTitle></SheetHeader>
              <div className="mt-6 space-y-6">
                <p className="text-sm">{active.detail}</p>
                {active.type === "paste" && (
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="text-destructive border-destructive/40">{active.ai_likelihood}% AI-likelihood estimate</Badge>
                    <span className="text-xs text-muted-foreground">Likely: {active.likely_source}</span>
                  </div>
                )}
                {active.snippet && (
                  <div>
                    <p className="overline-label text-muted-foreground mb-2">The flagged content</p>
                    <div className="p-3 rounded-lg bg-secondary/50 text-sm font-serif-doc max-h-40 overflow-y-auto scroll-thin whitespace-pre-wrap">{active.snippet}</div>
                  </div>
                )}

                {active.status?.startsWith("resolved") ? (
                  <div className="p-4 rounded-xl bg-secondary/60 text-sm">
                    <p className="font-medium mb-1">Your professor reviewed this: {active.status === "resolved_legitimate" ? "cleared" : "marked as a violation"}.</p>
                    {active.resolution_note && <p className="text-muted-foreground">{active.resolution_note}</p>}
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div>
                      <p className="overline-label text-muted-foreground mb-3">Why did this happen?</p>
                      <RadioGroup value={category} onValueChange={setCategory} className="space-y-2">
                        {CATEGORIES.map(([val, label]) => (
                          <div key={val} className="flex items-center gap-2.5">
                            <RadioGroupItem value={val} id={val} data-testid={`category-${val}`} />
                            <Label htmlFor={val} className="text-sm font-normal cursor-pointer">{label}</Label>
                          </div>
                        ))}
                      </RadioGroup>
                    </div>
                    <div>
                      <p className="overline-label text-muted-foreground mb-2">AI-usage statement (optional)</p>
                      <Textarea data-testid="ai-statement-input" value={aiStatement} onChange={(e) => setAiStatement(e.target.value)}
                        placeholder="If you used AI, state exactly how and where (as your institution's AI policy requires)." rows={3} />
                    </div>
                    <div>
                      <p className="overline-label text-muted-foreground mb-2">Explanation</p>
                      <Textarea data-testid="explanation-input" value={freeText} onChange={(e) => setFreeText(e.target.value)}
                        placeholder="Add any context that helps your professor understand." rows={3} />
                    </div>
                    <Button data-testid="submit-explanation-btn" onClick={submit} className="w-full gap-2">
                      <AlertTriangle className="h-4 w-4" /> Submit explanation to professor
                    </Button>
                    {active.status === "escalated" && <p className="text-xs text-muted-foreground text-center">You already submitted; sending again updates your explanation.</p>}
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
