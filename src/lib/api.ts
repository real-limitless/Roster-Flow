const base = (import.meta.env.VITE_API_URL as string | undefined) || "";

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(`${base}${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data as T;
}

export const api = {
  health: () => req<{ ok: boolean; harness: string }>("/api/v1/health"),
  state: () =>
    req<{
      seats: import("../data").Seat[];
      channels: import("../data").Channel[];
      messages: import("../data").Msg[];
      runs: Array<{ id: string; step: number; status: string }>;
    }>("/api/v1/state"),
  seats: () => req<import("../data").Seat[]>("/api/v1/seats"),
  channels: () => req<import("../data").Channel[]>("/api/v1/channels"),
  messages: (channel: string) => req<import("../data").Msg[]>(`/api/v1/channels/${channel}/messages`),
  postMessage: (channel: string, text: string) =>
    req(`/api/v1/channels/${channel}/messages`, { method: "POST", body: JSON.stringify({ text, who: "You" }) }),
  startRun: (prompt: string) => req(`/api/v1/runs`, { method: "POST", body: JSON.stringify({ prompt, channel: "ship" }) }),
  runs: () => req<Array<{ id: string; step: number; status: string }>>("/api/v1/runs"),
  hire: (seat: unknown) => req("/api/v1/seats", { method: "POST", body: JSON.stringify(seat) }),
  patchSeat: (id: string, body: unknown) =>
    req(`/api/v1/seats/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
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
  deleteProvider: (id: string) => req(`/api/v1/providers/${id}`, { method: "DELETE" }),
  models: () => req<Array<{ providerID: string; modelID: string; name: string }>>("/api/v1/models"),
  harness: () => req<{ harness: string; version: string | null }>("/api/v1/harness"),
  ensure: () => req("/api/v1/harness/ensure", { method: "POST", body: JSON.stringify({}) }),
};
