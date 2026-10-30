import React from "react";
import { PenLine, ShieldCheck, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Login() {
  const handleLogin = () => {
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + (process.env.PUBLIC_URL || "") + "/";
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      {/* Left brand / value panel */}
      <div className="relative hidden lg:flex flex-col justify-between p-14 overflow-hidden bg-primary text-primary-foreground">
        <div
          className="absolute inset-0 opacity-25"
          style={{
            backgroundImage:
              "url('https://images.unsplash.com/photo-1741699428220-65f37f3fbbcb?crop=entropy&cs=srgb&fm=jpg&q=85&w=1400')",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-primary via-primary/85 to-primary/40" />
        <div className="relative z-10">
          <div className="flex items-center gap-2 font-display text-xl font-bold tracking-tight">
            <PenLine className="h-6 w-6" /> Academic Integrity
          </div>
        </div>
        <div className="relative z-10 max-w-md">
          <h1 className="font-serif-doc text-4xl sm:text-5xl leading-tight mb-6">
            Write with integrity. Learn from your course.
          </h1>
          <p className="text-base text-primary-foreground/80 leading-relaxed mb-10">
            A monitored writing space where the only AI in the room answers strictly
            from your professor's material — and every keystroke, paste, and tab switch
            is transparent to you.
          </p>
          <div className="space-y-4 text-sm">
            {[
              [BookOpen, "Course-scoped AI grounded only in uploaded material"],
              [ShieldCheck, "Transparent monitoring with a right to explain"],
              [PenLine, "A calm, distraction-free writing canvas"],
            ].map(([Icon, label], i) => (
              <div key={i} className="flex items-center gap-3 text-primary-foreground/90">
                <Icon className="h-4 w-4 shrink-0" /> <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="relative z-10 overline-label text-primary-foreground/60">
          Monitored Writing Platform
        </div>
      </div>

      {/* Right auth panel */}
      <div className="flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2 font-display text-xl font-bold tracking-tight mb-10 text-primary">
            <PenLine className="h-6 w-6" /> Academic Integrity
          </div>
          <p className="overline-label text-muted-foreground mb-3">Welcome</p>
          <h2 className="font-display text-3xl font-bold tracking-tight mb-2">Sign in to continue</h2>
          <p className="text-muted-foreground text-sm mb-8">
            Use your school Google account. You'll choose your role next.
          </p>
          <Button
            data-testid="google-login-btn"
            onClick={handleLogin}
            className="w-full h-12 text-base rounded-xl gap-3"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="" className="h-5 w-5 bg-white rounded-full p-0.5" />
            Continue with Google
          </Button>
          <p className="text-xs text-muted-foreground mt-6 leading-relaxed">
            By continuing you agree that your writing activity in monitored assignments
            may be logged and reviewed by your instructor, and that you may add an
            explanation to any flagged item.
          </p>
        </div>
      </div>
    </div>
  );
}
