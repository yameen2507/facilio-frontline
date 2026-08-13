/**
 * Calling Facilio from inside a function.
 *
 * The browser uses `vibe.executeAction(connection, action, payload)`. Server-side
 * the equivalent is a POST to the connections service, whose base URL comes from
 * `process.system.CONNECTIONS_URL`. The host injects the service token because
 * the URL resolves to a *.facilio.* host — so never set an Authorization,
 * cookie or org header here, and never hardcode the host.
 */

/** `process.system` is a synthetic sandbox object; read it without Node types. */
function systemValue(key: string): string | undefined {
  const proc = (globalThis as unknown as {
    process?: { system?: Record<string, string | undefined> };
  }).process;
  return proc?.system?.[key];
}

export interface ActionResult {
  raw: unknown;
  /** Facilio record id when the action created or fetched one. */
  recordId: string | null;
}

/**
 * Dig the created record's id out of a response. Action outputs are not
 * normalised by the platform, so shapes vary by module — check the likely
 * places rather than assuming one.
 */
export function extractRecordId(response: unknown): string | null {
  const seen = new Set<unknown>();

  const walk = (node: unknown, depth: number): string | null => {
    if (!node || typeof node !== "object" || depth > 6 || seen.has(node)) return null;
    seen.add(node);

    const obj = node as Record<string, unknown>;

    for (const key of ["id", "recordId", "ID"]) {
      const v = obj[key];
      if (typeof v === "number" && Number.isFinite(v)) return String(v);
      if (typeof v === "string" && v.trim() !== "") return v;
    }

    for (const key of Object.keys(obj)) {
      const found = walk(obj[key], depth + 1);
      if (found) return found;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        const found = walk(item, depth + 1);
        if (found) return found;
      }
    }

    return null;
  };

  return walk(response, 0);
}

/**
 * Run a saved connection action. Throws on a non-2xx so the outbox can retry.
 * Slugs must come from `facilio connections search` — never invented, because an
 * invented slug fails at call time rather than at build time.
 */
export async function executeAction(
  connectionSlug: string,
  actionSlug: string,
  input: unknown
): Promise<ActionResult> {
  const base = systemValue("CONNECTIONS_URL");
  if (!base) {
    throw new Error("CONNECTIONS_URL is not available in this run");
  }

  const url = `${base.replace(/\/$/, "")}/api/v1/connections/${encodeURIComponent(
    connectionSlug
  )}/actions/${encodeURIComponent(actionSlug)}/execute`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(
      `${connectionSlug}.${actionSlug} failed: ${res.status} ${res.statusText} ${text.slice(0, 300)}`
    );
  }

  let raw: unknown = text;
  try {
    raw = JSON.parse(text);
  } catch {
    // Some actions return plain text; keep it as-is.
  }

  return { raw, recordId: extractRecordId(raw) };
}
