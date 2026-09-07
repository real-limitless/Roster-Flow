import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
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
          <NavLink to="/app" className="pill on">
            Workspace
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
        <span>Every bot is an OpenCode agent · same family as mcp-flow · skill-flow · ansible-flow</span>
      </footer>
    </div>
  );
}
