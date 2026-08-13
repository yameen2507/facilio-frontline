/**
 * Local type shim for `@facilio/studio-functions`.
 *
 * The package is NOT installable here — it 404s on repo.facilio.in and resolves
 * only inside the platform build. esbuild marks it external, so this file exists
 * purely so the editor and `tsc --noEmit` do not report a missing module.
 * Keep it in step with what the runtime actually provides.
 */
declare module "@facilio/studio-functions" {
  /** Parameter types the build accepts — only these two. */
  type ParamType = "number" | "string";

  interface HandlerParam {
    description: string;
    type: ParamType;
  }

  interface Handler {
    name: string;
    description?: string;
    parameters?: Record<string, HandlerParam>;
    execute: (args: Record<string, unknown>) => Promise<unknown>;
  }

  export default class StudioFunctions {
    constructor(opts: { name: string; version?: string });
    addHandler(handler: Handler): void;
    /** Must be the last top-level statement in the file. */
    execute(): void;
  }

  export interface QueryResult<T = Record<string, unknown>> {
    rows: T[];
    rowCount: number | null;
    fields: string[];
    truncated: boolean;
  }

  export class StudioDatabase {
    constructor(opts: { userName?: string; password?: string; schema?: string });
    /** Synchronous — the host call blocks. Always parameterise dynamic values. */
    query<T = Record<string, unknown>>(sql: string, params?: unknown[]): QueryResult<T>;
  }

  export class VibeEvents {
    constructor();
    publish(
      topic: string,
      payload: unknown
    ): Promise<{ ok: boolean; topic: string; receivers?: number; error?: string }>;
  }
}
