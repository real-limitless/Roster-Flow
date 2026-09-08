const FAMILY = [
  {
    id: "skill-flow",
    name: "skill-flow",
    replaces: "Settings → Skills",
    role: "Reusable skill catalog. Room can attach skill chips; the catalog lives here.",
    href: "https://github.com/real-limitless/skill-flow",
  },
  {
    id: "mcp-flow",
    name: "mcp-flow",
    replaces: "Settings → MCP",
    role: "Workspace MCP gateway. One endpoint for OpenCode and other harnesses; secrets stay on the gateway.",
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
    role: "Shared galleries (MCP nodes, Ansible palette) dual-tracked with the Flow MCP servers.",
    href: "https://github.com/real-limitless/OpenFlow",
  },
] as const;

export function FamilyPanel() {
  return (
    <section className="settings-pane" data-testid="settings-family">
      <div className="settings-head">
        <h1>Family</h1>
        <p className="micro">
          Roster-flow owns the org and the OpenCode write-through. Skills, MCP, and integrations stay in their owner
          products. Live attach comes later — these cards are the join map, not a second editor.
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
            <div className="settings-actions">
              <a className="pill-btn" href={item.href} target="_blank" rel="noreferrer">
                Repo
              </a>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
