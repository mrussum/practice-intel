import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

/**
 * Placeholder shell. Planned layout (day 4–5):
 *   left: documents (resume + jobs)   centre: chat   right: evidence/citations
 *   plus a Fit Matrix tab per job.
 */
export function App() {
  const [status, setStatus] = useState<"checking" | "ok" | "down">("checking");

  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then((r) => setStatus(r.ok ? "ok" : "down"))
      .catch(() => setStatus("down"));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Career Intel</h1>
      <p>Upload a resume and job descriptions, then ask how well you fit.</p>
      <p>
        API: <strong>{status}</strong>
      </p>
    </main>
  );
}
