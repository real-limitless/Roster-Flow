import { FormEvent, useState } from "react";
import { useAuth } from "../../lib/auth";
import { api } from "../../lib/api";

export function AccountPanel({
  onError,
  onOk,
}: {
  onError: (message: string) => void;
  onOk: (message: string) => void;
}) {
  const { user, status } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const skip = Boolean(status?.skip);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    onError("");
    onOk("");
    if (next !== confirm) {
      onError("New password and confirmation do not match");
      return;
    }
    setBusy(true);
    try {
      const out = await api.changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      onOk(out.policy || "Password updated. Other sessions were revoked; this browser stays signed in.");
    } catch (er) {
      onError(er instanceof Error ? er.message : "Could not change password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-pane" data-testid="settings-account">
      <div className="settings-head">
        <h1>Account</h1>
        <p className="micro">
          Local owner password (scrypt in <code>.roster-flow/state.json</code>). Changing it revokes other sessions; this
          browser keeps its token. Forgotten password: stop CORE, then <code>npm run owner:reset</code> — that does not
          delete seats or runs.
        </p>
      </div>
      <p className="micro" data-testid="account-recover">
        Recovery: <code>npm run owner:reset</code>
        {skip ? " — skip-onboarding is on, so this tab is using the demo token until you sign in as the owner." : ""}
      </p>
      <div className="kv">
        <span>Email</span>
        <b data-testid="account-email">{user?.email || "—"}</b>
      </div>
      <div className="kv">
        <span>Role</span>
        <b>{user?.role || "owner"}</b>
      </div>
      <form className="settings-provider-form" data-testid="account-form" onSubmit={onSubmit}>
        <label>
          Current password
          <input
            data-testid="account-current"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <label>
          New password
          <input
            data-testid="account-next"
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>
        <label>
          Confirm new password
          <input
            data-testid="account-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>
        <div className="settings-actions">
          <button className="pill-btn primary" data-testid="account-submit" type="submit" disabled={busy}>
            {busy ? "Updating…" : "Update password"}
          </button>
        </div>
      </form>
    </section>
  );
}
