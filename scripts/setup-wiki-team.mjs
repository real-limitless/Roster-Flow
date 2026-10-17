#!/usr/bin/env node
/**
 * Stand up the wiki-flow docs team on a running Roster-flow CORE.
 *
 *   FEATHERLESS_API_KEY=... node scripts/setup-wiki-team.mjs
 *
 * 1. PUT  /api/v1/providers  Featherless (OpenAI-compatible). The key is
 *    referenced as {env:FEATHERLESS_API_KEY}; it is never written here.
 * 2. POST /api/v1/projects   wiki-flow docs project (409 = already there).
 * 3. POST /api/v1/teams      @wiki with architect/scribe/diagrammer/editor.
 *    On 409, any missing specialist seats are hired via POST /api/v1/seats.
 *
 * Auth: ROSTER_API_TOKEN, a scoped API token (rf_..., needs "write") from
 *       Settings → API tokens, POST /api/v1/tokens, or scripts/create-token.mjs.
 * Env:  ROSTER_API (default http://127.0.0.1:8790), WIKI_PROJECT_ID (wiki-flow-docs),
 *       WIKI_MODEL (default deepseek-ai/DeepSeek-V4.1-Flash). The provider
 *       models list is the catalog, the models this script assigns, the
 *       provider's current models, and every featherless model a seat or
 *       team already uses.
 */
import { contextTokenLimit, FEATHERLESS_CHAT_ID, FEATHERLESS_CODER_ID, outputTokenLimit } from "../server/model-defaults.mjs";

export const FEATHERLESS_MODEL_DEFAULTS = [
  { id: FEATHERLESS_CODER_ID, name: "Qwen2.5 Coder 32B" },
  { id: "meta-llama/Meta-Llama-3.1-70B-Instruct", name: "Llama 3.1 70B" },
  { id: "deepseek-ai/DeepSeek-V3-0324", name: "DeepSeek V3" },
  { id: FEATHERLESS_CHAT_ID, name: "DeepSeek V4.1 Flash" },
];

export const FEATHERLESS = {
  id: "featherless",
  name: "Featherless",
  baseURL: "https://api.featherless.ai/v1",
  apiKeyEnv: "FEATHERLESS_API_KEY",
  models: FEATHERLESS_MODEL_DEFAULTS,
};

function listedModel(id, name, output, context) {
  return {
    id,
    name: name || id,
    limit: { context: contextTokenLimit(context), output: outputTokenLimit(output) },
  };
}

/**
 * Catalog defaults, models already on the provider, and every assigned
 * featherless model id. A rerun must not drop a model another seat still uses.
 * Refs for a different provider are ignored.
 */
export function featherlessModels(assignedRefs = [], current = []) {
  const byId = new Map(FEATHERLESS_MODEL_DEFAULTS.map((m) => [m.id, listedModel(m.id, m.name)]));
  const add = (id, name, output, context) => {
    const mid = String(id || "").trim();
    if (!mid || byId.has(mid)) return;
    byId.set(mid, listedModel(mid, name, output, context));
  };
  for (const item of current) {
    if (!item) continue;
    if (typeof item === "string") add(item);
    else add(item.id || item.modelID, item.name, item.limit?.output ?? item.max_tokens, item.limit?.context);
  }
  for (const ref of assignedRefs) {
    const raw = String(ref || "").trim();
    if (!raw) continue;
    if (raw.toLowerCase().startsWith("featherless/")) add(raw.slice("featherless/".length));
  }
  return [...byId.values()];
}

export function wikiModelId(ref) {
  const raw = String(ref || "").trim();
  if (!raw) return FEATHERLESS_CHAT_ID;
  return raw.startsWith("featherless/") ? raw.slice("featherless/".length) : raw;
}

export function wikiSpecialists(model) {
  const m = `featherless/${model}`;
  return [
    { id: "wiki-architect", name: "Wiki Architect", role: "Information architecture", model: m, job: "Plan page tree and slugs from wiki-flow sources." },
    { id: "wiki-scribe", name: "Wiki Scribe", role: "Writer", model: m, job: "Draft pages from sources and publish with wikiflow_put_page." },
    { id: "wiki-diagrammer", name: "Wiki Diagrammer", role: "Diagrams", model: m, job: "Add Mermaid diagrams grounded in sources." },
    { id: "wiki-editor", name: "Wiki Editor", role: "Editor", model: m, job: "Review pages for accuracy, citations, and tone." },
  ].map((s) => ({ ...s, tools: ["read", "bus"], deny: ["deploy", "bash"] }));
}

function client(base, token, fetchImpl) {
  return async (path, init = {}) => {
    const headers = { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) };
    const res = await fetchImpl(`${base}${path}`, { ...init, headers });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, ok: res.ok, data };
  };
}

async function readList(call, path) {
  const res = await call(path);
  if (res.status === 401 || res.status === 403) {
    throw new Error(`ROSTER_API_TOKEN rejected (${res.status}): ${res.data?.error || "check that it is live and has write scope"}`);
  }
  if (!res.ok || !Array.isArray(res.data)) return [];
  return res.data;
}

function coreError(step, res) {
  const error = String(res.data?.error || "");
  const detail = String(res.data?.detail || "");
  const msg = `${step}: ${res.status} ${error}`;
  if (/\bE(ACCES|PERM)\b/.test(`${error} ${detail}`)) {
    return new Error(
      `${msg}\nCORE cannot write its data volume. Start roster-flow as root (the image default; no user: override) ` +
        `so docker/entrypoint.sh repairs /data ownership, then rerun. See docs/STANDUP.md "Data volume ownership".`,
    );
  }
  return new Error(msg);
}

export async function setupWikiTeam({
  env = process.env,
  fetchImpl = fetch,
  log = console.log,
} = {}) {
  const base = (env.ROSTER_API || "http://127.0.0.1:8790").replace(/\/+$/, "");
  const token = String(env.ROSTER_API_TOKEN || "").trim();
  if (!token) throw new Error("ROSTER_API_TOKEN is required (create one in Settings → API tokens or with scripts/create-token.mjs)");
  const call = client(base, token, fetchImpl);
  const projectId = env.WIKI_PROJECT_ID || "wiki-flow-docs";
  const model = wikiModelId(env.WIKI_MODEL);
  if (!env.FEATHERLESS_API_KEY) log("warn: FEATHERLESS_API_KEY is not set; seats will be configured but cannot run until it is.");

  const specialists = wikiSpecialists(model);
  const providers = await readList(call, "/api/v1/providers");
  const seats = await readList(call, "/api/v1/seats");
  const teams = await readList(call, "/api/v1/teams");
  const current = providers.find((p) => p?.id === "featherless")?.models;
  const inUse = [];
  for (const seat of seats) inUse.push(seat?.model, seat?.fallbackModel);
  for (const team of teams) inUse.push(team?.defaultModel, team?.fallbackModel, ...(team?.allowedModels || []));
  const provider = {
    ...FEATHERLESS,
    models: featherlessModels([`featherless/${model}`, ...specialists.map((s) => s.model), ...inUse], Array.isArray(current) ? current : []),
  };
  const prov = await call("/api/v1/providers", { method: "PUT", body: JSON.stringify(provider) });
  if (prov.status === 401 || prov.status === 403) {
    throw new Error(`ROSTER_API_TOKEN rejected (${prov.status}): ${prov.data?.error || "check that it is live and has write scope"}`);
  }
  if (!prov.ok) throw coreError("provider", prov);
  log("provider featherless: ok");

  const proj = await call("/api/v1/projects", {
    method: "POST",
    body: JSON.stringify({ id: projectId, name: "wiki-flow docs", brief: "Docs-build integration with wiki-flow." }),
  });
  if (!proj.ok && proj.status !== 409) throw coreError("project", proj);
  log(`project ${projectId}: ${proj.status === 409 ? "exists" : "created"}`);

  const team = await call("/api/v1/teams", {
    method: "POST",
    body: JSON.stringify({
      id: "wiki",
      name: "@wiki",
      role: "Docs",
      description: "Builds the project wiki from wiki-flow sources.",
      defaultModel: `featherless/${model}`,
      projectId,
      specialists,
    }),
  });
  const hired = [];
  if (team.status === 409) {
    log("team wiki: exists; checking specialists");
    const seats = await call("/api/v1/seats");
    const have = new Set((seats.data || []).map((s) => s.id));
    for (const spec of specialists) {
      if (have.has(spec.id)) continue;
      const r = await call("/api/v1/seats", {
        method: "POST",
        body: JSON.stringify({ ...spec, kind: "bot", seatType: "specialist", team: "wiki", reportsTo: "wiki-supervisor", projectId }),
      });
      if (!r.ok && r.status !== 409) throw coreError(`seat ${spec.id}`, r);
      hired.push(spec.id);
    }
  } else if (!team.ok) {
    throw coreError("team", team);
  } else {
    log("team wiki: created");
  }
  if (hired.length) log(`hired: ${hired.join(", ")}`);
  return { projectId, model, teamCreated: team.ok, hired };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  setupWikiTeam().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
