import { verifyPassword } from "./auth.mjs";
import { skipOnboarding, demoMode, demoResetMs } from "./flags.mjs";
import { bootstrapToken, requireBootstrapToken, setupClosed } from "./bootstrap.mjs";
import { unreadBySeat } from "./inbox.mjs";
import { publicJob } from "./jobs.mjs";
import { publicRoutine } from "./routines.mjs";
import { emptyOrgState, migrateState, pendingState, starterState } from "./seed.mjs";
import { publicSeats } from "./adapters.mjs";
import { publicChannel } from "./channels.mjs";

export function publicState(state) {
  if (!state || typeof state !== "object") return state;
  const { users, authSessions, apiTokens, callbackSecret, accessRequests, ...rest } = state;
  return {
    ...rest,
    seats: publicSeats(rest.seats || []),
    channels: (rest.channels || []).map((c) => publicChannel(c, state)),
    jobs: (rest.jobs || []).map(publicJob),
    routines: (rest.routines || []).map(publicRoutine),
    inboxUnread: unreadBySeat(state),
  };
}

/**
 * `harness` is the company serve state from harness.status ("up" | "offline").
 * `harnessReady` means that serve answers health now, the same signal
 * /api/v1/health reports; a binary on PATH only sets `checks.opencode`.
 */
export function setupStatus(state, { user = null, binary = null, harness = "offline", providerKeys = false, dataWritable = true } = {}) {
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
  const body = {
    skip,
    hasUser,
    hasOwner: hasUser,
    setupClosed: hasUser,
    authenticated: Boolean(user) || skip,
    harnessReady: harness === "up",
    bootstrapTokenRequired: Boolean(bootstrapToken()) && !hasUser,
    complete,
    installSeen: Boolean(onboarding.installSeen) || complete,
    harnessSeen: Boolean(onboarding.harnessSeen) || complete,
    harnessSkipped: Boolean(onboarding.harnessSkipped),
    step,
    checks: {
      api: true,
      opencode: Boolean(binary),
      harness: harness === "up",
      providerKeys: Boolean(providerKeys),
      dataDir: Boolean(dataWritable),
    },
    binary: binary || null,
    demo: demoMode(),
    demoResetMs: demoResetMs(),
  };
  if (user) {
    body.email = user.email || null;
    body.name = user.name || null;
  }
  return body;
}

/** Unauthenticated setup status: booleans only. No owner email, name, or other identity. */
export function publicSetupStatus(status) {
  return {
    skip: Boolean(status.skip),
    hasOwner: Boolean(status.hasOwner ?? status.hasUser),
    hasUser: Boolean(status.hasUser),
    setupClosed: Boolean(status.setupClosed),
    authenticated: Boolean(status.authenticated),
    complete: Boolean(status.complete),
    bootstrapTokenRequired: Boolean(status.bootstrapTokenRequired),
    harnessReady: Boolean(status.harnessReady),
    installSeen: Boolean(status.installSeen),
    harnessSeen: Boolean(status.harnessSeen),
    harnessSkipped: Boolean(status.harnessSkipped),
    demo: Boolean(status.demo),
    checks: {
      api: Boolean(status.checks?.api),
      opencode: Boolean(status.checks?.opencode),
      harness: Boolean(status.checks?.harness),
      providerKeys: Boolean(status.checks?.providerKeys),
      dataDir: Boolean(status.checks?.dataDir),
    },
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
 * that owner's session or password before the email is compared. Anonymous
 * callers get 401 whether or not the email matches. A mismatched email is 403
 * only after that proof succeeds. `ROSTER_BOOTSTRAP_TOKEN`, when set, is
 * required as well (header `x-roster-bootstrap-token` or `body.bootstrapToken`).
 */
export async function startOver(state, { email, confirm, password, user, req, body } = {}) {
  if (skipOnboarding()) throw fail(409, "onboarding is skipped");
  if (!confirm) throw fail(400, "confirm required");
  requireBootstrapToken(req, body ?? {});
  if (setupClosed(state)) {
    const owner = state.users[0];
    // Authenticate before comparing the email. An anonymous caller must get 401
    // for a wrong email and for the real one, so the status code is not an oracle.
    const sessionOk = ownerSession(user, owner);
    const passwordOk = sessionOk ? false : await verifyPassword(password, owner?.passwordSalt, owner?.passwordHash);
    if (!sessionOk && !passwordOk) throw fail(401, "owner authentication required");
    const ownerEmail = String(owner?.email || "").trim().toLowerCase();
    if (String(email || "").trim().toLowerCase() !== ownerEmail) {
      throw fail(403, "email does not match owner");
    }
  }
  return migrateState(pendingState());
}
