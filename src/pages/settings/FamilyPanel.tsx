import { useEffect, useState } from "react";
import { api } from "../../lib/api";

const FAMILY = [
  {
    id: "skill-flow",
    name: "skill-flow",
    replaces: "Settings → Skills",
    role: "Reusable skill catalog. Roster audits and installs through skill-flow. It does not own the catalog.",
    href: "https://github.com/real-limitless/skill-flow",
  },
  {
    id: "mcp-flow",
    name: "mcp-flow",
    replaces: "Settings → MCP",
    role: "Workspace MCP gateway. Roster registers harness backends here. Secrets stay on the gateway.",
    href: "https://github.com/real-limitless/mcp-flow",
  },
  {
    id: "ansible-flow-mcp",
    name: "ansible-flow-mcp",
    replaces: "Settings → Integrations",
    role: "Ansible modules, playbooks, and hub/spoke automation for agents.",
    href: "https://github.com/real-limitless/ansible-flow-mcp",
  },
  {
    id: "openflow",
    name: "OpenFlow",
    replaces: "Catalogs / canvas",
    role: "Canvas that reads ansible's gallery and mcp-flow catalog-data.",
    href: "https://github.com/real-limitless/OpenFlow",
  },
] as const;

type FamilyStatus = {
  mcpFlow?: { url: string; ok: boolean; error?: string; admin?: boolean };
  skillFlow?: { url: string; bin: string; ok: boolean; error?: string };
  github?: { connected: boolean; env: string | null; api: string };
};

export function FamilyPanel() {
  const [status, setStatus] = useState<FamilyStatus | null>(null);
  const [skillSource, setSkillSource] = useState("");
  const [mcpSlug, setMcpSlug] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      setStatus(await api.familyStatus());
    } catch (err) {
      setNote(err instanceof Error ? err.message : "family status failed");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function run(label: string, work: () => Promise<unknown>) {
    setBusy(true);
    try {
      const result = await work();
      setNote(`${label}: ${JSON.stringify(result)}`);
      await refresh();
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-pane" data-testid="settings-family">
      <div className="settings-head">
        <h1>Family</h1>
        <p className="micro">
          Roster owns the org and OpenCode write-through. Skills install through skill-flow. MCP backends
          register on mcp-flow. GitHub PR cards use GITHUB_TOKEN or GH_TOKEN on the API — never state.json.
        </p>
      </div>
      <div className="settings-grid">
        {FAMILY.map((item) => (
          <div className="card" key={item.id} data-testid={`family-card-${item.id}`}>
            <h3>
              {item.name} <span className="chip">owned elsewhere</span>
            </h3>
            <p className="micro">{item.replaces}</p>
            <p>{item.role}</p>
            {item.id === "mcp-flow" && status?.mcpFlow && (
              <p className="micro">
                {status.mcpFlow.url} · {status.mcpFlow.ok ? "up" : status.mcpFlow.error || "down"}
                {status.mcpFlow.admin ? " · admin token set" : " · no admin token"}
              </p>
            )}
            {item.id === "skill-flow" && status?.skillFlow && (
              <p className="micro">
                {status.skillFlow.url} · {status.skillFlow.ok ? "up" : status.skillFlow.error || "CLI on PATH"}
              </p>
            )}
            <div className="settings-actions">
              <a className="pill-btn" href={item.href} target="_blank" rel="noreferrer">
                Repo
              </a>
            </div>
          </div>
        ))}
        <div className="card" data-testid="family-card-github">
          <h3>
            GitHub <span className="chip">env sidecar</span>
          </h3>
          <p className="micro">Settings → Integrations (PR cards)</p>
          <p>
            Optional PAT or GitHub App installation token. Eng.Build reports a PR URL; #ship renders status, title,
            and checks. Merge stays human-gated. Worktrees stay local.
          </p>
          <p className="micro" data-testid="family-github-status">
            {status?.github?.connected
              ? `${status.github.env || "token"} set · token stays in env`
              : "not connected · set GITHUB_TOKEN or GH_TOKEN"}
            {status?.github?.api ? ` · ${status.github.api}` : ""}
          </p>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>skill-flow audit / install</h3>
        <p className="micro">Runs `skill-flow audit` then `skill-flow install -y` on the API host.</p>
        <input
          className="settings-input"
          value={skillSource}
          onChange={(e) => setSkillSource(e.target.value)}
          placeholder="catalog id or path to SKILL.md"
        />
        <div className="settings-actions">
          <button
            type="button"
            className="pill-btn"
            disabled={busy || !skillSource.trim()}
            onClick={() => void run("audit", () => api.familySkillAudit(skillSource.trim()))}
          >
            Audit
          </button>
          <button
            type="button"
            className="pill-btn"
            disabled={busy || !skillSource.trim()}
            onClick={() => void run("install", () => api.familySkillInstall(skillSource.trim()))}
          >
            Install
          </button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>mcp-flow backend</h3>
        <p className="micro">POST /v1/backends on the gateway. Needs MCP_FLOW_ADMIN_TOKEN.</p>
        <input
          className="settings-input"
          value={mcpSlug}
          onChange={(e) => setMcpSlug(e.target.value)}
          placeholder="slug (opencode)"
        />
        <input
          className="settings-input"
          value={mcpUrl}
          onChange={(e) => setMcpUrl(e.target.value)}
          placeholder="streamable HTTP URL (optional)"
        />
        <div className="settings-actions">
          <button
            type="button"
            className="pill-btn"
            disabled={busy || !mcpSlug.trim()}
            onClick={() =>
              void run("register", () =>
                api.familyRegisterMcp({
                  slug: mcpSlug.trim(),
                  url: mcpUrl.trim() || undefined,
                  command: mcpUrl.trim() ? undefined : ["opencode", "mcp"],
                }),
              )
            }
          >
            Register
          </button>
          <button type="button" className="pill-btn" disabled={busy} onClick={() => void run("list", () => api.familyMcpBackends())}>
            List
          </button>
        </div>
      </div>
      {note && <pre className="micro">{note}</pre>}
    </section>
  );
}
