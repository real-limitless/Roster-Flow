import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "rf-harness-"));
const ocDir = join(dir, "opencode");
const dataDir = join(dir, "data");
const envOut = join(dir, "env");
mkdirSync(envOut, { recursive: true });
Object.assign(process.env, {
  ROSTER_DATA_DIR: dataDir,
  ROSTER_OPENCODE_DIR: ocDir,
  ROSTER_WORKSPACE: join(dir, "ws"),
  HOME: join(dir, "home"),
  OPENCODE_PORT: String(30000 + Math.floor(Math.random() * 10000)),
  OPENCODE_SYSTEM_PORT: String(40000 + Math.floor(Math.random() * 10000)),
  FAKE_OC_ENV_OUT: envOut,
  FEATHERLESS_API_KEY: "fl-test-key",
});
delete process.env.OPENCODE_CONFIG;
for (const k of ["XAI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"]) delete process.env[k];

// Stand-in for `opencode serve`: records its env and, like OpenCode, only
// knows the providers in OPENCODE_CONFIG / OPENCODE_CONFIG_DIR.
mkdirSync(join(dir, "bin"));
const fakeBin = join(dir, "bin", "opencode");
writeFileSync(
  fakeBin,
  `#!/usr/bin/env node
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
fs.writeFileSync(path.join(process.env.FAKE_OC_ENV_OUT, process.env.OPENCODE_CLIENT + ".json"), JSON.stringify({ env: process.env, cwd: process.cwd() }));
function providers() {
  const out = [{ id: "opencode", models: { "big-pickle": { id: "big-pickle" } } }];
  const files = [process.env.OPENCODE_CONFIG, process.env.OPENCODE_CONFIG_DIR && path.join(process.env.OPENCODE_CONFIG_DIR, "opencode.json")];
  for (const f of files) {
    if (!f || !fs.existsSync(f)) continue;
    const cfg = JSON.parse(fs.readFileSync(f, "utf8"));
    for (const [id, p] of Object.entries(cfg.provider || {})) if (!out.some((x) => x.id === id)) out.push({ id, models: p.models || {} });
  }
  return out;
}
http.createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.url === "/global/health") return res.end(JSON.stringify({ healthy: true, version: "fake" }));
  if (req.url === "/session") return res.end("[]");
  if (req.url === "/config/providers") return res.end(JSON.stringify({ providers: providers(), default: {} }));
  res.statusCode = 404;
  res.end("{}");
}).listen(port, "127.0.0.1");
`,
);
chmodSync(fakeBin, 0o755);
process.env.OPENCODE_BIN = fakeBin;

const harness = await import("./harness.mjs");
const providers = await import("./providers.mjs");

const FEATHERLESS_BLOCK = {
  npm: "@ai-sdk/openai-compatible",
  name: "Featherless",
  options: { baseURL: "https://api.featherless.ai/v1", apiKey: "{env:FEATHERLESS_API_KEY}" },
  models: { "Qwen/Qwen2.5-Coder-32B-Instruct": { name: "Qwen2.5 Coder 32B" } },
};

function writeCompany(provider) {
  providers.writeOpenCodeConfig({ $schema: "https://opencode.ai/config.json", provider });
}

after(async () => {
  for (const kind of [harness.COMPANY, harness.SYSTEM]) {
    const pid = harness.status(kind).pid;
    if (pid) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

test("configPaths point the company serve at the file providers.mjs writes", () => {
  assert.deepEqual(harness.configPaths("company"), { dir: ocDir, file: join(ocDir, "opencode.json") });
  assert.deepEqual(harness.configPaths("system"), {
    dir: join(dataDir, "system", ".opencode"),
    file: join(dataDir, "system", ".opencode", "opencode.json"),
  });
  writeCompany({ featherless: FEATHERLESS_BLOCK });
  assert.ok(existsSync(harness.configPaths("company").file));
});

test("serveEnv sets OPENCODE_CONFIG and OPENCODE_CONFIG_DIR for both serves", () => {
  const base = { PATH: "/bin", FEATHERLESS_API_KEY: "k", WIKIFLOW_URL: "http://wiki" };
  const company = harness.serveEnv("company", base);
  assert.equal(company.OPENCODE_CONFIG, join(ocDir, "opencode.json"));
  assert.equal(company.OPENCODE_CONFIG_DIR, ocDir);
  assert.equal(company.OPENCODE_CLIENT, "roster-flow");
  assert.equal(company.FEATHERLESS_API_KEY, "k");
  assert.equal(company.WIKIFLOW_URL, "http://wiki");
  assert.ok(company.ROSTER_API);
  assert.match(company.NODE_PATH, /node_modules/);

  const system = harness.serveEnv("system", base);
  assert.equal(system.OPENCODE_CONFIG, join(dataDir, "system", ".opencode", "opencode.json"));
  assert.equal(system.OPENCODE_CONFIG_DIR, join(dataDir, "system", ".opencode"));
  assert.equal(system.OPENCODE_CLIENT, "roster-flow-system");
  assert.equal(system.FEATHERLESS_API_KEY, "k");
});

test("serveEnv gives the plugin CORE's internal token unless ROSTER_API_TOKEN is set", async () => {
  const { internalPluginToken, isInternalPluginToken } = await import("./internal-token.mjs");
  const env = harness.serveEnv("company", { PATH: "/bin" });
  assert.equal(env.ROSTER_API_TOKEN, internalPluginToken());
  assert.ok(isInternalPluginToken(env.ROSTER_API_TOKEN));
  assert.equal(harness.serveEnv("system", { PATH: "/bin", ROSTER_API_TOKEN: " " }).ROSTER_API_TOKEN, internalPluginToken());
  assert.equal(harness.serveEnv("company", { PATH: "/bin", ROSTER_API_TOKEN: "rf_user" }).ROSTER_API_TOKEN, "rf_user");
});

test("an empty OPENCODE_CONFIG (compose default) keeps ROSTER_OPENCODE_DIR; a set one overrides the company serve only", () => {
  assert.equal(harness.serveEnv("company", { PATH: "/bin", OPENCODE_CONFIG: "" }).OPENCODE_CONFIG, join(ocDir, "opencode.json"));
  assert.equal(harness.serveEnv("company", { PATH: "/bin", OPENCODE_CONFIG: "  " }).OPENCODE_CONFIG, join(ocDir, "opencode.json"));
  const override = harness.serveEnv("company", { PATH: "/bin", OPENCODE_CONFIG: "/etc/oc/extra.json" });
  assert.equal(override.OPENCODE_CONFIG, "/etc/oc/extra.json");
  assert.equal(override.OPENCODE_CONFIG_DIR, ocDir);
  const system = harness.serveEnv("system", { PATH: "/bin", OPENCODE_CONFIG: "/etc/oc/extra.json" });
  assert.equal(system.OPENCODE_CONFIG, join(dataDir, "system", ".opencode", "opencode.json"));
});

test("serveChildEnv passes through every {env:VAR} a provider block references", () => {
  writeCompany({ featherless: FEATHERLESS_BLOCK, custom: { options: { headers: { "x-key": "{env:CUSTOM_HDR_KEY}" } }, models: {} } });
  process.env.CUSTOM_HDR_KEY = "hdr";
  try {
    assert.deepEqual(
      ["FEATHERLESS_API_KEY", "CUSTOM_HDR_KEY", "XAI_API_KEY"].filter((n) => providers.providerKeyEnvNames(providers.readOpenCodeConfig()).includes(n)),
      ["FEATHERLESS_API_KEY", "CUSTOM_HDR_KEY", "XAI_API_KEY"],
    );
    const env = providers.serveChildEnv({ PATH: "/bin" });
    assert.equal(env.FEATHERLESS_API_KEY, "fl-test-key");
    assert.equal(env.CUSTOM_HDR_KEY, "hdr");
  } finally {
    delete process.env.CUSTOM_HDR_KEY;
    writeCompany({ featherless: FEATHERLESS_BLOCK });
  }
});

test("ensure spawns both serves with the roster config and key, and reports loaded providers", async () => {
  writeCompany({ featherless: FEATHERLESS_BLOCK });
  const company = await harness.ensure({ kind: "company" });
  assert.equal(company.harness, "up");
  assert.ok(company.loadedProviders.includes("featherless"), company.loadedProviders.join(","));
  assert.equal(company.config, join(ocDir, "opencode.json"));

  const seen = JSON.parse(readFileSync(join(envOut, "roster-flow.json"), "utf8"));
  assert.equal(seen.env.OPENCODE_CONFIG, join(ocDir, "opencode.json"));
  assert.equal(seen.env.OPENCODE_CONFIG_DIR, ocDir);
  assert.equal(seen.env.FEATHERLESS_API_KEY, "fl-test-key");
  const written = JSON.parse(readFileSync(seen.env.OPENCODE_CONFIG, "utf8"));
  assert.ok(written.provider.featherless);
  assert.ok(written.plugin.includes("roster-flow-opencode"));

  const system = await harness.ensure({ kind: "system" });
  assert.equal(system.harness, "up");
  assert.ok(system.loadedProviders.includes("featherless"));
  const sys = JSON.parse(readFileSync(join(envOut, "roster-flow-system.json"), "utf8"));
  assert.equal(sys.env.OPENCODE_CONFIG, harness.configPaths("system").file);
  assert.equal(sys.env.FEATHERLESS_API_KEY, "fl-test-key");
  assert.ok(JSON.parse(readFileSync(sys.env.OPENCODE_CONFIG, "utf8")).provider.featherless);

  const loaded = await harness.loadedModels("company");
  assert.ok(loaded.some((m) => m.providerID === "featherless" && m.modelID === "Qwen/Qwen2.5-Coder-32B-Instruct"));
  assert.deepEqual(harness.knownLoadedModels("company"), loaded);
});

test("a serve that dies reads offline instead of a stale up", async () => {
  const before = await harness.liveCombinedStatus();
  assert.equal(before.systemHarness.harness, "up");
  process.kill(before.systemHarness.pid, "SIGKILL");
  for (let i = 0; i < 40 && harness.status("system").harness === "up"; i++) await new Promise((r) => setTimeout(r, 50));
  const live = await harness.liveCombinedStatus();
  assert.equal(live.systemHarness.harness, "offline");
  assert.equal(live.harness, "up");
});

test("fallback and seat resolution only pick models OpenCode loaded", () => {
  writeCompany({ featherless: FEATHERLESS_BLOCK });
  const builtinOnly = [{ providerID: "opencode", modelID: "big-pickle" }];
  const withFeatherless = [...builtinOnly, { providerID: "featherless", modelID: "Qwen/Qwen2.5-Coder-32B-Instruct" }];

  assert.equal(providers.firstConnectedModel()?.providerID, "featherless");
  assert.equal(providers.firstConnectedModel(builtinOnly), null);
  assert.equal(providers.firstConnectedModel(withFeatherless)?.providerID, "featherless");

  const st = providers.keyStatusForModel("featherless/Qwen/Qwen2.5-Coder-32B-Instruct", builtinOnly);
  assert.equal(st.connected, true);
  assert.equal(st.loaded, false);
  assert.equal(st.providerLoaded, false);
  assert.deepEqual(st.loadedProviders, ["opencode"]);
  assert.equal(providers.isUsable(st), false);
  assert.equal(providers.isUsable(providers.keyStatusForModel("featherless/Qwen/Qwen2.5-Coder-32B-Instruct", withFeatherless)), true);
  assert.equal(providers.keyStatusForModel("featherless/Qwen/Qwen2.5-Coder-32B-Instruct").loaded, null);

  const seat = { model: "xai/grok-4" };
  assert.deepEqual(providers.resolveUsableModel(seat, undefined, withFeatherless), {
    providerID: "xai",
    modelID: "grok-4",
  });
  assert.deepEqual(providers.resolveUsableModel({ model: "" }, undefined, withFeatherless), {
    providerID: "featherless",
    modelID: "Qwen/Qwen2.5-Coder-32B-Instruct",
  });
  assert.deepEqual(providers.resolveUsableModel(seat, undefined, builtinOnly), { providerID: "xai", modelID: "grok-4" });
});

test("describeOpenCodeError names a missing provider and a rejected key", () => {
  const missing = harness.describeOpenCodeError(
    Object.assign(new Error("Internal Server Error"), {
      status: 500,
      detail: { name: "UnknownError", data: { message: "ProviderModelNotFoundError: Model not found: featherless/Qwen" } },
    }),
    { model: "featherless/Qwen" },
  );
  assert.equal(missing.code, "PROVIDER_NOT_LOADED");
  assert.equal(missing.status, 409);
  assert.match(missing.message, /featherless\/Qwen is not loaded by the company OpenCode harness/);

  const rejected = harness.describeOpenCodeError(
    { name: "APIError", data: { message: "You must be signed in to access this resource", statusCode: 401 } },
    { model: "featherless/Qwen" },
  );
  assert.equal(rejected.code, "PROVIDER_AUTH");
  assert.match(rejected.message, /featherless rejected the API key \(401\): You must be signed in/);

  const unknown = harness.describeOpenCodeError(
    Object.assign(new Error("boom"), { status: 500, name: "UnknownError", detail: { name: "UnknownError", data: { message: "boom" } } }),
    { model: "x/y" },
  );
  assert.equal(unknown.code, "OPENCODE_ERROR");
  assert.equal(unknown.status, 502);
  assert.match(unknown.message, /500 UnknownError/);
  assert.equal(harness.openCodeErrorText({ name: "UnknownError", data: { message: "inner" } }), "inner");
});

test("lastAssistantFailure reports only the latest errored turn since the wake", () => {
  const err = { name: "APIError", data: { message: "nope", statusCode: 401 } };
  const failed = [
    { info: { id: "u1", role: "user", time: { created: 1000 } }, parts: [] },
    { info: { id: "a1", role: "assistant", providerID: "featherless", modelID: "Q", error: err, time: { created: 2000 } }, parts: [] },
  ];
  const got = harness.lastAssistantFailure(failed, { since: 1500 });
  assert.equal(got.code, "PROVIDER_AUTH");
  assert.equal(got.error, true);
  assert.match(got.text, /featherless rejected the API key \(401\)/);
  assert.equal(harness.lastAssistantFailure(failed, { since: 2500 }), null);
  assert.equal(harness.lastAssistantFailure([...failed, { info: { id: "u2", role: "user", time: { created: 3000 } } }]), null);
  assert.equal(harness.lastAssistantFailure(null), null);
});

test("flattenConfigProviders reads OpenCode's /config/providers shape", () => {
  assert.deepEqual(
    harness.flattenConfigProviders({ providers: [{ id: "opencode", models: { "big-pickle": {} } }, { id: "featherless", models: { "a/b": {} } }] }),
    [
      { providerID: "opencode", modelID: "big-pickle" },
      { providerID: "featherless", modelID: "a/b" },
    ],
  );
  assert.equal(harness.flattenConfigProviders({}), null);
});
