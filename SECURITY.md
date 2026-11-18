# Security

## Reporting a vulnerability

Report a vulnerability through a private GitHub security advisory on this repository. Do not open a public issue, pull request, or commit for an unfixed vulnerability. Include what you can about impact and how to reproduce it, without sending secrets, tokens, or passwords.

## Kill switch

Use these in order when access has to be cut. Details for the API calls are in [docs/API.md](docs/API.md).

1. **Revoke API tokens.** `DELETE /api/v1/tokens/:id` revokes one token. The caller needs an owner or admin session, or an API token with the `admin` scope. A revoked token then receives **401**.

2. **Rotate the callback secret.** `POST /api/v1/jobs/callback-secret/rotate` replaces the instance HMAC secret. The same owner or admin gate as the read route applies. The previous secret stays valid only until `ROSTER_CALLBACK_GRACE_MS` (default 10 minutes, maximum 24 hours). A second rotate drops the secret from before the first rotate immediately. If `ROSTER_CALLBACK_SECRET` is set in the environment, rotate returns **409**; change that value and restart the process.

3. **Revoke every session.** Stop the process, then run `npm run owner:reset` (it prompts, or take `--password` / `OWNER_RESET_PASSWORD`). That rewrites the owner password hash and revokes all sessions. It does not delete seats or runs.

4. **Stop the service** in the hosting platform so it stops accepting traffic.

## Dependency advisories

`npm audit` on DEVELOPMENT (November 2026) reported more rows than unique advisories. Four advisories were in the tree:

| Advisory | Severity | Where | What we did |
|---|---|---|---|
| [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) | high | `zod` 4.1.8 via `@opencode-ai/plugin` (the OpenCode plugin). shadcn already used 4.6.7. | Override `zod` to `4.6.7` (patched in 4.6.6, same major). The Roster plugin only builds `z.string()` schemas. |
| [GHSA-chp3-j5qr-2vfr](https://github.com/advisories/GHSA-chp3-j5qr-2vfr) | moderate | `effect` 4.0.0-beta.83, pinned by `@opencode-ai/plugin`. Cookie attribute injection in `makeCookie()`. | Override `effect` to `4.0.0-beta.103`, the first patched beta. The plugin entrypoint does not import `effect` or call `makeCookie()`. |
| [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | moderate | `minimatch` 10.2.6 via `shadcn` → `ts-morph`. No 10.x patch. The fix is `>=11.0.1`. | Override `minimatch` to `11.0.9`. The only caller is `minimatch(path, pattern)`. |
| [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) | high | `picomatch` `<=4.0.7`. Latest release is 4.0.7. GitHub lists no patched version. | Not overridden. npm's suggested fix downgrades `vite` 7 to 6 and `shadcn` 4 to 2, and those trees still use `picomatch` `<=4.0.7`. |

`picomatch` is pulled in by Vite and the shadcn CLI. Neither is imported by `server/`. `@tailwindcss/vite`, `tailwindcss`, `tw-animate-css`, and `shadcn` are devDependencies: the image build stage still installs them for `vite build`, and the runtime stage (`npm ci --omit=dev`) does not. The running API does not pass globs to `picomatch`. A full `npm audit` still lists this one high several times (Vite, shadcn, and their glob helpers) until picomatch publishes a fix. CI runs `npm audit --omit=dev --audit-level=high`, which is clean after the overrides above, and fails on a new high or critical finding in a runtime dependency.

## Interim on-call

Repository owner: Chen Chiu.

First responder: DevOps.
