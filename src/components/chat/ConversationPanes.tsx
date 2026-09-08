import { fileTestId, type Msg } from "../../data";
import { matchesSearch } from "../../lib/search";

export { matchesSearch };

export function FilesLinksPane({ messages }: { messages: Msg[] }) {
  const files = messages.flatMap((m) =>
    (m.files || []).map((f) => ({
      key: `file-${m.id}-${f.path}`,
      name: f.name,
      detail: f.path,
      testId: `files-file-${fileTestId(f.path)}`,
    })),
  );
  const attachments = messages.flatMap((m) =>
    (m.attachments || []).map((a) => ({
      key: `att-${m.id}-${a.id}`,
      name: a.name,
      detail: a.type || "attachment",
      testId: `files-att-${a.id}`,
    })),
  );
  const items = [...files, ...attachments];

  return (
    <div className="conversation-files" data-testid="conversation-files">
      {items.length === 0 ? (
        <p className="micro">No files or links in this conversation.</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.key} data-testid={item.testId}>
              <strong>{item.name}</strong>
              <span className="dim">{item.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
