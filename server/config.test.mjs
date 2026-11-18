import assert from "node:assert/strict";
import test from "node:test";
import {
  apiHost,
  apiPort,
  opencodeHostname,
  publicUrl,
  rosterApiUrl,
  webPort,
  redactWikiflowSecret,
  wikiflowAuthHeaders,
  wikiflowConfig,
  wikiflowWarnings,
} from "./config.mjs";

test("api bind defaults stay loopback for host standup", () => {
  const prevHost = process.env.ROSTER_API_HOST;
  const prevPort = process.env.ROSTER_API_PORT;
  const prevPublic = process.env.ROSTER_PUBLIC_URL;
  const prevApi = process.env.ROSTER_API;
  const prevOc = process.env.OPENCODE_HOSTNAME;
  delete process.env.ROSTER_API_HOST;
  delete process.env.ROSTER_API_PORT;
  delete process.env.ROSTER_PUBLIC_URL;
  delete process.env.ROSTER_API;
  delete process.env.OPENCODE_HOSTNAME;
  const prevWeb = process.env.ROSTER_WEB_PORT;
  delete process.env.ROSTER_WEB_PORT;
  try {
    assert.equal(apiHost(), "127.0.0.1");
    assert.equal(apiPort(), 8790);
    assert.equal(publicUrl(), "http://127.0.0.1:5175");
    assert.equal(rosterApiUrl(), "http://127.0.0.1:8790");
    assert.equal(opencodeHostname(), "127.0.0.1");
  } finally {
    if (prevHost === undefined) delete process.env.ROSTER_API_HOST;
    else process.env.ROSTER_API_HOST = prevHost;
    if (prevPort === undefined) delete process.env.ROSTER_API_PORT;
    else process.env.ROSTER_API_PORT = prevPort;
    if (prevPublic === undefined) delete process.env.ROSTER_PUBLIC_URL;
    else process.env.ROSTER_PUBLIC_URL = prevPublic;
    if (prevApi === undefined) delete process.env.ROSTER_API;
    else process.env.ROSTER_API = prevApi;
    if (prevOc === undefined) delete process.env.OPENCODE_HOSTNAME;
    else process.env.OPENCODE_HOSTNAME = prevOc;
    if (prevWeb === undefined) delete process.env.ROSTER_WEB_PORT;
    else process.env.ROSTER_WEB_PORT = prevWeb;
  }
});

test("container env can bind CORE on all interfaces", () => {
  const prevHost = process.env.ROSTER_API_HOST;
  const prevPublic = process.env.ROSTER_PUBLIC_URL;
  process.env.ROSTER_API_HOST = "0.0.0.0";
  process.env.ROSTER_PUBLIC_URL = "http://127.0.0.1:5173";
  try {
    assert.equal(apiHost(), "0.0.0.0");
    assert.equal(publicUrl(), "http://127.0.0.1:5173");
  } finally {
    if (prevHost === undefined) delete process.env.ROSTER_API_HOST;
    else process.env.ROSTER_API_HOST = prevHost;
    if (prevPublic === undefined) delete process.env.ROSTER_PUBLIC_URL;
    else process.env.ROSTER_PUBLIC_URL = prevPublic;
  }
});

test("ROSTER_WEB_PORT drives the default public URL", () => {
  const prevWeb = process.env.ROSTER_WEB_PORT;
  const prevPublic = process.env.ROSTER_PUBLIC_URL;
  delete process.env.ROSTER_PUBLIC_URL;
  try {
    delete process.env.ROSTER_WEB_PORT;
    assert.equal(webPort(), 5175);
    process.env.ROSTER_WEB_PORT = "5199";
    assert.equal(webPort(), 5199);
    assert.equal(publicUrl(), "http://127.0.0.1:5199");
    process.env.ROSTER_PUBLIC_URL = "https://roster.example";
    assert.equal(publicUrl(), "https://roster.example");
  } finally {
    if (prevWeb === undefined) delete process.env.ROSTER_WEB_PORT;
    else process.env.ROSTER_WEB_PORT = prevWeb;
    if (prevPublic === undefined) delete process.env.ROSTER_PUBLIC_URL;
    else process.env.ROSTER_PUBLIC_URL = prevPublic;
  }
});

test("wikiflow config is off until WIKIFLOW_URL is set", () => {
  const cfg = wikiflowConfig({});
  assert.equal(cfg.url, "");
  assert.equal(cfg.token, "");
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.source, "");
  assert.deepEqual(wikiflowAuthHeaders({}), {});
  assert.deepEqual(wikiflowWarnings({}), []);
});

test("wikiflow config trims the URL and token and builds a Bearer header", () => {
  const env = {
    WIKIFLOW_URL: " http://wiki.example/wiki/ ",
    WIKIFLOW_TOKEN: "  wiki-token-9f3a  ",
  };
  const cfg = wikiflowConfig(env);
  assert.equal(cfg.url, "http://wiki.example/wiki");
  assert.equal(cfg.token, "wiki-token-9f3a");
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.source, "WIKIFLOW_URL");
  assert.deepEqual(wikiflowAuthHeaders(env), { Authorization: "Bearer wiki-token-9f3a" });
  assert.deepEqual(wikiflowWarnings(env), []);
  assert.equal(redactWikiflowSecret("wiki-flow 401: bad token", "tok"), "wiki-flow 401: bad token");
  assert.equal(redactWikiflowSecret("rejected wiki-token-9f3a", "wiki-token-9f3a"), "rejected [redacted]");
});

test("a set WIKIFLOW_URL without a token warns and does not throw", () => {
  const env = {
    WIKIFLOW_URL: "http://wiki-flow:8788/",
    WIKIFLOW_TOKEN: "",
  };
  const cfg = wikiflowConfig(env);
  assert.equal(cfg.url, "http://wiki-flow:8788");
  assert.equal(cfg.enabled, false);
  assert.deepEqual(wikiflowAuthHeaders(env), {});
  const notes = wikiflowWarnings(env);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /WIKIFLOW_URL is set \(http:\/\/wiki-flow:8788\)/);
  assert.match(notes[0], /Set WIKIFLOW_TOKEN/);
  assert.match(notes[0], /keeps running/);
});

test("deprecated WIKIFLOW_API still supplies the base URL", () => {
  const token = "wiki-token-9f3a";
  const legacyOnly = wikiflowConfig({ WIKIFLOW_API: "http://wiki.example/docs/", WIKIFLOW_TOKEN: token });
  assert.equal(legacyOnly.url, "http://wiki.example/docs");
  assert.equal(legacyOnly.source, "WIKIFLOW_API");
  assert.equal(legacyOnly.enabled, true);
  assert.deepEqual(wikiflowAuthHeaders({ WIKIFLOW_API: "http://wiki.example", WIKIFLOW_TOKEN: token }), {
    Authorization: `Bearer ${token}`,
  });
  const deprecated = wikiflowWarnings({ WIKIFLOW_API: "http://user:wiki-token-9f3a@wiki.example/docs/?access_token=wiki-token-9f3a" });
  assert.equal(deprecated.length, 2);
  assert.match(deprecated[0], /WIKIFLOW_API is deprecated/);
  assert.match(deprecated[0], /Set WIKIFLOW_URL/);
  assert.match(deprecated[1], /WIKIFLOW_TOKEN is missing/);
  assert.match(deprecated[1], /http:\/\/wiki\.example\/docs/);
  assert.equal(deprecated.join("\n").includes(token), false);

  const both = wikiflowConfig({
    WIKIFLOW_URL: "http://wiki-flow:8788",
    WIKIFLOW_API: "http://old.example",
    WIKIFLOW_TOKEN: token,
  });
  assert.equal(both.url, "http://wiki-flow:8788");
  assert.equal(both.legacyIgnored, true);
  const ignored = wikiflowWarnings({
    WIKIFLOW_URL: "http://wiki-flow:8788",
    WIKIFLOW_API: "http://old.example",
    WIKIFLOW_TOKEN: token,
  });
  assert.equal(ignored.length, 1);
  assert.match(ignored[0], /deprecated and ignored/);
  assert.equal(ignored[0].includes(token), false);
});

test("API port never defaults to mcp-flow's 8787", () => {
  const prev = process.env.ROSTER_API_PORT;
  delete process.env.ROSTER_API_PORT;
  try {
    assert.notEqual(apiPort(), 8787);
    assert.equal(apiPort(), 8790);
  } finally {
    if (prev !== undefined) process.env.ROSTER_API_PORT = prev;
  }
});
