import { FormEvent, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Logo } from "../components/Logo";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { LoginForm } from "./Login";
import { PRESET_PROVIDERS } from "./settings/types";

const STEPS = [
  ["install", "Install"],
  ["first_user", "Owner"],
  ["login", "Sign in"],
  ["harness", "Harness"],
  ["welcome", "Welcome"],
] as const;

function CheckRow({ ok, warn, label, testId }: { ok: boolean; warn?: boolean; label: string; testId: string }) {
  return (
    <div className={`setup-check ${ok ? "ok" : warn ? "warn" : ""}`} data-testid={testId}>
      <span>{label}</span>
      <span className="mono">{ok ? "ready" : warn ? "optional" : "missing"}</span>
    </div>
  );
}

export function Setup() {
  const { status, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [providerId, setProviderId] = useState("xai");
  const [providerName, setProviderName] = useState("xAI");
  const [baseURL, setBaseURL] = useState("https://api.x.ai/v1");
  const [apiKeyEnv, setApiKeyEnv] = useState("XAI_API_KEY");
  const [models, setModels] = useState("grok-4");
  const [apiKey, setApiKey] = useState("");
  const [template, setTemplate] = useState<"starter" | "empty" | "">("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  if (loading) return <div className="setup-shell">Loading…</div>;
  if (status?.skip || (status?.complete && status.authenticated)) return <Navigate to="/app" replace />;
  if (status?.complete) return <Navigate to="/login" replace />;

  const step = status?.step || "install";

  async function wrap(fn: () => Promise<void>) {
    setErr("");
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (error) {
      setErr(error instanceof Error ? error.message : "request failed");
    } finally {
      setBusy(false);
    }
  }

  function fillPreset(id: string) {
    const p = PRESET_PROVIDERS.find((x) => x.id === id);
    if (!p) return;
    setProviderId(p.id);
    setProviderName(p.name);
    setBaseURL(p.baseURL);
    setApiKeyEnv(p.apiKeyEnv);
    setModels(p.models);
  }

  return (
    <div className="setup-shell" data-testid="setup-page">
      <div className="setup-card-page">
        <Logo to="/" />
        <p className="eyebrow">First run</p>
        <h1 className="display" style={{ fontSize: 32 }}>
          Set up Roster-flow
        </h1>
        <p className="lede">Installation, owner, sign in, harness, then a welcome into the workspace.</p>
        <ol className="setup-stepper" data-testid="setup-stepper">
          {STEPS.map(([id, label]) => (
            <li key={id} className={step === id ? "on" : ""} data-testid={`setup-stepper-${id}`}>
              {label}
            </li>
          ))}
        </ol>
        {err && (
          <p className="micro" style={{ color: "var(--deny)" }}>
            {err}
          </p>
        )}

        {step === "install" && (
          <section data-testid="setup-step-install">
            <h2>Installation</h2>
            <p className="micro">CORE is already running. OpenCode is optional — the room still works offline.</p>
            <CheckRow ok={Boolean(status?.checks.api)} label="CORE API" testId="setup-check-api" />
            <CheckRow
              ok={Boolean(status?.checks.opencode)}
              warn={!status?.checks.opencode}
              label={status?.binary ? `OpenCode CLI · ${status.binary}` : "OpenCode CLI (set OPENCODE_BIN or install from opencode.ai)"}
              testId="setup-check-opencode"
            />
            <CheckRow
              ok={Boolean(status?.checks.providerKeys)}
              warn={!status?.checks.providerKeys}
              label="Provider keys in env"
              testId="setup-check-keys"
            />
            <CheckRow ok={Boolean(status?.checks.dataDir)} label="Data directory writable" testId="setup-check-datadir" />
            <button
              className="pill-btn primary"
              data-testid="setup-continue-install"
              type="button"
              disabled={busy}
              onClick={() => void wrap(() => api.setupInstall().then(() => undefined))}
            >
              Continue
            </button>
          </section>
        )}

        {step === "first_user" && (
          <section data-testid="setup-step-first-user">
            <h2>Create the owner</h2>
            <p className="micro">First account becomes the You seat. Local password — not SSO.</p>
            <form
              className="form"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                void wrap(async () => {
                  await api.setupFirstUser({ name, email, password });
                });
              }}
            >
              <label>
                Name
                <input data-testid="setup-name" value={name} onChange={(e) => setName(e.target.value)} required />
              </label>
              <label>
                Email
                <input
                  data-testid="setup-email"
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
                  data-testid="setup-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </label>
              <button className="pill-btn primary" data-testid="setup-create-owner" type="submit" disabled={busy}>
                Create owner
              </button>
            </form>
          </section>
        )}

        {step === "login" && (
          <section data-testid="setup-step-login">
            <h2>First sign in</h2>
            <p className="micro">Use the owner you just created.</p>
            <LoginForm
              emailDefault={status?.email || email}
              testId="setup-login-form"
              onSignedIn={() => void refresh()}
            />
          </section>
        )}

        {step === "harness" && (
          <section data-testid="setup-step-harness">
            <h2>Harness</h2>
            <p className="micro">Start OpenCode serves and add one provider. You can skip and stay harness-offline.</p>
            <CheckRow
              ok={Boolean(status?.harnessReady)}
              warn={!status?.harnessReady}
              label={status?.binary ? `CLI found · ${status.binary}` : "OpenCode CLI missing"}
              testId="setup-check-harness"
            />
            <div className="setup-actions">
              <button
                className="pill-btn"
                data-testid="setup-ensure-company"
                type="button"
                disabled={busy}
                onClick={() => void wrap(() => api.ensure("company").then(() => undefined))}
              >
                Start company harness
              </button>
              <button
                className="pill-btn"
                data-testid="setup-ensure-system"
                type="button"
                disabled={busy}
                onClick={() => void wrap(() => api.ensure("system").then(() => undefined))}
              >
                Start system harness
              </button>
            </div>
            <div className="setup-actions">
              {PRESET_PROVIDERS.map((p) => (
                <button key={p.id} type="button" className="pill-btn" onClick={() => fillPreset(p.id)}>
                  {p.name}
                </button>
              ))}
            </div>
            <form
              className="form"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                void wrap(async () => {
                  await api.upsertProvider({
                    id: providerId,
                    name: providerName,
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
                });
              }}
            >
              <label>
                Provider id
                <input data-testid="setup-provider-id" value={providerId} onChange={(e) => setProviderId(e.target.value)} required />
              </label>
              <label>
                API key (optional)
                <input
                  data-testid="setup-provider-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <button className="pill-btn" data-testid="setup-provider-save" type="submit" disabled={busy}>
                Save provider
              </button>
            </form>
            <div className="setup-actions">
              <button
                className="pill-btn"
                data-testid="setup-skip-harness"
                type="button"
                disabled={busy}
                onClick={() => void wrap(() => api.setupHarness(true).then(() => undefined))}
              >
                Skip for now
              </button>
              <button
                className="pill-btn primary"
                data-testid="setup-continue-harness"
                type="button"
                disabled={busy}
                onClick={() => void wrap(() => api.setupHarness(false).then(() => undefined))}
              >
                Continue
              </button>
            </div>
          </section>
        )}

        {step === "welcome" && (
          <section data-testid="setup-step-welcome">
            <h2>Welcome</h2>
            <p className="micro">Pick a starting org, then enter the workspace.</p>
            <div className="setup-templates">
              <button
                type="button"
                data-testid="setup-template-starter"
                className={`setup-pick ${template === "starter" ? "on" : ""}`}
                onClick={() => setTemplate("starter")}
              >
                <strong>Starter company</strong>
                <span>You, Maya, #ship, and the billing train — ready to talk.</span>
              </button>
              <button
                type="button"
                data-testid="setup-template-empty"
                className={`setup-pick ${template === "empty" ? "on" : ""}`}
                onClick={() => setTemplate("empty")}
              >
                <strong>Empty org</strong>
                <span>Just you, Channel, and Architect. Staff the rest from the chart.</span>
              </button>
            </div>
            <div className="setup-tour">
              <div className="card">
                <h3>Room</h3>
                <p>Channels are the audit log. Humans and bots share the floor.</p>
              </div>
              <div className="card">
                <h3>Harness</h3>
                <p>Attach the real OpenCode TUI on a seat. Same session as the room.</p>
              </div>
              <div className="card">
                <h3>Chart</h3>
                <p>Hire, fire, reparent. Reporting lines are the control plane.</p>
              </div>
            </div>
            <button
              className="pill-btn primary"
              data-testid="setup-enter-workspace"
              type="button"
              disabled={busy || !template}
              onClick={() =>
                void wrap(async () => {
                  if (template !== "starter" && template !== "empty") return;
                  await api.setupComplete(template);
                  await refresh();
                  navigate("/app");
                })
              }
            >
              Enter workspace
            </button>
          </section>
        )}

        <p className="micro">
          Marketing site stays public. <Link to="/">Home</Link>
        </p>
      </div>
    </div>
  );
}
