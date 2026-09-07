# Campaign screenshots

Live captures of the marketing site and the Room / Harness / Chart workspace. Used on the root README the same way [mcp-flow](https://github.com/real-limitless/mcp-flow) uses `docs/images/campaign-*.png`.

## Frames

| File | Source |
| --- | --- |
| `docs/images/campaign-hero.png` | `/` hero — Room · Harness · Chart |
| `docs/images/campaign-why.png` | `/` problem section |
| `docs/images/campaign-orchestration.png` | `/orchestration` run story |
| `docs/images/chat-room.png` | `/app` Room (`#ship`) |
| `docs/images/chat-harness.png` | `/harness` mock TUI (`opencode attach eng.build`) |
| `docs/images/chat-chart.png` | `/app?mode=chart` |

## Capture

```bash
npm run standup          # if the site is not already up
cd docs/campaign
./capture.sh
```

Requires the marketing + workspace client on `BASE_URL` (default `http://127.0.0.1:5173`). Uses the repo Playwright install.

## Story

1. **Hero** — staff an org of OpenCode agents; talk in a room or open the harness
2. **Why** — agents and tools do not share a floor
3. **Orchestration** — Floor compiles a sentence into a run you still own
4. **Room** — humans and bots in one channel; the thread is the audit log
5. **Harness** — the same seat opens as a real OpenCode session
6. **Chart** — reporting lines are the control plane
