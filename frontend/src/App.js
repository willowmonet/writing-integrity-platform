import React, { useEffect, useRef, useState } from "react";
import { BrowserRouter, Routes, Route, useLocation, useNavigate, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import Login from "@/pages/Login";
import RoleSelect from "@/pages/RoleSelect";
import StudentHome from "@/pages/StudentHome";
import Editor from "@/pages/Editor";
import StudentInbox from "@/pages/StudentInbox";
import ProfessorHome from "@/pages/ProfessorHome";
import CoursePage from "@/pages/CoursePage";
import SubmissionReview from "@/pages/SubmissionReview";
import { Loader2 } from "lucide-react";

function FullLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );
}

function AuthCallback() {
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;
    const hash = window.location.hash;
    const sid = new URLSearchParams(hash.replace("#", "")).get("session_id");
    (async () => {
      try {
        const { data } = await api.post("/auth/session", { session_id: sid });
        setUser(data.user);
        window.history.replaceState(null, "", window.location.pathname);
        navigate(data.user.role ? "/" : "/role", { replace: true, state: { user: data.user } });
      } catch {
        navigate("/login", { replace: true });
      }
    })();
  }, [navigate, setUser]);

  return <FullLoader />;
}

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <FullLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.role) return <Navigate to="/role" replace />;
  return children;
}

function HomeRouter() {
  const { user } = useAuth();
  return user.role === "professor" ? <ProfessorHome /> : <StudentHome />;
}

function AppRouter() {
  const location = useLocation();
  if (location.hash?.includes("session_id=")) return <AuthCallback />;
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/role" element={<RoleSelect />} />
      <Route path="/" element={<RequireAuth><HomeRouter /></RequireAuth>} />
      <Route path="/course/:courseId" element={<RequireAuth><CoursePage /></RequireAuth>} />
      <Route path="/editor/:submissionId" element={<RequireAuth><Editor /></RequireAuth>} />
      <Route path="/submission/:submissionId/review" element={<RequireAuth><SubmissionReview /></RequireAuth>} />
      <Route path="/inbox" element={<RequireAuth><StudentInbox /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster position="top-right" richColors />
        <AppRouter />
      </BrowserRouter>
    </AuthProvider>
  );
}
