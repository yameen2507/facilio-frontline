/**
 * Runtime diagnostics — a scratch function for probing platform behaviour
 * empirically, the way ARCHITECTURE.md §3a's findings were established.
 * Nothing in the app calls this; it exists to answer questions like
 * 2026-08-14's "why does every function suddenly get 'The server does not
 * support SSL connections' while the CLI's own DB path works fine".
 */

import StudioFunctions, { StudioDatabase } from "@facilio/studio-functions";

const server = new StudioFunctions({ name: "probe" });

server.addHandler({
  name: "db-ssl",
  description:
    "Try the app DB with several connection configs and report each outcome, so a bridge-side SSL change can be diagnosed and — if the options pass through — overridden.",
  parameters: {},
  execute: async () => {
    const results: Record<string, string> = {};

    const attempt = (label: string, opts: Record<string, unknown>) => {
      try {
        const db = new StudioDatabase({
          userName: process.env.DB_USER,
          password: process.env.DB_PASSWORD,
          schema: process.env.SCHEMA,
          ...opts,
        } as ConstructorParameters<typeof StudioDatabase>[0]);
        const res = db.query("select 1 as ok");
        results[label] = `OK rows=${res.rows?.length ?? 0}`;
      } catch (e) {
        results[label] = `ERR ${String((e as Error)?.message ?? e).slice(0, 120)}`;
      }
    };

    attempt("plain", {});
    attempt("ssl-false", { ssl: false });
    attempt("ssl-disable-string", { ssl: "disable" });
    attempt("sslmode-disable", { sslmode: "disable" });
    attempt("ssl-object-off", { ssl: { rejectUnauthorized: false } });

    return { ok: true, data: { results, env: { schemaSet: Boolean(process.env.SCHEMA) } } };
  },
});

server.execute();
