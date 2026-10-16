# Contributing

PRs for the runnable app target **`DEVELOPMENT`**.

## Default branch

The GitHub default branch for clone-and-run should be **`DEVELOPMENT`**. That is a repository setting (Settings → General → Default branch). Agents and PRs cannot click it.

Until an admin switches it, `git clone` without `--branch` may still land on `CORE` (docs only). Then `git checkout DEVELOPMENT`. After the switch, the same clone runs `npm run standup` with no extra flag.

`CORE` remains the methodology branch. Do not delete it. Do not assume GitHub’s default is permanently `CORE` in README / INSTALLATION / campaign pages.

## Tests

```bash
npm run test:unit
npx tsc -b
npx playwright test
```
