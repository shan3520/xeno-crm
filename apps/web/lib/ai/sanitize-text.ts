/**
 * Strip raw tool-call markup that occasionally leaks into a model's TEXT output. Free-tier
 * models (Groq llama / Gemini) sometimes "narrate" a tool call as prose — e.g. the malformed
 * `<function=generate_segment_rule({"intent":"none"})</function>` — which the SDK can't parse
 * into a real call, so it would otherwise render verbatim and read as a broken AI.
 *
 * Run this on the FULL accumulated assistant text on each render: a tag split across streamed
 * chunks is still removed once both halves have arrived. Real tool calls arrive as structured
 * tool parts (isToolUIPart), never this text path, so nothing legitimate is stripped.
 */
export function sanitizeAssistantText(text: string): string {
  return text
    // Paired markup, including the malformed `<function=foo(...)</function>` form where the
    // opening tag is never closed with `>`. Lazy match from the opener to the next closer.
    .replace(/<function\b[\s\S]*?<\/function>/gi, "")
    .replace(/<(tool_call|tool_code|function_call)\b[\s\S]*?<\/\1>/gi, "")
    // Gemini sometimes wraps a synthetic call in a ```tool_code``` / ```tool_call``` fence.
    .replace(/```(?:tool_code|tool_call|json_tool)[\s\S]*?```/gi, "")
    // Any orphaned open/close tag left by a partial or split-stream emission.
    .replace(/<\/?(?:function|tool_call|tool_code|function_call)\b[^>]*>/gi, "")
    .trim();
}
