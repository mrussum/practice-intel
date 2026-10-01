import { useState, type FormEvent } from "react";
import type { Me } from "@career-intel/shared";
import { api, RequestError } from "../lib/api";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader } from "./ui/card";
import { Spinner } from "./ui/spinner";
import { TabPanel, Tabs } from "./ui/tabs";

type Mode = "login" | "signup";

const inputClass =
  "h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function AuthScreen({ onAuthed, offline }: { onAuthed: (me: Me) => void; offline?: boolean }) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const me = await (mode === "login" ? api.login : api.signup)({ email, password });
      onAuthed(me);
    } catch (err) {
      setError(err instanceof RequestError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-full items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="gap-3">
          <div>
            <h1 className="text-lg font-semibold">Career Intel</h1>
            <p className="text-sm text-muted-foreground">Grounded answers about your resume and target jobs.</p>
          </div>
          <Tabs
            idPrefix="auth"
            label="Account"
            value={mode}
            onChange={(m) => {
              setMode(m);
              setError(null);
            }}
            items={[
              { value: "login", label: "Log in" },
              { value: "signup", label: "Create account" },
            ]}
          />
        </CardHeader>
        <CardContent>
          <TabPanel idPrefix="auth" value={mode}>
            <form onSubmit={(e) => void submit(e)} className="space-y-3">
              {offline ? <Alert variant="destructive">Can't reach the API. Is it running?</Alert> : null}
              <div className="space-y-1">
                <label htmlFor="auth-email" className="text-sm font-medium">Email</label>
                <input
                  id="auth-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="auth-password" className="text-sm font-medium">Password</label>
                <input
                  id="auth-password"
                  type="password"
                  required
                  minLength={mode === "signup" ? 10 : undefined}
                  maxLength={200}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  aria-describedby={mode === "signup" ? "auth-password-hint" : undefined}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClass}
                />
                {mode === "signup" ? (
                  <p id="auth-password-hint" className="text-xs text-muted-foreground">At least 10 characters.</p>
                ) : null}
              </div>
              {error ? <Alert variant="destructive">{error}</Alert> : null}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? <Spinner className="h-3 w-3" label="Working" /> : null}
                {mode === "login" ? "Log in" : "Create account"}
              </Button>
              <p className="text-xs text-muted-foreground">Your documents are visible only to your account and can be deleted at any time.</p>
            </form>
          </TabPanel>
        </CardContent>
      </Card>
    </main>
  );
}
