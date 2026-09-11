import { createServer } from "node:http";
import { getState, mutate, save, resetState, uid } from "./store.mjs";
import { normalizeSeat, normalizeModelId } from "./seed.mjs";
import { ensure, status as harnessStatus, combinedStatus, listBoundSessions, createSession, promptSession, listLiveModels, harnessKindForSeat, sessionKeyForKind, whichOpenCode } from "./harness.mjs";
import { listProviders, upsertProvider, setAuth, removeProvider, listModels, mergeModelLists, readOpenCodeConfig, hasProviderKey } from "./providers.mjs";
import { addFirstUser, loginUser, parseBearer, publicUser, revokeSession, skipOnboarding, userFromToken } from "./auth.mjs";
import { completeSetup, markHarnessStep, markInstallSeen, publicState, setupStatus } from "./setup.mjs";
import { postBus, wakeSeat, cycleSafe } from "./bus.mjs";
import { attachPtyServer } from "./pty.mjs";
import { attachSeatToTeam, createStaffedTeam, enrichTeams, patchTeam } from "./teams.mjs";
import { syncBotAgents, syncSeatAgent, syncTeamAgent } from "./agents.mjs";
import { createChannel, patchChannel } from "./channels.mjs";
import { postMessage, routeChannelMessage, startSessionSync } from "./chat.mjs";
import { listTrace } from "./trace.mjs";
import { createProject, patchProject } from "./projects.mjs";
import { fireSeat, hireSeat, killRun, pauseSeat, pauseTeam, resumeSeat, wakeBlocked } from "./seats.mjs";
import { applyPlan, chatArchitect, getPlan } from "./architect.mjs";
import { createAccessRequest, listAccessRequests } from "./access.mjs";
import { createGoal, listGoals } from "./goals.mjs";
import { listInbox, markInboxRead } from "./inbox.mjs";
import { createApproval, listApprovals, recordApproval, resolveApproval } from "./approvals.mjs";
import { clearRoutineActive, createRoutine, patchRoutine, publicRoutine, runRoutineNow, tickRoutines } from "./routines.mjs";
import { auditSkill, familyStatus, installSkill, listMcpBackends, registerMcpBackend } from "./family.mjs";
import { fallbackText, validateBlocks } from "roster-flow-blocks";
import { apiHost, apiPort, opencodeHostname, publicUrl } from "./config.mjs";
import { isDataWritable } from "./paths.mjs";
import { tryServeStatic } from "./static.mjs";

const PORT = apiPort();
const HOST = apiHost();

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  });
  res.end(data);
}

function fail(res, err) {
  json(res, err.status || 500, { error: err.message || "error", detail: err.detail || err.code || undefined });
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function composeExtras(body = {}) {
  const extras = {};
  if (body.seatId) extras.seatId = String(body.seatId);
  const attachments = asList(body.attachments)
    .map((a) => ({
      id: String(a.id || uid("att")),
      name: String(a.name || "file").slice(0, 180),
      size: Number(a.size) || 0,
      type: String(a.type || "application/octet-stream").slice(0, 120),
    }))
    .filter((a) => a.name);
  const skills = asList(body.skills)
    .map((s) => ({ id: String(s.id || "").slice(0, 64), name: String(s.name || s.id || "").slice(0, 64) }))
    .filter((s) => s.id && s.name);
  const files = asList(body.files)
    .map((f) => ({ path: String(f.path || "").slice(0, 240), name: String(f.name || f.path || "").slice(0, 180) }))
    .filter((f) => f.path);
  if (attachments.length) extras.attachments = attachments;
  if (skills.length) extras.skills = skills;
  if (files.length) extras.files = files;
  if (body.blocks !== undefined) {
    const result = validateBlocks(body.blocks);
    if (!result.ok) {
      const err = new Error(result.errors[0] || "invalid blocks");
      err.status = 400;
      throw err;
    }
    extras.blocks = result.blocks;
  }
  return extras;
}

function messageText(body, extras) {
  const text = String(body.text || "").trim();
  if (text) return text;
  if (extras.blocks) return fallbackText(extras.blocks);
  return "";
}

function isPublicPath(method, pathname) {
  if (method === "GET" && pathname === "/api/v1/health") return true;
  if (method === "GET" && pathname === "/api/v1/setup/status") return true;
  if (method === "POST" && pathname === "/api/v1/setup/first-user") return true;
  if (method === "POST" && pathname === "/api/v1/setup/install") return true;
  if (method === "POST" && pathname === "/api/v1/auth/login") return true;
  if (method === "POST" && pathname === "/api/v1/access") return true;
  return false;
}

save();
try {
  syncBotAgents(getState().seats, getState().teams);
} catch {
  /* agent files are best-effort */
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "content-type, authorization",
        "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      });
      res.end();
      return;
    }
    const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
    const { pathname } = url;
    const method = req.method || "GET";
    if (tryServeStatic(req, res, pathname)) return;
    const token = parseBearer(req);
    const user = userFromToken(getState(), token);

    if (!skipOnboarding() && !isPublicPath(method, pathname) && !user) {
      json(res, 401, { error: "authentication required" });
      return;
    }

    if (pathname === "/api/v1/setup/status" && method === "GET") {
      json(
        res,
        200,
        setupStatus(getState(), {
          user,
          binary: whichOpenCode(),
          providerKeys: hasProviderKey(),
          dataWritable: isDataWritable(),
        }),
      );
      return;
    }
    if (pathname === "/api/v1/setup/install" && method === "POST") {
      mutate((s) => markInstallSeen(s));
      json(
        res,
        200,
        setupStatus(getState(), {
          user,
          binary: whichOpenCode(),
          providerKeys: hasProviderKey(),
          dataWritable: isDataWritable(),
        }),
      );
      return;
    }
    if (pathname === "/api/v1/setup/first-user" && method === "POST") {
      const body = await readBody(req);
      const created = await addFirstUser(getState(), body);
      save();
      json(res, 201, { user: publicUser(created) });
      return;
    }
    if (pathname === "/api/v1/setup/harness" && method === "POST") {
      const body = await readBody(req).catch(() => ({}));
      mutate((s) => markHarnessStep(s, { skipped: Boolean(body.skipped) }));
      json(
        res,
        200,
        setupStatus(getState(), {
          user,
          binary: whichOpenCode(),
          providerKeys: hasProviderKey(),
          dataWritable: isDataWritable(),
        }),
      );
      return;
    }
    if (pathname === "/api/v1/setup/complete" && method === "POST") {
      const body = await readBody(req);
      let next = null;
      mutate((s) => {
        next = completeSetup(s, { template: body.template, ownerName: user?.name });
        return next;
      });
      try {
        syncBotAgents(next.seats, next.teams);
      } catch {
        /* agent files are best-effort */
      }
      json(res, 200, { ...setupStatus(next, { user, binary: whichOpenCode(), providerKeys: hasProviderKey(), dataWritable: isDataWritable() }), state: publicState(next) });
      return;
    }
    if (pathname === "/api/v1/auth/login" && method === "POST") {
      const body = await readBody(req);
      const out = await loginUser(getState(), body);
      save();
      json(res, 200, out);
      return;
    }
    if (pathname === "/api/v1/auth/me" && method === "GET") {
      json(res, 200, publicUser(user));
      return;
    }
    if (pathname === "/api/v1/auth/logout" && method === "POST") {
      mutate((s) => revokeSession(s, token));
      json(res, 200, { ok: true });
      return;
    }

    if (pathname === "/api/v1/access" && method === "POST") {
      const body = await readBody(req);
      let created = null;
      mutate((s) => {
        created = createAccessRequest(s, body);
      });
      json(res, created.updated ? 200 : 201, created);
      return;
    }
    if (pathname === "/api/v1/access" && method === "GET") {
      json(res, 200, { requests: listAccessRequests(getState()) });
      return;
    }

    if (pathname === "/api/v1/health" && method === "GET") {
      json(res, 200, {
        ok: true,
        ...combinedStatus(),
        seats: getState().seats.length,
        providerKeys: hasProviderKey(),
      });
      return;
    }
    if (pathname === "/api/v1/family/status" && method === "GET") {
      json(res, 200, await familyStatus());
      return;
    }
    if (pathname === "/api/v1/family/skills/audit" && method === "POST") {
      const body = await readBody(req);
      json(res, 200, await auditSkill(body.source));
      return;
    }
    if (pathname === "/api/v1/family/skills/install" && method === "POST") {
      const body = await readBody(req);
      json(res, 200, await installSkill(body.source, { confirm: Boolean(body.confirm) }));
      return;
    }
    if (pathname === "/api/v1/family/mcp/backends" && method === "GET") {
      json(res, 200, await listMcpBackends());
      return;
    }
    if (pathname === "/api/v1/family/mcp/backends" && method === "POST") {
      const body = await readBody(req);
      const created = await registerMcpBackend(body);
      json(res, created.ok ? 201 : 400, created);
      return;
    }
    if (pathname === "/api/v1/reset" && method === "POST") {
      const st = resetState();
      try {
        syncBotAgents(st.seats, st.teams);
      } catch {
        /* agent files are best-effort */
      }
      json(res, 200, publicState(st));
      return;
    }
    if (pathname === "/api/v1/organizations" && method === "GET") {
      json(res, 200, getState().organizations || []);
      return;
    }
    if (pathname === "/api/v1/projects" && method === "GET") {
      json(res, 200, getState().projects || []);
      return;
    }
    if (pathname === "/api/v1/projects" && method === "POST") {
      const body = await readBody(req);
      let created = null;
      mutate((s) => {
        created = createProject(s, body);
      });
      json(res, 201, created);
      return;
    }
    const projectOne = pathname.match(/^\/api\/v1\/projects\/([^/]+)$/);
    if (projectOne && method === "GET") {
      const project = (getState().projects || []).find((p) => p.id === decodeURIComponent(projectOne[1]));
      if (!project) {
        json(res, 404, { error: "project not found" });
        return;
      }
      json(res, 200, project);
      return;
    }
    if (projectOne && method === "PATCH") {
      const id = decodeURIComponent(projectOne[1]);
      const body = await readBody(req);
      let updated = null;
      mutate((s) => {
        updated = patchProject(s, id, body);
      });
      if (!updated) {
        json(res, 404, { error: "project not found" });
        return;
      }
      json(res, 200, updated);
      return;
    }
    if (pathname === "/api/v1/goals" && method === "GET") {
      json(res, 200, listGoals(getState()));
      return;
    }
    if (pathname === "/api/v1/goals" && method === "POST") {
      const body = await readBody(req);
      let created = null;
      mutate((s) => {
        created = createGoal(s, body);
      });
      json(res, 201, created);
      return;
    }
    if (pathname === "/api/v1/approvals" && method === "GET") {
      json(res, 200, listApprovals(getState(), { status: url.searchParams.get("status") || undefined }));
      return;
    }
    if (pathname === "/api/v1/approvals" && method === "POST") {
      const body = await readBody(req);
      let created = null;
      mutate((s) => {
        created = createApproval(s, body, user?.seatId || "you");
      });
      json(res, 201, created);
      return;
    }
    const approvalAct = pathname.match(/^\/api\/v1\/approvals\/([^/]+)\/(approve|reject)$/);
    if (approvalAct && method === "POST") {
      const id = decodeURIComponent(approvalAct[1]);
      const action = approvalAct[2];
      let result = null;
      mutate((s) => {
        result = resolveApproval(s, id, { status: action === "approve" ? "approved" : "rejected", actor: user?.seatId || "you" });
      });
      for (const seat of result.created?.seats || (result.seat ? [result.seat] : [])) {
        if (seat.kind === "bot") syncSeatAgent(seat);
      }
      for (const team of result.created?.teams || []) syncTeamAgent(team);
      json(res, 200, {
        ...result,
        seats: getState().seats,
        teams: enrichTeams(getState().teams, getState().seats),
        projects: getState().projects,
      });
      return;
    }
    if (pathname === "/api/v1/routines" && method === "GET") {
      json(res, 200, (getState().routines || []).map(publicRoutine));
      return;
    }
    if (pathname === "/api/v1/routines" && method === "POST") {
      const body = await readBody(req);
      let created = null;
      mutate((s) => {
        created = createRoutine(s, body);
      });
      json(res, 201, publicRoutine(created));
      return;
    }
    const routineOne = pathname.match(/^\/api\/v1\/routines\/([^/]+)$/);
    if (routineOne && method === "PATCH") {
      const id = decodeURIComponent(routineOne[1]);
      const body = await readBody(req);
      let updated = null;
      mutate((s) => {
        updated = patchRoutine(s, id, body);
      });
      if (!updated) {
        json(res, 404, { error: "routine not found" });
        return;
      }
      json(res, 200, publicRoutine(updated));
      return;
    }
    const routineRun = pathname.match(/^\/api\/v1\/routines\/([^/]+)\/run$/);
    if (routineRun && method === "POST") {
      const id = decodeURIComponent(routineRun[1]);
      const body = await readBody(req).catch(() => ({}));
      const rec = (getState().routines || []).find((r) => r.id === id);
      if (!rec) {
        json(res, 404, { error: "routine not found" });
        return;
      }
      if (rec.webhookSecret) {
        const got = req.headers["x-roster-webhook-secret"] || body.secret || url.searchParams.get("secret");
        if (got && got !== rec.webhookSecret) {
          json(res, 403, { error: "invalid webhook secret" });
          return;
        }
      }
      let prepared = null;
      mutate((s) => {
        prepared = runRoutineNow(s, id);
      });
      const entry = postBus({
        from: "routine",
        to: prepared.seatId,
        kind: "routine",
        text: prepared.prompt,
        wake: true,
        runId: prepared.runId,
      });
      mutate((s) => clearRoutineActive(s, prepared.runId));
      json(res, 200, { ...prepared, routine: publicRoutine(prepared.routine), bus: entry });
      return;
    }
    const runKill = pathname.match(/^\/api\/v1\/runs\/([^/]+)\/kill$/);
    if (runKill && method === "POST") {
      const runId = decodeURIComponent(runKill[1]);
      let result = null;
      mutate((s) => {
        result = killRun(s, runId);
      });
      json(res, 200, result);
      return;
    }
    if (pathname === "/api/v1/architect/chat" && method === "POST") {
      const body = await readBody(req);
      const out = await chatArchitect(getState(), body);
      save();
      json(res, 200, out);
      return;
    }
    if (pathname === "/api/v1/architect/apply" && method === "POST") {
      const body = await readBody(req);
      const planId = body.planId || body.id;
      const existing = getPlan(getState(), planId);
      if (!existing) {
        json(res, 404, { error: "plan not found" });
        return;
      }
      let result = null;
      mutate((s) => {
        const plan = getPlan(s, planId);
        recordApproval(s, {
          kind: "strategy",
          status: "approved",
          actor: user?.seatId || "you",
          planId,
          payload: { summary: plan.summary },
        });
        result = applyPlan(s, plan);
      });
      for (const seat of result.created.seats || []) {
        if (seat.kind === "bot") syncSeatAgent(seat);
      }
      for (const team of result.created.teams || []) syncTeamAgent(team);
      json(res, 200, { ...result, seats: getState().seats, teams: enrichTeams(getState().teams, getState().seats), projects: getState().projects });
      return;
    }
    const planGet = pathname.match(/^\/api\/v1\/architect\/plans\/([^/]+)$/);
    if (planGet && method === "GET") {
      const plan = getPlan(getState(), decodeURIComponent(planGet[1]));
      if (!plan) {
        json(res, 404, { error: "plan not found" });
        return;
      }
      json(res, 200, plan);
      return;
    }
    if (pathname === "/api/v1/teams" && method === "GET") {
      const st = getState();
      json(res, 200, enrichTeams(st.teams, st.seats));
      return;
    }
    if (pathname === "/api/v1/teams" && method === "POST") {
      const body = await readBody(req);
      let created = null;
      mutate((s) => {
        created = createStaffedTeam(s, body);
      });
      for (const seat of created.seats) syncSeatAgent(seat);
      syncTeamAgent(created.team);
      json(res, 201, created);
      return;
    }
    const teamPause = pathname.match(/^\/api\/v1\/teams\/([^/]+)\/pause$/);
    if (teamPause && method === "POST") {
      const id = decodeURIComponent(teamPause[1]);
      let result = null;
      mutate((s) => {
        result = pauseTeam(s, id);
      });
      json(res, 200, result);
      return;
    }
    const teamPatch = pathname.match(/^\/api\/v1\/teams\/([^/]+)$/);
    if (teamPatch && method === "PATCH") {
      const id = decodeURIComponent(teamPatch[1]);
      const body = await readBody(req);
      let updated = null;
      mutate((s) => {
        updated = patchTeam(s, id, body);
      });
      if (!updated) {
        json(res, 404, { error: "team not found" });
        return;
      }
      const generic = getState().seats.find((s) => s.id === updated.genericSeatId);
      if (generic) syncSeatAgent(generic);
      const supervisor = getState().seats.find((s) => s.id === updated.supervisorSeatId);
      if (supervisor) syncSeatAgent(supervisor);
      syncTeamAgent(updated);
      json(res, 200, updated);
      return;
    }
    if (teamPatch && method === "GET") {
      const id = decodeURIComponent(teamPatch[1]);
      const st = getState();
      const team = enrichTeams(st.teams, st.seats).find((t) => t.id === id);
      if (!team) {
        json(res, 404, { error: "team not found" });
        return;
      }
      json(res, 200, team);
      return;
    }
    if (pathname === "/api/v1/bots" && method === "GET") {
      json(res, 200, getState().seats.filter((s) => s.kind === "bot"));
      return;
    }
    if (pathname === "/api/v1/seats" && method === "GET") {
      json(res, 200, getState().seats);
      return;
    }
    if (pathname === "/api/v1/seats" && method === "POST") {
      const body = await readBody(req);
      let seat = null;
      mutate((s) => {
        seat = hireSeat(s, body);
        recordApproval(s, {
          kind: "hire",
          status: "approved",
          actor: user?.seatId || "you",
          seatId: seat.id,
          payload: { id: seat.id, name: seat.name, team: seat.team, projectId: seat.projectId },
        });
      });
      if (seat.kind === "bot") syncSeatAgent(seat);
      json(res, 201, seat);
      return;
    }
    if (pathname === "/api/v1/seats/me/inbox" && method === "GET") {
      const seatId = user?.seatId || "you";
      const box = listInbox(getState(), seatId);
      if (!box) {
        json(res, 404, { error: "seat not found" });
        return;
      }
      json(res, 200, box);
      return;
    }
    const seatInbox = pathname.match(/^\/api\/v1\/seats\/([^/]+)\/inbox$/);
    if (seatInbox && method === "GET") {
      const id = decodeURIComponent(seatInbox[1]);
      const box = listInbox(getState(), id);
      if (!box) {
        json(res, 404, { error: "seat not found" });
        return;
      }
      json(res, 200, box);
      return;
    }
    const seatInboxRead = pathname.match(/^\/api\/v1\/seats\/([^/]+)\/inbox\/read$/);
    if (seatInboxRead && method === "POST") {
      const id = decodeURIComponent(seatInboxRead[1]);
      const body = await readBody(req).catch(() => ({}));
      let box = null;
      mutate((s) => {
        box = markInboxRead(s, id, body.beforeId);
      });
      if (!box) {
        json(res, 404, { error: "seat not found" });
        return;
      }
      json(res, 200, box);
      return;
    }
    const seatPause = pathname.match(/^\/api\/v1\/seats\/([^/]+)\/pause$/);
    if (seatPause && method === "POST") {
      const id = decodeURIComponent(seatPause[1]);
      let updated = null;
      mutate((s) => {
        updated = pauseSeat(s, id);
      });
      json(res, 200, updated);
      return;
    }
    const seatResume = pathname.match(/^\/api\/v1\/seats\/([^/]+)\/resume$/);
    if (seatResume && method === "POST") {
      const id = decodeURIComponent(seatResume[1]);
      let updated = null;
      mutate((s) => {
        updated = resumeSeat(s, id);
      });
      json(res, 200, updated);
      return;
    }
    const seatPatch = pathname.match(/^\/api\/v1\/seats\/([^/]+)$/);
    if (seatPatch && method === "PATCH") {
      const id = decodeURIComponent(seatPatch[1]);
      const body = await readBody(req);
      let updated = null;
      mutate((s) => {
        s.seats = s.seats.map((seat) => {
          if (seat.id !== id) return seat;
          const next = { ...seat, ...body, id };
          if (body.model) next.model = normalizeModelId(body.model);
          if (body.fallbackModel !== undefined) next.fallbackModel = normalizeModelId(body.fallbackModel) || undefined;
          updated = normalizeSeat(next);
          return updated;
        });
        if (updated?.team) attachSeatToTeam(s, updated.team, updated.id);
      });
      if (!updated) {
        json(res, 404, { error: "seat not found" });
        return;
      }
      if (updated.kind === "bot") syncSeatAgent(updated);
      json(res, 200, updated);
      return;
    }
    if (seatPatch && method === "DELETE") {
      const id = decodeURIComponent(seatPatch[1]);
      let result = null;
      mutate((s) => {
        result = fireSeat(s, id);
      });
      json(res, 200, result);
      return;
    }
    const attach = pathname.match(/^\/api\/v1\/seats\/([^/]+)\/attach$/);
    if (attach && method === "POST") {
      const id = decodeURIComponent(attach[1]);
      const body = await readBody(req).catch(() => ({}));
      const seat = getState().seats.find((s) => s.id === id);
      const blocked = wakeBlocked(getState(), seat, { runId: body.runId });
      if (blocked) {
        json(res, 200, { seat: id, paused: true, reason: blocked.reason, sessionId: null, attach: null });
        return;
      }
      const kind = harnessKindForSeat(seat);
      try {
        await ensure({ kind });
      } catch (err) {
        if (err.code !== "OPENCODE_MISSING") throw err;
      }
      const woke = (await wakeSeat(id, "Attached from Roster-flow chart.", { from: "you", kind: "attach" })) || {
        seat: id,
      };
      const h = harnessStatus(kind);
      const sessionId = woke.sessionId || getState()[sessionKeyForKind(kind)]?.[id] || null;
      json(res, 200, {
        seat: id,
        ...woke,
        sessionId,
        harness: h,
        attach: sessionId && h.port ? `opencode attach http://${opencodeHostname()}:${h.port} --session ${sessionId}` : null,
      });
      return;
    }
    if (pathname === "/api/v1/channels" && method === "GET") {
      json(res, 200, getState().channels);
      return;
    }
    if (pathname === "/api/v1/channels" && method === "POST") {
      const body = await readBody(req);
      let created = null;
      mutate((s) => {
        created = createChannel(s, body);
      });
      json(res, 201, created);
      return;
    }
    const chOne = pathname.match(/^\/api\/v1\/channels\/([^/]+)$/);
    if (chOne && method === "GET") {
      const id = decodeURIComponent(chOne[1]);
      const ch = getState().channels.find((c) => c.id === id);
      if (!ch) {
        json(res, 404, { error: "channel not found" });
        return;
      }
      json(res, 200, ch);
      return;
    }
    if (chOne && method === "PATCH") {
      const id = decodeURIComponent(chOne[1]);
      const body = await readBody(req);
      let updated = null;
      mutate((s) => {
        updated = patchChannel(s, id, body);
      });
      if (!updated) {
        json(res, 404, { error: "channel not found" });
        return;
      }
      json(res, 200, updated);
      return;
    }
    const chMsg = pathname.match(/^\/api\/v1\/channels\/([^/]+)\/messages$/);
    if (chMsg && method === "GET") {
      const id = decodeURIComponent(chMsg[1]);
      json(res, 200, getState().messages.filter((m) => m.channel === id));
      return;
    }
    if (chMsg && method === "POST") {
      const id = decodeURIComponent(chMsg[1]);
      const body = await readBody(req);
      const extras = composeExtras(body);
      const text = messageText(body, extras);
      if (!text && !extras.attachments && !extras.skills && !extras.files && !extras.blocks) {
        json(res, 400, { error: "text, blocks, or attachment required" });
        return;
      }
      const msg = postMessage(id, body.who || "You", body.kind || "human", text, extras);
      const routed = text
        ? await routeChannelMessage({ channelId: id, text, from: extras.seatId || "you" })
        : { mentions: [], wakes: [], notify: [] };
      json(res, 201, {
        ...msg,
        mentions: routed.mentions,
        wakes: routed.wakes,
        notify: routed.notify,
        messages: getState().messages.filter((m) => m.channel === id),
      });
      return;
    }
    if (pathname === "/api/v1/threads" && method === "GET") {
      const byCh = {};
      for (const m of getState().messages) {
        byCh[m.channel] = byCh[m.channel] || [];
        byCh[m.channel].push(m);
      }
      json(
        res,
        200,
        Object.entries(byCh).map(([id, messages]) => ({ id, channel: id, count: messages.length })),
      );
      return;
    }
    const thread = pathname.match(/^\/api\/v1\/threads\/([^/]+)$/);
    if (thread && method === "GET") {
      const id = decodeURIComponent(thread[1]);
      json(res, 200, { id, messages: getState().messages.filter((m) => m.channel === id) });
      return;
    }
    if (pathname === "/api/v1/messages" && method === "POST") {
      const body = await readBody(req);
      const from = body.from || "you";
      const to = body.to;
      const extras = composeExtras(body);
      const text = messageText(body, extras);
      if (!to || (!text && !extras.blocks)) {
        json(res, 400, { error: "to and text or blocks required" });
        return;
      }
      if (!cycleSafe(from, to)) {
        json(res, 429, { error: "cycle detector: too many ping-pongs" });
        return;
      }
      let channel = "ship";
      if (String(to).startsWith("channel:")) channel = to.slice("channel:".length);
      const fromSeat = getState().seats.find((s) => s.id === from);
      postMessage(channel, fromSeat?.name || from, fromSeat?.kind || "bot", text, { ...extras, seatId: extras.seatId || from });
      const entry = postBus({ from, to, kind: "send_message", text, wake: body.wake !== false && !String(to).startsWith("channel:") });
      json(res, 201, entry);
      return;
    }
    if (pathname === "/api/v1/bus" && method === "GET") {
      json(res, 200, getState().bus);
      return;
    }
    if (pathname === "/api/v1/bus/send" && method === "POST") {
      const body = await readBody(req);
      const extras = composeExtras(body);
      const text = messageText(body, extras);
      if (!body.from || !body.to || (!text && !extras.blocks)) {
        json(res, 400, { error: "from, to, and text or blocks required" });
        return;
      }
      if (!cycleSafe(body.from, body.to)) {
        json(res, 429, { error: "cycle detector: too many ping-pongs" });
        return;
      }
      const fromSeat = getState().seats.find((s) => s.id === body.from);
      postMessage(body.channel || "ship", fromSeat?.name || body.from, fromSeat?.kind || "bot", text, {
        ...extras,
        seatId: extras.seatId || body.from,
      });
      json(res, 201, postBus({ ...body, text }));
      return;
    }
    if (pathname === "/api/v1/block-actions" && method === "POST") {
      const body = await readBody(req);
      const messageId = String(body.messageId || "");
      const actionId = String(body.actionId || "");
      const value = String(body.value || "");
      const userId = String(body.userId || "you");
      const msg = getState().messages.find((m) => m.id === messageId);
      if (!msg) {
        json(res, 404, { error: "message not found" });
        return;
      }
      if (!actionId) {
        json(res, 400, { error: "actionId required" });
        return;
      }
      const to = msg.seatId || "channel";
      const text = `block_actions ${actionId}${value ? `=${value}` : ""}`;
      const entry = postBus({
        from: userId,
        to,
        kind: "block_actions",
        text,
        channel: msg.channel,
        actionId,
        value,
        messageId,
        wake: true,
      });
      void wakeSeat(to, `User clicked ${actionId}${value ? ` (${value})` : ""} on your Block Kit message.`, {
        from: userId,
        kind: "block_actions",
        messageId,
        actionId,
        value,
      });
      json(res, 201, entry);
      return;
    }
    if (pathname === "/api/v1/harness" && method === "GET") {
      json(res, 200, combinedStatus());
      return;
    }
    if (pathname === "/api/v1/harness/ensure" && method === "POST") {
      const body = await readBody(req).catch(() => ({}));
      const kind = body.kind === "system" ? "system" : "company";
      try {
        await ensure({ forceRestart: Boolean(body.forceRestart), kind });
        json(res, 200, combinedStatus());
      } catch (err) {
        json(res, err.status || 409, { error: err.message, code: err.code, ...combinedStatus() });
      }
      return;
    }
    if (pathname === "/api/v1/debug/trace" && method === "GET") {
      json(res, 200, {
        events: listTrace({
          since: url.searchParams.get("since") || undefined,
          channel: url.searchParams.get("channel") || undefined,
          scope: url.searchParams.get("scope") || undefined,
          limit: url.searchParams.get("limit") || 80,
        }),
        ...combinedStatus(),
        providerKeys: hasProviderKey(),
      });
      return;
    }
    if (pathname === "/api/v1/harness/sessions" && method === "GET") {
      try {
        const sessions = await listBoundSessions();
        json(res, 200, { sessions, ...combinedStatus() });
      } catch (err) {
        json(res, 200, { harness: "offline", sessions: [], error: err.message, ...combinedStatus() });
      }
      return;
    }
    if (pathname === "/api/v1/harness/sessions" && method === "POST") {
      const body = await readBody(req);
      json(res, 201, await createSession(body));
      return;
    }
    const promptPath = pathname.match(/^\/api\/v1\/harness\/sessions\/([^/]+)\/prompt$/);
    if (promptPath && method === "POST") {
      const body = await readBody(req);
      json(res, 200, await promptSession(decodeURIComponent(promptPath[1]), body));
      return;
    }
    if (pathname === "/api/v1/providers" && method === "GET") {
      json(res, 200, listProviders());
      return;
    }
    if (pathname === "/api/v1/providers" && method === "PUT") {
      json(res, 200, upsertProvider(await readBody(req)));
      return;
    }
    const authP = pathname.match(/^\/api\/v1\/providers\/([^/]+)\/auth$/);
    if (authP && method === "POST") {
      const body = await readBody(req);
      json(res, 200, setAuth(decodeURIComponent(authP[1]), body.apiKey || body.key));
      return;
    }
    const delP = pathname.match(/^\/api\/v1\/providers\/([^/]+)$/);
    if (delP && method === "DELETE") {
      json(res, 200, removeProvider(decodeURIComponent(delP[1])));
      return;
    }
    if (pathname === "/api/v1/models" && method === "GET") {
      const live = await listLiveModels().catch(() => []);
      json(res, 200, mergeModelLists(live, listModels()));
      return;
    }
    if (pathname === "/api/v1/opencode/config" && method === "GET") {
      json(res, 200, readOpenCodeConfig());
      return;
    }
    if (pathname === "/api/v1/state" && method === "GET") {
      json(res, 200, publicState(getState()));
      return;
    }
    json(res, 404, { error: "not found", path: pathname });
  } catch (err) {
    fail(res, err);
  }
});

attachPtyServer(server);
server.on("clientError", (err, socket) => {
  try {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  } catch {
    /* ignore */
  }
});

startSessionSync();
const ROUTINE_TICK_MS = Number(process.env.ROSTER_ROUTINE_TICK_MS) || 15_000;
function startRoutineTicker() {
  if (process.env.ROSTER_DISABLE_ROUTINES === "1") return;
  setInterval(() => {
    let due = [];
    try {
      mutate((s) => {
        due = tickRoutines(s, Date.now());
      });
      for (const item of due) {
        if (item.coalesced) {
          mutate((s) => clearRoutineActive(s, item.runId));
          continue;
        }
        postBus({
          from: "routine",
          to: item.seatId,
          kind: "routine",
          text: item.prompt,
          wake: true,
          runId: item.runId,
        });
        mutate((s) => clearRoutineActive(s, item.runId));
      }
    } catch (err) {
      console.error("routine tick", err);
    }
  }, ROUTINE_TICK_MS);
}
server.listen(PORT, HOST, () => {
  const shown = HOST === "0.0.0.0" || HOST === "::" ? "127.0.0.1" : HOST;
  console.log(`roster-flow CORE API http://${shown}:${PORT}`);
  console.log(`Setup: ${publicUrl()}/setup`);
  startRoutineTicker();
});
