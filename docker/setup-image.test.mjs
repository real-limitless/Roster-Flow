import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const entry = "scripts/setup-wiki-team.mjs";

/** Relative module specifiers this file imports. Package and node: imports are not files we copy. */
function relativeImports(source) {
  const specs = [];
  const re = /^\s*import\s+(?:[^'"\n]*?\s+from\s+)?["'](\.[^"']+)["']/gm;
  for (const match of source.matchAll(re)) specs.push(match[1]);
  const dynamic = /import\s*\(\s*["'](\.[^"']+)["']\s*\)/g;
  for (const match of source.matchAll(dynamic)) specs.push(match[1]);
  return specs;
}

/** Entry script plus every local module it reaches, repo-relative. */
export function localImportGraph(entryRel, repoRoot = root) {
  const seen = new Set();
  const stack = [entryRel];
  while (stack.length) {
    const rel = stack.pop();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const abs = join(repoRoot, rel);
    const source = readFileSync(abs, "utf8");
    for (const spec of relativeImports(source)) {
      const next = relative(repoRoot, resolve(dirname(abs), spec)).split("\\").join("/");
      stack.push(next);
    }
  }
  return [...seen].sort();
}

function posixJoin(dir, rel) {
  const parts = `${dir}/${rel}`.split("/");
  const out = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `/${out.join("/")}`;
}

function sourceIsDirectory(repoRoot, source) {
  if (source.endsWith("/")) return true;
  const abs = join(repoRoot, source);
  return existsSync(abs) && statSync(abs).isDirectory();
}

function filesInDirectory(repoRoot, source) {
  const prefix = source.replace(/\/+$/, "");
  const abs = join(repoRoot, prefix);
  const out = [];
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const child = join(dir, name);
      const childRel = rel ? `${rel}/${name}` : name;
      if (statSync(child).isDirectory()) walk(child, childRel);
      else out.push({ source: `${prefix}/${childRel}`, rel: childRel });
    }
  };
  walk(abs, "");
  return out;
}

/** Runtime path -> repo-relative source, after WORKDIR and COPY. Directory COPY places each file under the dest dir. */
export function placeCopies(dockerfile, repoRoot = root) {
  let workdir = "/";
  const placed = new Map();
  for (const rawLine of dockerfile.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (/^WORKDIR\s+/i.test(line)) {
      const arg = line.replace(/^WORKDIR\s+/i, "").trim().replace(/^["']|["']$/g, "");
      workdir = arg.startsWith("/") ? posixJoin("/", arg) : posixJoin(workdir, arg);
      continue;
    }
    if (!/^COPY\s+/i.test(line)) continue;
    const tokens = line.replace(/^COPY\s+/i, "").trim().split(/\s+/).filter((token) => !token.startsWith("--"));
    if (tokens.length < 2) continue;
    const destToken = tokens.at(-1);
    const sources = tokens.slice(0, -1);
    const destAbs = destToken.startsWith("/") ? posixJoin("/", destToken) : posixJoin(workdir, destToken);
    const asDir = sources.length > 1 || destToken === "." || destToken === "./" || destToken.endsWith("/");
    for (const source of sources) {
      const src = source.replace(/^\.\//, "");
      if (sourceIsDirectory(repoRoot, src)) {
        for (const file of filesInDirectory(repoRoot, src)) placed.set(posixJoin(destAbs, file.rel), file.source);
        continue;
      }
      const base = src.split("/").filter(Boolean).pop();
      placed.set(asDir ? posixJoin(destAbs, base) : destAbs, src);
    }
  }
  return placed;
}

export function nodeScripts(text) {
  return [...String(text || "").matchAll(/\bnode\s+(\/\S+\.mjs)\b/g)].map((match) => match[1]);
}

/** Errors when the node command or a relative import does not land on a copied path. */
export function runtimeLayoutErrors({ dockerfile, commandText = "", repoRoot = root }) {
  const placed = placeCopies(dockerfile, repoRoot);
  const commands = [...new Set([...nodeScripts(dockerfile), ...nodeScripts(commandText)])];
  const errors = [];
  if (!commands.length) errors.push("no node command path");
  for (const cmd of commands) {
    if (!placed.has(cmd)) {
      errors.push(`command ${cmd} is not a copied file`);
      continue;
    }
    const stack = [cmd];
    const seen = new Set();
    while (stack.length) {
      const runtime = stack.pop();
      if (seen.has(runtime)) continue;
      seen.add(runtime);
      const source = placed.get(runtime);
      if (!source) {
        errors.push(`${runtime} is imported but not copied`);
        continue;
      }
      let text;
      try {
        text = readFileSync(join(repoRoot, source), "utf8");
      } catch {
        errors.push(`copied source ${source} is missing from the repo`);
        continue;
      }
      for (const spec of relativeImports(text)) {
        const next = posixJoin(runtime.split("/").slice(0, -1).join("/") || "/", spec);
        if (!placed.has(next)) errors.push(`${source} import ${spec} resolves to ${next}, which is not copied`);
        else stack.push(next);
      }
    }
  }
  return errors;
}

/** COPY sources from a Dockerfile. The last token is the destination. */
export function copySources(dockerfile) {
  const sources = [];
  for (const line of dockerfile.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("COPY ")) continue;
    const tokens = trimmed.slice("COPY ".length).trim().split(/\s+/).filter((token) => !token.startsWith("--"));
    sources.push(...tokens.slice(0, -1));
  }
  return sources;
}

function dedent(lines) {
  const indents = lines.filter((line) => line.trim()).map((line) => line.match(/^ */)[0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(min)).join("\n");
}

/** Inline Dockerfiles from a compose file. A Dockerfile is returned as itself. */
export function dockerfilesForSetup(text, filename = "") {
  if (/^Dockerfile/i.test(filename) || filename.endsWith(".Dockerfile")) return [text];
  const lines = text.split("\n");
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/dockerfile_inline:\s*\|/.test(lines[i])) continue;
    const keyIndent = lines[i].match(/^ */)[0].length;
    const body = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].trim()) {
        body.push(lines[j]);
        continue;
      }
      const indent = lines[j].match(/^ */)[0].length;
      if (indent <= keyIndent) break;
      body.push(lines[j]);
    }
    blocks.push(dedent(body));
  }
  return blocks;
}

function setupImageFiles() {
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const abs = join(dir, name);
      const st = statSync(abs);
      if (st.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!/docker-compose.*\.ya?ml$|^Dockerfile/i.test(name) && !name.endsWith(".Dockerfile")) continue;
      const text = readFileSync(abs, "utf8");
      if (!text.includes("setup-wiki-team.mjs")) continue;
      for (const dockerfile of dockerfilesForSetup(text, name)) {
        if (dockerfile.includes("setup-wiki-team.mjs")) found.push({ file: relative(root, abs), dockerfile, commandText: text });
      }
    }
  };
  walk(root);
  return found;
}

test("the roster-setup image copies every module setup-wiki-team.mjs imports", () => {
  const needed = localImportGraph(entry);
  assert.ok(needed.includes("server/model-defaults.mjs"));
  const images = setupImageFiles();
  assert.ok(images.length > 0, "no setup image copies setup-wiki-team.mjs");
  for (const image of images) {
    const copied = new Set(copySources(image.dockerfile));
    const missing = needed.filter((file) => !copied.has(file));
    assert.deepEqual(missing, [], `${image.file} does not copy ${missing.join(", ")}`);
  }
});

test("a flattened COPY fails when the import resolves outside the image", () => {
  const dockerfile = `
    FROM node:22-alpine
    WORKDIR /s
    COPY scripts/setup-wiki-team.mjs ./
    COPY server/model-defaults.mjs ./
  `;
  const errors = runtimeLayoutErrors({ dockerfile, commandText: "exec node /s/setup-wiki-team.mjs" });
  assert.ok(errors.some((error) => error.includes("/server/model-defaults.mjs")), errors.join("\n"));
});

test("a command path that misses the copied entry fails", () => {
  const dockerfile = `
    FROM node:22-alpine
    WORKDIR /s
    COPY scripts/setup-wiki-team.mjs scripts/setup-wiki-team.mjs
    COPY server/model-defaults.mjs server/model-defaults.mjs
    COPY server/featherless-catalog.mjs server/featherless-catalog.mjs
  `;
  const errors = runtimeLayoutErrors({ dockerfile, commandText: "exec node /s/setup-wiki-team.mjs" });
  assert.ok(errors.some((error) => error.includes("is not a copied file")), errors.join("\n"));
});

test("COPY server/ server/ places imported modules on the command path", () => {
  const dockerfile = `
    FROM node:22-alpine
    WORKDIR /s
    COPY scripts/setup-wiki-team.mjs scripts/setup-wiki-team.mjs
    COPY server/ server/
  `;
  assert.deepEqual(runtimeLayoutErrors({ dockerfile, commandText: "exec node /s/scripts/setup-wiki-team.mjs" }), []);
});

test("the roster-setup command runs the copied entry and its imports", () => {
  const images = setupImageFiles();
  assert.ok(images.length > 0, "no setup image copies setup-wiki-team.mjs");
  for (const image of images) {
    const errors = runtimeLayoutErrors({ dockerfile: image.dockerfile, commandText: image.commandText });
    assert.deepEqual(errors, [], `${image.file}: ${errors.join("; ")}`);
  }
});
