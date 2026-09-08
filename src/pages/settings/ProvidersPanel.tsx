import { FormEvent, useState } from "react";
import { api } from "../../lib/api";
import { PRESET_PROVIDERS, type Provider } from "./types";

function parseHeaders(text: string): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const cut = line.indexOf(":");
    if (cut < 1) continue;
    const key = line.slice(0, cut).trim();
    const value = line.slice(cut + 1).trim();
    if (key && value) headers[key] = value;
  }
  return Object.keys(headers).length ? headers : undefined;
}

function parseModels(text: string) {
  return text
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((m) => ({ id: m, name: m }));
}

export function ProvidersPanel({
  providers,
  onChanged,
  onError,
  onOk,
}: {
  providers: Provider[];
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
  onOk: (message: string) => void;
}) {
  const [id, setId] = useState("xai");
  const [name, setName] = useState("xAI");
  const [baseURL, setBaseURL] = useState("https://api.x.ai/v1");
  const [models, setModels] = useState("grok-4");
  const [apiKeyEnv, setApiKeyEnv] = useState("XAI_API_KEY");
  const [apiKey, setApiKey] = useState("");
  const [headers, setHeaders] = useState("");
  const [connectId, setConnectId] = useState<string | null>(null);
  const [connectKey, setConnectKey] = useState("");
  const [connectEnv, setConnectEnv] = useState("");

  function fill(p: (typeof PRESET_PROVIDERS)[number] | Provider) {
    setId(p.id);
    setName(p.name);
    setBaseURL("baseURL" in p ? p.baseURL : "");
    setApiKeyEnv(p.apiKeyEnv || "");
    if ("models" in p && typeof p.models === "string") setModels(p.models);
    else if ("models" in p && Array.isArray(p.models)) setModels(p.models.map((m) => m.id).join(", "));
    setHeaders("");
    setApiKey("");
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    try {
      await api.upsertProvider({
        id,
        name,
        npm: "@ai-sdk/openai-compatible",
        baseURL,
        apiKeyEnv,
        apiKey: apiKey || undefined,
        headers: parseHeaders(headers),
        models: parseModels(models),
      });
      setApiKey("");
      onOk("Wrote provider into .opencode/opencode.json (OpenCode config, not a parallel store).");
      await onChanged();
    } catch (er) {
      onError(er instanceof Error ? er.message : "save failed");
    }
  }

  async function connectPreset(preset: (typeof PRESET_PROVIDERS)[number]) {
    try {
      const existing = providers.find((p) => p.id === preset.id);
      await api.upsertProvider({
        id: preset.id,
        name: preset.name,
        npm: "@ai-sdk/openai-compatible",
        baseURL: existing?.baseURL || preset.baseURL,
        apiKeyEnv: connectEnv || existing?.apiKeyEnv || preset.apiKeyEnv,
        apiKey: connectKey || undefined,
        models: existing?.models.length ? existing.models : parseModels(preset.models),
      });
      setConnectKey("");
      setConnectId(null);
      onOk(`Connected ${preset.name} through OpenCode config.`);
      await onChanged();
    } catch (er) {
      onError(er instanceof Error ? er.message : "connect failed");
    }
  }

  const custom = providers.filter((p) => !PRESET_PROVIDERS.some((preset) => preset.id === p.id));

  return (
    <section className="settings-pane">
      <div className="settings-head">
        <h1>Providers</h1>
        <p className="micro">
          Same contract as OpenChamber: this screen writes <code>opencode.json</code> and optional auth. Prefer{" "}
          <code>{"{env:VAR}"}</code> over literal keys.
        </p>
      </div>
      <div className="rail-label">Built-in</div>
      <div className="settings-grid">
        {PRESET_PROVIDERS.map((preset) => {
          const configured = providers.find((p) => p.id === preset.id);
          const connected = Boolean(configured?.connected);
          return (
            <div className="card" key={preset.id} data-testid={`provider-card-${preset.id}`}>
              <h3>
                {preset.name}{" "}
                <span className={`chip ${connected ? "ok" : ""}`}>{connected ? "connected" : "no key"}</span>
              </h3>
              <p className="micro">
                {preset.id}
                {configured?.baseURL ? ` · ${configured.baseURL}` : preset.baseURL ? ` · ${preset.baseURL}` : ""}
              </p>
              <div className="settings-chip-row">
                {(configured?.models.length ? configured.models : parseModels(preset.models)).map((m) => (
                  <span className="chip" key={m.id}>
                    {m.name}
                  </span>
                ))}
              </div>
              {connectId === preset.id ? (
                <form
                  className="settings-connect"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void connectPreset(preset);
                  }}
                >
                  <label>
                    API key env var
                    <input
                      value={connectEnv || preset.apiKeyEnv}
                      onChange={(e) => setConnectEnv(e.target.value)}
                      placeholder={preset.apiKeyEnv}
                    />
                  </label>
                  <label>
                    API key (optional)
                    <input type="password" value={connectKey} onChange={(e) => setConnectKey(e.target.value)} autoComplete="off" />
                  </label>
                  <div className="settings-actions">
                    <button className="pill-btn primary" type="submit">
                      Save to OpenCode
                    </button>
                    <button className="pill-btn" type="button" onClick={() => setConnectId(null)}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="settings-actions">
                  <button
                    className="pill-btn primary"
                    type="button"
                    onClick={() => {
                      setConnectId(preset.id);
                      setConnectEnv(configured?.apiKeyEnv || preset.apiKeyEnv);
                      fill(configured || preset);
                    }}
                  >
                    {configured ? "Edit" : "Connect"}
                  </button>
                  {configured && (
                    <button
                      className="pill-btn"
                      type="button"
                      onClick={async () => {
                        await api.deleteProvider(preset.id);
                        await onChanged();
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {custom.length > 0 && (
        <>
          <div className="rail-label" style={{ marginTop: 20 }}>
            Custom
          </div>
          <div className="settings-grid">
            {custom.map((p) => (
              <div className="card" key={p.id} data-testid={`provider-card-${p.id}`}>
                <h3>
                  {p.name} <span className={`chip ${p.connected ? "ok" : ""}`}>{p.connected ? "connected" : "no key"}</span>
                </h3>
                <p className="micro">
                  {p.id} · {p.baseURL || "default endpoint"}
                </p>
                <div className="settings-chip-row">
                  {p.models.map((m) => (
                    <span className="chip" key={m.id}>
                      {m.name}
                    </span>
                  ))}
                </div>
                <div className="settings-actions">
                  <button className="pill-btn" type="button" onClick={() => fill(p)}>
                    Edit
                  </button>
                  <button
                    className="pill-btn"
                    type="button"
                    onClick={async () => {
                      await api.deleteProvider(p.id);
                      await onChanged();
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <form className="form hire-form settings-provider-form" data-testid="settings-providers" onSubmit={onSave}>
        <strong>Other / Custom</strong>
        <p className="micro">OpenAI-compatible endpoint. Writes the provider block OpenCode already reads.</p>
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
        <label>
          Request headers (optional, Name: value per line)
          <textarea value={headers} onChange={(e) => setHeaders(e.target.value)} rows={3} />
        </label>
        <button className="pill-btn primary" data-testid="provider-save" type="submit">
          Save to OpenCode
        </button>
      </form>
    </section>
  );
}
