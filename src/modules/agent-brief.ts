/**
 * The input each wired agent is handed.
 *
 * Every one of these agents opens with the same INPUT CONTRACT: "the caller
 * sends one message containing labelled blocks; treat these as the ONLY sources
 * of truth." So a brief is exactly that — named blocks, built here, on the
 * server, from the tables. The browser makes the model call (a function aborts
 * at the ~10s fetch timeout) but it never composes the prompt: the block names
 * are part of each agent's contract, and a client that spelled one differently
 * would get an agent quietly reporting the data as absent.
 *
 * OPTIONAL BLOCKS ARE OMITTED, NEVER FAKED. Each agent declares what to do with
 * a missing block — set `tenderProvided=No`, treat manpower as needing an
 * estimator, mark a pattern "Insufficient data". That is the honest answer and
 * the agents already know how to give it, so a block with nothing behind it is
 * simply not sent. The one thing always sent is CURRENT_DATE: absent it, four
 * of the five refuse to reason about urgency or expiry at all.
 *
 * QUERY BUDGET. Every `query()` costs ~194ms of fixed bridge overhead
 * (shared/db.ts), so each builder below is at most two statements — one for the
 * entity through its existing getter, one batched read for everything else.
 */

import { many, one } from "../shared/db";
import { dedupKeys } from "../domain/normalize";
import { configData, coverageBrief } from "./settings";
import { findDuplicate, getLead } from "./lead";
import { getProposal } from "./proposal";
import { handoffPayload } from "./survey";
import type { AgentName } from "./assessment";

// --- block assembly -----------------------------------------------------------

type Block = { label: string; body: string } | null;

/** A block is dropped when its body is empty — see the header. */
const block = (label: string, body: unknown): Block => {
  if (body === null || body === undefined) return null;
  const text = typeof body === "string" ? body.trim() : JSON.stringify(body, null, 1);
  if (!text || text === "{}" || text === "[]" || text === "null") return null;
  return { label, body: text };
};

const compose = (blocks: Block[]): string =>
  blocks
    .filter((b): b is { label: string; body: string } => b !== null)
    .map((b) => `${b.label}:\n${b.body}`)
    .join("\n\n");

/** Plain "Label: value" lines, skipping anything absent. */
const lines = (pairs: Array<[string, unknown]>): string =>
  pairs
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join("\n");

/**
 * Minor units are the wire format everywhere in this app (ARCHITECTURE.md §7),
 * and an agent asked to check pricing must not be handed 170100 where the
 * proposal says 1,701.00 — it would report a mismatch against every source.
 */
const money = (minor: unknown, currency: unknown): string | null =>
  typeof minor === "number" ? `${(minor / 100).toFixed(2)} ${String(currency ?? "")}`.trim() : null;

/** ISO date, stamped server-side. Four of the five agents require it by name. */
const today = (): string => new Date().toISOString().slice(0, 10);

export interface Brief {
  /** The LOGICAL agent name for `vibe.executeAgent` — never the link name. */
  agent: AgentName;
  entityId: string;
  input: string;
}

// --- proposal lane ------------------------------------------------------------

interface ProposalContext {
  deal: { data: Record<string, unknown> | null; stage: string | null; currency: string | null } | null;
  snapshot: unknown;
  cardRows: Array<Record<string, unknown>>;
  services: Array<Record<string, unknown>>;
}

/**
 * Everything BESIDE the proposal that the two proposal-lane agents read, in one
 * statement. Both need the survey behind the price and the card the price came
 * from; only the estimation review needs the catalogue.
 */
function proposalContext(proposalId: string): ProposalContext {
  const row = one<ProposalContext>(
    `select
       (select row_to_json(x) from (
          select d.data_json, d.stage, d.currency
            from fl_deal d
           where d.id = (select deal_id from fl_proposal where id = $1)
           limit 1
        ) x) as deal_obj,

       (select r.snapshot_json from fl_survey_revision r
         where r.id = (select survey_revision_id from fl_proposal where id = $1)
         limit 1) as snapshot_json,

       (select coalesce(json_agg(x), '[]'::json) from (
          select estimation_key, description, service_code, pricing_basis, uom,
                 price, min_charge, default_frequency, condition_multipliers_json
            from fl_rate_card_row
           where rate_card_id = (select rate_card_id from fl_proposal where id = $1)
             and is_active = 'true'
           limit 500
        ) x) as card_rows_arr,

       -- NOT active = 'true'. The flag is nullable — rows written before
       -- saveService existed carry none — and everywhere else in this app an
       -- absent flag means active (see settings.coverageBrief).
       (select coalesce(json_agg(x), '[]'::json) from (
          select code, name
            from fl_service_line
           where coalesce(active, 'true') <> 'false'
           limit 200
        ) x) as services_arr`,
    [proposalId]
  );

  return {
    deal: row?.deal ?? null,
    snapshot: row?.snapshot ?? null,
    cardRows: row?.cardRows ?? [],
    services: row?.services ?? [],
  };
}

/** The proposal as a document, not as a table — what the agent is reviewing. */
function proposalDraft(proposal: Record<string, unknown>): string {
  const currency = proposal.currency;
  const rows = (proposal.lines as Array<Record<string, unknown>> | undefined) ?? [];

  const head = lines([
    ["Reference", `${proposal.refNo} v${proposal.revisionNo ?? 1}`],
    ["Title", proposal.title],
    ["Status", proposal.status],
    ["Currency", currency],
    ["Contract type", proposal.contractType],
    ["Liability threshold", money(proposal.liabilityThresholdAmount, currency)],
    ["Payment terms", proposal.paymentTerms],
    ["Expected programme", proposal.expectedProgramme],
    ["Valid until", proposal.validUntil ?? "no expiry set"],
    ["One-time total", money(proposal.totalOneTime, currency)],
    ["Recurring monthly total", money(proposal.totalRecurringMonthly, currency)],
    ["Optional one-time (excluded from total)", money(proposal.optionalOneTimeTotal, currency)],
    ["Optional recurring (excluded from total)", money(proposal.optionalRecurringMonthlyTotal, currency)],
  ]);

  // One line per line, in the order the client reads them. `card price` and
  // `charged` are both shown on purpose: the gap between them IS the discount,
  // and an agent asked to check pricing against the rate card needs to see both
  // rather than infer one from a percentage.
  const body = rows.length
    ? rows
        .map((l, i) => {
          const parts = [
            `${i + 1}. ${l.description ?? "(no description)"}`,
            l.serviceCode ? `service ${l.serviceCode}` : null,
            l.estimationKey ? `estimation_key ${l.estimationKey}` : null,
            `qty ${l.qty ?? 0} ${l.uom ?? ""}`.trim(),
            `frequency ${l.frequency ?? "one_time"}`,
            `card price ${money(l.cardPrice, currency) ?? "not priced"}`,
            `charged ${money(l.appliedPrice, currency) ?? "not priced"}`,
            l.pricingMode && l.pricingMode !== "standard" ? `mode ${l.pricingMode}` : null,
            l.deltaValue ? `delta ${l.deltaValue} (${l.deltaType ?? ""})` : null,
            l.deltaReason ? `reason "${l.deltaReason}"` : null,
            `line total ${money(l.lineTotal, currency) ?? "-"}`,
            l.isOptional ? "OPTIONAL — prints but never joins the total" : null,
            l.source ? `source ${l.source}` : null,
            l.notes ? `notes "${l.notes}"` : null,
          ].filter(Boolean);
          return parts.join(" | ");
        })
        .join("\n")
    : "(no lines on this proposal)";

  const readiness = (proposal.warnings as string[] | undefined) ?? [];

  return [
    head,
    "",
    "LINES:",
    body,
    readiness.length ? `\nThe app's own pre-send warnings:\n- ${readiness.join("\n- ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * `proposal-intelligence` — the final quality-control read before a proposal is
 * sent, per the agent's own architecture boundary.
 *
 * TENDER_REQUIREMENTS is never sent: this app has no tender store, and the
 * agent's contract says to set `tenderProvided=No` and treat tender checks as
 * N/A when it is absent. That is the honest output, not a degraded one.
 */
export function proposalCheckBrief(proposalId: string): Brief {
  const { proposal } = getProposal(proposalId);
  const ctx = proposalContext(proposalId);

  const input = compose([
    block("CURRENT_DATE", today()),
    block("PROPOSAL_DRAFT", proposalDraft(proposal)),
    // The discovery sheet is this app's confirmed-requirements record — the
    // fields the deal captured before anything was priced.
    block("CUSTOMER_REQUIREMENTS", ctx.deal?.data?.discovery ?? null),
    block("VALIDATED_SURVEY", ctx.snapshot),
    // There is no estimation entity in this app: the proposal's own lines ARE
    // the approved estimation, so what the agent compares against is the rate
    // card those lines were priced from.
    block(
      "APPROVED_ESTIMATION",
      ctx.cardRows.length
        ? {
            note: "This app holds no separate estimation. The proposal lines are the estimation; the rate card below is the approved commercial source they were priced from.",
            rate_card: proposal.rateCard ?? null,
            rate_card_resolved_reason: proposal.rateCardResolvedReason ?? null,
            rows: ctx.cardRows,
          }
        : null
    ),
  ]);

  return { agent: "proposal-intelligence", entityId: proposalId, input };
}

/**
 * `estimation-intelligence` — reviewing the lines that were generated, not
 * producing them. Generation is a deterministic join from the frozen survey to
 * the rate card (`proposal.generateLines`) and stays that way; this agent reads
 * the result and says where the quantities, rates and minimums do not hold up.
 *
 * APPROVED_ASSUMPTIONS is never sent because no productivity or manpower rules
 * are configured anywhere in this app. Its contract then flags manpower as
 * requiring estimator input rather than inventing a productivity rule, which is
 * the correct answer.
 */
export function estimationReviewBrief(proposalId: string): Brief {
  const { proposal } = getProposal(proposalId);
  const ctx = proposalContext(proposalId);

  const input = compose([
    block("CURRENT_DATE", today()),
    block("VALIDATED_SURVEY", ctx.snapshot),
    block("DEAL_REQUIREMENTS", ctx.deal?.data?.discovery ?? null),
    block("SERVICE_CONFIG", ctx.services),
    block(
      "RATE_CARD",
      proposal.rateCard
        ? {
            card: proposal.rateCard,
            why_this_card: proposal.rateCardResolvedReason ?? null,
            prices_are_in: "integer minor units",
            rows: ctx.cardRows,
          }
        : null
    ),
    // Not one of its declared blocks, and labelled as the thing under review so
    // it cannot be mistaken for a source of quantities.
    block("ESTIMATION_UNDER_REVIEW", proposalDraft(proposal)),
  ]);

  return { agent: "estimation-intelligence", entityId: proposalId, input };
}

// --- survey lane --------------------------------------------------------------

/**
 * `survey-intelligence` — read before the revision is frozen, which is the last
 * point at which fixing a bad measurement is cheap.
 *
 * SURVEY is the handoff payload rather than the survey row: the payload is the
 * §5 contract the estimator prices from, so an agent checking whether the survey
 * is ready for estimation should be reading exactly what estimation will read.
 */
export function surveyReviewBrief(surveyId: string): Brief {
  const payload = handoffPayload(surveyId);

  const ctx = one<{
    survey: Record<string, unknown> | null;
    deal: { data: Record<string, unknown> | null } | null;
    services: Array<Record<string, unknown>>;
    photos: Array<Record<string, unknown>>;
  }>(
    `select
       (select row_to_json(x) from (
          select s.ref_no, s.title, s.status, s.contract_intent, s.revision_no,
                 s.completeness_pct, s.not_visited_pct, s.target_completion_date,
                 s.notes,
                 (select a.name from fl_account a where a.id = s.account_id) as account_name
            from fl_survey s where s.id = $1 limit 1
        ) x) as survey_obj,

       (select row_to_json(x) from (
          select d.data_json from fl_deal d
           where d.id = (select deal_id from fl_survey where id = $1)
           limit 1
        ) x) as deal_obj,

       (select coalesce(json_agg(x), '[]'::json) from (
          select code, name
            from fl_service_line
           where coalesce(active, 'true') <> 'false'
           limit 200
        ) x) as services_arr,

       (select coalesce(json_agg(x), '[]'::json) from (
          select p.entity_type, p.file_name, p.caption
            from fl_photo p
           where p.entity_id = $1
              or p.entity_id in (select id from fl_survey_visit where survey_id = $1)
           limit 300
        ) x) as photos_arr`,
    [surveyId]
  );

  const input = compose([
    block("CURRENT_DATE", today()),
    block("SURVEY", { record: ctx?.survey ?? null, handoff_payload: payload }),
    block("DEAL_REQUIREMENTS", ctx?.deal?.data?.discovery ?? null),
    block("CONFIGURED_SERVICES", ctx?.services ?? []),
    // The index, not the images: this agent reads text, and what it does with
    // photos is flag where expected evidence is MISSING.
    block("PHOTOS_INDEX", ctx?.photos ?? []),
  ]);

  return { agent: "survey-intelligence", entityId: surveyId, input };
}

// --- deal lane ----------------------------------------------------------------

/**
 * `lost-deal-intelligence` — the read the lose dialog was built for. Its
 * capture sheet (reason, detail, competitor, sentiment, future opportunity) is
 * the most complete agent input in this app and until now nothing read it.
 *
 * HISTORICAL_DEALS is other lost deals. Sent only when there are some: with one
 * deal the agent's contract makes it label every cross-deal pattern
 * "Insufficient data", which is right, and it says so itself.
 */
export function lossAnalysisBrief(dealId: string): Brief {
  const row = one<{
    deal: Record<string, unknown> | null;
    proposals: Array<Record<string, unknown>>;
    history: Array<Record<string, unknown>>;
  }>(
    `select
       (select row_to_json(x) from (
          select d.id, d.ref_no, d.title, d.stage, d.currency, d.estimated_value,
                 d.lost_at, d.lost_reason, d.source, d.data_json,
                 (select a.name from fl_account a where a.id = d.account_id) as account_name,
                 (select a.address_json from fl_account a where a.id = d.account_id) as account_address_json
            from fl_deal d where d.id = $1 limit 1
        ) x) as deal_obj,

       (select coalesce(json_agg(x order by x.revision_no), '[]'::json) from (
          select ref_no, revision_no, status, currency, total_one_time,
                 total_recurring_monthly, decision, decision_reason, sent_at
            from fl_proposal
           where deal_id = $1 and is_active = 'true'
           limit 50
        ) x) as proposals_arr,

       (select coalesce(json_agg(x order by x.lost_at desc), '[]'::json) from (
          select d.ref_no, d.title, d.currency, d.estimated_value, d.lost_at,
                 d.lost_reason, d.data_json,
                 (select a.address_json from fl_account a where a.id = d.account_id) as account_address_json
            from fl_deal d
           where d.stage = 'lost' and d.id <> $1
           order by d.lost_at desc
           limit 30
        ) x) as history_arr`,
    [dealId]
  );

  const deal = row?.deal;
  if (!deal) throw new Error(`deal ${dealId} not found`);
  if (deal.stage !== "lost") {
    throw new Error("this deal is not lost — there is nothing for the loss analysis to read");
  }

  const data = (deal.data as Record<string, unknown> | null) ?? {};
  const proposals = row?.proposals ?? [];
  const latest = proposals[proposals.length - 1] ?? null;

  const input = compose([
    block("CURRENT_DATE", today()),
    block("LOST_DEAL", {
      reference: deal.refNo,
      name: deal.title,
      account: deal.accountName,
      account_address: deal.accountAddress ?? null,
      arrived_via: deal.source,
      currency: deal.currency,
      deal_value: money(deal.estimatedValue as number, deal.currency),
      lost_at: deal.lostAt,
      primary_loss_reason: deal.lostReason,
      // The lose dialog's own fields, verbatim.
      loss_capture: data.lost ?? null,
      discovery: data.discovery ?? null,
      negotiation: data.negotiation ?? null,
      proposal_history: proposals,
    }),
    block(
      "APPROVED_COMMERCIAL",
      latest
        ? {
            note: "The last proposal issued on this deal, as the approved commercial position.",
            proposal: latest,
          }
        : null
    ),
    block("HISTORICAL_DEALS", row?.history?.length ? row.history : null),
  ]);

  return { agent: "lost-deal-intelligence", entityId: dealId, input };
}

/**
 * `handover-intelligence` — turning a won deal into something Operations can
 * act on without reading the sales history.
 *
 * WHAT THIS APP CAN AND CANNOT GIVE IT, stated plainly because the agent will
 * report the gap either way. There is no contract module here, so there is no
 * signed document, no approved manpower and no negotiated exclusions beyond
 * what the survey qualified. What there IS: the win capture (final value,
 * contract dates), the accepted proposal and its lines (services, frequencies,
 * quantities), the portfolio tree (sites), and the contacts. That is most of a
 * handover and all of the commercial half.
 *
 * So the agent is handed what exists and left to flag the rest — which is what
 * its `documents` field tags Missing and its `outstandingActions` field lists.
 * A brief that invented a manpower plan to look complete would be worse than
 * one that admits there is no contract yet.
 *
 * THE PROPOSAL IS CHOSEN, NOT GUESSED. Accepted beats sent, and the newest
 * revision beats an older one — a handover built from a superseded version is
 * a handover of a price nobody agreed to.
 */
export function handoverBrief(dealId: string): Brief {
  const row = one<{
    deal: Record<string, unknown> | null;
    contacts: Array<Record<string, unknown>>;
    proposal: Record<string, unknown> | null;
    lines: Array<Record<string, unknown>>;
    sites: Array<Record<string, unknown>>;
    snapshot: unknown;
  }>(
    `select
       (select row_to_json(x) from (
          select d.id, d.ref_no, d.title, d.stage, d.currency, d.estimated_value,
                 d.won_at, d.sales_owner_email, d.data_json,
                 (select a.name from fl_account a where a.id = d.account_id) as account_name,
                 (select a.address_json from fl_account a where a.id = d.account_id) as account_address_json
            from fl_deal d where d.id = $1 limit 1
        ) x) as deal_obj,

       (select coalesce(json_agg(x), '[]'::json) from (
          select c.name, c.email, c.phone, c.is_primary
            from fl_account_contact c
           where c.account_id = (select account_id from fl_deal where id = $1)
           limit 20
        ) x) as contacts_arr,

       -- Accepted first, then sent, newest revision of either. Anything still
       -- in draft or withdrawn is not what the customer agreed to.
       (select row_to_json(x) from (
          select p.id, p.ref_no, p.revision_no, p.status, p.currency,
                 p.contract_type, p.payment_terms, p.expected_programme,
                 p.valid_until, p.total_one_time, p.total_recurring_monthly,
                 p.decision, p.decided_at, p.sent_at, p.survey_revision_id
            from fl_proposal p
           where p.deal_id = $1 and p.is_active = 'true'
             and p.status in ('accepted', 'sent')
           order by case when p.status = 'accepted' then 0 else 1 end, p.revision_no desc
           limit 1
        ) x) as proposal_obj,

       (select coalesce(json_agg(x order by x.sequence_no), '[]'::json) from (
          select l.description, l.service_code, l.qty, l.uom, l.frequency,
                 l.is_optional, l.notes, l.sequence_no, l.line_total
            from fl_proposal_line l
           where l.is_active = 'true'
             and l.proposal_id = (
               select p.id from fl_proposal p
                where p.deal_id = $1 and p.is_active = 'true'
                  and p.status in ('accepted', 'sent')
                order by case when p.status = 'accepted' then 0 else 1 end, p.revision_no desc
                limit 1)
        ) x) as lines_arr,

       (select coalesce(json_agg(x order by x.ancestry_path), '[]'::json) from (
          -- Operating hours ride along: "when can we get in" is a handover
          -- question, and this is the only table that answers it.
          select n.name, n.type, n.ancestry_path, n.area as area_sqft,
                 n.no_of_floors, n.room_count, n.restroom_count, n.verdict,
                 n.street, n.city, n.state, n.country, n.site_type,
                 n.operation_hours_start, n.operation_hours_end, n.max_occupancy
            from fl_portfolio_location n
           where n.deal_id = $1 and n.is_active = 'true'
           limit 500
        ) x) as sites_arr,

       -- Carries the survey's qualifications, which is where this app's
       -- exclusions actually live.
       (select r.snapshot_json from fl_survey_revision r
         where r.id = (
           select p.survey_revision_id from fl_proposal p
            where p.deal_id = $1 and p.is_active = 'true'
              and p.status in ('accepted', 'sent')
            order by case when p.status = 'accepted' then 0 else 1 end, p.revision_no desc
            limit 1)
         limit 1) as snapshot_json`,
    [dealId]
  );

  const deal = row?.deal;
  if (!deal) throw new Error(`deal ${dealId} not found`);
  if (deal.stage !== "won") {
    throw new Error("this deal is not won — a handover is prepared from a won deal");
  }

  const data = (deal.data as Record<string, unknown> | null) ?? {};
  const proposal = row?.proposal ?? null;

  const input = compose([
    block("CURRENT_DATE", today()),
    block("WON_DEAL", {
      reference: deal.refNo,
      name: deal.title,
      customer: deal.accountName,
      customer_address: deal.accountAddress ?? null,
      won_at: deal.wonAt,
      sales_owner: deal.salesOwnerEmail,
      currency: deal.currency,
      // The win dialog's own fields — the only contract facts this app holds.
      contract: data.won ?? null,
      contract_note:
        "This app has no contract module. There is no signed document, no approved manpower plan and no negotiated exclusion list beyond the survey qualifications below. Report those as missing rather than inferring them.",
      original_requirements: data.discovery ?? null,
      contacts: row?.contacts ?? [],
      sites: row?.sites ?? [],
      agreed_services: row?.lines ?? [],
    }),
    block(
      "FINAL_PROPOSAL",
      proposal
        ? {
            ...proposal,
            selected_because:
              proposal.status === "accepted"
                ? "the accepted proposal, newest revision"
                : "the newest sent proposal — none has been marked accepted",
            totals_are_in: "integer minor units",
            lines: row?.lines ?? [],
          }
        : null
    ),
    block("FINAL_SURVEY", row?.snapshot ?? null),
  ]);

  return { agent: "handover-intelligence", entityId: dealId, input };
}

// --- lead lane ----------------------------------------------------------------

/**
 * `lead-intelligence` — a SECOND read on a lead, beside the live `lead-analyst`
 * and never instead of it.
 *
 * They do not compete. The analyst returns a 0-100 score and a verdict enum,
 * both denormalised onto `fl_lead` so the inbox can sort and filter without a
 * join (modules/analysis.ts). This agent's schema has neither — its closest
 * field is a P1/P2/P3 priority — so swapping it in would leave the queue with
 * nothing to order by. It answers the questions the analyst does not: what is
 * missing, what is a red flag, is this a duplicate, what should the actioner do
 * next. Nothing here ever writes `fl_lead`.
 */
export function leadIntelBrief(leadId: string): Brief {
  const lead = getLead(leadId);
  if (!lead) throw new Error(`lead ${leadId} not found`);

  const data = configData();
  // The same duplicate check intake runs at creation, re-run at read time — a
  // lead that was unique in March may not be in August.
  const duplicate = findDuplicate(dedupKeys(lead));

  // `fl_account` carries no `is_active` column — it has never been soft-deleted
  // — so there is nothing to filter on here beyond the name.
  const candidates = many<Record<string, unknown>>(
    `select a.id, a.name, a.website_domain, a.address_json, a.facilio_client_id
       from fl_account a
      where lower(a.name) = lower($1)
      limit 5`,
    [lead.companyName ?? ""]
  );

  const input = compose([
    block("CURRENT_DATE", today()),
    // coverageBrief is the same scope text the live analyst is judged against —
    // one source, so the two agents can never disagree about what we sell.
    block("CONFIGURED_SERVICES_AND_SUPPORTED_REGIONS", coverageBrief(data)),
    block("LEAD", {
      reference: lead.refNo,
      company: lead.companyName,
      contact: lead.contactName,
      email: lead.contactEmail,
      phone: lead.contactPhone,
      website: lead.websiteDomain,
      service_asked_for: lead.serviceType,
      enquiry: lead.description,
      site_address: lead.siteAddress,
      city: lead.siteCity,
      region: lead.siteRegion,
      stated_value: money(lead.estimatedValue, lead.currency),
      value_type: lead.valueType,
      value_frequency: lead.valueFrequency,
      arrived_via: lead.source,
      came_from: lead.origin,
      status: lead.status,
      arrived_at: lead.arrivedAt,
      // The analyst's own verdict, so this agent is not asked to re-derive a
      // score — and can say where it disagrees.
      analyst_verdict: lead.verdict,
      analyst_score: lead.score,
    }),
    block(
      "CANDIDATE_MATCHES",
      duplicate || candidates.length
        ? { duplicate_lead: duplicate, accounts_with_this_name: candidates }
        : null
    ),
  ]);

  return { agent: "lead-intelligence", entityId: leadId, input };
}

// --- dispatch -----------------------------------------------------------------

const BUILDERS: Record<AgentName, (entityId: string) => Brief> = {
  "proposal-intelligence": proposalCheckBrief,
  "estimation-intelligence": estimationReviewBrief,
  "survey-intelligence": surveyReviewBrief,
  "lost-deal-intelligence": lossAnalysisBrief,
  "handover-intelligence": handoverBrief,
  "lead-intelligence": leadIntelBrief,
};

/** The brief for one agent against one record. Throws on an unwired agent. */
export function buildBrief(agent: string, entityId: string): Brief {
  const builder = BUILDERS[agent as AgentName];
  if (!builder) {
    throw new Error(`no brief is built for agent "${agent}"`);
  }
  return builder(entityId);
}
