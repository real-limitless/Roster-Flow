import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
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
        if (dockerfile.includes("setup-wiki-team.mjs")) found.push({ file: relative(root, abs), dockerfile });
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
