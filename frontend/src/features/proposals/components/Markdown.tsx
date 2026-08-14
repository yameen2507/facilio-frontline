/**
 * The smallest Markdown renderer that serves a proposal's text sections.
 *
 * WHY NOT A LIBRARY. A text section is a textarea an estimator types prose into
 * — paragraphs, the odd heading, a bullet list, an emphasised phrase. Everything
 * past that (tables, footnotes, HTML passthrough, syntax highlighting) is weight
 * this document will never use, and the two obvious packages are ~40kB before
 * their sanitiser. Rich-text editing was ruled out for the same reason (spec §6):
 * the hard parts of a document here are versioning and comments, and both are
 * solved elsewhere — by the revision, and by the negotiation thread.
 *
 * WHY IT BUILDS NODES RATHER THAN HTML. No `dangerouslySetInnerHTML` anywhere:
 * this text is merged with client-supplied token values and printed for a client
 * to sign, so a `<script>` typed into a template would be a stored XSS with a
 * signature block under it. Building React elements makes that structurally
 * impossible rather than a sanitiser away from it.
 *
 * Anything it does not understand renders as the literal text it was, which is
 * the right failure: a proof-reader notices a stray `##`, and nobody notices a
 * paragraph that silently vanished.
 */

import type { ReactNode } from "react";

/** `**bold**`, `*italic*` and `` `code` `` — the three an estimator actually types. */
const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;

function inline(text: string, keyPrefix: string): ReactNode[] {
  return text
    .split(INLINE)
    .filter((part) => part !== "")
    .map((part, i) => {
      const key = `${keyPrefix}-${i}`;
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={key}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith("`") && part.endsWith("`")) {
        return (
          <code key={key} className="font-mono text-[0.9em]">
            {part.slice(1, -1)}
          </code>
        );
      }
      if (part.startsWith("*") && part.endsWith("*")) {
        return <em key={key}>{part.slice(1, -1)}</em>;
      }
      return <span key={key}>{part}</span>;
    });
}

/** A paragraph's own line breaks are kept — a cover letter's address block and
    sign-off are single newlines, and reflowing them into one line is wrong. */
function lines(block: string, keyPrefix: string): ReactNode[] {
  const parts = block.split("\n");
  return parts.flatMap((line, i) => [
    ...inline(line, `${keyPrefix}-l${i}`),
    i < parts.length - 1 ? <br key={`${keyPrefix}-br${i}`} /> : null,
  ]);
}

export function Markdown({ body }: { body: string }) {
  // A blank line is the only block separator, which is Markdown's own rule and
  // the one every writer already knows.
  const blocks = String(body ?? "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  if (!blocks.length) return null;

  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, i) => {
        const key = `b${i}`;
        const rows = block.split("\n");

        const heading = /^(#{1,3})\s+(.*)$/.exec(block);
        if (heading && rows.length === 1) {
          const level = heading[1].length;
          const text = inline(heading[2], key);
          if (level === 1) return <h2 key={key} className="text-base font-semibold">{text}</h2>;
          if (level === 2) return <h3 key={key} className="text-sm font-semibold">{text}</h3>;
          return <h4 key={key} className="text-sm font-medium">{text}</h4>;
        }

        if (rows.every((r) => /^[-*]\s+/.test(r))) {
          return (
            <ul key={key} className="ml-5 flex list-disc flex-col gap-1">
              {rows.map((r, j) => (
                <li key={`${key}-${j}`} className="text-sm">
                  {inline(r.replace(/^[-*]\s+/, ""), `${key}-${j}`)}
                </li>
              ))}
            </ul>
          );
        }

        if (rows.every((r) => /^\d+\.\s+/.test(r))) {
          return (
            <ol key={key} className="ml-5 flex list-decimal flex-col gap-1">
              {rows.map((r, j) => (
                <li key={`${key}-${j}`} className="text-sm">
                  {inline(r.replace(/^\d+\.\s+/, ""), `${key}-${j}`)}
                </li>
              ))}
            </ol>
          );
        }

        return (
          <p key={key} className="text-sm leading-relaxed">
            {lines(block, key)}
          </p>
        );
      })}
    </div>
  );
}
