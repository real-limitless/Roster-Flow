#!/usr/bin/env node
/**
 * Run the unit suite against a temp copy of .opencode so tests cannot rewrite
 * the tracked opencode.json. Fails if that file is dirty afterward.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const files = [
  "packages/roster-flow-blocks/index.test.mjs",
  "packages/roster-flow-opencode/index.test.mjs",
  "server/bus.test.mjs",
  "server/jobs.test.mjs",
  "server/mcp-jobs.test.mjs",
  "server/teams.test.mjs",
  "server/agents.test.mjs",
  "server/mentions.test.mjs",
  "server/channels.test.mjs",
  "server/room-sessions.test.mjs",
  "server/threads.test.mjs",
  "server/internal-token.test.mjs",
  "server/events.test.mjs",
  "server/models.test.mjs",
  "server/model-defaults.test.mjs",
  "server/featherless-catalog.test.mjs",
  "server/providers.test.mjs",
  "server/harness.test.mjs",
  "server/live-harness.test.mjs",
  "server/projects.test.mjs",
  "server/architect.test.mjs",
  "server/chat.test.mjs",
  "server/auth.test.mjs",
  "server/setup.test.mjs",
  "server/config.test.mjs",
  "server/static.test.mjs",
  "server/paths.test.mjs",
  "server/family.test.mjs",
  "server/goals.test.mjs",
  "server/inbox.test.mjs",
  "server/approvals.test.mjs",
  "server/routines.test.mjs",
  "server/bootstrap.test.mjs",
  "server/tokens.test.mjs",
  "server/autostart.test.mjs",
  "scripts/setup-wiki-team.test.mjs",
  "docker/entrypoint.test.mjs",
  "docker/setup-image.test.mjs",
  "server/access.test.mjs",
  "server/tasks.test.mjs",
  "server/budget.test.mjs",
  "server/heartbeats.test.mjs",
  "server/mcp.test.mjs",
  "server/adapters.test.mjs",
  "server/github.test.mjs",
  "server/knowledge.test.mjs",
  "server/slack.test.mjs",
  "server/flags.test.mjs",
  "server/audit-log.test.mjs",
  "server/hardening.test.mjs",
];

const tempOc = mkdtempSync(join(tmpdir(), "rf-opencode-"));
cpSync(join(root, ".opencode"), tempOc, { recursive: true });

const child = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...files], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, ROSTER_OPENCODE_DIR: tempOc },
});

const diff = spawnSync("git", ["diff", "--", ".opencode/opencode.json"], {
  cwd: root,
  encoding: "utf8",
});
if ((diff.stdout || "").trim()) {
  console.error("unit tests wrote the tracked .opencode/opencode.json");
  console.error(diff.stdout);
  process.exit(child.status && child.status !== 0 ? child.status : 1);
}
process.exit(child.status ?? 1);
