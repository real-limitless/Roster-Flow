import assert from "node:assert/strict";
import test from "node:test";
import { apiHost, apiPort, opencodeHostname, publicUrl, rosterApiUrl } from "./config.mjs";

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
  try {
    assert.equal(apiHost(), "127.0.0.1");
    assert.equal(apiPort(), 8787);
    assert.equal(publicUrl(), "http://127.0.0.1:5173");
    assert.equal(rosterApiUrl(), "http://127.0.0.1:8787");
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
