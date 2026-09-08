import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export function staticRoot() {
  const dir = String(process.env.ROSTER_STATIC_DIR || "").trim();
  return dir || null;
}

export function safeJoin(rootDir, urlPath) {
  const cleaned = decodeURIComponent(String(urlPath || "/")).split("?")[0].split("#")[0];
  const relative = cleaned.replace(/^\/+/, "") || "index.html";
  const resolved = resolve(rootDir, relative);
  const rootResolved = resolve(rootDir);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + sep)) return null;
  return resolved;
}

export function resolveStaticFile(rootDir, pathname) {
  if (!rootDir) return null;
  const path = pathname === "/" ? "/index.html" : pathname;
  const candidate = safeJoin(rootDir, path);
  if (candidate && existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  if (String(pathname || "").startsWith("/assets/")) return null;
  const index = join(rootDir, "index.html");
  if (existsSync(index) && statSync(index).isFile()) return index;
  return null;
}

export function tryServeStatic(req, res, pathname) {
  const method = req.method || "GET";
  if (method !== "GET" && method !== "HEAD") return false;
  if (String(pathname || "").startsWith("/api")) return false;
  const rootDir = staticRoot();
  if (!rootDir) return false;
  const file = resolveStaticFile(rootDir, pathname);
  if (!file) return false;
  const type = MIME[extname(file).toLowerCase()] || "application/octet-stream";
  const immutable = String(pathname || "").startsWith("/assets/");
  res.writeHead(200, {
    "content-type": type,
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  if (method === "HEAD") {
    res.end();
    return true;
  }
  createReadStream(file).pipe(res);
  return true;
}
