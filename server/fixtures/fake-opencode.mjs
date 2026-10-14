#!/usr/bin/env node
// Test double for `opencode serve`: answers /global/health and empty session lists.
import { createServer } from "node:http";
const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]);
const host = args[args.indexOf("--hostname") + 1] || "127.0.0.1";
createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.url.startsWith("/global/health")) return res.end(JSON.stringify({ healthy: true, version: "fake" }));
  if (req.url.startsWith("/session")) return res.end("[]");
  res.end("{}");
}).listen(port, host);
process.on("SIGTERM", () => process.exit(0));
// Exit with the CORE that spawned us so test runs leave nothing behind.
const parent = process.ppid;
setInterval(() => {
  try {
    process.kill(parent, 0);
  } catch {
    process.exit(0);
  }
}, 200).unref();
