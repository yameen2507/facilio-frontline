/**
 * The lead inbox.
 *
 * `loaded` is tracked separately from `leads.length` on purpose. Without it, the
 * first paint of a cold load renders the empty state — "No open leads" — for the
 * second before data arrives, which reads as an answer rather than as a wait.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCounts } from "../../../app/counts";
import { PageShell } from "../../../app/shell/PageShell";
import { ago, plural } from "../../../lib/format";
import { Button, LinkButton } from "../../../ui/Button";
import { Card } from "../../../ui/Card";
import { CountLine, Row, RowTitle, TableHead } from "../../../ui/Row";
import { SkeletonRows } from "../../../ui/Skeleton";
import { Empty, ErrorState } from "../../../ui/States";
import { Tabs } from "../../../ui/Tabs";
import { listLeads } from "../api/leads-util";
import { ScoreCell, SlaChip, StatusChip } from "../components/LeadChips";
import { countBuckets, filterLeads, type TabId } from "../filters";
import type { Lead } from "../types/lead";

/** Every leads console labels its columns; this one used not to. */
const COLUMNS = ["Company", "Status", "Score", "Response"];

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
      subtitle={`${counts.open} open · ${counts.overdue} overdue`}
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
      <div style={{ marginTop: "var(--spacing-container-large)" }}>
        <Card pad={false}>
          {!loaded ? (
            <>
              {/* The heading renders for real while the rows shimmer — it is known
                  before the request, and skeletonising it would make a fast load
                  look broken. */}
              <TableHead columns={COLUMNS} />
              <SkeletonRows count={6} />
            </>
          ) : error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : rows.length ? (
            <>
              <TableHead columns={COLUMNS} />
              {rows.map((l) => (
                <Row key={l.id} onClick={() => navigate(`/leads/${l.id}`)}>
                  <RowTitle
                    title={l.companyName}
                    meta={
                      <>
                        <code className="mono">{l.refNo}</code> · {l.source}
                        {l.serviceType ? ` · ${l.serviceType}` : ""}
                        {l.siteCity ? ` · ${l.siteCity}` : ""} ·{" "}
                        {l.ownerEmail ? l.ownerEmail.split("@")[0] : <em>unclaimed</em>}
                      </>
                    }
                  />
                  <div>
                    <StatusChip status={l.status} />
                  </div>
                  <ScoreCell lead={l} />
                  <div>
                    <SlaChip sla={l.sla} />
                    <div className="meta">{ago(l.createdAt)}</div>
                  </div>
                </Row>
              ))}
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
