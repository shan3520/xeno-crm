/**
 * Pure, server-side personalization renderer. Resolves a small, DOCUMENTED token set in a
 * message template against a single customer. No DB, no framework — unit-tested in isolation.
 *
 * Token syntax: `{{ token }}` (optional surrounding whitespace).
 *
 * Supported tokens (case-sensitive):
 *   {{first_name}} -> customer.firstName
 *   {{last_name}}  -> customer.lastName
 *   {{email}}      -> customer.email
 *   {{phone}}      -> customer.phone (blank if the customer has none)
 *   {{city}}       -> customer.attributes.city (blank if absent)
 *   {{tier}}       -> customer.attributes.tier (blank if absent)
 *
 * Resolution policy (documented):
 *   - A KNOWN token whose value is missing renders as an EMPTY string ("").
 *   - An UNKNOWN token is left AS-IS (the literal `{{token}}` is preserved) so authoring
 *     mistakes stay visible rather than silently vanishing.
 */

export interface RenderContext {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  attributes: unknown;
}

const TOKEN_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Safely read a string-ish value from a customer's JSON attributes. */
function attrString(attributes: unknown, key: string): string {
  if (attributes && typeof attributes === "object" && !Array.isArray(attributes)) {
    const value = (attributes as Record<string, unknown>)[key];
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
  }
  return "";
}

/** Build the known-token lookup for a customer. */
export function buildTokens(ctx: RenderContext): Record<string, string> {
  return {
    first_name: ctx.firstName,
    last_name: ctx.lastName,
    email: ctx.email,
    phone: ctx.phone ?? "",
    city: attrString(ctx.attributes, "city"),
    tier: attrString(ctx.attributes, "tier"),
  };
}

/**
 * Render a template against a customer. Known tokens are substituted (missing values ->
 * ""), unknown tokens are left as their literal `{{token}}`.
 */
export function renderMessage(template: string, ctx: RenderContext): string {
  const tokens = buildTokens(ctx);
  return template.replace(TOKEN_PATTERN, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(tokens, name) ? tokens[name]! : whole,
  );
}
