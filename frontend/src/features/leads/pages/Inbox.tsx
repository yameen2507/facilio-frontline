/**
 * The lead inbox.
 *
 * `loaded` is tracked separately from `leads.length` on purpose. Without it, the
 * first paint of a cold load renders the empty state — "No open leads" — for the
 * second before data arrives, which reads as an answer rather than as a wait.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Gauge, Timer } from "lucide-react";
import { useCounts } from "../../../app/counts";
import { PageShell } from "../../../app/shell/PageShell";
import { ago, plural } from "../../../lib/format";
import { Button, LinkButton } from "../../../ui/Button";
import { Card } from "../../../ui/Card";
import { TableCell } from "@/components/ui/table";
import { CountLine } from "../../../ui/Row";
import { ClickRow, ListTable, ListTableSkeleton, type Col } from "../../../ui/DataTable";
import { CompanyLogo } from "../../../ui/CompanyLogo";
import { Empty, ErrorState } from "../../../ui/States";
import { Tabs } from "../../../ui/Tabs";
import { listLeads } from "../api/leads-util";
import { ScoreCell, SlaChip, StatusChip } from "../components/LeadChips";
import { countBuckets, filterLeads, type TabId } from "../filters";
import type { Lead } from "../types/lead";

/** Every leads console labels its columns; this one used not to. Status and
    score step aside on phones — company + response clock is the triage view. */
const COLS: Col[] = [
  { label: "Company", icon: Building2, skel: "entity" },
  { label: "Status", className: "max-sm:hidden w-32", skel: "chip" },
  { label: "Score", icon: Gauge, className: "max-sm:hidden w-24", skel: "num" },
  { label: "Response", icon: Timer, className: "w-36", skel: "chip" },
];

export function Inbox() {
  const navigate = useNavigate();
  const { setOpenLeads } = useCounts();

  const [leads, setLeads] = useState<Lead[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("open");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let live = true;
    // `loaded` is NOT reset here. On a manual refresh the existing rows should stay
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
      title="Inbox"
      actions={
        <Button small glyph="refresh" onClick={reload}>
          Refresh
        </Button>
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
      <div className="mt-4">
        <Card pad={false}>
          {!loaded ? (
            <ListTableSkeleton cols={COLS} rows={6} />
          ) : error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : rows.length ? (
            <>
              <ListTable cols={COLS}>
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
                            <code className="font-mono">{l.refNo}</code> · {l.source}
                            {l.serviceType ? ` · ${l.serviceType}` : ""}
                            {l.siteCity ? ` · ${l.siteCity}` : ""} ·{" "}
                            {l.ownerEmail ? l.ownerEmail.split("@")[0] : <em>unclaimed</em>}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="w-32 px-4 py-3 max-sm:hidden">
                      <StatusChip status={l.status} />
                    </TableCell>
                    <TableCell className="w-24 px-4 py-3 max-sm:hidden">
                      <ScoreCell lead={l} />
                    </TableCell>
                    <TableCell className="w-36 px-4 py-3">
                      <SlaChip sla={l.sla} />
                      <div className="text-muted-foreground mt-1 text-xs">{ago(l.createdAt)}</div>
                    </TableCell>
                  </ClickRow>
                ))}
              </ListTable>
              <CountLine>{`${plural(rows.length, "lead", "leads")} in this view`}</CountLine>
            </>
          ) : (
            <Empty
              title={tab === "open" ? "No open leads" : "Nothing in this view"}
              body="Enquiries arrive here from the website chat and land as unclaimed leads."
              action={<LinkButton to="/chat">Try the website chat</LinkButton>}
            />
          )}
        </Card>
      </div>
    </PageShell>
  );
}
