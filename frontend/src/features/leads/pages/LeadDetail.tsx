/**
 * One lead: everything known about it, and every move available on it.
 *
 * Three things here are load-bearing and easy to undo by accident:
 *
 * 1. **The assessment runs in the BROWSER, not the server.** A function aborts at
 *    the ~10s fetch timeout and a model call is slower than that
 *    (ARCHITECTURE.md §8a). So: ask the server for the prompt, call the agent from
 *    here, post the reply back to be parsed and stored. This page is the reason the
 *    UI is not optional.
 * 2. **Mutations render from their own response.** Each handler returns the
 *    refreshed `detail`, so an action costs one round trip instead of two.
 * 3. **Every async completion is guarded.** The lead id can change under this
 *    component (it is the same component for `/leads/a` and `/leads/b`), and a
 *    reply that lands after the user moved on must not paint the previous lead's
 *    data over the current one.
 *
 * Known gap, stated rather than hidden: the destructive and data-entry actions use
 * `prompt()` / `confirm()`, inherited from the vanilla console. A close
 * confirmation should name its consequence in a real dialog. Replacing them is a
 * separate piece of work.
 */

import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useActor } from "../../../app/auth";
import { PageShell } from "../../../app/shell/PageShell";
import { ago, humanise, money } from "../../../lib/format";
import { errMessage } from "../../../lib/request";
import { vibe } from "../../../lib/vibe";
import { Button } from "../../../ui/Button";
import { Bar, Card, Split, Stack } from "../../../ui/Card";
import { Chip } from "../../../ui/Chip";
import { Facts } from "../../../ui/Facts";
import { LeadDetailSkeleton } from "../../../ui/Skeleton";
import { ErrorState } from "../../../ui/States";
import { useToast } from "../../../ui/Toast";
import { actionsFor, type LeadActionId } from "../actions";
import {
  analyseInput,
  assignLead,
  claimLead,
  convertLead,
  getLead,
  logCall,
  storeAnalysis,
  transitionLead,
  updateLead,
} from "../api/leads-util";
import { AiAssessment } from "../components/AiAssessment";
import { StatusChip, SlaChip } from "../components/LeadChips";
import { LifecycleSteps } from "../components/LifecycleSteps";
import { ResponseClocks } from "../components/ResponseClocks";
import { Ownership, Timeline } from "../components/Timeline";
import { TranscriptCard } from "../components/TranscriptCard";
import type { LeadDetail as LeadDetailShape } from "../types/lead";

export function LeadDetail() {
  const { id = "" } = useParams();
  const actor = useActor();
  const toast = useToast();

  const [detail, setDetail] = useState<LeadDetailShape | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assessing, setAssessing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Which lead this component is currently showing. An async reply checks against
  // it before writing, which is what stops a slow response for lead A from
  // painting over lead B after a navigation.
  const showing = useRef(id);
  showing.current = id;

  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    []
  );

  useEffect(() => {
    let live = true;
    setDetail(null);
    setError(null);

    getLead(id).then(({ data, error: err }) => {
      if (!live) return;
      if (err) setError(err);
      else setDetail(data);
    });

    return () => {
      live = false;
    };
  }, [id, reloadKey]);

  /**
   * Applies a mutation's own returned view.
   *
   * The sidebar's open-lead count is deliberately NOT refreshed here. The vanilla
   * console refetched a hundred leads after every action to update one integer;
   * returning to the inbox remounts it and refetches anyway, so the badge is stale
   * only while you stay on this page.
   */
  const settled = (result: { detail: LeadDetailShape } | null, message: string) => {
    if (!result) return;
    if (!mounted.current) return;
    toast(message);
    // The write is guarded even though the toast is not: an action started on lead
    // A must never paint its result over lead B, but the user still wants to hear
    // that it worked.
    if (showing.current === id) setDetail(result.detail);
  };

  /** Reports a rejection and returns null, so callers can `if (!ok) return`. */
  const unwrap = <T,>(res: { data: T | null; error: string | null }): T | null => {
    if (res.error) {
      toast(res.error, true);
      return null;
    }
    return res.data;
  };

  async function assess() {
    setAssessing(true);
    try {
      // 1. The prompt is built server-side from settings, so the scope brief that
      //    drives relevance is never duplicated in this client.
      const prep = unwrap(await analyseInput(id));
      if (!prep) return;

      // 2. The model call, from the page. A function would abort before it returns.
      const reply = await vibe.executeAgent<{ response?: { content?: string } }>(prep.agent, prep.input);
      const content = reply?.response?.content;
      if (!content) {
        toast("The assessor returned nothing", true);
        return;
      }

      // 3. Parsed, clamped and stored as a new version server-side.
      const stored = unwrap(await storeAnalysis(id, content));
      if (!stored) return;

      settled(stored, `${humanise(stored.verdict)} · score ${stored.score}`);
    } catch (err) {
      toast(errMessage(err, "The assessment failed"), true);
    } finally {
      // The await chain spans several seconds; the user may well have left.
      if (mounted.current) setAssessing(false);
    }
  }

  if (error) {
    return (
      <PageShell title="Lead">
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      </PageShell>
    );
  }

  if (!detail) {
    return (
      <PageShell title="Lead">
        <LeadDetailSkeleton />
      </PageShell>
    );
  }

  const lead = detail.lead;
  const token = lead.data?.intakeSessionToken;

  const HANDLERS: Record<LeadActionId, { label: string; primary?: boolean; run: () => Promise<void> | void }> = {
    claim: {
      label: "Claim",
      primary: true,
      run: async () => settled(unwrap(await claimLead(id, actor)), "Claimed — it's yours"),
    },
    "log-call": {
      label: "Log a call",
      run: async () => {
        const body = prompt("What happened on the call?");
        if (!body) return;
        settled(unwrap(await logCall(id, body, actor)), "Call logged");
      },
    },
    assess: { label: "Assess with AI", primary: true, run: assess },
    reassess: { label: "Re-assess", run: assess },
    qualify: {
      label: "Qualify",
      run: async () => settled(unwrap(await transitionLead(id, "qualified", actor)), "Qualified"),
    },
    nurture: {
      label: "Nurture",
      run: async () => {
        const until = prompt(
          "Bring this back on which date? (YYYY-MM-DD)",
          new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10)
        );
        if (!until) return;
        // Two steps: the status change is validated by the state machine, the date
        // is an ordinary field edit. Only the second one's view is rendered — the
        // first would be stale a moment later.
        if (!unwrap(await transitionLead(id, "nurture", actor, { note: `Nurturing until ${until}` }))) return;
        settled(unwrap(await updateLead(id, { nurtureUntil: until }, actor)), `Parked until ${until}`);
      },
    },
    assign: {
      label: "Assign…",
      run: async () => {
        const who = prompt("Assign to which email?", actor);
        if (!who) return;
        const role = confirm("OK = hand to SALES owner\nCancel = reassign the ACTIONER") ? "sales" : "actioner";
        settled(
          unwrap(await assignLead(id, who, role, actor)),
          `${role === "sales" ? "Sales owner" : "Actioner"} set to ${who}`
        );
      },
    },
    convert: {
      label: "Convert to deal",
      primary: true,
      run: async () => {
        const r = unwrap(await convertLead(id, actor));
        if (r) settled(r, `${r.dealRefNo} created · ${r.queued.length} Facilio writes queued`);
      },
    },
    close: {
      label: "Close",
      run: async () => {
        const reason = prompt(
          "Why is this closing?\nspam · outside_region · wrong_service · not_interested · no_budget · no_response · lost_to_competitor",
          "not_interested"
        );
        if (!reason) return;
        settled(unwrap(await transitionLead(id, "closed", actor, { dispositionReason: reason })), "Closed");
      },
    },
  };

  // The action set is a pure function of the lead's state, and it is unit-tested.
  // "assess" is dropped from the bar because the AI card carries it when there is
  // no verdict yet — two buttons for one action on one screen.
  const actions = actionsFor(lead, Boolean(detail.analysis)).filter((a) => a !== "assess");

  return (
    <PageShell
      title={lead.companyName}
      subtitle={`${lead.refNo} · from ${lead.source} · ${ago(lead.createdAt)}`}
      actions={
        <Button small glyph="refresh" onClick={() => setReloadKey((k) => k + 1)}>
          Refresh
        </Button>
      }
    >
      <Bar style={{ marginBottom: "var(--spacing-container-large)" }}>
        {actions.map((a) => (
          <Button
            key={a}
            variant={HANDLERS[a].primary ? "primary" : "default"}
            onClick={() => void HANDLERS[a].run()}
            disabled={a === "reassess" && assessing}
          >
            {a === "reassess" && assessing ? "Assessing…" : HANDLERS[a].label}
          </Button>
        ))}
        <span className="grow" />
        <StatusChip status={lead.status} />
        <SlaChip sla={detail.sla} />
      </Bar>

      <Card style={{ marginBottom: "var(--spacing-container-large)" }}>
        <LifecycleSteps lead={lead} />
      </Card>

      <Split>
        <Stack>
          <Card title="Enquiry">
            <div style={{ marginBottom: "var(--spacing-container-large)" }}>
              {lead.description ?? "No description captured."}
            </div>
            <Facts
              items={[
                { label: "Contact", value: lead.contactName ?? "—" },
                { label: "Service", value: lead.serviceType ?? "—" },
                {
                  label: "Email",
                  value: lead.contactEmail ? <a href={`mailto:${lead.contactEmail}`}>{lead.contactEmail}</a> : "—",
                },
                {
                  label: "Phone",
                  value: lead.contactPhone ? <a href={`tel:${lead.contactPhone}`}>{lead.contactPhone}</a> : "—",
                },
                {
                  label: "Location",
                  value: `${lead.siteCity ?? "—"}${lead.siteAddress ? `, ${lead.siteAddress}` : ""}`,
                },
                { label: "Est. value", value: money(lead.estimatedValue, lead.currency ?? "AED") },
                { label: "Owner", value: lead.ownerEmail ?? "unclaimed" },
                { label: "Deal", value: lead.dealId ? <Chip tone="green">created</Chip> : "—" },
                {
                  label: "Account",
                  value: lead.accountId ? <Link to={`/accounts/${lead.accountId}`}>Company page</Link> : "—",
                },
              ]}
            />
            {lead.dispositionReason ? (
              <div style={{ marginTop: "var(--spacing-container-medium)" }}>
                <Chip tone="red">{`closed: ${lead.dispositionReason}`}</Chip>
              </div>
            ) : null}
            {detail.duplicates.length ? (
              <div style={{ marginTop: "var(--spacing-container-medium)" }}>
                <Chip tone="orange">
                  {`${detail.duplicates.length} duplicate ${
                    detail.duplicates.length === 1 ? "enquiry" : "enquiries"
                  } merged in`}
                </Chip>
              </div>
            ) : null}
          </Card>

          <Card title="Activity" meta={`${detail.timeline.length} events`}>
            <Timeline events={detail.timeline} />
          </Card>
        </Stack>

        <Stack>
          {token ? <TranscriptCard token={token} /> : null}

          <Card title="AI assessment">
            <AiAssessment
              lead={lead}
              band={detail.band}
              analysis={detail.analysis}
              onAssess={() => void assess()}
              assessing={assessing}
            />
          </Card>

          <Card title="Response clocks">
            <ResponseClocks lead={lead} />
          </Card>

          <Card title="Ownership">
            <Ownership assignments={detail.assignments} />
          </Card>
        </Stack>
      </Split>
    </PageShell>
  );
}
