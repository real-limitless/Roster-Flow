import { FormEvent, useEffect, useState } from "react";
import { api, type ApiToken } from "../../lib/api";

const SCOPES = ["read", "write", "admin"] as const;

export function TokensPanel({ onError }: { onError: (msg: string) => void }) {
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["read", "write"]);
  const [days, setDays] = useState("");
  const [shown, setShown] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      setTokens(await api.listTokens());
    } catch (err) {
      onError(err instanceof Error ? err.message : "could not list tokens");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const out = await api.createToken({ name, scopes, ...(days ? { expiresInDays: Number(days) } : {}) });
      setShown(out.token);
      setName("");
      await refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : "could not create token");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    try {
      await api.revokeToken(id);
      await refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : "could not revoke token");
    }
  }

  return (
    <section className="settings-pane" data-testid="settings-tokens">
      <div className="settings-head">
        <h1>API tokens</h1>
        <p className="micro">
          Long-lived tokens for scripts and automation. Send as <code>Authorization: Bearer rf_…</code>. Scopes: read
          (GET), write (changes), admin (tokens and setup). The token is shown once; only a hash is stored.
        </p>
      </div>
      {shown && (
        <div className="setup-check ok" data-testid="token-shown">
          <span className="mono">{shown}</span>
          <button className="pill-btn" type="button" onClick={() => setShown("")}>
            Done
          </button>
        </div>
      )}
      <form className="form" onSubmit={create}>
        <label>
          Name
          <input data-testid="token-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <fieldset>
          {SCOPES.map((s) => (
            <label key={s}>
              <input
                type="checkbox"
                data-testid={`token-scope-${s}`}
                checked={scopes.includes(s)}
                onChange={(e) => setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))}
              />{" "}
              {s}
            </label>
          ))}
        </fieldset>
        <label>
          Expires in days (blank = never)
          <input data-testid="token-days" type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} />
        </label>
        <button className="pill-btn primary" data-testid="token-create" type="submit" disabled={busy || !scopes.length}>
          Create token
        </button>
      </form>
      <table className="micro" data-testid="token-list">
        <thead>
          <tr>
            <th>Name</th>
            <th>Prefix</th>
            <th>Scopes</th>
            <th>Expires</th>
            <th>Last used</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {tokens.map((t) => (
            <tr key={t.id}>
              <td>{t.name}</td>
              <td className="mono">{t.prefix}…</td>
              <td>{t.scopes.join(", ")}</td>
              <td>{t.expiresAt ? new Date(t.expiresAt).toLocaleDateString() : "never"}</td>
              <td>{t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : "—"}</td>
              <td>
                {t.revokedAt ? (
                  "revoked"
                ) : (
                  <button className="pill-btn" type="button" data-testid={`token-revoke-${t.id}`} onClick={() => void revoke(t.id)}>
                    Revoke
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
