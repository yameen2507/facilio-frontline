/**
 * The lead inbox.
 *
 * `loaded` is tracked separately from `leads.length` on purpose. Without it, the
 * first paint of a cold load renders the empty state — "No open leads" — for the
 * second before data arrives, which reads as an answer rather than as a wait.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Clock3, Gauge, Timer } from "lucide-react";
import { useAccess } from "../../../app/access";
import { useCounts } from "../../../app/counts";
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
import { countBuckets, filterLeads, type TabId } from "../filters";
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

/** The entity cell's second line, shared by the table cell and the phone card
    so the two can never describe a lead differently. */
const LeadMeta = ({ lead: l }: { lead: Lead }) => (
  <>
    <code className="font-mono">{l.refNo}</code> · {l.source}
    {l.serviceType ? ` · ${l.serviceType}` : ""}
    {l.siteCity ? ` · ${l.siteCity}` : ""} ·{" "}
    {l.ownerEmail ? l.ownerEmail.split("@")[0] : <em>unclaimed</em>}
  </>
);

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
  const [tab, setTab] = useState<TabId>("open");
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
  const rows = useMemo(() => filterLeads(leads, tab), [leads, tab]);

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
        <Tabs
          items={[
            { id: "open", label: "Open", count: counts.open },
            { id: "unclaimed", label: "Unclaimed", count: counts.unclaimed },
            { id: "overdue", label: "Overdue", count: counts.overdue },
            { id: "won", label: "Won", count: counts.won },
            { id: "closed", label: "Closed", count: counts.closed },
          ]}
          active={tab}
          onChange={setTab}
        />
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
        ) : (
          // No buttons here: the body already says where leads come from and
          // that one can be raised by hand, and the header's New lead sits a
          // few pixels above. Repeating it turned an explanation into a pitch.
          <Empty
            title={tab === "open" ? "No open leads" : "Nothing in this view"}
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
