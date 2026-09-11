function nid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function field(body, key, { required = false, max = 240 } = {}) {
  const value = String(body?.[key] || "").trim().slice(0, max);
  if (required && !value) fail(400, `${key} required`);
  return value;
}

export function listAccessRequests(state) {
  return [...(state.accessRequests || [])].sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

export function createAccessRequest(state, body = {}) {
  const email = normalizeEmail(field(body, "email", { required: true, max: 320 }));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, "email required");
  const name = field(body, "name", { required: true });
  const company = field(body, "company", { required: true });
  const now = new Date().toISOString();
  const next = {
    name,
    email,
    company,
    role: field(body, "role"),
    size: field(body, "size", { max: 32 }),
    replace: field(body, "replace"),
    note: field(body, "note", { max: 4000 }),
    updatedAt: now,
  };
  const list = [...(state.accessRequests || [])];
  const idx = list.findIndex((row) => normalizeEmail(row.email) === email);
  if (idx >= 0) {
    const row = { ...list[idx], ...next, id: list[idx].id, createdAt: list[idx].createdAt || now };
    list[idx] = row;
    state.accessRequests = list;
    return { ...row, updated: true };
  }
  const row = { id: nid("access"), ...next, createdAt: now };
  state.accessRequests = [...list, row];
  return { ...row, updated: false };
}
