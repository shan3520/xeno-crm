/**
 * CLIENT mirror of crm-api's render.ts so the message preview matches send-time output exactly.
 * Known tokens resolve (missing value -> ""), unknown tokens stay literal `{{token}}`.
 */

export const MESSAGE_TOKENS = [
  "first_name",
  "last_name",
  "email",
  "phone",
  "city",
  "tier",
] as const;
export type MessageToken = (typeof MESSAGE_TOKENS)[number];

export interface TokenCustomer {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  attributes?: unknown;
}

const TOKEN_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function attrString(attributes: unknown, key: string): string {
  if (attributes && typeof attributes === "object" && !Array.isArray(attributes)) {
    const value = (attributes as Record<string, unknown>)[key];
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
  }
  return "";
}

export function buildTokens(c: TokenCustomer): Record<string, string> {
  return {
    first_name: c.firstName,
    last_name: c.lastName,
    email: c.email,
    phone: c.phone ?? "",
    city: attrString(c.attributes, "city"),
    tier: attrString(c.attributes, "tier"),
  };
}

/** Plain-string render, identical to the server renderer. */
export function renderTokens(template: string, c: TokenCustomer): string {
  const tokens = buildTokens(c);
  return template.replace(TOKEN_PATTERN, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(tokens, name) ? tokens[name]! : whole,
  );
}

export interface RenderedSpan {
  text: string;
  /** Present when this span came from a `{{token}}`; `known` says if it's in the whitelist. */
  token?: string;
  known?: boolean;
}

/**
 * Render to spans so the preview can highlight resolved tokens (and flag unknown ones). A
 * known token with an empty value yields `{ token, known: true, text: "" }`.
 */
export function renderSpans(template: string, c: TokenCustomer): RenderedSpan[] {
  const tokens = buildTokens(c);
  const spans: RenderedSpan[] = [];
  let last = 0;
  for (const m of template.matchAll(TOKEN_PATTERN)) {
    const idx = m.index ?? 0;
    if (idx > last) spans.push({ text: template.slice(last, idx) });
    const name = m[1]!;
    const known = Object.prototype.hasOwnProperty.call(tokens, name);
    spans.push({ text: known ? tokens[name]! : m[0], token: name, known });
    last = idx + m[0].length;
  }
  if (last < template.length) spans.push({ text: template.slice(last) });
  return spans;
}
