/** Roster Block Kit — Slack-shaped blocks for bot messages. */

export const MAX_BLOCKS = 50;
export const BLOCK_TYPES = Object.freeze(["header", "section", "divider", "context", "image", "actions", "markdown"]);

function clip(value, n) {
  return String(value ?? "").slice(0, n);
}

export const Elements = {
  plainText(text) {
    return { type: "plain_text", text: String(text ?? "") };
  },
  mrkdwn(text) {
    return { type: "mrkdwn", text: String(text ?? "") };
  },
  image({ imageUrl, altText } = {}) {
    return { type: "image", image_url: String(imageUrl || ""), alt_text: String(altText || "") };
  },
  button({ text, actionId, value, url, style } = {}) {
    const out = {
      type: "button",
      text: typeof text === "string" ? Elements.plainText(text) : text || Elements.plainText("Button"),
    };
    if (actionId) out.action_id = String(actionId);
    if (value != null && value !== "") out.value = String(value);
    if (url) out.url = String(url);
    if (style === "primary" || style === "danger") out.style = style;
    return out;
  },
};

export const Blocks = {
  header(text) {
    return { type: "header", text: typeof text === "string" ? Elements.plainText(text) : text };
  },
  section({ text, fields, accessory } = {}) {
    const out = { type: "section" };
    if (text != null) out.text = typeof text === "string" ? Elements.mrkdwn(text) : text;
    if (fields?.length) {
      out.fields = fields.map((f) => (typeof f === "string" ? Elements.mrkdwn(f) : f));
    }
    if (accessory) out.accessory = accessory;
    return out;
  },
  divider() {
    return { type: "divider" };
  },
  context(elements = []) {
    return {
      type: "context",
      elements: (Array.isArray(elements) ? elements : []).map((e) => (typeof e === "string" ? Elements.mrkdwn(e) : e)),
    };
  },
  image({ imageUrl, altText, title } = {}) {
    const out = { type: "image", image_url: String(imageUrl || ""), alt_text: String(altText || "") };
    if (title) out.title = typeof title === "string" ? Elements.plainText(title) : title;
    return out;
  },
  actions(elements = []) {
    return { type: "actions", elements: Array.isArray(elements) ? elements : [] };
  },
  markdown(text) {
    return { type: "markdown", text: String(text ?? "") };
  },
};

export function defaultBlock(type) {
  switch (type) {
    case "header":
      return Blocks.header("Header");
    case "section":
      return Blocks.section({ text: "*Section* text with optional fields." });
    case "divider":
      return Blocks.divider();
    case "context":
      return Blocks.context(["Context line"]);
    case "image":
      return Blocks.image({ imageUrl: "https://placehold.co/600x200/10161f/e8eef6?text=Image", altText: "Placeholder" });
    case "actions":
      return Blocks.actions([Elements.button({ text: "Click", actionId: "click", value: "1" })]);
    case "markdown":
      return Blocks.markdown("**Markdown** block.");
    default:
      return Blocks.section({ text: "Untitled" });
  }
}

function asText(obj, { allowMrkdwn = true, required = true } = {}) {
  if (obj == null) return required ? null : undefined;
  if (typeof obj === "string") {
    const text = obj.trim();
    if (!text && required) return null;
    return { type: allowMrkdwn ? "mrkdwn" : "plain_text", text };
  }
  if (typeof obj !== "object") return null;
  const type = obj.type === "mrkdwn" && allowMrkdwn ? "mrkdwn" : "plain_text";
  const text = clip(obj.text, 3000);
  if (!text && required) return null;
  return { type, text };
}

function asImageEl(el) {
  const url = clip(el.image_url || el.imageUrl, 2000);
  const alt = clip(el.alt_text || el.altText, 200);
  if (!url) return null;
  return { type: "image", image_url: url, alt_text: alt || "image" };
}

function asButton(el) {
  if (!el || el.type !== "button") return { error: "element must be a button" };
  const text = asText(el.text, { allowMrkdwn: false });
  if (!text) return { error: "button needs text" };
  const out = { type: "button", text };
  if (el.action_id) out.action_id = clip(el.action_id, 64);
  if (el.value != null && el.value !== "") out.value = clip(el.value, 240);
  if (el.url) out.url = clip(el.url, 500);
  if (el.style === "primary" || el.style === "danger") out.style = el.style;
  return { ok: out };
}

function normalizeBlock(block, i) {
  if (!block || typeof block !== "object") return { error: `block ${i} is not an object` };
  const type = block.type;
  if (!BLOCK_TYPES.includes(type)) return { error: `block ${i}: unknown type ${type}` };

  if (type === "divider") return { ok: { type: "divider" } };

  if (type === "header") {
    const text = asText(block.text, { allowMrkdwn: false });
    if (!text) return { error: `block ${i}: header needs text` };
    return { ok: { type: "header", text } };
  }

  if (type === "markdown") {
    const text = clip(block.text, 8000);
    if (!text) return { error: `block ${i}: markdown needs text` };
    return { ok: { type: "markdown", text } };
  }

  if (type === "image") {
    const img = asImageEl(block);
    if (!img) return { error: `block ${i}: image needs image_url` };
    const out = { ...img };
    if (block.title) {
      const title = asText(block.title, { allowMrkdwn: false, required: false });
      if (title) out.title = title;
    }
    return { ok: out };
  }

  if (type === "section") {
    const text = asText(block.text, { required: false });
    const fields = Array.isArray(block.fields)
      ? block.fields.map((f) => asText(f)).filter(Boolean).slice(0, 10)
      : [];
    if (!text && !fields.length) return { error: `block ${i}: section needs text or fields` };
    const out = { type: "section" };
    if (text) out.text = text;
    if (fields.length) out.fields = fields;
    if (block.accessory) {
      const acc = asButton(block.accessory);
      if (acc.error) return { error: `block ${i}: ${acc.error}` };
      out.accessory = acc.ok;
    }
    return { ok: out };
  }

  if (type === "context") {
    const raw = Array.isArray(block.elements) ? block.elements : [];
    const elements = [];
    for (const el of raw.slice(0, 10)) {
      if (el?.type === "image") {
        const img = asImageEl(el);
        if (img) elements.push(img);
      } else {
        const t = asText(el);
        if (t) elements.push(t);
      }
    }
    if (!elements.length) return { error: `block ${i}: context needs elements` };
    return { ok: { type: "context", elements } };
  }

  if (type === "actions") {
    const raw = Array.isArray(block.elements) ? block.elements : [];
    const elements = [];
    for (const el of raw.slice(0, 5)) {
      const btn = asButton(el);
      if (btn.error) return { error: `block ${i}: ${btn.error}` };
      elements.push(btn.ok);
    }
    if (!elements.length) return { error: `block ${i}: actions needs buttons` };
    return { ok: { type: "actions", elements } };
  }

  return { error: `block ${i}: unsupported` };
}

export function validateBlocks(blocks) {
  if (blocks == null) return { ok: false, errors: ["blocks required"] };
  if (!Array.isArray(blocks)) return { ok: false, errors: ["blocks must be an array"] };
  if (!blocks.length) return { ok: false, errors: ["blocks must not be empty"] };
  if (blocks.length > MAX_BLOCKS) return { ok: false, errors: [`at most ${MAX_BLOCKS} blocks`] };
  const errors = [];
  const out = [];
  blocks.forEach((b, i) => {
    const n = normalizeBlock(b, i);
    if (n.error) errors.push(n.error);
    else out.push(n.ok);
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], blocks: out };
}

function textOf(obj) {
  if (!obj) return "";
  if (typeof obj === "string") return obj;
  return String(obj.text || "");
}

export function fallbackText(blocks) {
  const v = Array.isArray(blocks) ? { ok: true, blocks } : validateBlocks(blocks);
  const list = v.ok ? v.blocks : [];
  const parts = [];
  for (const b of list) {
    if (b.type === "header" || b.type === "markdown") parts.push(textOf(b.text ?? b));
    else if (b.type === "section") {
      if (b.text) parts.push(textOf(b.text));
      for (const f of b.fields || []) parts.push(textOf(f));
    } else if (b.type === "context") {
      for (const el of b.elements || []) {
        if (el.type !== "image") parts.push(textOf(el));
      }
    }
  }
  return parts.map((p) => p.trim()).filter(Boolean).join("\n") || "Block Kit message";
}

export const templates = {
  approval: {
    id: "approval",
    name: "Approval",
    blocks: [
      Blocks.header("New request"),
      Blocks.section({
        text: "*Type:*\nPaid Time Off",
        fields: ["*Created by:*\nMaya", "*When:*\nAug 10 – Aug 13"],
        accessory: Elements.button({ text: "Approve", actionId: "approve", value: "req_1", style: "primary" }),
      }),
      Blocks.divider(),
      Blocks.context(["Due Aug 13 · Channel"]),
      Blocks.actions([Elements.button({ text: "Deny", actionId: "deny", value: "req_1", style: "danger" })]),
    ],
  },
  status: {
    id: "status",
    name: "Status",
    blocks: [
      Blocks.header("Staging deploy"),
      Blocks.section({
        text: "*billing-fix* is on staging.",
        fields: ["*PR:*\n#482", "*Tests:*\n14/14"],
      }),
      Blocks.context(["DevOps · waiting on QA"]),
    ],
  },
  incident: {
    id: "incident",
    name: "Incident",
    blocks: [
      Blocks.header("Flaky 500 on /billing/webhook"),
      Blocks.section({ text: "Reproduced on staging. Stack in `billing/webhook.ts:142`." }),
      Blocks.markdown("Scout handed this to **Eng.Build**."),
      Blocks.actions([
        Elements.button({ text: "Ack", actionId: "ack", value: "inc_1" }),
        Elements.button({ text: "Open file", url: "https://example.com/billing/webhook.ts" }),
      ]),
    ],
  },
};

export function exampleBlocks() {
  return structuredClone(templates.approval.blocks);
}

export function examplePayload() {
  const blocks = exampleBlocks();
  return { text: fallbackText(blocks), blocks };
}
