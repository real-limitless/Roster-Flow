/** GitHub PR/issue cards for #ship. Token stays in env — never state.json. */

import { getState, mutate } from "./store.mjs";
import { postBus } from "./bus.mjs";

export const deps = {
  fetchFn: (...args) => fetch(...args),
  env: process.env,
};

export function githubToken() {
  const env = deps.env || process.env;
  return String(env.GITHUB_TOKEN || env.GH_TOKEN || "").trim();
}

export function githubApiBase() {
  const env = deps.env || process.env;
  return String(env.ROSTER_GITHUB_API || "https://api.github.com").replace(/\/+$/, "");
}

export function githubStatus() {
  const token = githubToken();
  const env = deps.env || process.env;
  let via = null;
  if (String(env.GITHUB_TOKEN || "").trim()) via = "GITHUB_TOKEN";
  else if (String(env.GH_TOKEN || "").trim()) via = "GH_TOKEN";
  return {
    connected: Boolean(token),
    env: via,
    api: githubApiBase(),
  };
}

const PULL_OR_ISSUE =
  /https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+)\/(pull|issues)\/(\d+)/i;
const SHORT_REF = /\b([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)\b/;

export function parseGithubRef(input = {}) {
  const prior = input.github;
  if (prior && prior.owner && prior.repo && prior.number) {
    const kind = prior.kind === "issue" ? "issue" : "pull";
    return {
      owner: String(prior.owner),
      repo: String(prior.repo),
      number: Number(prior.number),
      kind,
      url: prior.url || htmlUrl(prior.owner, prior.repo, kind, prior.number),
      branch: prior.branch || input.branch || undefined,
    };
  }

  const candidates = [input.prUrl, input.issueUrl, input.url, input.text];
  for (const raw of candidates) {
    const hit = matchUrl(String(raw || ""));
    if (hit) {
      if (input.branch) hit.branch = String(input.branch);
      return hit;
    }
  }

  const short = String(input.text || "").match(SHORT_REF);
  if (short) {
    const kind = "pull";
    const owner = short[1];
    const repo = short[2];
    const number = Number(short[3]);
    return {
      owner,
      repo,
      number,
      kind,
      url: htmlUrl(owner, repo, kind, number),
      branch: input.branch ? String(input.branch) : undefined,
    };
  }

  return null;
}

function matchUrl(text) {
  const m = String(text).match(PULL_OR_ISSUE);
  if (!m) return null;
  const kind = m[3].toLowerCase() === "issues" ? "issue" : "pull";
  return {
    owner: m[1],
    repo: m[2],
    number: Number(m[4]),
    kind,
    url: htmlUrl(m[1], m[2], kind, m[4]),
  };
}

function htmlUrl(owner, repo, kind, number) {
  const path = kind === "issue" ? "issues" : "pull";
  return `https://github.com/${owner}/${repo}/${path}/${number}`;
}

export function canMergeGithub(state, userId) {
  const seat = (state.seats || []).find((s) => s.id === userId);
  if (!seat || seat.kind !== "human") return false;
  const deny = Array.isArray(seat.deny) ? seat.deny : [];
  return !deny.includes("deploy");
}

export function isGithubAction(actionId) {
  return String(actionId || "").startsWith("github.");
}

function publicCard(card) {
  if (!card) return card;
  const out = { ...card };
  delete out.token;
  delete out.authorization;
  return out;
}

function staleFrom(ref, previous = null, reason = "disconnected") {
  const prev = previous || {};
  return publicCard({
    kind: ref.kind || prev.kind || "pull",
    owner: ref.owner,
    repo: ref.repo,
    number: ref.number,
    url: ref.url || prev.url || htmlUrl(ref.owner, ref.repo, ref.kind || "pull", ref.number),
    title: prev.title || `${ref.owner}/${ref.repo}#${ref.number}`,
    state: prev.merged ? "merged" : prev.state || "open",
    merged: Boolean(prev.merged),
    draft: Boolean(prev.draft),
    branch: ref.branch || prev.branch,
    base: prev.base,
    checks: prev.checks || { status: "unknown", summary: "GitHub disconnected", total: 0, passed: 0, failed: 0 },
    stale: true,
    connected: false,
    fetchedAt: new Date().toISOString(),
    mergeable: prev.mergeable ?? null,
    note: reason,
  });
}

function summarizeChecks(runs = []) {
  const list = Array.isArray(runs) ? runs : [];
  let passed = 0;
  let failed = 0;
  let pending = 0;
  for (const run of list) {
    const status = String(run.status || "").toLowerCase();
    const conclusion = String(run.conclusion || "").toLowerCase();
    if (status && status !== "completed") {
      pending += 1;
      continue;
    }
    if (["failure", "cancelled", "timed_out", "action_required", "startup_failure"].includes(conclusion)) {
      failed += 1;
    } else if (conclusion === "success" || conclusion === "neutral" || conclusion === "skipped") {
      passed += 1;
    } else {
      pending += 1;
    }
  }
  const total = list.length;
  let status = "unknown";
  let summary = "No checks yet";
  if (total) {
    if (failed) {
      status = "failure";
      summary = `${failed} failed / ${total} checks`;
    } else if (pending) {
      status = "pending";
      summary = `CI running (${passed}/${total})`;
    } else {
      status = "success";
      summary = `${passed} / ${total} checks`;
    }
  }
  return { status, summary, total, passed, failed };
}

async function gh(path, { method = "GET", body } = {}) {
  const token = githubToken();
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "roster-flow",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["content-type"] = "application/json";
  const url = `${githubApiBase()}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await deps.fetchFn(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  const text = typeof res.text === "function" ? await res.text() : "";
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: Boolean(res.ok), status: res.status || 0, data };
}

export async function snapshotGithub(ref, { previous = null } = {}) {
  if (!ref?.owner || !ref?.repo || !ref?.number) return null;
  const connected = Boolean(githubToken());
  if (!connected) return staleFrom(ref, previous, "disconnected");

  try {
    let kind = ref.kind === "issue" ? "issue" : "pull";
    let payload = null;
    if (kind === "pull") {
      const pull = await gh(`/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`);
      if (pull.ok) payload = pull.data;
      else if (pull.status === 404) {
        const issue = await gh(`/repos/${ref.owner}/${ref.repo}/issues/${ref.number}`);
        if (issue.ok) {
          kind = "issue";
          payload = issue.data;
        }
      } else if (pull.status === 401 || pull.status === 403) {
        return staleFrom(ref, previous, "disconnected");
      }
    } else {
      const issue = await gh(`/repos/${ref.owner}/${ref.repo}/issues/${ref.number}`);
      if (issue.ok) payload = issue.data;
      else if (issue.status === 401 || issue.status === 403) return staleFrom(ref, previous, "disconnected");
    }

    if (!payload) return staleFrom(ref, previous, "not found");

    const merged = Boolean(payload.merged || payload.merged_at || payload.state === "merged");
    const state = merged ? "merged" : payload.state === "closed" ? "closed" : "open";
    const sha = payload.head?.sha || payload.merge_commit_sha || "";
    const branch = ref.branch || payload.head?.ref || previous?.branch;
    let checks = previous?.checks || { status: "unknown", summary: "No checks yet", total: 0, passed: 0, failed: 0 };
    if (sha && kind === "pull") {
      const cr = await gh(`/repos/${ref.owner}/${ref.repo}/commits/${sha}/check-runs`);
      if (cr.ok) checks = summarizeChecks(cr.data?.check_runs);
    }

    return publicCard({
      kind,
      owner: ref.owner,
      repo: ref.repo,
      number: ref.number,
      url: payload.html_url || ref.url || htmlUrl(ref.owner, ref.repo, kind, ref.number),
      title: payload.title || previous?.title || `${ref.owner}/${ref.repo}#${ref.number}`,
      state,
      merged,
      draft: Boolean(payload.draft),
      branch,
      base: payload.base?.ref || previous?.base,
      checks,
      stale: false,
      connected: true,
      fetchedAt: new Date().toISOString(),
      mergeable: payload.mergeable == null ? null : Boolean(payload.mergeable),
    });
  } catch {
    return staleFrom(ref, previous, "disconnected");
  }
}

function writeCard(messageId, card) {
  let next = null;
  mutate((s) => {
    s.messages = (s.messages || []).map((m) => {
      if (m.id !== messageId) return m;
      next = { ...m, github: publicCard(card) };
      return next;
    });
  });
  return next;
}

export async function attachGithubCard(msg, hint = {}) {
  if (!msg) return msg;
  const ref = parseGithubRef({
    text: hint.text || msg.text,
    prUrl: hint.prUrl,
    issueUrl: hint.issueUrl,
    branch: hint.branch,
    github: hint.github || msg.github,
  });
  if (!ref) return msg;
  const card = await snapshotGithub(ref, { previous: hint.github || msg.github || null });
  const updated = writeCard(msg.id, card);
  return updated || { ...msg, github: card };
}

export async function refreshGithubMessage(messageId) {
  const msg = (getState().messages || []).find((m) => m.id === messageId);
  if (!msg) {
    const err = new Error("message not found");
    err.status = 404;
    throw err;
  }
  if (!msg.github && !parseGithubRef({ text: msg.text, github: msg.github })) {
    const err = new Error("no GitHub card on this message");
    err.status = 404;
    throw err;
  }
  return attachGithubCard(msg, { text: msg.text, github: msg.github, branch: msg.github?.branch });
}

export async function mergeGithubPull(ref, { userId }) {
  const state = getState();
  if (!canMergeGithub(state, userId)) {
    const err = new Error("merge is human-gated; this seat cannot merge");
    err.status = 403;
    throw err;
  }
  if (!githubToken()) {
    const err = new Error("github disconnected");
    err.status = 409;
    throw err;
  }
  if (!ref || ref.kind === "issue") {
    const err = new Error("only pull requests can be merged");
    err.status = 400;
    throw err;
  }
  const result = await gh(`/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/merge`, {
    method: "PUT",
    body: { merge_method: "merge" },
  });
  if (result.status === 401 || result.status === 403) {
    const err = new Error("github disconnected");
    err.status = 409;
    throw err;
  }
  if (!result.ok) {
    const err = new Error(result.data?.message || "merge failed");
    err.status = result.status === 405 ? 409 : result.status || 409;
    throw err;
  }
  return result.data;
}

export async function handleGithubBlockAction({ msg, actionId, userId }) {
  if (!msg) {
    const err = new Error("message not found");
    err.status = 404;
    throw err;
  }
  const action = String(actionId || "");
  if (!isGithubAction(action)) return null;

  if (action === "github.refresh") {
    const message = await refreshGithubMessage(msg.id);
    const entry = postBus({
      from: userId,
      to: msg.seatId || "channel",
      kind: "github_refresh",
      text: `refresh ${message.github?.url || ""}`,
      channel: msg.channel,
      messageId: msg.id,
      actionId,
      wake: false,
    });
    return { github: message.github, message, bus: { ...entry, wake: false } };
  }

  if (action === "github.merge") {
    const current = await attachGithubCard(msg, { github: msg.github, text: msg.text });
    const card = current.github;
    if (!card) {
      const err = new Error("no GitHub card on this message");
      err.status = 400;
      throw err;
    }
    if (card.stale || !card.connected) {
      const err = new Error("github disconnected");
      err.status = 409;
      throw err;
    }
    if (card.merged) {
      const entry = postBus({
        from: userId,
        to: msg.seatId || "channel",
        kind: "github_merge",
        text: `already merged ${card.url}`,
        channel: msg.channel,
        messageId: msg.id,
        actionId,
        wake: false,
      });
      return { github: card, message: current, bus: { ...entry, wake: false } };
    }
    await mergeGithubPull(card, { userId });
    const message = await attachGithubCard(current, {
      github: { ...card, merged: true, state: "merged" },
      text: msg.text,
    });
    const entry = postBus({
      from: userId,
      to: msg.seatId || "channel",
      kind: "github_merge",
      text: `merged ${message.github?.url || card.url}`,
      channel: msg.channel,
      messageId: msg.id,
      actionId,
      wake: false,
    });
    return { github: message.github, message, bus: { ...entry, wake: false } };
  }

  const err = new Error("unknown github action");
  err.status = 400;
  throw err;
}
