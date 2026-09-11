import assert from "node:assert/strict";
import test from "node:test";
import { emptyState } from "./seed.mjs";
import { mutate } from "./store.mjs";
import { postMessage } from "./chat.mjs";
import {
  attachGithubCard,
  canMergeGithub,
  deps,
  githubStatus,
  handleGithubBlockAction,
  parseGithubRef,
  snapshotGithub,
} from "./github.mjs";

function resetLive() {
  mutate((s) => {
    Object.assign(s, emptyState());
  });
}

function jsonRes(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(data),
  };
}

test("parseGithubRef accepts prUrl, text URLs, and owner/repo#n", () => {
  const fromUrl = parseGithubRef({ prUrl: "https://github.com/real-limitless/Roster-Flow/pull/42" });
  assert.equal(fromUrl.owner, "real-limitless");
  assert.equal(fromUrl.repo, "Roster-Flow");
  assert.equal(fromUrl.number, 42);
  assert.equal(fromUrl.kind, "pull");

  const fromText = parseGithubRef({
    text: "opened https://github.com/acme/app/issues/9 for the brief",
  });
  assert.equal(fromText.kind, "issue");
  assert.equal(fromText.number, 9);

  const short = parseGithubRef({ text: "ship acme/app#12", branch: "eng/webhook" });
  assert.equal(short.number, 12);
  assert.equal(short.branch, "eng/webhook");
});

test("snapshot without a token is a stale link, not a blocking error", async () => {
  const prevEnv = deps.env;
  const prevFetch = deps.fetchFn;
  deps.env = {};
  deps.fetchFn = async () => {
    throw new Error("should not fetch GitHub without a token");
  };
  try {
    const card = await snapshotGithub({
      owner: "acme",
      repo: "app",
      number: 7,
      kind: "pull",
      url: "https://github.com/acme/app/pull/7",
    });
    assert.equal(card.stale, true);
    assert.equal(card.connected, false);
    assert.equal(card.url, "https://github.com/acme/app/pull/7");
    assert.match(card.title, /acme\/app#7/);
    assert.equal(githubStatus().connected, false);
  } finally {
    deps.env = prevEnv;
    deps.fetchFn = prevFetch;
  }
});

test("snapshot with a token fills title, branch, and checks", async () => {
  const prevEnv = deps.env;
  const prevFetch = deps.fetchFn;
  const calls = [];
  deps.env = { GITHUB_TOKEN: "ghs_test" };
  deps.fetchFn = async (url) => {
    calls.push(String(url));
    if (String(url).includes("/pulls/42")) {
      return jsonRes(200, {
        html_url: "https://github.com/real-limitless/Roster-Flow/pull/42",
        title: "Idempotent Stripe webhooks",
        state: "open",
        merged: false,
        draft: false,
        mergeable: true,
        head: { ref: "eng/webhook-idempotency", sha: "abc123" },
        base: { ref: "main" },
      });
    }
    if (String(url).includes("/check-runs")) {
      return jsonRes(200, {
        total_count: 2,
        check_runs: [
          { name: "ci", status: "completed", conclusion: "success" },
          { name: "lint", status: "completed", conclusion: "success" },
        ],
      });
    }
    return jsonRes(404, { message: "nope" });
  };
  try {
    const card = await snapshotGithub(
      parseGithubRef({ prUrl: "https://github.com/real-limitless/Roster-Flow/pull/42" }),
    );
    assert.equal(card.stale, false);
    assert.equal(card.connected, true);
    assert.equal(card.title, "Idempotent Stripe webhooks");
    assert.equal(card.branch, "eng/webhook-idempotency");
    assert.equal(card.checks.status, "success");
    assert.match(card.checks.summary, /2 \/ 2/);
    assert.ok(!JSON.stringify(card).includes("ghs_test"));
    assert.equal(githubStatus().env, "GITHUB_TOKEN");
    assert.ok(calls.some((u) => u.includes("/pulls/42")));
  } finally {
    deps.env = prevEnv;
    deps.fetchFn = prevFetch;
  }
});

test("You can merge; Jules with deny deploy cannot; merge does not wake", async () => {
  resetLive();
  const prevEnv = deps.env;
  const prevFetch = deps.fetchFn;
  let merged = false;
  deps.env = { GITHUB_TOKEN: "ghs_test" };
  deps.fetchFn = async (url, init = {}) => {
    if (String(url).includes("/merge") && init.method === "PUT") {
      merged = true;
      return jsonRes(200, { merged: true, sha: "abc" });
    }
    if (String(url).includes("/pulls/8")) {
      return jsonRes(200, {
        html_url: "https://github.com/acme/app/pull/8",
        title: "Gate merge",
        state: merged ? "closed" : "open",
        merged,
        head: { ref: "feat", sha: "abc" },
        base: { ref: "main" },
      });
    }
    if (String(url).includes("/check-runs")) {
      return jsonRes(200, { total_count: 0, check_runs: [] });
    }
    return jsonRes(404, {});
  };
  try {
    const state = { seats: emptyState().seats };
    assert.equal(canMergeGithub(state, "you"), true);
    assert.equal(canMergeGithub(state, "maya"), true);
    assert.equal(canMergeGithub(state, "jules"), false);
    assert.equal(canMergeGithub(state, "build"), false);

    const msg = postMessage("ship", "Eng.Build", "bot", "PR https://github.com/acme/app/pull/8", {
      seatId: "build",
    });
    const attached = await attachGithubCard(msg, { prUrl: "https://github.com/acme/app/pull/8" });
    assert.equal(attached.github.title, "Gate merge");

    await assert.rejects(
      () => handleGithubBlockAction({ msg: attached, actionId: "github.merge", userId: "jules" }),
      (err) => err.status === 403,
    );
    assert.equal(merged, false);

    const out = await handleGithubBlockAction({ msg: attached, actionId: "github.merge", userId: "you" });
    assert.equal(merged, true);
    assert.equal(out.github.merged || out.github.state === "merged", true);
    assert.equal(out.bus.wake, false);
    assert.equal(out.bus.kind, "github_merge");
  } finally {
    deps.env = prevEnv;
    deps.fetchFn = prevFetch;
  }
});

test("refresh after disconnect keeps the historical URL as a stale card", async () => {
  resetLive();
  const prevEnv = deps.env;
  const prevFetch = deps.fetchFn;
  deps.env = { GITHUB_TOKEN: "ghs_test" };
  deps.fetchFn = async (url) => {
    if (String(url).includes("/pulls/3")) {
      return jsonRes(200, {
        html_url: "https://github.com/acme/app/pull/3",
        title: "Keep this title",
        state: "open",
        merged: false,
        head: { ref: "feat", sha: "abc" },
        base: { ref: "main" },
      });
    }
    if (String(url).includes("/check-runs")) {
      return jsonRes(200, {
        check_runs: [{ name: "ci", status: "completed", conclusion: "success" }],
      });
    }
    return jsonRes(404, {});
  };
  try {
    const msg = postMessage("ship", "Eng.Build", "bot", "https://github.com/acme/app/pull/3", { seatId: "build" });
    const live = await attachGithubCard(msg, { text: msg.text });
    assert.equal(live.github.stale, false);

    deps.env = {};
    const stale = await snapshotGithub(live.github, { previous: live.github });
    assert.equal(stale.stale, true);
    assert.equal(stale.url, "https://github.com/acme/app/pull/3");
    assert.equal(stale.title, "Keep this title");
    assert.ok(!/error that blocks/i.test(JSON.stringify(stale)));
  } finally {
    deps.env = prevEnv;
    deps.fetchFn = prevFetch;
  }
});
