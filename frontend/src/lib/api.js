import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({
  baseURL: API,
  withCredentials: true,
});

export const BASE_PATH = process.env.PUBLIC_URL || "";
const TOKEN_KEY = "session_token";
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));
const authHeader = () => {
  const t = localStorage.getItem(TOKEN_KEY);
  return t ? { Authorization: `Bearer ${t}` } : {};
};

api.interceptors.request.use((config) => {
  Object.assign(config.headers, authHeader());
  return config;
});

// Stream the course AI answer via SSE-over-fetch (cookies included).
export async function streamAsk(submissionId, question, { onDelta, onDone, onError }) {
  try {
    const res = await fetch(`${API}/submissions/${submissionId}/ai/ask`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ question }),
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop();
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith("data:")) continue;
        const payload = JSON.parse(line.slice(5).trim());
        if (payload.type === "delta") onDelta?.(payload.content);
        else if (payload.type === "done") onDone?.(payload);
        else if (payload.type === "error") onError?.(payload.content);
      }
    }
  } catch (e) {
    onError?.(e.message);
  }
}
