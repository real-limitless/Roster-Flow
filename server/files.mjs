/**
 * Job-scoped file bytes (issue #69). Paths in `fileRefs` stay metadata.
 * Bytes live under dataDir/jobs/<id> and are indexed on the job.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir as defaultDataDir } from "./paths.mjs";
import { canReadJob } from "./job-access.mjs";

export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_FILES = 8;
export const MAX_JOB_BYTES = 4 * 1024 * 1024;

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function safeFileName(name) {
  const base = String(name || "").replace(/\\/g, "/").split("/").pop().trim();
  if (!base || base === "." || base === "..") throw fail(400, "file name required");
  if (base.length > 180) throw fail(400, "file name is too long");
  if (!/^[A-Za-z0-9._-]+$/.test(base)) throw fail(400, "file name must be letters, numbers, dot, dash, or underscore");
  return base;
}

function safeJobId(id) {
  const s = String(id || "");
  if (!/^job-[A-Za-z0-9-]+$/.test(s)) throw fail(400, "bad job id");
  return s;
}

function rawJob(state, id) {
  const job = (state.jobs || []).find((j) => j.id === id);
  if (!job) throw fail(404, "job not found");
  return job;
}

function decodeContent(content, encoding) {
  if (typeof content !== "string" || !content.length) throw fail(400, "content required");
  const enc = encoding || "utf8";
  if (enc === "utf8") return Buffer.from(content, "utf8");
  if (enc === "base64") return Buffer.from(content, "base64");
  throw fail(400, "encoding must be utf8 or base64");
}

export function writeJobFile(state, jobId, body = {}, caller = {}, root = defaultDataDir) {
  const job = rawJob(state, jobId);
  if (!canReadJob(job, caller)) throw fail(404, "job not found");
  const name = safeFileName(body.name);
  const buf = decodeContent(body.content, body.encoding);
  if (buf.length > MAX_FILE_BYTES) throw fail(413, "file exceeds 1MB");
  const files = Array.isArray(job.files) ? job.files : [];
  const others = files.filter((f) => f.name !== name);
  if (!files.some((f) => f.name === name) && others.length >= MAX_FILES) throw fail(413, "job file cap is 8");
  const total = others.reduce((sum, f) => sum + (Number(f.size) || 0), 0) + buf.length;
  if (total > MAX_JOB_BYTES) throw fail(413, "job file cap is 4MB");
  const id = safeJobId(job.id);
  const dir = join(root, "jobs", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), buf);
  const meta = {
    name,
    size: buf.length,
    sha256: createHash("sha256").update(buf).digest("hex"),
    updatedAt: new Date().toISOString(),
  };
  job.files = [...others, meta];
  job.updatedAt = meta.updatedAt;
  return meta;
}

export function readJobFile(state, jobId, name, caller = {}, root = defaultDataDir) {
  const job = rawJob(state, jobId);
  if (!canReadJob(job, caller)) throw fail(404, "job not found");
  const fileName = safeFileName(name);
  const meta = (job.files || []).find((f) => f.name === fileName);
  if (!meta) throw fail(404, "file not found");
  const buf = readFileSync(join(root, "jobs", safeJobId(job.id), fileName));
  return {
    name: fileName,
    size: buf.length,
    sha256: meta.sha256,
    encoding: "base64",
    content: buf.toString("base64"),
  };
}
