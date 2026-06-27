import { describe, expect, it } from "vitest";

import { sanitizeAssistantText } from "./sanitize-text";

describe("sanitizeAssistantText", () => {
  it("strips the exact malformed leak observed in QA", () => {
    const leaked = `<function=generate_segment_rule({"intent": "none"})</function>`;
    expect(sanitizeAssistantText(leaked)).toBe("");
  });

  it("removes a leaked tag but keeps the surrounding prose", () => {
    const input = `Here's your audience. <function=generate_segment_rule({"a":1})</function> Want to edit it?`;
    expect(sanitizeAssistantText(input)).toBe(
      "Here's your audience.  Want to edit it?".trim(),
    );
  });

  it("strips well-formed tool_call / function_call blocks", () => {
    expect(
      sanitizeAssistantText(`<tool_call>{"name":"draft_message"}</tool_call>`),
    ).toBe("");
    expect(
      sanitizeAssistantText(`<function_call name="x">{"y":2}</function_call>`),
    ).toBe("");
  });

  it("strips a tool_code fenced block (Gemini style)", () => {
    const input = "```tool_code\nprint(default_api.list_campaigns())\n```";
    expect(sanitizeAssistantText(input)).toBe("");
  });

  it("removes orphaned/partial tags", () => {
    expect(sanitizeAssistantText("ok </function> done")).toBe("ok  done");
    expect(sanitizeAssistantText("<function=foo")).toBe("<function=foo");
  });

  it("leaves legitimate prose untouched (incl. ordinary angle brackets)", () => {
    const prose =
      "Target customers who spent > ₹50k. I'll draft an email next — sound good?";
    expect(sanitizeAssistantText(prose)).toBe(prose);
  });

  it("never throws and trims surrounding whitespace", () => {
    expect(sanitizeAssistantText("   ")).toBe("");
    expect(sanitizeAssistantText("")).toBe("");
  });
});
