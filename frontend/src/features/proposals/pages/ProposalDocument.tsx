/**
 * The document — what the client actually receives.
 *
 * PDF IS STYLED HTML PLUS `window.print()`, and that is the whole dependency
 * list (spec §6). The production reference tool does exactly this today. It
 * works because the revision is FROZEN: the render is deterministic, so the
 * same proposal prints the same bytes tomorrow, which is the property a PDF
 * library would have been bought for.
 *
 * THE SNAPSHOT IS TAKEN ON FIRST RENDER. `proposal.document` holds it once
 * something has rendered; until then this page calls `render` to make it. An
 * admin editing the template on Friday must not change a proposal already with
 * a client — the same problem, and the same solution, as the survey question
 * snapshot. So this page reads the snapshot in preference to asking for a fresh
 * one, always.
 *
 * IT PRINTS ITS NUMBER, ITS REVISION AND ITS DATE (spec §5 R5) — in the
 * masthead, where a client reads them, and again in the footer that repeats on
 * every printed page. Otherwise you will one day argue about which one they
 * signed.
 *
 * ONE NOTE ON THE PRINT STYLESHEET BELOW. It is a `<style>` element rather than
 * Tailwind's `print:` variants, and rather than a block in globals.css, because
 * it has to reach ELEMENTS THIS PAGE DOES NOT OWN: the sidebar, the header band
 * and the scroll container all sit above it and would otherwise print, and the
 * shell's fixed heights and `overflow: hidden` would clip the document to one
 * screen. Being a scoped element, it exists only while this page is mounted.
 */

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Printer } from "lucide-react";
import { useActor } from "../../../app/auth";
import { PageShell } from "../../../app/shell/PageShell";
import { humanise, onDay, when } from "../../../lib/format";
import { Card } from "../../../ui/Card";
import { SkeletonRows } from "../../../ui/Skeleton";
import { Empty, ErrorState } from "../../../ui/States";
import { Button } from "@/components/ui/button";
import { getProposal, renderProposal } from "../api/proposals-util";
import { money, qty as fmtQty } from "../money";
import { Markdown } from "../components/Markdown";
import type {
  Proposal,
  RenderLine,
  RenderedDocument,
  RenderedSection,
} from "../types/proposal";

/**
 * The print rules.
 *
 * `:has()` does the ancestor work: every element that CONTAINS the print area
 * is unclipped and left visible, everything else is removed from the flow, and
 * the area itself is laid out as a normal document again. `display: none` on the
 * siblings rather than `visibility: hidden` on purpose — a hidden element still
 * occupies its box, which is what leaves a printed first page blank, and the
 * absolute-positioning trick people reach for next truncates multi-page output.
 *
 * Colour is forced to black on white rather than taken from the theme tokens,
 * and this is the one place in the app where that is right: a client printing a
 * dark-theme page gets a black rectangle, and a printer asked for `oklch()`
 * backgrounds either ignores them or empties a cartridge.
 */
const PRINT_CSS = `
@media print {
  @page { margin: 16mm; }

  body *:not(:has(#fl-print)):not(#fl-print):not(#fl-print *) { display: none !important; }

  html, body, :has(#fl-print) {
    display: block !important;
    overflow: visible !important;
    height: auto !important;
    max-height: none !important;
    position: static !important;
    background: #fff !important;
  }

  #fl-print * {
    color: #000 !important;
    background: transparent !important;
    border-color: #999 !important;
    box-shadow: none !important;
  }
  #fl-print {
    background: #fff !important;
    max-width: none !important;
    margin: 0 !important;
    padding: 0 !important;
    font-size: 11pt;
  }

  /* A heading marooned at the foot of a page, and a split price row, are the
     two things that make a printed proposal look unfinished. */
  #fl-print h1, #fl-print h2, #fl-print h3 { break-after: avoid; }
  #fl-print tr, #fl-print li { break-inside: avoid; }
  #fl-print section { break-inside: auto; }
}
`;

// ── System sections ──────────────────────────────────────────────────────────

/** The payloads are `unknown` on the wire, so each is narrowed before use — a
    section this build does not recognise is named rather than crashing the page. */
const linesOf = (data: unknown): RenderLine[] =>
  data && typeof data === "object" && Array.isArray((data as { lines?: unknown }).lines)
    ? ((data as { lines: RenderLine[] }).lines ?? [])
    : [];

const itemsOf = <T,>(data: unknown): T[] =>
  data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)
    ? ((data as { items: T[] }).items ?? [])
    : [];

/** The priced table, as the client reads it. No card price, no mode, no reason:
    the derivation is ours, and the client is owed the number and what it buys. */
function PricingTable({
  lines,
  currency,
  emptyNote,
}: {
  lines: RenderLine[];
  currency: string | null | undefined;
  emptyNote: string;
}) {
  if (!lines.length) return <p className="text-muted-foreground text-sm">{emptyNote}</p>;

  return (
    // The wrapper scrolls on a narrow screen instead of pushing the page wide;
    // in print it is unclipped along with every other ancestor.
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-3 font-medium">Service</th>
            <th className="w-28 py-2 pr-3 text-right font-medium">Quantity</th>
            <th className="w-28 py-2 pr-3 font-medium">Frequency</th>
            <th className="w-28 py-2 pr-3 text-right font-medium">Rate</th>
            <th className="w-32 py-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={`${l.description}-${i}`} className="border-b last:border-b-0 align-top">
              <td className="py-2 pr-3">{l.description}</td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {fmtQty(l.qty)} {l.uom ? humanise(l.uom) : ""}
              </td>
              <td className="py-2 pr-3">{humanise(l.frequency ?? "one_time")}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{money(l.appliedPrice, currency)}</td>
              <td className="py-2 text-right tabular-nums">{money(l.lineTotal, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SystemSection({
  section,
  proposal,
}: {
  section: RenderedSection;
  proposal: Proposal;
}) {
  const currency = proposal.currency;

  switch (section.key) {
    case "pricing_table":
      return (
        <>
          <PricingTable
            lines={linesOf(section.data)}
            currency={currency}
            emptyNote="No services have been priced on this proposal yet."
          />
          {/* THE TWO TOTALS, and they are never added into one. A client
              signing "AED 84,000" when the truth is 12,000 once and 6,000 a
              month is the single most expensive misprint this document could
              carry. */}
          <div className="mt-4 flex flex-col gap-1 border-t pt-3">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-sm">Total, one-time</span>
              <span className="text-sm font-semibold tabular-nums">
                {money(proposal.totalOneTime, currency)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-sm">Total, recurring</span>
              <span className="text-sm font-semibold tabular-nums">
                {money(proposal.totalRecurringMonthly, currency)}
                <span className="font-normal"> per month</span>
              </span>
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              The one-time and monthly figures are separate charges and are not added together.
            </p>
          </div>
        </>
      );

    case "optional_services": {
      const optional = linesOf(section.data);
      if (!optional.length) return null;
      return (
        <>
          <p className="text-muted-foreground mb-3 text-sm">
            Available if you want them, and not included in the totals above.
          </p>
          <PricingTable lines={optional} currency={currency} emptyNote="" />
          <div className="mt-4 flex flex-col gap-1 border-t border-dashed pt-3">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-sm">Optional, one-time</span>
              <span className="text-sm tabular-nums">
                {money(proposal.optionalOneTimeTotal, currency)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-sm">Optional, recurring</span>
              <span className="text-sm tabular-nums">
                {money(proposal.optionalRecurringMonthlyTotal, currency)}
                <span> per month</span>
              </span>
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              Outside the total. Tell us which of these you want and we will add them at acceptance
              — there is no need to re-sign for an addition.
            </p>
          </div>
        </>
      );
    }

    case "exclusions": {
      const items = itemsOf<string>(section.data);
      if (!items.length) {
        return (
          <p className="text-sm">
            Nothing is excluded from this scope beyond what the terms below state.
          </p>
        );
      }
      return (
        <ul className="ml-5 flex list-disc flex-col gap-1">
          {items.map((x, i) => (
            <li key={`${x}-${i}`} className="text-sm">
              {x}
            </li>
          ))}
        </ul>
      );
    }

    case "site_summary": {
      const items = itemsOf<{ name: string; detail: string }>(section.data);
      if (!items.length) {
        return <p className="text-sm">This proposal was prepared without a site survey.</p>;
      }
      return (
        <dl className="flex flex-col gap-2">
          {items.map((s, i) => (
            <div key={`${s.name}-${i}`} className="flex flex-wrap gap-x-3">
              <dt className="w-44 shrink-0 text-sm font-medium">{s.name}</dt>
              <dd className="min-w-0 flex-1 text-sm">{s.detail}</dd>
            </div>
          ))}
        </dl>
      );
    }

    case "acceptance":
      return (
        <>
          <p className="text-sm">
            To accept, sign below and return this document. Please name any optional services you
            want included.
          </p>
          {/* A printed signature panel, not a link. There is no public page on
              this platform for a client to click through to, and a dead URL on
              a signature block is worse than an honest ruled line. */}
          <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
            {["Signed", "Name and position", "Company", "Date"].map((label) => (
              <div key={label} className="flex flex-col gap-6">
                <span className="border-b border-dashed" aria-hidden="true" />
                <span className="text-muted-foreground -mt-5 text-xs">{label}</span>
              </div>
            ))}
          </div>
        </>
      );

    default:
      return (
        <p className="text-muted-foreground text-sm">
          This build does not know how to print a “{section.key}” section.
        </p>
      );
  }
}

// ── The page ─────────────────────────────────────────────────────────────────

export function ProposalDocument() {
  const { id } = useParams();
  const actor = useActor();

  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [doc, setDoc] = useState<RenderedDocument | null>(null);
  const [loaded, setLoaded] = useState(false);
  /** The proposal itself could not be read — the page has nothing to stand on. */
  const [error, setError] = useState<string | null>(null);
  /**
   * The RENDER's message, kept apart from the fatal one on purpose. A proposal
   * that reads fine but has no snapshot yet is EMPTY, not broken — and while
   * `render` is an unregistered seam that is every proposal, so treating its
   * rejection as a load failure would put "Could not load this" on a page that
   * loaded perfectly. The message is still shown, one line down, where it
   * explains the emptiness rather than claiming a failure.
   */
  const [renderNote, setRenderNote] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!id) return;
    let live = true;

    (async () => {
      const { data, error: err } = await getProposal(id);
      if (!live) return;

      if (err || !data?.proposal) {
        setLoaded(true);
        setError(err ?? "This proposal could not be read");
        return;
      }
      setProposal(data.proposal);

      // The snapshot wins whenever there is one — reading it is what makes a
      // frozen revision reproduce. `render` is only ever asked for the FIRST
      // one, which is the moment the template stops being able to move.
      const snapshot = data.proposal.document;
      if (snapshot?.sections?.length) {
        setLoaded(true);
        setDoc(snapshot);
        return;
      }

      const rendered = await renderProposal(id, actor);
      if (!live) return;
      setLoaded(true);
      setRenderNote(rendered.error);
      if (rendered.data?.document) setDoc(rendered.data.document);
    })();

    return () => {
      live = false;
    };
  }, [id, actor, reloadKey]);

  const label = proposal ? `${proposal.refNo} v${proposal.revisionNo ?? 1}` : "Proposal";
  // The date this document speaks as of: when it went to the client if it has,
  // and when it was rendered if it has not. Never "today" — a document that
  // re-dates itself on every open is a document nobody can cite.
  const issued = proposal?.sentAt ?? doc?.renderedAt ?? proposal?.createdAt ?? null;

  return (
    <PageShell
      title={`Document — ${label}`}
      subtitle={doc?.templateName ?? "The client's copy"}
      actions={
        doc ? (
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="size-4" />
            Print / save as PDF
          </Button>
        ) : null
      }
    >
      {/* Scoped to this page: it exists while the document is on screen and
          nowhere else in the app. */}
      <style>{PRINT_CSS}</style>

      {!loaded ? (
        <Card pad={false}>
          <SkeletonRows count={5} />
        </Card>
      ) : error ? (
        <Card pad={false}>
          <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
        </Card>
      ) : doc && proposal ? (
        <>
          {/* Internal, and deliberately outside the print area: what the
              renderer could not resolve is for us, never for the client. */}
          {doc.warnings?.length ? (
            <Card title="Not resolved in this render" pad={false} className="mb-5">
              <ul className="flex flex-col">
                {doc.warnings.map((w) => (
                  <li key={w} className="border-b px-4 py-2 text-sm last:border-b-0">
                    {w}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {/* THE PRINT AREA. Everything outside this id is removed when
              printing; everything inside it is the client's document. */}
          <div id="fl-print" className="bg-card mx-auto max-w-3xl rounded-xl border p-6 sm:p-10">
            <header className="border-b pb-5">
              <h1 className="text-xl font-semibold tracking-tight">
                {proposal.title ?? "Service proposal"}
              </h1>
              {/* Number, revision and date — the three facts an argument about
                  "which one did they sign" turns on. */}
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                {[
                  { label: "Proposal", value: proposal.refNo },
                  { label: "Revision", value: `v${proposal.revisionNo ?? 1}` },
                  { label: "Date", value: issued ? onDay(issued) : "—" },
                  {
                    label: "Valid until",
                    value: proposal.validUntil ? onDay(proposal.validUntil) : "—",
                  },
                ].map((f) => (
                  <div key={f.label} className="min-w-0">
                    <dt className="text-muted-foreground text-xs">{f.label}</dt>
                    <dd className="text-sm font-medium">{f.value}</dd>
                  </div>
                ))}
              </dl>
            </header>

            {doc.sections.map((section) => (
              <section key={section.key} className="mt-7">
                <h2 className="mb-3 text-base font-semibold">{section.title}</h2>
                {section.type === "text" ? (
                  <Markdown body={section.body} />
                ) : (
                  <SystemSection section={section} proposal={proposal} />
                )}
              </section>
            ))}

            <footer className="text-muted-foreground mt-10 border-t pt-4 text-xs">
              {proposal.refNo} v{proposal.revisionNo ?? 1}
              {issued ? ` · issued ${when(issued)}` : ""}
              {proposal.checksum ? ` · checksum ${proposal.checksum}` : ""}. Any earlier version of
              this proposal is superseded.
            </footer>
          </div>
        </>
      ) : (
        <Card pad={false}>
          <Empty
            title="Nothing rendered yet"
            body={
              <>
                A document is a template snapshotted onto this proposal — the sections, the merged
                text and the priced tables, frozen at the moment of the first render, so an edit to
                the template can never reach a proposal a client already holds.
                {/* The renderer's own words, one line down: the reason there is
                    no snapshot, stated rather than implied. */}
                {renderNote ? (
                  <span className="mt-3 block text-xs">Rendering answered: {renderNote}</span>
                ) : null}
              </>
            }
            action={
              <Button variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
                Try rendering again
              </Button>
            }
          />
        </Card>
      )}
    </PageShell>
  );
}
