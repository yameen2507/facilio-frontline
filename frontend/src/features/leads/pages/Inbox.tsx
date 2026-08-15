/**
 * The lead inbox.
 *
 * `loaded` is tracked separately from `leads.length` on purpose. Without it, the
 * first paint of a cold load renders the empty state — "No open leads" — for the
 * second before data arrives, which reads as an answer rather than as a wait.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Building2, Clock3, Gauge, Timer } from "lucide-react";
import { useAccess } from "../../../app/access";
import { useCounts } from "../../../app/counts";
import { useUserDirectory } from "../../../app/users";
import { PageShell } from "../../../app/shell/PageShell";
import { ago, plural } from "../../../lib/format";
import { Button } from "../../../ui/Button";
import { Card } from "../../../ui/Card";
import { TableCell } from "@/components/ui/table";
import { CountLine } from "../../../ui/Row";
import {
  ClickRow,
  ListTable,
  ListTableSkeleton,
  MobileFact,
  MobileList,
  MobileRow,
  PHONE_BLEED,
  PHONE_BLEED_TOP,
  type Col,
} from "../../../ui/DataTable";
import { CompanyLogo } from "../../../ui/CompanyLogo";
import { Empty, ErrorState } from "../../../ui/States";
import { Tabs } from "../../../ui/Tabs";
import { listLeads } from "../api/leads-util";
import { ScoreCell, SlaChip, StatusChip } from "../components/LeadChips";
import { NewLeadDialog } from "../components/NewLeadDialog";
import { countBuckets, countToggles, filterLeads, type TabId } from "../filters";
import type { Lead } from "../types/lead";

/** Every leads console labels its columns; this one used not to. No phone
    visibility classes here any more — below `sm` the whole table yields to the
    MobileList, which shows all four columns' content as a card. */
const COLS: Col[] = [
  { label: "Company", icon: Building2, skel: "entity" },
  { label: "Status", className: "w-32", skel: "chip" },
  { label: "Score", icon: Gauge, className: "w-24", skel: "num" },
  { label: "Response", icon: Timer, className: "w-36", skel: "chip" },
];

/** How each lifecycle tab reads inside a sentence. `open` and `all` are absent:
    open is the default lens and `all` narrows nothing, so naming either in a
    "none of them are…" clause would describe a filter nobody applied. */
const TAB_PHRASE: Partial<Record<TabId, string>> = {
  converted: "converted",
  closed: "closed",
};

/**
 * The narrowings currently in force, as one clause — "converted and running
 * late". Built rather than hard-coded because there are eight combinations of
 * the three axes and a filtered-empty state that names the wrong one is worse
 * than one that names none.
 */
function describeFilter(tab: TabId, unclaimed: boolean, overdue: boolean): string {
  const parts = [TAB_PHRASE[tab], unclaimed ? "unclaimed" : null, overdue ? "running late" : null]
    .filter((p): p is string => Boolean(p));
  if (!parts.length) return "in this view";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** The entity cell's second line, shared by the table cell and the phone card
    so the two can never describe a lead differently. */
const LeadMeta = ({ lead: l }: { lead: Lead }) => {
  // The owner as a person, not an address (X-05). The directory is cached at
  // module level, so per-row use costs one map lookup.
  const { nameOf } = useUserDirectory();
  return (
    <>
      <code className="font-mono">{l.refNo}</code> · {l.source}
      {l.serviceType ? ` · ${l.serviceType}` : ""}
      {l.siteCity ? ` · ${l.siteCity}` : ""} ·{" "}
      {l.ownerEmail ? nameOf(l.ownerEmail) : <em>unclaimed</em>}
    </>
  );
};

export function Inbox() {
  const navigate = useNavigate();
  const { can } = useAccess();
  const { setOpenLeads } = useCounts();
  // Spec §9: whether this role may raise a lead by hand comes from the matrix
  // in Settings, never from a role name check here.
  const canCreate = can("leads", "create");

  const [leads, setLeads] = useState<Lead[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * D-25: three independent axes, and all three live in the URL (N-06) so a
   * filtered view survives a reload and pastes into a chat message.
   */
  const [params, setParams] = useSearchParams();
  const tab = (["open", "converted", "closed", "all"].includes(params.get("tab") ?? "")
    ? params.get("tab")
    : "open") as TabId;
  const unclaimed = params.get("unclaimed") === "1";
  const overdue = params.get("overdue") === "1";
  const setFilter = (patch: { tab?: TabId; unclaimed?: boolean; overdue?: boolean }) => {
    const next = new URLSearchParams(params);
    const put = (key: string, value: string | null) =>
      value === null ? next.delete(key) : next.set(key, value);
    if (patch.tab !== undefined) put("tab", patch.tab === "open" ? null : patch.tab);
    if (patch.unclaimed !== undefined) put("unclaimed", patch.unclaimed ? "1" : null);
    if (patch.overdue !== undefined) put("overdue", patch.overdue ? "1" : null);
    setParams(next, { replace: true });
  };
  const [reloadKey, setReloadKey] = useState(0);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let live = true;
    // `loaded` is NOT reset here. On a reload the existing rows should stay
    // on screen — replacing real data with a skeleton to fetch the same thing again
    // is a worse answer than a second of staleness.
    listLeads().then(({ data, error: err }) => {
      if (!live) return;
      setLoaded(true);
      setError(err);
      if (data) setLeads(data.leads);
    });
    return () => {
      live = false;
    };
  }, [reloadKey]);

  const counts = useMemo(() => countBuckets(leads), [leads]);
  const filter = useMemo(() => ({ tab, unclaimed, overdue }), [tab, unclaimed, overdue]);
  const rows = useMemo(() => filterLeads(leads, filter), [leads, filter]);
  // Scoped to the tab and to whatever else is switched on, so each chip's number
  // is the length of the list clicking it produces.
  const toggleCounts = useMemo(() => countToggles(leads, filter), [leads, filter]);

  /** Whether an empty result is a FILTERING outcome rather than an empty inbox.
      Both halves matter: with no leads at all, "none match these filters" would
      blame the controls for a queue that has simply never had anything in it. */
  const filtered = counts.all > 0 && (tab !== "open" || unclaimed || overdue);
  const clearFilters = () => setFilter({ tab: "open", unclaimed: false, overdue: false });

  // Feeds the sidebar badge. The shell never imports this feature; the number
  // travels up through the app-level counts context.
  useEffect(() => {
    if (loaded && !error) setOpenLeads(counts.open);
  }, [loaded, error, counts.open, setOpenLeads]);

  const reload = () => setReloadKey((k) => k + 1);

  return (
    <PageShell
      title="Leads"
      // The phone header count — this view's rows, the same number the (sm+)
      // CountLine reports. Only once it's real; a 0 mid-load would lie.
      count={loaded && !error ? rows.length : undefined}
      actions={
        canCreate ? (
          <Button small variant="primary" glyph="plus" onClick={() => setCreating(true)}>
            New lead
          </Button>
        ) : null
      }
      strip={
        // D-25: lifecycle is the tab row; ownership and time are toggles that
        // COMBINE with it — "open, nobody's picked up, running late" is one
        // click of each, where the old strip made them rival tabs. X-04: the
        // tab says Converted because that is the status its rows show.
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Tabs
            items={[
              { id: "open", label: "Open", count: counts.open },
              { id: "converted", label: "Converted", count: counts.converted },
              { id: "closed", label: "Closed", count: counts.closed },
              { id: "all", label: "All", count: counts.all },
            ]}
            active={tab}
            onChange={(t) => setFilter({ tab: t })}
          />
          <div className="flex items-center gap-1.5 pb-2">
            {/* D-26: named after the question a person asks, not the system word. */}
            <button
              type="button"
              aria-pressed={unclaimed}
              onClick={() => setFilter({ unclaimed: !unclaimed })}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs whitespace-nowrap transition-colors",
                unclaimed
                  ? "border-primary bg-muted font-medium"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {`Nobody's picked up · ${toggleCounts.unclaimed}`}
            </button>
            <button
              type="button"
              aria-pressed={overdue}
              onClick={() => setFilter({ overdue: !overdue })}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs whitespace-nowrap transition-colors",
                overdue
                  ? "border-primary bg-muted font-medium"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {`Running late · ${toggleCounts.overdue}`}
            </button>
          </div>
        </div>
      }
    >
      <Card pad={false} className={`${PHONE_BLEED} ${PHONE_BLEED_TOP}`}>
        {!loaded ? (
          <ListTableSkeleton cols={COLS} rows={6} />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : rows.length ? (
          <>
            <ListTable cols={COLS} className="max-sm:hidden">
              {rows.map((l) => (
                <ClickRow key={l.id} onClick={() => navigate(`/leads/${l.id}`)}>
                  <TableCell className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {/* Logo by the contact's email domain — free-mail
                          addresses fall back to tinted initials. */}
                      <CompanyLogo name={l.companyName} email={l.contactEmail} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{l.companyName}</div>
                        <div className="text-muted-foreground truncate text-xs">
                          <LeadMeta lead={l} />
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="w-32 px-4 py-3">
                    <StatusChip status={l.status} />
                  </TableCell>
                  <TableCell className="w-24 px-4 py-3">
                    <ScoreCell lead={l} />
                  </TableCell>
                  <TableCell className="w-36 px-4 py-3">
                    <SlaChip sla={l.sla} />
                    <div className="text-muted-foreground mt-1 text-xs">{ago(l.createdAt)}</div>
                  </TableCell>
                </ClickRow>
              ))}
            </ListTable>
            <MobileList>
              {rows.map((l) => (
                <MobileRow
                  key={l.id}
                  onClick={() => navigate(`/leads/${l.id}`)}
                  leading={<CompanyLogo name={l.companyName} email={l.contactEmail} />}
                  title={l.companyName}
                  // The response clock takes the title line: this is a triage
                  // list, and "how late am I" outranks "what state is it in".
                  trailing={<SlaChip sla={l.sla} />}
                  meta={<LeadMeta lead={l} />}
                  // The facts carry the table columns' own glyphs (Gauge is
                  // Score's, Clock3 is every list's Created), so a fact is
                  // findable across the two forms by its icon.
                  facts={
                    <>
                      <StatusChip status={l.status} />
                      {l.score !== null && l.score !== undefined ? (
                        <MobileFact icon={Gauge} value={l.score}>
                          {l.band ?? undefined}
                        </MobileFact>
                      ) : (
                        <MobileFact icon={Gauge}>not scored</MobileFact>
                      )}
                      <MobileFact icon={Clock3}>{ago(l.createdAt)}</MobileFact>
                    </>
                  }
                />
              ))}
            </MobileList>
            <CountLine>{`${plural(rows.length, "lead", "leads")} in this view`}</CountLine>
          </>
        ) : filtered ? (
          // A FILTERED empty is a different fact from an empty inbox, and saying
          // where leads come from here answers a question nobody asked — there
          // are leads, these filters just exclude all of them. So: name the
          // filters, and offer the one action that undoes them.
          <Empty
            title="No leads match these filters"
            body={`${plural(counts.all, "lead is", "leads are")} on file, but ${
              counts.all === 1 ? "it is not" : "none of them are"
            } ${describeFilter(tab, unclaimed, overdue)}.`}
            action={
              <Button small onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        ) : (
          // No buttons on THIS one: the body already says where leads come from
          // and that one can be raised by hand, and the header's New lead sits a
          // few pixels above. Repeating it turned an explanation into a pitch.
          <Empty
            title={counts.all ? "No open leads" : "No leads yet"}
            body="Enquiries arrive from the website chat as unclaimed leads. One that came in by phone, by email or as a tender notice is raised here by hand."
          />
        )}
      </Card>

      {/* Stays mounted so the radix exit animation plays. A capture refreshes the
          list even when the dialog holds its ground on the duplicate outcome —
          the row exists either way, and the Closed tab should show it. */}
      <NewLeadDialog open={creating} onOpenChange={setCreating} onCreated={reload} />
    </PageShell>
  );
}
