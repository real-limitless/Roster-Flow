import { FormEvent, useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { Routine, Seat } from "../../data";

export function RoutinesPanel({
  seats,
  onError,
}: {
  seats: Seat[];
  onError: (message: string) => void;
}) {
  const bots = seats.filter((s) => s.kind === "bot");
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [title, setTitle] = useState("Standup ping");
  const [seatId, setSeatId] = useState(bots[0]?.id || "product");
  const [prompt, setPrompt] = useState("Post a short standup.");
  const [intervalMinutes, setIntervalMinutes] = useState(60);
  const [busy, setBusy] = useState("");

  async function refresh() {
    try {
      const list = await api.routines();
      setRoutines(Array.isArray(list) ? list : []);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not load routines");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!bots.some((s) => s.id === seatId) && bots[0]) setSeatId(bots[0].id);
  }, [bots, seatId]);

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      await api.createRoutine({ title, seatId, prompt, intervalMinutes, enabled: true });
      setTitle("");
      await refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not create routine");
    }
  }

  async function toggle(r: Routine, enabled: boolean) {
    try {
      await api.patchRoutine(r.id, { enabled });
      await refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not update routine");
    }
  }

  async function testRun(id: string) {
    setBusy(id);
    try {
      await api.runRoutine(id);
      await refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Test run failed");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="settings-pane" data-testid="settings-routines">
      <div className="settings-head">
        <h1>Routines</h1>
        <p className="micro">
          CORE ticks enabled routines while it is up. A run is a bus wake, skipped when the seat is paused or the prompt
          implies deploy on a seat that denies it.
        </p>
      </div>
      <form className="card" data-testid="routine-create" onSubmit={(e) => void create(e)} style={{ marginBottom: 16 }}>
        <h3>New routine</h3>
        <label className="kv-label">
          Title
          <input data-testid="routine-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label className="kv-label">
          Seat
          <select data-testid="routine-seat" value={seatId} onChange={(e) => setSeatId(e.target.value)}>
            {bots.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="kv-label">
          Interval (minutes)
          <input
            data-testid="routine-interval"
            type="number"
            min={1}
            value={intervalMinutes}
            onChange={(e) => setIntervalMinutes(Number(e.target.value) || 60)}
          />
        </label>
        <label className="kv-label">
          Prompt
          <textarea data-testid="routine-prompt" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </label>
        <div className="settings-actions">
          <button className="pill-btn primary" data-testid="routine-create-submit" type="submit">
            Create
          </button>
        </div>
      </form>
      {routines.length === 0 && <p className="micro">No routines yet. Create one to test a wake.</p>}
      <div className="settings-grid">
        {routines.map((r) => (
          <div className="card" key={r.id} data-testid={`routine-card-${r.id}`}>
            <h3>{r.title}</h3>
            <p className="micro">
              {r.seatId} · every {r.intervalMinutes}m
            </p>
            <div className="kv">
              <span>Enabled</span>
              <b>{r.enabled ? "yes" : "paused"}</b>
            </div>
            <div className="kv">
              <span>Last run</span>
              <b data-testid={`routine-last-${r.id}`}>{r.lastRunAt || "—"}</b>
            </div>
            <div className="kv">
              <span>Last error</span>
              <b>{r.lastError || "—"}</b>
            </div>
            <div className="settings-actions">
              <button className="pill-btn" type="button" onClick={() => void toggle(r, !r.enabled)}>
                {r.enabled ? "Pause" : "Enable"}
              </button>
              <button
                className="pill-btn primary"
                type="button"
                data-testid={`routine-run-${r.id}`}
                disabled={busy === r.id}
                onClick={() => void testRun(r.id)}
              >
                {busy === r.id ? "Running…" : "Test run"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
