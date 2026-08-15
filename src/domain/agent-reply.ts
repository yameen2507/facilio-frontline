/**
 * Getting the JSON back out of an agent reply.
 *
 * A structured-output agent returns its object as a *string* inside
 * `response.content`, and forgetting to parse it is the single most common bug
 * on this platform. It is handled in ONE place, and tolerantly: models
 * occasionally wrap the object in prose or a code fence even when a schema is
 * enforced.
 *
 * Lives in `domain/` because it is pure text handling with no database and no
 * platform import — which is also what lets both the lead analyst and the
 * generic assessment store use it without importing each other.
 */

export function parseAgentContent(content: string): unknown {
  const direct = tryJson(content);
  if (direct !== undefined) return direct;

  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    const inner = tryJson(fenced[1]);
    if (inner !== undefined) return inner;
  }

  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const slice = tryJson(content.slice(start, end + 1));
    if (slice !== undefined) return slice;
  }

  throw new Error(`agent reply was not JSON: ${content.slice(0, 200)}`);
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text.trim());
  } catch {
    return undefined;
  }
}
