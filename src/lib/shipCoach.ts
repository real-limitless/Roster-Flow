export const SHIP_SENTENCE =
  "Talk to Product and the Eng team. When they complete, have DevOps deploy to staging and QA test everything.";

export const SHIP_PATH = ["product", "eng-supervisor", "build", "review", "devops", "qa"];

export const COACH_KEY = "roster-flow.ship-coach";

export function loadCoachOpen() {
  try {
    return localStorage.getItem(COACH_KEY) !== "off";
  } catch {
    return true;
  }
}

export function saveCoachOpen(open: boolean) {
  try {
    if (open) localStorage.removeItem(COACH_KEY);
    else localStorage.setItem(COACH_KEY, "off");
  } catch {
    /* ignore */
  }
}
