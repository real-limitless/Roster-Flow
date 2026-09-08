import { FormEvent, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Logo } from "../components/Logo";
import { useAuth } from "../lib/auth";

export function LoginForm({
  emailDefault = "",
  onSignedIn,
  testId = "login-form",
}: {
  emailDefault?: string;
  onSignedIn?: () => void;
  testId?: string;
}) {
  const { login } = useAuth();
  const [email, setEmail] = useState(emailDefault);
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await login(email, password);
      onSignedIn?.();
    } catch (error) {
      setErr(error instanceof Error ? error.message : "sign in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" data-testid={testId} onSubmit={onSubmit}>
      <label>
        Email
        <input
          data-testid="setup-login-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
        />
      </label>
      <label>
        Password
        <input
          data-testid="setup-login-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </label>
      {err && (
        <p className="micro" style={{ color: "var(--deny)" }}>
          {err}
        </p>
      )}
      <button className="pill-btn primary" data-testid="setup-login-submit" type="submit" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export function Login() {
  const { status, loading } = useAuth();
  if (loading) return <div className="setup-shell">Loading…</div>;
  if (status?.skip || (status?.complete && status.authenticated)) return <Navigate to="/app" replace />;
  if (status && !status.complete) return <Navigate to="/setup" replace />;

  return (
    <div className="setup-shell" data-testid="login-page">
      <div className="setup-card-page">
        <Logo to="/" />
        <p className="eyebrow">Owner</p>
        <h1 className="display" style={{ fontSize: 32 }}>
          Sign in
        </h1>
        <p className="lede">Local owner account. This is not SSO.</p>
        <LoginForm emailDefault={status?.email || ""} />
        <p className="micro">
          Need to start over? <Link to="/setup">Open setup</Link>
        </p>
      </div>
    </div>
  );
}
