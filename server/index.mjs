import { createServer } from "node:http";
import { getState, mutate, save, resetState, uid } from "./store.mjs";
import {
  ensure,
  status as harnessStatus,
  combinedStatus,
  liveCombinedStatus,
  listBoundSessions,
  createSession,
  promptSession,
  listLiveModels,
  harnessKindForSeat,
  sessionKeyForKind,
  whichOpenCode,
  describeOpenCodeError,
  restartForProviderChange,
} from "./harness.mjs";
import { listProviders, upsertProvider, setAuth, removeProvider, listModels, mergeModelLists, readOpenCodeConfig, hasProviderKey } from "./providers.mjs";
import { addFirstUser, changePassword, DEMO_TOKEN, loginUser, parseBearer, publicUser, revokeSession, skipOnboarding, userFromToken } from "./auth.mjs";
import { allowStateReset, demoMode, demoResetMs } from "./flags.mjs";
import { createApiToken, isApiToken, listApiTokens, resolveApiToken, revokeApiToken, seedApiTokenFromEnv, tokenAllows } from "./tokens.mjs";
import { requireBootstrapToken, seedOwnerFromEnv, setupClosed } from "./bootstrap.mjs";
import { completeSetup, markHarnessStep, markInstallSeen, publicSetupStatus, publicState, setupStatus, startOver } from "./setup.mjs";
import { pendingWake, postBus, wakeSeat, cycleSafe } from "./bus.mjs";
import {
  callbackSecretInfo,
  deliverCallback,
  followUpJob,
  getJob,
  listJobs,
  publishNewJob,
  rotateCallbackSecret,
  settleJob,
  waitForJob,
} from "./jobs.mjs";
import { canReadJob } from "./job-access.mjs";
import { readJobFile, writeJobFile } from "./files.mjs";
import { attachPtyServer } from "./pty.mjs";
import { createStaffedTeam, enrichTeams, patchTeam } from "./teams.mjs";
import { syncBotAgents, syncSeatAgent, syncTeamAgent } from "./agents.mjs";
import { channelsForSeat, createChannel, patchChannel, publicChannel } from "./channels.mjs";
import { sessionRoom } from "./room-sessions.mjs";
import { INTERNAL_SEAT_FIELDS, internalTokenAllows, isInternalPluginToken } from "./internal-token.mjs";
import { postMessage, resetChatRuntime, routeChannelMessage, startSessionSync } from "./chat.mjs";
import { listTrace } from "./trace.mjs";
import { createProject, patchProject } from "./projects.mjs";
import { attachConnector, listConnectors, publicConnector, removeConnector, searchKnowledge } from "./knowledge.mjs";
import { fireSeat, hireSeat, killRun, patchSeat, pauseSeat, pauseTeam, resumeSeat, wakeBlocked } from "./seats.mjs";
import { adapterSecretOk, isOpenCodeAdapter, parseAdapterCallback, publicSeat, publicSeats } from "./adapters.mjs";
import { applyPlan, chatArchitect, getPlan } from "./architect.mjs";
import { createTask, claimTask, completeTask, listTasks } from "./tasks.mjs";
import { createAccessRequest, listAccessRequests } from "./access.mjs";
import { createGoal, listGoals } from "./goals.mjs";
import { listUsage, meterWake, usageCsv } from "./budget.mjs";
import { listInbox, markInboxRead } from "./inbox.mjs";
import { createApproval, listApprovals, recordApproval, resolveApproval } from "./approvals.mjs";
import { clearRoutineActive, createRoutine, patchRoutine, publicRoutine, runRoutineNow, tickRoutines } from "./routines.mjs";
import { tickHeartbeats } from "./heartbeats.mjs";
import { auditSkill, familyStatus, installSkill, listMcpBackends, registerMcpBackend } from "./family.mjs";
import { attachGithubCard, githubStatus, handleGithubBlockAction, isGithubAction, refreshGithubMessage } from "./github.mjs";
import { fallbackText, validateBlocks } from "roster-flow-blocks";
import { apiHost, apiPort, opencodeHostname, publicUrl } from "./config.mjs";
import { autostartHarness, seedProviderFromEnv } from "./autostart.mjs";
import { isDataWritable } from "./paths.mjs";
import { tryServeStatic } from "./static.mjs";
import { handleSlackAction, handleSlackEvent, mirrorToSlack, slackStatus, verifySlackRequest } from "./slack.mjs";
import { allowMcp, isMcpPath, MCP_GUEST_ID, serveMcp } from "./mcp.mjs";

const PORT = apiPort();
const HOST = apiHost();

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, authorization, mcp-session-id, mcp-protocol-version",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
  });
  res.end(data);
}

async function setupPayload(state, user) {
  const live = await liveCombinedStatus();
  const full = setupStatus(state, {
    user,
    binary: whichOpenCode(),
    harness: live.harness,
    providerKeys: hasProviderKey(),
    dataWritable: isDataWritable(),
  });
  return user ? full : publicSetupStatus(full);
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

async function readRaw(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
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

function githubHint(body = {}) {
  return {
    text: body.text,
    prUrl: body.prUrl,
    issueUrl: body.issueUrl,
    branch: body.branch,
  };
}

async function postRoomMessage(channel, who, kind, text, extras, hint = {}) {
  const msg = postMessage(channel, who, kind, text, extras);
  return attachGithubCard(msg, { ...hint, text });
}

/** The room an OpenCode session belongs to, so plugin tools post where the seat was woken. */
function roomOfSession(sessionId) {
  if (!sessionId) return null;
  return sessionRoom(getState(), String(sessionId))?.channelId || null;
}

function requestCaller(user, apiToken) {
  return {
    userId: user?.id || null,
    seatId: apiToken?.token?.seatId || user?.seatId || "you",
    name: user?.name || null,
    tokenId: apiToken?.token?.id || null,
  };
}

function jobDeps() {
  return { mutate, getState, postMessage, postBus, wakeSeat, deliverCallback };
}

function isPublicPath(method, pathname) {
  if (method === "GET" && pathname === "/api/v1/health") return true;
  if (method === "GET" && pathname === "/api/v1/setup/status") return true;
  if (method === "POST" && pathname === "/api/v1/setup/first-user") return true;
  if (method === "POST" && pathname === "/api/v1/setup/install") return true;
  if (method === "POST" && pathname === "/api/v1/auth/login") return true;
  if (method === "POST" && pathname === "/api/v1/access") return true;
  // Reachable without a session so a logged-out owner can present a password.
  // When setupClosed(), startOver still requires an owner session or password.
  if (method === "POST" && pathname === "/api/v1/setup/start-over") return true;
  if (pathname === "/api/v1/slack/events" || pathname === "/api/v1/slack/actions") return true;
  return false;
}

try {
  const seeded = await seedOwnerFromEnv(getState());
  if (seeded.seeded) {
    mutate(() => seeded.state);
    console.log(`Owner ${seeded.user.email} seeded from env; setup is closed.`);
  }
  const tok = seedApiTokenFromEnv(getState());
  if (tok.seeded) {
    save();
    console.log(`API token "${tok.record.name}" registered from ROSTER_API_TOKEN.`);
  } else if (tok.reason === "no owner") {
    console.log("ROSTER_API_TOKEN is set but no owner exists yet; it will register on the next boot after setup.");
  }
} catch (err) {
  console.error(`Owner seed from env failed: ${err.message}`);
  process.exit(1);
}
try {
  const provider = seedProviderFromEnv();
  if (provider.seeded) console.log(`Provider ${provider.provider.id} seeded from env.`);
  else if (provider.reason) console.log(`Provider seed skipped: ${provider.reason}`);
} catch (err) {
  console.error(`Provider seed from env failed: ${err.message}`);
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
        "access-control-allow-headers": "content-type, authorization, mcp-session-id, mcp-protocol-version",
        "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      });
      res.end();
      return;
    }
    const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
    const { pathname } = url;
    const method = req.method || "GET";
    if (isMcpPath(pathname)) {
      const token = parseBearer(req);
      const mcpApiToken = isApiToken(token) ? resolveApiToken(getState(), token) : null;
      if (isApiToken(token) && (!mcpApiToken || !tokenAllows(mcpApiToken.token, method, pathname))) {
        json(res, mcpApiToken ? 403 : 401, { error: mcpApiToken ? "token scope does not allow this request" : "invalid, expired, or revoked API token" });
        return;
      }
      const mcpUser = mcpApiToken ? mcpApiToken.user : userFromToken(getState(), token);
      if (!allowMcp(req, mcpUser)) {
        json(res, 401, { error: "authentication required" });
        return;
      }
      // Dedicated ROSTER_MCP_TOKEN and skip-onboarding callers act as the MCP guest seat.
      const caller = mcpUser || mcpApiToken
        ? requestCaller(mcpUser, mcpApiToken)
        : { userId: null, seatId: MCP_GUEST_ID, name: "MCP Guest", tokenId: null };
      await serveMcp(req, res, { caller, scopes: mcpApiToken?.token?.scopes || null, getState, mutate, jobDeps });
      return;
    }
    if (tryServeStatic(req, res, pathname)) return;
    const token = parseBearer(req);
    const internal = isInternalPluginToken(token);
    const apiToken = !internal && isApiToken(token) ? resolveApiToken(getState(), token) : null;
    const user = internal ? (getState().users || [])[0] || null : apiToken ? apiToken.user : userFromToken(getState(), token);

    if (internal && !internalTokenAllows(method, pathname)) {
      json(res, 403, { error: "the internal plugin token does not allow this request" });
      return;
    }
    if (!internal && isApiToken(token) && !apiToken) {
      json(res, 401, { error: "invalid, expired, or revoked API token" });
      return;
    }
    if (!internal && !skipOnboarding() && !isPublicPath(method, pathname) && !user) {
      json(res, 401, { error: "authentication required" });
      return;
    }
    if (apiToken && !tokenAllows(apiToken.token, method, pathname)) {
      json(res, 403, { error: "token scope does not allow this request" });
      return;
    }

    if (pathname === "/api/v1/tokens" && method === "GET") {
      json(res, 200, listApiTokens(getState()));
      return;
    }
    if (pathname === "/api/v1/tokens" && method === "POST") {
      const body = await readBody(req);
      let out = null;
      mutate((s) => {
        out = createApiToken(s, {
          name: body.name,
          scopes: body.scopes,
          expiresAt: body.expiresAt,
          expiresInDays: body.expiresInDays,
          userId: user?.id,
          seatId: body.seatId,
        });
      });
      json(res, 201, out);
      return;
    }
    const tokenOne = pathname.match(/^\/api\/v1\/tokens\/([^/]+)$/);
    if (tokenOne && method === "DELETE") {
      let out = null;
      mutate((s) => {
        out = revokeApiToken(s, decodeURIComponent(tokenOne[1]));
      });
      json(res, 200, out);
      return;
    }

    if (pathname === "/api/v1/setup/status" && method === "GET") {
      json(res, 200, await setupPayload(getState(), user));
      return;
    }
    if (pathname === "/api/v1/setup/install" && method === "POST") {
      mutate((s) => markInstallSeen(s));
      json(res, 200, await setupPayload(getState(), user));
      return;
    }
    if (pathname === "/api/v1/setup/first-user" && method === "POST") {
      const body = await readBody(req);
      if (setupClosed(getState())) {
        json(res, 409, { error: "setup is closed: an owner already exists" });
        return;
      }
      requireBootstrapToken(req, body);
      const created = await addFirstUser(getState(), body);
      save();
      json(res, 201, { user: publicUser(created) });
      return;
    }
    if (pathname === "/api/v1/setup/harness" && method === "POST") {
      const body = await readBody(req).catch(() => ({}));
      mutate((s) => markHarnessStep(s, { skipped: Boolean(body.skipped) }));
      json(res, 200, await setupPayload(getState(), user));
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
      json(res, 200, { ...(await setupPayload(next, user)), state: publicState(next) });
      return;
    }
    if (pathname === "/api/v1/setup/start-over" && method === "POST") {
      const body = await readBody(req);
      const seen = getState();
      // Bearer identity only (login session, or an API token userFromToken resolves). Never body.user.
      // Non-admin API tokens are already rejected above: /setup/* requires the admin scope.
      const sessionUser = userFromToken(seen, token);
      const next = await startOver(seen, {
        email: body.email,
        confirm: body.confirm,
        password: body.password,
        user: sessionUser,
        req,
        body,
      });
      mutate((s) => {
        const sameOwner =
          setupClosed(s) === setupClosed(seen) &&
          (s.users?.[0]?.id || "") === (seen.users?.[0]?.id || "") &&
          (s.users?.[0]?.passwordHash || "") === (seen.users?.[0]?.passwordHash || "");
        if (!sameOwner) {
          const err = new Error("owner changed; retry start-over");
          err.status = 409;
          throw err;
        }
        return next;
      });
      json(res, 200, await setupPayload(next, null));
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
    if (pathname === "/api/v1/auth/password" && method === "POST") {
      if (!user) {
        json(res, 401, { error: "authentication required" });
        return;
      }
      if (skipOnboarding() && token === DEMO_TOKEN) {
        json(res, 401, { error: "sign in with the owner password to rotate it" });
        return;
      }
      const body = await readBody(req);
      const out = await changePassword(getState(), {
        userId: user.id,
        currentPassword: body.current || body.currentPassword,
        newPassword: body.next || body.newPassword,
        keepToken: token,
      });
      save();
      json(res, 200, { ok: true, ...out });
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
      const status = await liveCombinedStatus();
      json(res, 200, {
        ok: true,
        ...status,
        harnessReady: status.harness === "up",
        ready: status.harness === "up" && status.systemHarness?.harness === "up",
        seats: getState().seats.length,
        providerKeys: hasProviderKey(),
        demo: demoMode(),
        demoResetMs: demoResetMs(),
      });
      return;
    }
    if (pathname === "/api/v1/family/status" && method === "GET") {
      json(res, 200, await familyStatus());
      return;
    }
    if (pathname === "/api/v1/slack" && method === "GET") {
      json(res, 200, slackStatus());
      return;
    }
    if (pathname === "/api/v1/slack/events" && method === "POST") {
      const raw = await readRaw(req);
      const ts = req.headers["x-slack-request-timestamp"];
      const sig = req.headers["x-slack-signature"];
      if (!verifySlackRequest(raw, ts, sig)) {
        json(res, 401, { error: "invalid slack signature" });
        return;
      }
      let body = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        json(res, 400, { error: "invalid json" });
        return;
      }
      try {
        const out = await handleSlackEvent(body);
        json(res, 200, out);
      } catch (err) {
        fail(res, err);
      }
      return;
    }
    if (pathname === "/api/v1/slack/actions" && method === "POST") {
      const raw = await readRaw(req);
      const ts = req.headers["x-slack-request-timestamp"];
      const sig = req.headers["x-slack-signature"];
      if (!verifySlackRequest(raw, ts, sig)) {
        json(res, 401, { error: "invalid slack signature" });
        return;
      }
      let payload = {};
      try {
        if (String(req.headers["content-type"] || "").includes("application/x-www-form-urlencoded")) {
          payload = JSON.parse(new URLSearchParams(raw).get("payload") || "{}");
        } else {
          payload = raw ? JSON.parse(raw) : {};
        }
      } catch {
        json(res, 400, { error: "invalid payload" });
        return;
      }
      try {
        const out = await handleSlackAction(payload);
        json(res, 200, out);
      } catch (err) {
        fail(res, err);
      }
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
      if (!allowStateReset()) {
        json(res, 403, { error: "reset disabled on public demo" });
        return;
      }
      const st = resetState();
      resetChatRuntime();
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
    const projectConn = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/connectors(?:\/([^/]+))?$/);
    if (projectConn && !projectConn[2] && method === "GET") {
      json(res, 200, listConnectors(getState(), decodeURIComponent(projectConn[1])).map(publicConnector));
      return;
    }
    if (projectConn && !projectConn[2] && method === "POST") {
      const body = await readBody(req);
      try {
        let created = null;
        mutate((s) => {
          created = attachConnector(s, decodeURIComponent(projectConn[1]), body);
        });
        json(res, 201, created);
      } catch (err) {
        fail(res, err);
      }
      return;
    }
    if (projectConn && projectConn[2] && method === "DELETE") {
      let removed = null;
      mutate((s) => {
        removed = removeConnector(s, decodeURIComponent(projectConn[1]), decodeURIComponent(projectConn[2]));
      });
      if (!removed) {
        json(res, 404, { error: "connector not found" });
        return;
      }
      json(res, 200, removed);
      return;
    }
    const projectKnow = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/knowledge$/);
    if (projectKnow && method === "GET") {
      try {
        const out = await searchKnowledge(getState(), decodeURIComponent(projectKnow[1]), url.searchParams.get("q") || "", {
          seatId: url.searchParams.get("seatId") || user?.seatId || "you",
        });
        json(res, 200, out);
      } catch (err) {
        fail(res, err);
      }
      return;
    }
    if (pathname === "/api/v1/goals" && method === "GET") {
      json(res, 200, listGoals(getState()));
      return;
    }
    if (pathname === "/api/v1/tasks" && method === "GET") {
      json(
        res,
        200,
        listTasks(getState(), {
          projectId: url.searchParams.get("projectId") || undefined,
          runId: url.searchParams.get("runId") || undefined,
        }),
      );
      return;
    }
    if (pathname === "/api/v1/tasks" && method === "POST") {
      const body = await readBody(req);
      let created = null;
      mutate((s) => {
        created = createTask(s, body);
      });
      json(res, 201, created);
      return;
    }
    {
      const claimMatch = pathname.match(/^\/api\/v1\/tasks\/([^/]+)\/claim$/);
      if (claimMatch && method === "POST") {
        const body = await readBody(req).catch(() => ({}));
        let claimed = null;
        mutate((s) => {
          claimed = claimTask(s, decodeURIComponent(claimMatch[1]), body.seatId);
        });
        json(res, 200, claimed);
        return;
      }
      const completeMatch = pathname.match(/^\/api\/v1\/tasks\/([^/]+)\/complete$/);
      if (completeMatch && method === "POST") {
        const body = await readBody(req).catch(() => ({}));
        let done = null;
        mutate((s) => {
          done = completeTask(s, decodeURIComponent(completeMatch[1]), body.seatId);
        });
        json(res, 200, done);
        return;
      }
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
    if (pathname === "/api/v1/usage" && method === "GET") {
      const rows = listUsage(getState(), {
        projectId: url.searchParams.get("projectId") || undefined,
        teamId: url.searchParams.get("teamId") || undefined,
        seatId: url.searchParams.get("seatId") || undefined,
      });
      if (url.searchParams.get("format") === "csv") {
        const body = usageCsv(rows);
        res.writeHead(200, {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": "attachment; filename=roster-usage.csv",
          "access-control-allow-origin": "*",
        });
        res.end(body);
        return;
      }
      json(res, 200, rows);
      return;
    }
    if (pathname === "/api/v1/heartbeats/tick" && method === "POST") {
      let due = [];
      mutate((s) => {
        due = tickHeartbeats(s, Date.now());
      });
      for (const item of due) {
        if (item.coalesced) continue;
        postBus({
          from: "heartbeat",
          to: item.seatId,
          kind: "heartbeat",
          text: item.prompt,
          wake: true,
        });
      }
      json(res, 200, { due });
      return;
    }
    if (pathname === "/api/v1/usage" && method === "POST") {
      const body = await readBody(req);
      let out = null;
      mutate((s) => {
        out = meterWake(s, {
          seatId: body.seatId,
          runId: body.runId,
          model: body.model,
          inputTokens: body.inputTokens,
          outputTokens: body.outputTokens,
          ms: body.ms,
          source: body.source || "manual",
        });
      });
      if (!out?.row) {
        json(res, 400, { error: "bot seatId required" });
        return;
      }
      json(res, 201, out.row);
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
      json(res, 200, publicSeats(getState().seats.filter((s) => s.kind === "bot")));
      return;
    }
    if (pathname === "/api/v1/seats" && method === "GET") {
      json(res, 200, publicSeats(getState().seats));
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
      json(res, 201, publicSeat(seat));
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
    const seatRooms = pathname.match(/^\/api\/v1\/seats\/([^/]+)\/channels$/);
    if (seatRooms && method === "GET") {
      const id = decodeURIComponent(seatRooms[1]);
      const st = getState();
      if (!st.seats.some((s) => s.id === id)) {
        json(res, 404, { error: "seat not found" });
        return;
      }
      json(res, 200, channelsForSeat(st, id));
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
      const raw = await readBody(req);
      const body = internal ? Object.fromEntries(INTERNAL_SEAT_FIELDS.filter((k) => k in raw).map((k) => [k, raw[k]])) : raw;
      let updated = null;
      mutate((s) => {
        updated = patchSeat(s, id, body);
      });
      if (!updated) {
        json(res, 404, { error: "seat not found" });
        return;
      }
      if (updated.kind === "bot") syncSeatAgent(updated);
      json(res, 200, publicSeat(updated));
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
    const adapterCb = pathname.match(/^\/api\/v1\/seats\/([^/]+)\/adapter\/(report|handoff)$/);
    if (adapterCb && method === "POST") {
      const id = decodeURIComponent(adapterCb[1]);
      const verb = adapterCb[2];
      const seat = getState().seats.find((s) => s.id === id);
      if (!seat) {
        json(res, 404, { error: "seat not found" });
        return;
      }
      if (isOpenCodeAdapter(seat)) {
        json(res, 400, { error: "OpenCode seats use the plugin bus, not adapter callbacks" });
        return;
      }
      if (!adapterSecretOk(seat, req)) {
        json(res, 401, { error: "adapter secret required" });
        return;
      }
      const body = await readBody(req);
      const parsed = parseAdapterCallback({ ...body, kind: verb });
      if (!parsed.text) {
        json(res, 400, { error: "text required" });
        return;
      }
      const to = verb === "handoff" ? parsed.to : `channel:${parsed.channel}`;
      postMessage(parsed.channel, seat.name, seat.kind || "bot", parsed.text, { seatId: id });
      json(
        res,
        201,
        postBus({
          from: id,
          to,
          kind: verb === "handoff" ? "handoff" : "report",
          text: parsed.text,
          channel: parsed.channel,
          wake: verb === "handoff" && !String(to).startsWith("channel:"),
        }),
      );
      return;
    }
    const attach = pathname.match(/^\/api\/v1\/seats\/([^/]+)\/attach$/);
    if (attach && method === "POST") {
      const id = decodeURIComponent(attach[1]);
      const body = await readBody(req).catch(() => ({}));
      const guestSeat = getState().seats.find((s) => s.id === id);
      if (guestSeat?.mcpGuest) {
        json(res, 400, { error: "guest harness seats do not attach OpenCode", guest: true, seat: id });
        return;
      }
      if (guestSeat && !isOpenCodeAdapter(guestSeat)) {
        json(res, 400, {
          error: "non-OpenCode adapters do not attach a PTY",
          adapter: guestSeat.adapter || "webhook",
          seat: id,
        });
        return;
      }
      let blocked = null;
      mutate((s) => {
        const found = s.seats.find((s0) => s0.id === id);
        blocked = wakeBlocked(s, found, { runId: body.runId });
      });
      if (blocked) {
        json(res, 200, { seat: id, paused: true, reason: blocked.reason, sessionId: null, attach: null });
        return;
      }
      const seat = getState().seats.find((s) => s.id === id);
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
      const st = getState();
      json(res, 200, st.channels.map((c) => publicChannel(c, st)));
      return;
    }
    if (pathname === "/api/v1/channels" && method === "POST") {
      const body = await readBody(req);
      let created = null;
      mutate((s) => {
        created = createChannel(s, body);
      });
      json(res, 201, publicChannel(created, getState()));
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
      json(res, 200, publicChannel(ch, getState()));
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
      json(res, 200, publicChannel(updated, getState()));
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
      const msg = await postRoomMessage(id, body.who || "You", body.kind || "human", text, extras, githubHint(body));
      const routed = text
        ? routeChannelMessage({ channelId: id, text, from: extras.seatId || "you", messageId: msg?.id || null })
        : { mentions: [], wakes: [], notify: [], pending: Promise.resolve([]) };
      const wakeResults = (await (routed.started || routed.pending) || []).map((row) => ({
        seat: row?.seat || null,
        runId: row?.runId || null,
        started: Boolean(row?.started),
      }));
      json(res, 201, {
        ...msg,
        mentions: routed.mentions,
        wakes: routed.wakes,
        notify: routed.notify,
        runId: wakeResults[0]?.runId ?? null,
        started: wakeResults.length ? wakeResults.every((row) => row.started) : false,
        wakeResults,
        ...(routed.queued ? { queued: true } : {}),
        ...(routed.rateLimited ? { rateLimited: true } : {}),
        ...(routed.quiet ? { quiet: true } : {}),
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
      let channel = body.channel ? String(body.channel) : roomOfSession(body.sessionId) || "ship";
      if (String(to).startsWith("channel:")) channel = to.slice("channel:".length);
      const fromSeat = getState().seats.find((s) => s.id === from);
      await postRoomMessage(channel, fromSeat?.name || from, fromSeat?.kind || "bot", text, { ...extras, seatId: extras.seatId || from }, githubHint(body));
      const entry = postBus({
        from,
        to,
        kind: "send_message",
        text,
        channel,
        runId: body.runId,
        wake: body.wake !== false && !String(to).startsWith("channel:"),
      });
      const woke = await pendingWake(entry);
      json(res, 201, woke ? { ...entry, runId: woke.runId || entry.runId, started: Boolean(woke.started) } : entry);
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
      if (!body.channel && body.sessionId) body.channel = roomOfSession(body.sessionId) || undefined;
      const msg = await postRoomMessage(body.channel || "ship", fromSeat?.name || body.from, fromSeat?.kind || "bot", text, {
        ...extras,
        seatId: extras.seatId || body.from,
        ...(body.jobId ? { jobId: String(body.jobId) } : {}),
      }, githubHint(body));
      void mirrorToSlack(msg, { kind: body.kind }).catch(() => undefined);
      const entry = postBus({ ...body, text, channel: body.channel || (body.wake ? "ship" : undefined) });
      const woke = await pendingWake(entry);
      json(res, 201, woke ? { ...entry, runId: woke.runId || entry.runId, started: Boolean(woke.started) } : entry);
      return;
    }
    if (pathname === "/api/v1/github" && method === "GET") {
      json(res, 200, githubStatus());
      return;
    }
    const githubMsg = pathname.match(/^\/api\/v1\/messages\/([^/]+)\/github$/);
    if (githubMsg && method === "GET") {
      try {
        const message = await refreshGithubMessage(decodeURIComponent(githubMsg[1]));
        json(res, 200, { github: message.github, message });
      } catch (err) {
        fail(res, err);
      }
      return;
    }
    if (pathname === "/api/v1/jobs" && method === "GET") {
      const caller = requestCaller(user, apiToken);
      const jobs = listJobs(getState(), {
        status: url.searchParams.get("status") || undefined,
        target: url.searchParams.get("target") || undefined,
        assignee: url.searchParams.get("assignee") || undefined,
      }).filter((job) => canReadJob(job, caller));
      json(res, 200, jobs);
      return;
    }
    if (pathname === "/api/v1/jobs" && method === "POST") {
      const body = await readBody(req);
      const { job } = await publishNewJob(body, requestCaller(user, apiToken), jobDeps());
      json(res, 201, job);
      return;
    }
    if (pathname === "/api/v1/jobs/callback-secret" && method === "GET") {
      let info;
      mutate((s) => {
        info = callbackSecretInfo(s);
      });
      json(res, 200, info);
      return;
    }
    if (pathname === "/api/v1/jobs/callback-secret/rotate" && method === "POST") {
      let info;
      mutate((s) => {
        info = rotateCallbackSecret(s);
      });
      json(res, 200, info);
      return;
    }
    const jobWait = pathname.match(/^\/api\/v1\/jobs\/([^/]+)\/wait$/);
    if (jobWait && method === "GET") {
      const id = decodeURIComponent(jobWait[1]);
      const caller = requestCaller(user, apiToken);
      const existing = getJob(getState(), id);
      if (!existing || !canReadJob(existing, caller)) {
        json(res, 404, { error: "job not found" });
        return;
      }
      const out = await waitForJob(id, {
        timeout: url.searchParams.get("timeout"),
        since: url.searchParams.get("since"),
      }, jobDeps());
      if (!out) {
        json(res, 404, { error: "job not found" });
        return;
      }
      json(res, 200, out);
      return;
    }
    const jobCancel = pathname.match(/^\/api\/v1\/jobs\/([^/]+)\/cancel$/);
    if (jobCancel && method === "POST") {
      const id = decodeURIComponent(jobCancel[1]);
      const body = await readBody(req).catch(() => ({}));
      const job = await settleJob(id, "cancel", body, requestCaller(user, apiToken), jobDeps());
      json(res, 200, job);
      return;
    }
    const jobComplete = pathname.match(/^\/api\/v1\/jobs\/([^/]+)\/complete$/);
    if (jobComplete && method === "POST") {
      const id = decodeURIComponent(jobComplete[1]);
      const body = await readBody(req);
      const job = await settleJob(id, "complete", body, requestCaller(user, apiToken), jobDeps());
      if (body.prUrl || body.branch) {
        const msg = [...(getState().messages || [])].reverse().find((m) => m.jobId === id);
        if (msg) await attachGithubCard(msg, { text: msg.text, prUrl: body.prUrl, branch: body.branch });
      }
      json(res, 200, job);
      return;
    }
    const jobFile = pathname.match(/^\/api\/v1\/jobs\/([^/]+)\/files\/([^/]+)$/);
    if (jobFile && method === "GET") {
      const caller = requestCaller(user, apiToken);
      json(res, 200, readJobFile(getState(), decodeURIComponent(jobFile[1]), decodeURIComponent(jobFile[2]), caller));
      return;
    }
    const jobFiles = pathname.match(/^\/api\/v1\/jobs\/([^/]+)\/files$/);
    if (jobFiles && method === "POST") {
      const caller = requestCaller(user, apiToken);
      const body = await readBody(req);
      let meta = null;
      mutate((s) => {
        meta = writeJobFile(s, decodeURIComponent(jobFiles[1]), body, caller);
      });
      json(res, 201, meta);
      return;
    }
    const jobMsg = pathname.match(/^\/api\/v1\/jobs\/([^/]+)\/messages$/);
    if (jobMsg && method === "POST") {
      const body = await readBody(req);
      const job = await followUpJob(decodeURIComponent(jobMsg[1]), body, requestCaller(user, apiToken), jobDeps());
      json(res, 201, job);
      return;
    }
    const jobOne = pathname.match(/^\/api\/v1\/jobs\/([^/]+)\/?$/);
    if (jobOne && method === "GET") {
      const id = decodeURIComponent(jobOne[1]);
      const caller = requestCaller(user, apiToken);
      const job = getJob(getState(), id);
      if (!job || !canReadJob(job, caller)) {
        json(res, 404, { error: "job not found" });
        return;
      }
      json(res, 200, job);
      return;
    }
    if (pathname === "/api/v1/block-actions" && method === "POST") {
      const body = await readBody(req);
      const messageId = String(body.messageId || "");
      const actionId = String(body.actionId || "");
      const value = String(body.value || "");
      const userId = String(body.userId || user?.seatId || "you");
      const msg = getState().messages.find((m) => m.id === messageId);
      if (!msg) {
        json(res, 404, { error: "message not found" });
        return;
      }
      if (!actionId) {
        json(res, 400, { error: "actionId required" });
        return;
      }
      if (isGithubAction(actionId) || msg.github) {
        if (isGithubAction(actionId)) {
          try {
            const out = await handleGithubBlockAction({ msg, actionId, userId, value });
            json(res, 200, out);
          } catch (err) {
            fail(res, err);
          }
          return;
        }
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
      json(res, 200, await liveCombinedStatus());
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
    const sessionRoomPath = pathname.match(/^\/api\/v1\/sessions\/([^/]+)\/room$/);
    if (sessionRoomPath && method === "GET") {
      const found = sessionRoom(getState(), decodeURIComponent(sessionRoomPath[1]));
      if (!found) {
        json(res, 404, { error: "session not bound to a seat" });
        return;
      }
      json(res, 200, found);
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
      try {
        json(res, 200, await promptSession(decodeURIComponent(promptPath[1]), body));
      } catch (err) {
        if (!err.status || err.status === 404) throw err;
        const model = body.model?.providerID ? `${body.model.providerID}/${body.model.modelID || ""}` : "";
        const d = describeOpenCodeError(err, { model });
        json(res, d.status, { error: d.message, code: d.code });
      }
      return;
    }
    if (pathname === "/api/v1/providers" && method === "GET") {
      json(res, 200, listProviders());
      return;
    }
    if (pathname === "/api/v1/providers" && method === "PUT") {
      const out = upsertProvider(await readBody(req));
      restartForProviderChange();
      json(res, 200, out);
      return;
    }
    const authP = pathname.match(/^\/api\/v1\/providers\/([^/]+)\/auth$/);
    if (authP && method === "POST") {
      const body = await readBody(req);
      const out = setAuth(decodeURIComponent(authP[1]), body.apiKey || body.key);
      restartForProviderChange();
      json(res, 200, out);
      return;
    }
    const delP = pathname.match(/^\/api\/v1\/providers\/([^/]+)$/);
    if (delP && method === "DELETE") {
      const out = removeProvider(decodeURIComponent(delP[1]));
      restartForProviderChange();
      json(res, 200, out);
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
      let beats = [];
      mutate((s) => {
        beats = tickHeartbeats(s, Date.now());
      });
      for (const item of beats) {
        if (item.coalesced) continue;
        postBus({
          from: "heartbeat",
          to: item.seatId,
          kind: "heartbeat",
          text: item.prompt,
          wake: true,
        });
      }
    } catch (err) {
      console.error("routine tick", err);
    }
  }, ROUTINE_TICK_MS);
}

function startDemoResetTicker() {
  const ms = demoResetMs();
  if (!ms) return;
  console.log(`Demo reseed every ${ms}ms`);
  setInterval(() => {
    try {
      const st = resetState();
      try {
        syncBotAgents(st.seats, st.teams);
      } catch {
        /* agent files are best-effort */
      }
    } catch (err) {
      console.error("demo reset", err);
    }
  }, ms);
}

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(
      `ROSTER_API_PORT ${PORT} is already in use on ${HOST}. Stop the other process or set a different ROSTER_API_PORT.`,
    );
  } else {
    console.error(err);
  }
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  const shown = HOST === "0.0.0.0" || HOST === "::" ? "127.0.0.1" : HOST;
  console.log(`roster-flow CORE API http://${shown}:${PORT}`);
  if (!setupClosed(getState())) console.log(`Setup: ${publicUrl()}/setup`);
  if (demoMode()) console.log(`Demo: ${publicUrl()}/app`);
  startRoutineTicker();
  void autostartHarness().catch((err) => console.error("harness autostart", err));
  startDemoResetTicker();
});
