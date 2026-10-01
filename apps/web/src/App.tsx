import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Citation, Me } from "@career-intel/shared";
import { api, RequestError } from "./lib/api";
import { cn } from "./lib/cn";
import { AuthScreen } from "./components/AuthScreen";
import { BrandMark } from "./components/BrandMark";
import { ChatPanel } from "./components/ChatPanel";
import { CompareView } from "./components/CompareView";
import { DocumentsPanel } from "./components/DocumentsPanel";
import { EvidencePanel, type EvidenceTarget } from "./components/EvidencePanel";
import { FitMatrix } from "./components/FitMatrix";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Spinner } from "./components/ui/spinner";
import { TabPanel, Tabs } from "./components/ui/tabs";

type View = "chat" | "fit" | "compare";

const SESSION_KEY = "career-intel:session";

/** Chat session ids belong to one user, so they're dropped on login and logout. */
function forgetChatSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage unavailable: nothing to forget.
  }
}

/**
 * Drops every cached query except "me", so one user's data can't leak into
 * the next session. "me" itself is kept and overwritten instead: removing it
 * would detach the observer that switches between login screen and app.
 */
function resetUserData(queryClient: ReturnType<typeof useQueryClient>, me: Me | null) {
  queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
  queryClient.setQueryData(meQuery.queryKey, me);
}

/**
 * The signed-in user, or null when signed out. A 401 from the API means
 * "signed out", not an error, so it resolves to null.
 */
export const meQuery = {
  queryKey: ["me"],
  queryFn: async (): Promise<Me | null> => {
    try {
      return await api.me();
    } catch (err) {
      if (err instanceof RequestError && err.status === 401) return null;
      throw err;
    }
  },
  retry: false,
  staleTime: Infinity,
} as const;

export function App() {
  const queryClient = useQueryClient();
  const me = useQuery(meQuery);

  if (me.isLoading) {
    return (
      <p className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Loading…
      </p>
    );
  }
  if (!me.data) {
    return (
      <AuthScreen
        offline={!!me.error}
        onAuthed={(user) => {
          forgetChatSession();
          resetUserData(queryClient, user);
        }}
      />
    );
  }
  return (
    <Workspace
      me={me.data}
      onLogout={async () => {
        await api.logout().catch(() => undefined); // signed out locally either way
        forgetChatSession();
        resetUserData(queryClient, null);
      }}
    />
  );
}

function initialSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

/** True at the `xl` breakpoint, where the evidence panel is a permanent column. */
function useWide(): boolean {
  const query = "(min-width: 1280px)";
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const onChange = () => setWide(m.matches);
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
  }, []);
  return wide;
}

function Workspace({ me, onLogout }: { me: Me; onLogout: () => Promise<void> }) {
  const [view, setView] = useState<View>("chat");
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [evidence, setEvidence] = useState<EvidenceTarget | null>(null);
  const [fitJobId, setFitJobId] = useState<string | null>(null);
  const wide = useWide();

  const ready = useQuery({ queryKey: ["ready"], queryFn: api.ready, refetchInterval: 30_000, retry: false });
  const documents = useQuery({ queryKey: ["documents"], queryFn: api.listDocuments });
  const docs = documents.data ?? [];
  const resume = docs.find((d) => d.kind === "resume");
  const jobs = docs.filter((d) => d.kind === "job");

  const openCitation = (c: Citation) => setEvidence({ documentId: c.documentId, chunkId: c.chunkId });
  const drawerOpen = !wide && evidence !== null;

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setEvidence(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const newChat = () => {
    const id = crypto.randomUUID();
    try {
      sessionStorage.setItem(SESSION_KEY, id);
    } catch {
      // Storage unavailable: the id just won't survive a reload.
    }
    setSessionId(id);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between bg-gradient-to-r from-brand-from to-brand-to px-4 py-2.5 text-white shadow-sm">
        <div className="flex items-center gap-3">
          <BrandMark inverted />
          <div className="flex items-baseline gap-3">
            <h1 className="text-base font-semibold tracking-tight">Career Intel</h1>
            <p className="hidden text-xs text-indigo-100 md:block">Grounded answers about your resume and target jobs</p>
          </div>
        </div>
        <div className="flex items-center gap-2" aria-live="polite">
          {ready.error ? (
            <Badge variant="missing" className="border-transparent">API offline</Badge>
          ) : ready.data?.ai === "fake" || ready.data?.embeddings === "fake" ? (
            <Badge variant="amber" className="border-transparent" title="No API keys configured: deterministic stand-ins are answering. Add keys to .env for real answers.">
              Demo mode
            </Badge>
          ) : null}
          {ready.data?.store === "memory" ? <Badge variant="onBrand" title="No DATABASE_URL: data is lost on restart.">In-memory store</Badge> : null}
          <span className="hidden max-w-[200px] truncate text-xs text-indigo-100 sm:inline" title={me.email}>{me.email}</span>
          <Button variant="ghost" size="sm" className="text-white hover:bg-white/15 focus-visible:ring-white focus-visible:ring-offset-0" onClick={() => void onLogout()}>
            Sign out
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_380px]">
        <aside className="min-h-0 border-b border-border bg-gradient-to-b from-indigo-50/70 to-background md:border-r md:border-b-0">
          <DocumentsPanel
            documents={docs}
            loading={documents.isLoading}
            error={documents.error}
            onOpenFit={(id) => {
              setFitJobId(id);
              setView("fit");
            }}
          />
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col">
          <div className="border-b border-border bg-card px-4 py-2">
            <Tabs
              idPrefix="view"
              label="Views"
              value={view}
              onChange={setView}
              items={[
                { value: "chat", label: "Chat" },
                { value: "fit", label: "Fit matrix" },
                { value: "compare", label: "Compare jobs" },
              ]}
            />
          </div>
          {view === "chat" ? (
            <TabPanel idPrefix="view" value="chat" className="min-h-0 flex-1">
              <ChatPanel sessionId={sessionId} jobLabels={jobs.map((j) => j.label)} hasResume={!!resume} onNewChat={newChat} onCitation={openCitation} />
            </TabPanel>
          ) : view === "fit" ? (
            <TabPanel idPrefix="view" value="fit" className="min-h-0 flex-1 overflow-y-auto p-4">
              <FitMatrix jobs={jobs} jobId={fitJobId} resume={resume} onSelectJob={setFitJobId} onEvidence={setEvidence} />
            </TabPanel>
          ) : (
            <TabPanel idPrefix="view" value="compare" className="min-h-0 flex-1 overflow-y-auto p-4">
              <CompareView jobs={jobs} resume={resume} />
            </TabPanel>
          )}
        </main>

        {wide ? (
          <aside className="min-h-0 border-l border-border bg-card">
            <EvidencePanel target={evidence} />
          </aside>
        ) : (
          <aside
            aria-hidden={!drawerOpen}
            className={cn(
              "fixed inset-y-0 right-0 z-20 w-full max-w-[400px] border-l border-border bg-card shadow-xl transition-transform",
              drawerOpen ? "translate-x-0" : "invisible translate-x-full",
            )}
          >
            <EvidencePanel target={evidence} onClose={() => setEvidence(null)} />
          </aside>
        )}
      </div>
    </div>
  );
}
