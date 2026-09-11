import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth, workspaceHref } from "../lib/auth";
import { DISCUSSIONS_URL } from "../lib/community";
import { Logo } from "./Logo";

const links = [
  ["Product", "/product"],
  ["Bots", "/bots"],
  ["Orchestration", "/orchestration"],
  ["Harness", "/harness"],
  ["Org", "/org"],
  ["Security", "/security"],
  ["Pricing", "/pricing"],
];

export function Layout() {
  const [open, setOpen] = useState(false);
  const { status } = useAuth();
  const workspace = workspaceHref(status);

  return (
    <div className="shell">
      <header className="topbar">
        <Logo />
        <nav className="meta-pills">
          {links.map(([label, to]) => (
            <NavLink key={to} to={to} className={({ isActive }) => (isActive ? "pill accent" : "pill")}>
              {label}
            </NavLink>
          ))}
          <NavLink to={workspace} className="pill on">
            Workspace
          </NavLink>
          <NavLink to="/app/settings" className="pill">
            Settings
          </NavLink>
          <NavLink to="/access" className="pill vault">
            Access
          </NavLink>
          <button className="pill menu-btn" onClick={() => setOpen((v) => !v)} aria-label="Menu">
            Menu
          </button>
        </nav>
      </header>
      {open && (
        <div className="meta-pills" style={{ padding: "8px 0 16px" }}>
          {links.map(([label, to]) => (
            <NavLink key={to} to={to} className="pill" onClick={() => setOpen(false)}>
              {label}
            </NavLink>
          ))}
        </div>
      )}
      <Outlet />
      <footer className="foot">
        <span>roster-flow</span>
        <a href={DISCUSSIONS_URL} data-testid="community-discussions">
          Discussions
        </a>
        <span>Every bot is an OpenCode agent · same family as mcp-flow · skill-flow · ansible-flow</span>
      </footer>
    </div>
  );
}
