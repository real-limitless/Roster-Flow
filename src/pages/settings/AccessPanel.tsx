import { useEffect, useState } from "react";
import { api, type AccessRequest } from "../../lib/api";

export function AccessPanel({ onError }: { onError: (message: string) => void }) {
  const [rows, setRows] = useState<AccessRequest[]>([]);

  useEffect(() => {
    void api
      .accessRequests()
      .then((body) => setRows(Array.isArray(body.requests) ? body.requests : []))
      .catch((e) => onError(e instanceof Error ? e.message : "Could not load access requests"));
  }, []);

  return (
    <section className="settings-pane" data-testid="settings-access">
      <div className="settings-head">
        <h1>Access</h1>
        <p className="micro">
          Public <code>POST /api/v1/access</code> from the marketing form. Stored in CORE <code>accessRequests[]</code>.
          No mail is sent.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="micro" data-testid="access-empty">
          No requests yet.
        </p>
      ) : (
        <div className="card">
          {rows.map((row) => (
            <div key={row.id} className="card" data-testid={`access-row-${row.id}`} style={{ marginBottom: 12 }}>
              <h3 style={{ marginBottom: 4 }}>
                {row.name} · {row.email}
              </h3>
              <p className="micro">
                {row.company}
                {row.role ? ` · ${row.role}` : ""}
                {row.size ? ` · ${row.size}` : ""}
              </p>
              {row.replace ? <p className="micro">Replace first: {row.replace}</p> : null}
              {row.note ? <p>{row.note}</p> : null}
              <p className="micro">{row.updatedAt}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
