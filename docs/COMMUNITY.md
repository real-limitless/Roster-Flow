# Community

The public room is [GitHub Discussions](https://github.com/real-limitless/Roster-Flow/discussions) (Q&A, Show and tell). Discord is not a second home until a real invite exists.

Enabling Discussions is a repo **admin** toggle (`Settings → General → Features → Discussions`). Until that is on, the URL above is the destination; pin the topic below as soon as it is.

## Pin: How to standup on DEVELOPMENT

**Title:** How to standup on DEVELOPMENT

```bash
git clone https://github.com/real-limitless/Roster-Flow.git
cd Roster-Flow
git checkout DEVELOPMENT
npm install
npx playwright install chromium
npm run standup
```

Then http://127.0.0.1:5173/setup (install → owner → login → harness → welcome) or `ROSTER_SKIP_ONBOARDING=1` for Playwright.

- Product branch is **DEVELOPMENT**. `CORE` is consensus only.
- Full notes: [STANDUP.md](STANDUP.md)

## Office hours

Not listed on `/changelog` or `/access` until a recurring agenda exists. When it does: 20 minutes Room, 10 minutes Chart hire, 10 minutes attach.
