const base = (import.meta.env.VITE_API_URL as string | undefined) || "";
const TOKEN_KEY = "roster-flow-token";

export type SetupStatus = {
  skip: boolean;
  hasUser: boolean;
  authenticated: boolean;
  harnessReady: boolean;
  complete: boolean;
  step: "install" | "first_user" | "login" | "harness" | "welcome" | "done";
  checks: { api: boolean; opencode: boolean; providerKeys: boolean; dataDir: boolean };
  binary: string | null;
  email?: string | null;
  name?: string | null;
};

export type AuthUser = { id: string; name: string; email: string; role: string; seatId: string };

export function getAuthToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function setAuthToken(token: string) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const token = getAuthToken();
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${base}${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText);
  return data as T;
}

export const api = {
  health: () => req<{ ok: boolean; harness: string }>("/api/v1/health"),
  state: () =>
    req<{
      seats: import("../data").Seat[];
      channels: import("../data").Channel[];
      messages: import("../data").Msg[];
      teams?: import("../data").Team[];
      projects?: import("../data").Project[];
      organizations?: import("../data").Organization[];
      goals?: import("../data").Goal[];
      approvals?: import("../data").Approval[];
      routines?: import("../data").Routine[];
      inboxUnread?: Record<string, number>;
      inboxCursors?: Record<string, string>;
      tasks?: import("../data").Task[];
    }>("/api/v1/state"),
  goals: () => req<import("../data").Goal[]>("/api/v1/goals"),
  createGoal: (body: unknown) =>
    req<import("../data").Goal>("/api/v1/goals", { method: "POST", body: JSON.stringify(body) }),
  inbox: (id: string) =>
    req<{ seatId: string; cursor: string | null; items: Array<Record<string, unknown> & { unread?: boolean; text?: string; from?: string; to?: string; kind?: string; id: string }>; unread: number }>(
      `/api/v1/seats/${id}/inbox`,
    ),
  markInboxRead: (id: string, beforeId?: string) =>
    req<{ unread: number; cursor: string | null }>(`/api/v1/seats/${id}/inbox/read`, {
      method: "POST",
      body: JSON.stringify({ beforeId }),
    }),
  pauseSeat: (id: string) => req<import("../data").Seat>(`/api/v1/seats/${id}/pause`, { method: "POST", body: "{}" }),
  resumeSeat: (id: string) => req<import("../data").Seat>(`/api/v1/seats/${id}/resume`, { method: "POST", body: "{}" }),
  pauseTeam: (id: string) =>
    req<{ team: import("../data").Team; seats: import("../data").Seat[] }>(`/api/v1/teams/${id}/pause`, {
      method: "POST",
      body: "{}",
    }),
  killRun: (runId: string) =>
    req<{ runId: string; paused: boolean }>(`/api/v1/runs/${encodeURIComponent(runId)}/kill`, {
      method: "POST",
      body: "{}",
    }),
  tasks: (query: { projectId?: string; runId?: string } = {}) => {
    const params = new URLSearchParams();
    if (query.projectId) params.set("projectId", query.projectId);
    if (query.runId) params.set("runId", query.runId);
    const q = params.toString();
    return req<import("../data").Task[]>(`/api/v1/tasks${q ? `?${q}` : ""}`);
  },
  createTask: (body: unknown) => req<import("../data").Task>("/api/v1/tasks", { method: "POST", body: JSON.stringify(body) }),
  claimTask: (id: string, seatId: string) =>
    req<import("../data").Task>(`/api/v1/tasks/${encodeURIComponent(id)}/claim`, {
      method: "POST",
      body: JSON.stringify({ seatId }),
    }),
  completeTask: (id: string, seatId?: string) =>
    req<import("../data").Task>(`/api/v1/tasks/${encodeURIComponent(id)}/complete`, {
      method: "POST",
      body: JSON.stringify({ seatId }),
    }),
  approvals: (status?: string) =>
    req<import("../data").Approval[]>(`/api/v1/approvals${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  createApproval: (body: unknown) =>
    req<import("../data").Approval>("/api/v1/approvals", { method: "POST", body: JSON.stringify(body) }),
  approveApproval: (id: string) =>
    req<{ approval: import("../data").Approval; seats?: import("../data").Seat[] }>(`/api/v1/approvals/${id}/approve`, {
      method: "POST",
      body: "{}",
    }),
  rejectApproval: (id: string) =>
    req<{ approval: import("../data").Approval }>(`/api/v1/approvals/${id}/reject`, { method: "POST", body: "{}" }),
  routines: () => req<import("../data").Routine[]>("/api/v1/routines"),
  createRoutine: (body: unknown) =>
    req<import("../data").Routine>("/api/v1/routines", { method: "POST", body: JSON.stringify(body) }),
  patchRoutine: (id: string, body: unknown) =>
    req<import("../data").Routine>(`/api/v1/routines/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  runRoutine: (id: string) =>
    req<{ bus?: { id: string; to: string; text: string }; prompt: string }>(`/api/v1/routines/${id}/run`, {
      method: "POST",
      body: "{}",
    }),
  seats: () => req<import("../data").Seat[]>("/api/v1/seats"),
  teams: () => req<import("../data").Team[]>("/api/v1/teams"),
  projects: () => req<import("../data").Project[]>("/api/v1/projects"),
  createProject: (body: unknown) =>
    req<import("../data").Project>("/api/v1/projects", { method: "POST", body: JSON.stringify(body) }),
  patchProject: (id: string, body: unknown) =>
    req<import("../data").Project>(`/api/v1/projects/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  createTeam: (body: unknown) =>
    req<{ team: import("../data").Team; seats: import("../data").Seat[] }>("/api/v1/teams", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  patchTeam: (id: string, body: unknown) =>
    req<import("../data").Team>(`/api/v1/teams/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  channels: () => req<import("../data").Channel[]>("/api/v1/channels"),
  createChannel: (body: unknown) =>
    req<import("../data").Channel>("/api/v1/channels", { method: "POST", body: JSON.stringify(body) }),
  patchChannel: (id: string, body: unknown) =>
    req<import("../data").Channel>(`/api/v1/channels/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  messages: (channel: string) => req<import("../data").Msg[]>(`/api/v1/channels/${channel}/messages`),
  attach: (id: string) =>
    req<{
      seat: string;
      sessionId?: string;
      attach?: string | null;
      paused?: boolean;
      reason?: string;
      harness?: { harness: string; port?: number };
    }>(
      `/api/v1/seats/${id}/attach`,
      { method: "POST", body: JSON.stringify({}) },
    ),
  postMessage: (
    channel: string,
    text: string,
    extra: {
      who?: string;
      seatId?: string;
      attachments?: import("../data").MsgAttachment[];
      skills?: import("../data").MsgSkill[];
      files?: import("../data").MsgFile[];
      blocks?: import("roster-flow-blocks").Block[];
    } = {},
  ) =>
    req<{ id?: string; messages?: import("../data").Msg[]; text?: string }>(
      `/api/v1/channels/${channel}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          text,
          who: extra.who || "You",
          seatId: extra.seatId || "you",
          attachments: extra.attachments,
          skills: extra.skills,
          files: extra.files,
          blocks: extra.blocks,
        }),
      },
    ),
  blockAction: (body: { messageId: string; actionId: string; value?: string; userId?: string }) =>
    req("/api/v1/block-actions", { method: "POST", body: JSON.stringify(body) }),
  hire: (seat: unknown) => req("/api/v1/seats", { method: "POST", body: JSON.stringify(seat) }),
  fire: (id: string) => req<{ id: string; reparentedTo?: string }>(`/api/v1/seats/${id}`, { method: "DELETE" }),
  patchSeat: (id: string, body: unknown) =>
    req(`/api/v1/seats/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  architectChat: (message: string, history: Array<{ role: string; text: string }> = []) =>
    req<{
      reply: string;
      source?: string;
      plan: {
        id: string;
        summary: string;
        rationale: string[];
        reply: string;
        ops: Array<Record<string, unknown>>;
      } | null;
    }>("/api/v1/architect/chat", { method: "POST", body: JSON.stringify({ message, history }) }),
  architectApply: (planId: string) =>
    req<{
      plan: { id: string; status?: string };
      seats: import("../data").Seat[];
      teams: import("../data").Team[];
      projects: import("../data").Project[];
    }>("/api/v1/architect/apply", { method: "POST", body: JSON.stringify({ planId }) }),
  providers: () =>
    req<
      Array<{
        id: string;
        name: string;
        npm: string;
        baseURL: string;
        models: Array<{ id: string; name: string }>;
        apiKeyEnv: string;
        connected: boolean;
      }>
    >("/api/v1/providers"),
  upsertProvider: (body: unknown) => req("/api/v1/providers", { method: "PUT", body: JSON.stringify(body) }),
  setAuth: (id: string, apiKey: string) =>
    req<{ id: string; stored: boolean }>(`/api/v1/providers/${id}/auth`, {
      method: "POST",
      body: JSON.stringify({ apiKey }),
    }),
  deleteProvider: (id: string) => req(`/api/v1/providers/${id}`, { method: "DELETE" }),
  models: () => req<Array<{ providerID: string; modelID: string; name: string }>>("/api/v1/models"),
  harness: () =>
    req<{
      kind?: string;
      harness: string;
      binary?: string | null;
      port?: number | null;
      version?: string | null;
      workspace?: string;
      plugin?: string;
      pid?: number | null;
      systemHarness?: {
        kind?: string;
        harness: string;
        binary?: string | null;
        port?: number | null;
        version?: string | null;
        workspace?: string;
        plugin?: string;
        pid?: number | null;
      };
    }>("/api/v1/harness"),
  ensure: (kind?: "company" | "system", opts?: { forceRestart?: boolean }) =>
    req("/api/v1/harness/ensure", {
      method: "POST",
      body: JSON.stringify({ kind, forceRestart: Boolean(opts?.forceRestart) }),
    }),
  debugTrace: (query: { since?: string; channel?: string; scope?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (query.since) params.set("since", query.since);
    if (query.channel) params.set("channel", query.channel);
    if (query.scope) params.set("scope", query.scope);
    if (query.limit) params.set("limit", String(query.limit));
    const q = params.toString();
    return req<{
      events: Array<{
        id: string;
        ts: string;
        level: string;
        scope: string;
        step: string;
        channel: string | null;
        seat: string | null;
        detail: Record<string, unknown>;
      }>;
      harness: string;
      systemHarness?: { harness: string };
      providerKeys?: boolean;
    }>(`/api/v1/debug/trace${q ? `?${q}` : ""}`);
  },
  setupStatus: () => req<SetupStatus>("/api/v1/setup/status"),
  setupInstall: () => req<SetupStatus>("/api/v1/setup/install", { method: "POST", body: "{}" }),
  setupFirstUser: (body: { name: string; email: string; password: string }) =>
    req<{ user: AuthUser }>("/api/v1/setup/first-user", { method: "POST", body: JSON.stringify(body) }),
  setupHarness: (skipped = false) =>
    req<SetupStatus>("/api/v1/setup/harness", { method: "POST", body: JSON.stringify({ skipped }) }),
  setupComplete: (template: "starter" | "empty") =>
    req<SetupStatus & { state?: unknown }>("/api/v1/setup/complete", {
      method: "POST",
      body: JSON.stringify({ template }),
    }),
  login: (email: string, password: string) =>
    req<{ token: string; user: AuthUser }>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  me: () => req<AuthUser>("/api/v1/auth/me"),
  logout: () => req<{ ok: boolean }>("/api/v1/auth/logout", { method: "POST", body: "{}" }),
  harnessSessions: () =>
    req<{
      sessions: Array<{
        id: string;
        title: string;
        agent: string | null;
        harness: string;
        seatId: string | null;
        channel: string | null;
      }>;
    }>("/api/v1/harness/sessions"),
  familyStatus: () =>
    req<{
      mcpFlow: { url: string; ok: boolean; status?: number; error?: string; admin: boolean };
      skillFlow: { url: string; bin: string; ok: boolean; status?: number; error?: string };
    }>("/api/v1/family/status"),
  familySkillAudit: (source: string) =>
    req<{ ok: boolean; json?: unknown; stderr?: string; error?: string }>("/api/v1/family/skills/audit", {
      method: "POST",
      body: JSON.stringify({ source }),
    }),
  familySkillInstall: (source: string) =>
    req<{ ok: boolean; json?: unknown; stderr?: string; error?: string }>("/api/v1/family/skills/install", {
      method: "POST",
      body: JSON.stringify({ source, confirm: true }),
    }),
  familyMcpBackends: () =>
    req<{ ok: boolean; backends: unknown[]; error?: string }>("/api/v1/family/mcp/backends"),
  familyRegisterMcp: (body: { slug: string; url?: string; command?: string[]; title?: string }) =>
    req<{ ok: boolean; backend?: unknown; error?: string }>("/api/v1/family/mcp/backends", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
