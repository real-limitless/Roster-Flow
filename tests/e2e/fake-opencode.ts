import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

/**
 * A stand-in for `opencode serve`. CORE adopts any healthy serve already on the
 * preferred port (14180 company, 14181 System), so e2e can drive real wakes
 * without the OpenCode binary or a provider.
 */
export type FakePrompt = { sessionId: string; title: string; agent?: string; model?: unknown; text: string };
type Part = { type: string; text: string };
type Msg = { info: { id: string; sessionID?: string; role: string; time: { created: number; completed?: number }; providerID?: string; modelID?: string }; parts: Part[] };

export type FakeOpenCode = {
  port: number;
  prompts: FakePrompt[];
  sessions: Map<string, { id: string; title: string; messages: Msg[] }>;
  close: () => Promise<void>;
};

export async function startFakeOpenCode(opts: {
  port: number;
  providers: Record<string, string[]>;
  reply: (prompt: FakePrompt) => string | null;
  delayMs?: number;
}): Promise<FakeOpenCode> {
  const sessions: FakeOpenCode["sessions"] = new Map();
  const prompts: FakePrompt[] = [];
  let n = 0;
  const streams = new Set<ServerResponse>();
  const publish = (evt: unknown) => {
    for (const res of streams) res.write(`data: ${JSON.stringify(evt)}\n\n`);
  };
  const send = (res: ServerResponse, status: number, body?: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(body === undefined ? "" : JSON.stringify(body));
  };
  const read = (req: IncomingMessage) =>
    new Promise<Record<string, unknown>>((resolve) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c as Buffer));
      req.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
        } catch {
          resolve({});
        }
      });
    });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const path = url.pathname;
    const method = req.method || "GET";
    if (path === "/global/health") return send(res, 200, { healthy: true, version: "fake-1.19" });
    if (path === "/config/providers") {
      return send(res, 200, {
        providers: Object.entries(opts.providers).map(([id, models]) => ({ id, models: Object.fromEntries(models.map((m) => [m, { id: m }])) })),
        default: {},
      });
    }
    if (path === "/session/status") return send(res, 200, {});
    if (path === "/event") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      res.write(`data: ${JSON.stringify({ type: "server.connected", properties: {} })}\n\n`);
      streams.add(res);
      req.on("close", () => streams.delete(res));
      return;
    }
    if (path === "/session" && method === "GET") return send(res, 200, [...sessions.values()].map(({ id, title }) => ({ id, title })));
    if (path === "/session" && method === "POST") {
      const body = await read(req);
      const id = `ses_fake_${++n}`;
      sessions.set(id, { id, title: String(body.title || id), messages: [] });
      return send(res, 200, { id, title: body.title || id });
    }
    const m = path.match(/^\/session\/([^/]+)(?:\/(message|prompt_async|abort))?$/);
    const ses = m ? sessions.get(m[1]) : undefined;
    if (m && !ses) return send(res, 404, { name: "NotFoundError", data: { message: "session not found" } });
    if (m && ses && !m[2] && method === "DELETE") {
      sessions.delete(ses.id);
      return send(res, 200, true);
    }
    if (m && ses && m[2] === "message" && method === "GET") return send(res, 200, ses.messages);
    if (m && ses && m[2] === "abort") return send(res, 200, true);
    if (m && ses && m[2] === "prompt_async" && method === "POST") {
      const body = await read(req);
      const parts = (body.parts as Part[] | undefined) || [];
      const text = parts.map((p) => p.text || "").join("\n");
      const prompt: FakePrompt = { sessionId: ses.id, title: ses.title, agent: body.agent as string | undefined, model: body.model, text };
      prompts.push(prompt);
      ses.messages.push({ info: { id: `msg_u_${++n}`, role: "user", time: { created: Date.now() } }, parts: [{ type: "text", text }] });
      const answer = opts.reply(prompt);
      setTimeout(() => {
        // OpenCode reports a completed assistant turn once the provider answers; a null reply is a turn with nothing to post.
        const now = Date.now();
        const info = { id: `msg_a_${++n}`, sessionID: ses.id, role: "assistant", time: { created: now, completed: now } };
        if (answer) ses.messages.push({ info, parts: [{ type: "text", text: answer }] });
        publish({ type: "message.updated", properties: { sessionID: ses.id, info } });
        publish({ type: "session.idle", properties: { sessionID: ses.id } });
      }, opts.delayMs ?? 150);
      res.writeHead(204);
      return res.end();
    }
    return send(res, 404, { name: "NotFoundError", data: { message: `${method} ${path}` } });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, "127.0.0.1", () => resolve());
  });
  return {
    port: opts.port,
    prompts,
    sessions,
    close: () =>
      new Promise<void>((resolve) => {
        for (const res of streams) res.end();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
