import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Logo } from "../components/Logo";
import { api } from "../lib/api";

type Provider = {
  id: string;
  name: string;
  npm: string;
  baseURL: string;
  models: Array<{ id: string; name: string }>;
  apiKeyEnv: string;
  connected: boolean;
};

export function Settings() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [harness, setHarness] = useState("offline");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [id, setId] = useState("xai");
  const [name, setName] = useState("xAI");
  const [baseURL, setBaseURL] = useState("https://api.x.ai/v1");
  const [models, setModels] = useState("grok-4");
  const [apiKeyEnv, setApiKeyEnv] = useState("XAI_API_KEY");
  const [apiKey, setApiKey] = useState("");

  async function refresh() {
    try {
      const [p, h] = await Promise.all([api.providers(), api.harness().catch(() => ({ harness: "offline" }))]);
      setProviders(p);
      setHarness(h.harness);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "API offline — start npm run standup");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setOk("");
    try {
      await api.upsertProvider({
        id,
        name,
        npm: "@ai-sdk/openai-compatible",
        baseURL,
        apiKeyEnv,
        apiKey: apiKey || undefined,
        models: models
          .split(/[,\s]+/)
          .filter(Boolean)
          .map((m) => ({ id: m, name: m })),
      });
      setApiKey("");
      setOk("Wrote provider into .opencode/opencode.json (OpenCode config, not a parallel store).");
      await refresh();
    } catch (er) {
      setErr(er instanceof Error ? er.message : "save failed");
    }
  }

  return (
    <div className="app-shell" data-testid="settings-page">
      <div className="app-top">
        <Logo to="/" />
        <span className="mono app-meta">Providers · harness {harness}</span>
        <Link to="/app" className="pill-btn">
          Workspace
        </Link>
      </div>
      <div className="wrap section" style={{ paddingTop: 24 }}>
        <h1 className="display" style={{ fontSize: 32 }}>
          OpenCode providers
        </h1>
        <p className="lede">
          Same contract as OpenChamber: this screen writes <code>opencode.json</code> and optional auth. Keys stay in env
          refs when you can.
        </p>
        {err && <p className="micro" style={{ color: "var(--deny)" }}>{err}</p>}
        {ok && <p className="micro" style={{ color: "var(--phosphor)" }}>{ok}</p>}
        <div className="grid-2" style={{ marginTop: 20 }}>
          <form className="form hire-form" data-testid="settings-providers" onSubmit={onSave} style={{ width: "100%" }}>
            <strong>Add / update provider</strong>
            <label>
              Provider id
              <input data-testid="provider-id" value={id} onChange={(e) => setId(e.target.value)} required />
            </label>
            <label>
              Display name
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              Base URL
              <input value={baseURL} onChange={(e) => setBaseURL(e.target.value)} placeholder="https://api.example.com/v1" />
            </label>
            <label>
              Models (comma-separated)
              <input value={models} onChange={(e) => setModels(e.target.value)} />
            </label>
            <label>
              API key env var
              <input value={apiKeyEnv} onChange={(e) => setApiKeyEnv(e.target.value)} placeholder="XAI_API_KEY" />
            </label>
            <label>
              API key (optional, stored in .roster-flow/auth.json)
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" />
            </label>
            <button className="pill-btn primary" data-testid="provider-save" type="submit">
              Save to OpenCode
            </button>
          </form>
          <div>
            <div className="rail-label">Configured</div>
            {providers.length === 0 && <p className="micro">None yet. Save xAI or a custom OpenAI-compatible endpoint.</p>}
            {providers.map((p) => (
              <div className="card" key={p.id} style={{ marginBottom: 10 }} data-testid={`provider-card-${p.id}`}>
                <h3>
                  {p.name} <span className={`chip ${p.connected ? "ok" : ""}`}>{p.connected ? "connected" : "no key"}</span>
                </h3>
                <p className="micro">
                  {p.id} · {p.baseURL || "default endpoint"}
                </p>
                <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {p.models.map((m) => (
                    <span className="chip" key={m.id}>
                      {m.name}
                    </span>
                  ))}
                </div>
                <button
                  className="pill-btn"
                  style={{ marginTop: 10 }}
                  type="button"
                  onClick={async () => {
                    await api.deleteProvider(p.id);
                    await refresh();
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              className="pill-btn"
              type="button"
              style={{ marginTop: 8 }}
              onClick={() => void api.ensure().then(refresh).catch((e) => setErr(String(e.message || e)))}
            >
              Ensure OpenCode harness
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
