import React, { useEffect, useState, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import TopBar from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Dot,
} from "recharts";
import {
  ArrowLeft, Play, Pause, Clipboard, MousePointerClick, Keyboard, ShieldAlert, Loader2,
  RotateCcw, Zap, FileText,
} from "lucide-react";

const TYPE_ICON = { paste: Clipboard, tab_switch: MousePointerClick, keystroke: Keyboard };
const JUMP_THRESHOLD = 200;

function fmtTime(iso) {
  try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
  catch { return ""; }
}

export default function SubmissionReview() {
  const { submissionId } = useParams();
  const navigate = useNavigate();
  const [ctx, setCtx] = useState(null);
  const [activity, setActivity] = useState(null);
  const [revs, setRevs] = useState([]);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playRef = useRef(null);

  useEffect(() => {
    (async () => {
      const [c, a, r] = await Promise.all([
        api.get(`/submissions/${submissionId}`),
        api.get(`/submissions/${submissionId}/activity`),
        api.get(`/submissions/${submissionId}/revisions`),
      ]);
      setCtx(c.data); setActivity(a.data); setRevs(r.data);
      setIdx(r.data.length ? r.data.length - 1 : 0);
    })();
  }, [submissionId]);

  useEffect(() => {
    if (!playing) return;
    playRef.current = setInterval(() => {
      setIdx((i) => { if (i >= revs.length - 1) { setPlaying(false); return i; } return i + 1; });
    }, 700);
    return () => clearInterval(playRef.current);
  }, [playing, revs.length]);

  const timeline = useMemo(() => {
    if (!activity) return [];
    const items = [
      ...activity.events.map((e) => ({ kind: "event", ...e })),
      ...activity.flags.map((f) => ({ kind: "flag", ...f, type: f.type, created_at: f.created_at })),
    ];
    return items.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  }, [activity]);

  const chartData = useMemo(() =>
    revs.map((r, i) => ({ i, chars: r.char_count, delta: r.delta, jump: r.delta >= JUMP_THRESHOLD || r.trigger === "paste" })),
  [revs]);

  if (!ctx || !activity) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  const cur = revs[idx];
  const jumps = chartData.filter((d) => d.jump).length;

  return (
    <div className="min-h-screen bg-background">
      <TopBar />
      <main className="max-w-6xl mx-auto px-5 sm:px-8 py-8">
        <button data-testid="review-back-btn" onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <div className="flex flex-wrap items-center gap-3 mb-8">
          <div className="flex-1 min-w-0">
            <p className="overline-label text-muted-foreground mb-1">Submission review</p>
            <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight truncate">{ctx.submission.student_name}</h1>
            <p className="text-sm text-muted-foreground">{ctx.assignment?.title} · {ctx.submission.word_count} words · <span className="capitalize">{ctx.submission.status}</span></p>
          </div>
          {ctx.submission.declaration && (
            <div className="max-w-xs text-xs p-3 rounded-lg bg-secondary/60 border border-border">
              <div className="overline-label text-muted-foreground mb-1">AI declaration</div>
              {ctx.submission.declaration}
            </div>
          )}
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Growth chart + playback */}
          <section className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display font-bold">Revision playback</h2>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Zap className="h-3.5 w-3.5 text-destructive" /> {jumps} large jump{jumps !== 1 && "s"}
              </div>
            </div>

            {revs.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted-foreground">
                <FileText className="h-8 w-8 mx-auto mb-3 opacity-40" />
                No revision history was recorded for this submission.
              </div>
            ) : (
              <>
                <div className="h-40 -ml-2 mb-2" style={{ minHeight: 160 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 8, right: 10, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eef1f4" />
                      <XAxis dataKey="i" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                      <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" />
                      <Tooltip formatter={(v, n) => [v, n === "chars" ? "characters" : n]} labelFormatter={(l) => `Step ${l}`} />
                      <Line type="monotone" dataKey="chars" stroke="hsl(222 82% 30%)" strokeWidth={2}
                        dot={(p) => p.payload.jump
                          ? <Dot key={p.key} cx={p.cx} cy={p.cy} r={4} fill="hsl(353 88% 43%)" stroke="white" strokeWidth={1} />
                          : <Dot key={p.key} cx={p.cx} cy={p.cy} r={2} fill="hsl(222 82% 30%)" />} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="flex items-center gap-3 mb-3">
                  <Button size="icon" variant="outline" data-testid="playback-toggle" onClick={() => { if (idx >= revs.length - 1) setIdx(0); setPlaying((p) => !p); }} className="h-9 w-9 shrink-0">
                    {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => { setPlaying(false); setIdx(0); }} className="h-9 w-9 shrink-0">
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                  <Slider data-testid="playback-slider" value={[idx]} min={0} max={revs.length - 1} step={1}
                    onValueChange={(v) => { setPlaying(false); setIdx(v[0]); }} className="flex-1" />
                  <span className="text-xs text-muted-foreground w-24 text-right shrink-0">
                    {fmtTime(cur?.created_at)}
                  </span>
                </div>

                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="secondary" className="text-xs">Step {idx + 1}/{revs.length}</Badge>
                  {cur?.delta >= JUMP_THRESHOLD && <Badge className="bg-destructive text-white text-xs gap-1"><Zap className="h-3 w-3" /> +{cur.delta} chars</Badge>}
                  {cur?.trigger === "paste" && <Badge className="bg-amber-500 text-white text-xs">after paste</Badge>}
                  <span className="text-xs text-muted-foreground ml-auto">{cur?.word_count} words</span>
                </div>
                <div data-testid="playback-content" className="h-56 overflow-y-auto scroll-thin rounded-xl bg-[#F9F9F8] border border-border p-4 font-serif-doc text-sm leading-relaxed whitespace-pre-wrap text-[#1a2230]">
                  {cur?.content || <span className="text-muted-foreground italic">Empty at this point.</span>}
                </div>
              </>
            )}
          </section>

          {/* Activity timeline */}
          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="font-display font-bold mb-4">Activity timeline</h2>
            {timeline.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">No activity recorded.</p>
            ) : (
              <div className="relative pl-6 max-h-[28rem] overflow-y-auto scroll-thin" data-testid="activity-timeline">
                <div className="absolute left-2 top-1 bottom-1 w-px bg-border" />
                {timeline.map((it, i) => {
                  const Icon = it.kind === "flag" ? ShieldAlert : (TYPE_ICON[it.type] || Keyboard);
                  const isFlag = it.kind === "flag";
                  const color = isFlag ? "text-destructive" : it.type === "paste" ? "text-amber-600" : "text-primary";
                  let label = "";
                  if (isFlag) label = `Flag: ${it.type.replace("_", " ")}${it.type === "paste" ? ` — ${it.ai_likelihood}% AI (${it.likely_source})` : ""}`;
                  else if (it.type === "paste") label = `Pasted ${it.data?.text?.length || 0} characters`;
                  else if (it.type === "tab_switch") label = `Left tab (${Math.round((it.data?.away_ms || 0) / 1000)}s away)`;
                  else if (it.type === "keystroke") label = `Typing burst · ~${Math.round(it.data?.wpm || 0)} WPM`;
                  return (
                    <div key={i} className="relative mb-4">
                      <div className={`absolute -left-[18px] top-0.5 h-4 w-4 rounded-full bg-card border-2 flex items-center justify-center ${isFlag ? "border-destructive" : "border-border"}`}>
                        <div className={`h-1.5 w-1.5 rounded-full ${isFlag ? "bg-destructive" : "bg-muted-foreground"}`} />
                      </div>
                      <div className="flex items-start gap-2">
                        <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${color}`} />
                        <div className="min-w-0">
                          <div className="text-sm">{label}</div>
                          <div className="text-[11px] text-muted-foreground">{fmtTime(it.created_at)}</div>
                          {isFlag && it.snippet && <div className="text-xs text-muted-foreground mt-1 bg-secondary/50 rounded px-2 py-1 line-clamp-2">{it.snippet}</div>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
