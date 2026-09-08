export const MAX_BLOCKS: 50;
export const BLOCK_TYPES: readonly string[];

export type TextObject = { type: "plain_text" | "mrkdwn"; text: string };
export type ImageElement = { type: "image"; image_url: string; alt_text: string };
export type ButtonElement = {
  type: "button";
  text: TextObject;
  action_id?: string;
  value?: string;
  url?: string;
  style?: "primary" | "danger";
};

export type HeaderBlock = { type: "header"; text: TextObject };
export type SectionBlock = {
  type: "section";
  text?: TextObject;
  fields?: TextObject[];
  accessory?: ButtonElement;
};
export type DividerBlock = { type: "divider" };
export type ContextBlock = { type: "context"; elements: Array<TextObject | ImageElement> };
export type ImageBlock = ImageElement & { title?: TextObject };
export type ActionsBlock = { type: "actions"; elements: ButtonElement[] };
export type MarkdownBlock = { type: "markdown"; text: string };
export type Block = HeaderBlock | SectionBlock | DividerBlock | ContextBlock | ImageBlock | ActionsBlock | MarkdownBlock;

export declare const Elements: {
  plainText(text: string): TextObject;
  mrkdwn(text: string): TextObject;
  image(opts: { imageUrl?: string; altText?: string }): ImageElement;
  button(opts: { text?: string | TextObject; actionId?: string; value?: string; url?: string; style?: "primary" | "danger" }): ButtonElement;
};

export declare const Blocks: {
  header(text: string | TextObject): HeaderBlock;
  section(opts?: { text?: string | TextObject; fields?: Array<string | TextObject>; accessory?: ButtonElement }): SectionBlock;
  divider(): DividerBlock;
  context(elements?: Array<string | TextObject | ImageElement>): ContextBlock;
  image(opts?: { imageUrl?: string; altText?: string; title?: string | TextObject }): ImageBlock;
  actions(elements?: ButtonElement[]): ActionsBlock;
  markdown(text: string): MarkdownBlock;
};

export function defaultBlock(type: string): Block;
export function validateBlocks(blocks: unknown): { ok: true; errors: string[]; blocks: Block[] } | { ok: false; errors: string[]; blocks?: undefined };
export function fallbackText(blocks: unknown): string;

export type BlockTemplate = { id: string; name: string; blocks: Block[] };
export declare const templates: { approval: BlockTemplate; status: BlockTemplate; incident: BlockTemplate };
export function exampleBlocks(): Block[];
export function examplePayload(): { text: string; blocks: Block[] };
