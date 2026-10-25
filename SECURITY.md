# Security

## Reporting a vulnerability

Report a vulnerability through a private GitHub security advisory on this repository. Do not open a public issue, pull request, or commit for an unfixed vulnerability. Include what you can about impact and how to reproduce it, without sending secrets, tokens, or passwords.

## Kill switch

Use these in order when access has to be cut. Details for the API calls are in [docs/API.md](docs/API.md).

1. **Revoke API tokens.** `DELETE /api/v1/tokens/:id` revokes one token. The caller needs an owner or admin session, or an API token with the `admin` scope. A revoked token then receives **401**.

2. **Rotate the callback secret.** `POST /api/v1/jobs/callback-secret/rotate` replaces the instance HMAC secret. The same owner or admin gate as the read route applies. The previous secret stays valid only until `ROSTER_CALLBACK_GRACE_MS` (default 10 minutes, maximum 24 hours). A second rotate drops the secret from before the first rotate immediately. If `ROSTER_CALLBACK_SECRET` is set in the environment, rotate returns **409**; change that value and restart the process.

3. **Revoke every session.** Stop the process, then run `npm run owner:reset` (it prompts, or take `--password` / `OWNER_RESET_PASSWORD`). That rewrites the owner password hash and revokes all sessions. It does not delete seats or runs.

4. **Stop the service** in the hosting platform so it stops accepting traffic.

## Interim on-call

Repository owner: Chen Chiu.

First responder: DevOps.
