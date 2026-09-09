# Campaign storyboard

Static HTML frames plus live product screenshots used in the CORE README.

## README images (live app)

These files are what `README.md` embeds. Recapture them on DEVELOPMENT (`ROSTER_SKIP_ONBOARDING=1 npm run standup` then `docs/campaign/capture.sh`) and copy onto CORE. Do not overwrite `campaign-hero.png` or `campaign-why.png` with the HTML storyboard capture.

| File |
| --- |
| `docs/images/campaign-hero.png` |
| `docs/images/campaign-why.png` |
| `docs/images/campaign-orchestration.png` |
| `docs/images/chat-room.png` |
| `docs/images/chat-harness.png` |
| `docs/images/chat-chart.png` |
| `docs/images/setup-install.png` |
| `docs/images/setup-owner.png` |
| `docs/images/setup-signin.png` |
| `docs/images/setup-harness.png` |
| `docs/images/setup-welcome.png` |
| `docs/images/login.png` |

## Extra HTML frames

`./capture.sh` also writes storyboard-only PNGs. Keep these; they are not in the product README.

| File | Output PNG |
| --- | --- |
| `frames/seats.html` | `docs/images/campaign-seats.png` |
| `frames/timeline.html` | `docs/images/campaign-timeline.png` |
| `frames/room.html` | `docs/images/campaign-room.png` |

HTML `frames/hero.html` and `frames/why.html` exist for the storyboard, but running `./capture.sh` on CORE would clobber the live hero/why shots the README shows. Restore those two files from DEVELOPMENT after a full capture.

## Capture

```bash
cd docs/campaign
./capture.sh
```

Requires network once for Google Fonts (or frames fall back to system fonts). Uses Playwright via a temp install when available.
