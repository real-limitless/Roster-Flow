import { skipOnboarding } from "./flags.mjs";
import { bootstrapToken } from "./bootstrap.mjs";
import { unreadBySeat } from "./inbox.mjs";
import { publicRoutine } from "./routines.mjs";
import { emptyOrgState, migrateState, starterState } from "./seed.mjs";

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
  const body = {
    skip,
    hasUser,
    hasOwner: hasUser,
    setupClosed: hasUser,
    authenticated: Boolean(user) || skip,
    harnessReady: Boolean(binary),
    bootstrapTokenRequired: Boolean(bootstrapToken()) && !hasUser,
    complete,
    installSeen: Boolean(onboarding.installSeen) || complete,
    harnessSeen: Boolean(onboarding.harnessSeen) || complete,
    harnessSkipped: Boolean(onboarding.harnessSkipped),
    step,
    checks: {
      api: true,
      opencode: Boolean(binary),
      providerKeys: Boolean(providerKeys),
      dataDir: Boolean(dataWritable),
    },
    binary: binary || null,
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
    checks: {
      api: Boolean(status.checks?.api),
      opencode: Boolean(status.checks?.opencode),
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
