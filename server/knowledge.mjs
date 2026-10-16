/** Project-scoped knowledge connectors. Prefer mcp-flow when it is up; otherwise CORE-local. */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { familyEnv, pingHttp } from "./family.mjs";
import { root } from "./paths.mjs";
import { uid } from "./store.mjs";

export const deps = {
  fetchFn: (...args) => fetch(...args),
  ping: pingHttp,
};

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "graphify-out",
  ".roster-flow",
  ".opencode",
  "artifacts",
  ".cursor",
]);
const TEXT_EXT = new Set([".md", ".txt", ".ts", ".tsx", ".js", ".mjs", ".json", ".yml", ".yaml"]);

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

export function listConnectors(state, projectId) {
  return (state.connectors || []).filter((c) => c.projectId === projectId);
}

export function publicConnector(c) {
  if (!c) return c;
  const out = { ...c };
  delete out.token;
  delete out.secret;
  return out;
}

export function seatCanSearchProject(state, seatId, projectId) {
  if (!seatId) return true;
  const seat = (state.seats || []).find((s) => s.id === seatId);
  if (!seat) return false;
  if (seat.id === "you" || seat.system) return true;
  if (seat.projectId === projectId) return true;
  const project = (state.projects || []).find((p) => p.id === projectId);
  if (seat.team && project?.teamIds?.includes(seat.team)) return true;
  return false;
}

export function resolveWorkspacePath(p) {
  const raw = String(p || "").trim() || ".";
  const abs = isAbsolute(raw) ? resolve(raw) : resolve(root, raw);
  const rel = relative(root, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) fail(400, "path outside workspace");
  return abs;
}

export function attachConnector(state, projectId, body = {}) {
  const project = (state.projects || []).find((p) => p.id === projectId);
  if (!project) fail(404, "project not found");
  const kind = String(body.kind || "git").toLowerCase();
  if (!["git", "github", "docs"].includes(kind)) fail(400, "kind must be git, github, or docs");
  const connector = {
    id: uid("conn"),
    projectId,
    kind,
    path: body.path ? String(body.path).slice(0, 240) : kind === "git" ? "." : undefined,
    remote: body.remote ? String(body.remote).slice(0, 240) : undefined,
    root: body.root ? String(body.root).slice(0, 240) : kind === "docs" ? "docs" : undefined,
    enabled: body.enabled !== false,
  };
  if (kind === "github" && !connector.remote) fail(400, "remote required");
  if (connector.path) resolveWorkspacePath(connector.path);
  if (connector.root) resolveWorkspacePath(connector.root);
  state.connectors = [...(state.connectors || []), connector];
  return publicConnector(connector);
}

export function removeConnector(state, projectId, connectorId) {
  const before = state.connectors || [];
  const found = before.find((c) => c.id === connectorId && c.projectId === projectId);
  if (!found) return null;
  state.connectors = before.filter((c) => c.id !== connectorId);
  return publicConnector(found);
}

export function knowledgePointerLines(state, seat) {
  const project = seat?.projectId
    ? (state.projects || []).find((p) => p.id === seat.projectId)
    : (state.projects || []).find((p) => p.id === "billing") || (state.projects || [])[0];
  if (!project) return [];
  const lines = [`Knowledge is project-scoped (${project.id}). Workspace data is not used for training.`];
  const attached = listConnectors(state, project.id).filter((c) => c.enabled);
  if (attached.length) {
    lines.push(`Attached sources: ${attached.map(labelConnector).join("; ")}`);
    lines.push(`Search: GET /api/v1/projects/${project.id}/knowledge?q=`);
  }
  return lines;
}

function labelConnector(c) {
  if (c.kind === "github") return `github:${c.remote}${c.path ? ` @ ${c.path}` : ""}`;
  if (c.kind === "docs") return `docs:${c.root || "docs"}`;
  return `git:${c.path || "."}`;
}

function walkFiles(dir, acc, budget) {
  if (acc.length >= budget.maxFiles) return;
  if (!existsSync(dir)) return;
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (acc.length >= budget.maxFiles) return;
    if (ent.name.startsWith(".") && ent.name !== ".env.example") continue;
    if (SKIP_DIRS.has(ent.name)) continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      walkFiles(full, acc, budget);
      continue;
    }
    if (!TEXT_EXT.has(extname(ent.name).toLowerCase())) continue;
    acc.push(full);
  }
}

function snippetAround(text, q, size = 280) {
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const at = lower.indexOf(needle);
  if (at < 0) return text.slice(0, size);
  const start = Math.max(0, at - 80);
  return text.slice(start, start + size).replace(/\s+/g, " ").trim();
}

function searchTree(dir, q, projectRoot = root) {
  const files = [];
  walkFiles(dir, files, { maxFiles: 80 });
  const hits = [];
  const needle = q.toLowerCase();
  for (const file of files) {
    let raw = "";
    try {
      const st = statSync(file);
      if (st.size > 120_000) continue;
      raw = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!raw.toLowerCase().includes(needle)) continue;
    const rel = relative(projectRoot, file).split(sep).join("/");
    hits.push({ path: rel, snippet: snippetAround(raw, q) });
    if (hits.length >= 12) break;
  }
  return hits;
}

function localHits(state, projectId, q) {
  const attached = listConnectors(state, projectId).filter((c) => c.enabled);
  const hits = [];
  const seen = new Set();
  for (const c of attached) {
    const target = c.kind === "docs" ? c.root || "docs" : c.path || ".";
    let dir;
    try {
      dir = resolveWorkspacePath(target);
    } catch {
      continue;
    }
    for (const hit of searchTree(dir, q)) {
      if (seen.has(hit.path)) continue;
      seen.add(hit.path);
      hits.push({ ...hit, connectorId: c.id, kind: c.kind });
    }
  }
  return hits;
}

async function searchMcpFlow(projectId, q) {
  const env = familyEnv();
  const health = await deps.ping(env.mcpFlowUrl, "/health", env.mcpAdminToken);
  if (!health.ok) return null;
  const url = `${env.mcpFlowUrl}/v1/knowledge/search?project=${encodeURIComponent(projectId)}&q=${encodeURIComponent(q)}`;
  try {
    const headers = { Accept: "application/json" };
    if (env.mcpAdminToken) headers.Authorization = `Bearer ${env.mcpAdminToken}`;
    const res = await deps.fetchFn(url, { headers, signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    const data = typeof res.json === "function" ? await res.json() : JSON.parse(await res.text());
    const hits = Array.isArray(data?.hits) ? data.hits : Array.isArray(data) ? data : null;
    if (!hits) return null;
    return hits.map((h) => ({
      path: String(h.path || h.file || ""),
      snippet: String(h.snippet || h.text || "").slice(0, 400),
      connectorId: h.connectorId,
      kind: h.kind || "mcp-flow",
    }));
  } catch {
    return null;
  }
}

export async function searchKnowledge(state, projectId, q, { seatId } = {}) {
  const project = (state.projects || []).find((p) => p.id === projectId);
  if (!project) fail(404, "project not found");
  if (!seatCanSearchProject(state, seatId, projectId)) fail(403, "seat is not on this project");
  const query = String(q || "").trim();
  if (!query) fail(400, "q required");
  const viaMcp = await searchMcpFlow(projectId, query);
  if (viaMcp) return { source: "mcp-flow", projectId, q: query, hits: viaMcp };
  return { source: "core", projectId, q: query, hits: localHits(state, projectId, query) };
}
