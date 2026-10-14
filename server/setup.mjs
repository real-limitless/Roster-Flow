import { verifyPassword } from "./auth.mjs";
import { skipOnboarding } from "./flags.mjs";
import { bootstrapToken, requireBootstrapToken, setupClosed } from "./bootstrap.mjs";
import { unreadBySeat } from "./inbox.mjs";
import { publicRoutine } from "./routines.mjs";
import { emptyOrgState, migrateState, pendingState, starterState } from "./seed.mjs";

export function publicState(state) {
  if (!state || typeof state !== "object") return state;
  const { users, authSessions, apiTokens, ...rest } = state;
  return {
    ...rest,
    routines: (rest.routines || []).map(publicRoutine),
    inboxUnread: unreadBySeat(state),
  };
}

export function setupStatus(state, { user = null, binary = null, providerKeys = false, dataWritable = true } = {}) {
  const skip = skipOnboarding();
  const users = state.users || [];
  const hasUser = users.length > 0;
  const onboarding = state.onboarding || { complete: true };
  const complete = skip || Boolean(onboarding.complete);
  let step = "done";
  if (!skip && !onboarding.complete) {
    if (!onboarding.installSeen) step = "install";
    else if (!hasUser) step = "first_user";
    else if (!user) step = "login";
    else if (!onboarding.harnessSeen && !onboarding.harnessSkipped) step = "harness";
    else step = "welcome";
  }
  return {
    skip,
    hasUser,
    authenticated: Boolean(user) || skip,
    harnessReady: Boolean(binary),
    bootstrapTokenRequired: Boolean(bootstrapToken()) && !hasUser,
    complete,
    step,
    checks: {
      api: true,
      opencode: Boolean(binary),
      providerKeys: Boolean(providerKeys),
      dataDir: Boolean(dataWritable),
    },
    binary: binary || null,
    email: hasUser ? users[0].email : null,
    name: hasUser ? users[0].name : null,
  };
}

export function markInstallSeen(state) {
  state.onboarding = { ...(state.onboarding || {}), installSeen: true };
  return state;
}

export function markHarnessStep(state, { skipped = false } = {}) {
  state.onboarding = {
    ...(state.onboarding || {}),
    harnessSeen: true,
    harnessSkipped: Boolean(skipped) || Boolean(state.onboarding?.harnessSkipped),
  };
  return state;
}

export function applyOrgTemplate(state, template, ownerName = "You") {
  const users = state.users || [];
  const authSessions = state.authSessions || [];
  const apiTokens = state.apiTokens || [];
  const prev = state.onboarding || {};
  const kind = template === "empty" ? "empty" : "starter";
  const base = kind === "empty" ? emptyOrgState(ownerName) : starterState();
  const you = (base.seats || []).find((s) => s.id === "you");
  if (you && ownerName) you.name = ownerName;
  return migrateState({
    ...base,
    users,
    authSessions,
    apiTokens,
    onboarding: {
      ...base.onboarding,
      complete: true,
      template: kind,
      installSeen: true,
      harnessSeen: true,
      harnessSkipped: Boolean(prev.harnessSkipped),
    },
  });
}

export function completeSetup(state, { template, ownerName } = {}) {
  if (state.onboarding?.complete) {
    const err = new Error("setup already complete");
    err.status = 409;
    throw err;
  }
  if (template !== "starter" && template !== "empty") {
    const err = new Error("template must be starter or empty");
    err.status = 400;
    throw err;
  }
  return applyOrgTemplate(state, template, ownerName || state.users?.[0]?.name || "You");
}

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function ownerSession(user, owner) {
  if (!user || !owner) return false;
  const id = String(user.id || "");
  return id.length > 0 && id === owner.id;
}

/**
 * Reopen setup. When an owner exists (`setupClosed`), the caller must present
 * that owner's session or password. `ROSTER_BOOTSTRAP_TOKEN`, when set, is
 * required as well (header `x-roster-bootstrap-token` or `body.bootstrapToken`).
 */
export async function startOver(state, { email, confirm, password, user, req, body } = {}) {
  if (skipOnboarding()) throw fail(409, "onboarding is skipped");
  if (!confirm) throw fail(400, "confirm required");
  requireBootstrapToken(req, body ?? {});
  if (setupClosed(state)) {
    const owner = state.users[0];
    const ownerEmail = String(owner?.email || "").trim().toLowerCase();
    if (String(email || "").trim().toLowerCase() !== ownerEmail) {
      throw fail(403, "email does not match owner");
    }
    const sessionOk = ownerSession(user, owner);
    const passwordOk = await verifyPassword(password, owner?.passwordSalt, owner?.passwordHash);
    if (!sessionOk && !passwordOk) throw fail(401, "owner authentication required");
  }
  return migrateState(pendingState());
}
