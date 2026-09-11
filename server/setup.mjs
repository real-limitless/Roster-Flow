import { skipOnboarding } from "./flags.mjs";
import { unreadBySeat } from "./inbox.mjs";
import { publicRoutine } from "./routines.mjs";
import { emptyOrgState, migrateState, pendingState, starterState } from "./seed.mjs";

export function publicState(state) {
  if (!state || typeof state !== "object") return state;
  const { users, authSessions, ...rest } = state;
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
  const prev = state.onboarding || {};
  const kind = template === "empty" ? "empty" : "starter";
  const base = kind === "empty" ? emptyOrgState(ownerName) : starterState();
  const you = (base.seats || []).find((s) => s.id === "you");
  if (you && ownerName) you.name = ownerName;
  return migrateState({
    ...base,
    users,
    authSessions,
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

export function startOver(state, { email, confirm } = {}) {
  if (skipOnboarding()) {
    const err = new Error("onboarding is skipped");
    err.status = 409;
    throw err;
  }
  if (!confirm) {
    const err = new Error("confirm required");
    err.status = 400;
    throw err;
  }
  const ownerEmail = String(state.users?.[0]?.email || "").trim().toLowerCase();
  if (ownerEmail && String(email || "").trim().toLowerCase() !== ownerEmail) {
    const err = new Error("email does not match owner");
    err.status = 403;
    throw err;
  }
  return migrateState(pendingState());
}
