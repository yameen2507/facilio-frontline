/**
 * The proposal aggregate — the only writer of `fl_proposal` and
 * `fl_proposal_line` (ARCHITECTURE.md §9 r2, one writer per aggregate).
 *
 * A proposal turns a frozen survey revision into priced lines using a rate
 * card. The pure math lives in `domain/pricing.ts` (the estimation-key join,
 * condition multipliers, frequency, totals) and `domain/proposal-pricing.ts`
 * (card resolution and the pricing modes). This file is the plumbing between
 * them and the database, and it owns exactly one thing neither of those can:
 *
 *   MONEY CROSSES A UNIT BOUNDARY HERE, AND ONLY HERE.
 *
 * JS holds integer MINOR units end to end (ARCHITECTURE.md §7). The columns are
 * `numeric(14,2)` holding MAJOR units, because that is what a human reads in
 * SQL and what a CSV export should contain. `toMinor` on read, `toMajor` on
 * write, nowhere else — a second conversion site is a second rounding bug, and
 * a missed one is money off by a factor of a hundred.
 */

import {
  conditionMultiplier,
  draftLinesFromHandoff,
  isFrequency,
  priceLine,
  quoteReadiness,
  quoteTotals,
  type Frequency,
  type HandoffPayload,
  type RateEntry,
  type ScaleDirection,
} from "../domain/pricing";
import {
  applyMode,
  deviationPct,
  isDeltaType,
  isPricingMode,
  modeBlockers,
  resolveRateCard,
  type DeltaType,
  type PricingMode,
  type ResolvableCard,
} from "../domain/proposal-pricing";
import {
  approvalDecision,
  canRecordNegotiation,
  canRevise,
  daysToExpiry,
  effectiveStatus,
  isNegotiationKind,
  isProposalStatus,
  nextStatus,
  transitionBlocker,
  NEGOTIATION_KINDS,
  PROPOSAL_STATUSES,
  STATUS_LABEL,
  type ProposalStatus,
  type TransitionName,
} from "../domain/proposal-state";
import {
  diffProposals,
  type DiffableLine,
  type ProposalDiff,
} from "../domain/proposal-diff";
import {
  isSystemSectionKey,
  renderDocument,
  DEFAULT_TEMPLATE,
  SYSTEM_SECTION_KEYS,
  type ProposalTemplate,
  type RenderedDocument,
  type RenderLine,
  type TemplateSection,
  type TokenValues,
} from "../domain/proposal-document";
import { checksum } from "../domain/survey-revision";
import { many, mutate, nowIso, one, type Row } from "../shared/db";
import { appendEvent, timeline } from "../shared/events";
import { nextRef } from "../shared/ids";
import { parseJson, upsertJsonKey } from "../shared/row-map";

// --- money at the boundary -----------------------------------------------------

/**
 * Every currency this product prices in has two minor digits. When that stops
 * being true (JOD and KWD have three, JPY has none) this constant becomes a
 * lookup on the proposal's currency — it is deliberately named so that the
 * change has one obvious home rather than a hundred call sites.
 */
const MINOR_DIGITS = 2;
const MINOR_FACTOR = 10 ** MINOR_DIGITS;

/** DB (major, numeric) -> JS (minor, integer). */
const toMinor = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * MINOR_FACTOR) : null;
};

/** JS (minor, integer) -> DB (major, numeric). */
const toMajor = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v / MINOR_FACTOR : null;

const bool = (v: unknown): boolean => v === true || v === "true";
const flag = (v: boolean): string => (v ? "true" : "false");

// --- shapes --------------------------------------------------------------------

/**
 * The lifecycle vocabulary lives in `domain/proposal-state.ts` and is re-exported
 * here so the function file keeps one import. A second copy of the status list
 * is a second state machine, and they diverge the week nobody is looking.
 */
export { PROPOSAL_STATUSES, type ProposalStatus };

export type LineSource = "survey_entry" | "recommendation" | "manual" | "external_schedule";

export const LINE_SOURCES: readonly LineSource[] = [
  "survey_entry",
  "recommendation",
  "manual",
  "external_schedule",
];

export const PRICING_BASES = ["unit", "hour", "visit"] as const;

/** `uom` depends on `pricing_basis` (roles&response §4.3). */
export const UNITS_BY_BASIS: Record<string, readonly string[]> = {
  unit: ["sq_ft", "sq_m", "washroom", "room", "person", "site", "each"],
  hour: ["hour"],
  visit: ["per_visit"],
};

const PROPOSAL_COLUMNS = `
  id, ref_no, deal_id, account_id, survey_id, survey_revision_id,
  rate_card_id, rate_card_resolved_reason, title, status, currency,
  contract_type, liability_threshold_amount, condition_scale_direction,
  payment_terms, expected_programme,
  one_time_subtotal, recurring_monthly_subtotal,
  optional_one_time_total, optional_recurring_monthly_total,
  total_one_time, total_recurring_monthly, valid_until,
  template_id, document_json, deviation_pct,
  approved_by, approved_at, sent_by, sent_at, checksum,
  revision_no, parent_proposal_id, superseded_by_proposal_id,
  decision, decision_reason, decided_at, notes,
  created_by, updated_by, created_at, updated_at`;

const LINE_COLUMNS = `
  id, proposal_id, sequence_no, description, facilio_service_id, service_code,
  scope_node_id, estimation_key, source, source_ref_id, qty, pricing_basis, uom,
  frequency, rate_card_id, rate_card_row_id, card_price, pricing_mode,
  delta_type, delta_value, delta_reason, applied_price, line_total,
  condition_score, condition_multiplier, per_occurrence_amount,
  monthly_equivalent_amount, one_time_amount, is_optional, notes`;

/** Every money column, so the unit conversion is a list and not a guess. */
const PROPOSAL_MONEY = [
  "liabilityThresholdAmount",
  "oneTimeSubtotal",
  "recurringMonthlySubtotal",
  "optionalOneTimeTotal",
  "optionalRecurringMonthlyTotal",
  "totalOneTime",
  "totalRecurringMonthly",
] as const;

const LINE_MONEY = [
  "cardPrice",
  "appliedPrice",
  "lineTotal",
  "perOccurrenceAmount",
  "monthlyEquivalentAmount",
  "oneTimeAmount",
] as const;

/**
 * A rate card row's own money, converted only where a card is READ FOR ADMIN.
 * `toRateEntry` already converts on the pricing path, so routing that through
 * here as well would halve every price by converting twice.
 */
const CARD_ROW_MONEY = ["price", "minCharge"] as const;

/** `deltaValue` is NOT here on purpose: a percentage is not money. */
const readMoney = (row: Row, fields: readonly string[]): Row => {
  for (const f of fields) row[f] = toMinor(row[f]);
  return row;
};

// --- rate card -----------------------------------------------------------------

interface RateCardRow extends Row {
  id: string;
  estimationKey: string | null;
  description: string | null;
  serviceCode: string | null;
  facilioServiceId: string | null;
  pricingBasis: string | null;
  uom: string | null;
  price: number | null;
  minCharge: number | null;
  conditionMultipliers: Record<string, number> | null;
  defaultFrequency: string | null;
}

export interface ResolvedService {
  serviceCode: string | null;
  facilioServiceId: string | null;
}

/**
 * Turn a service code into the pair that gets stored, and enforce C23.
 *
 * C23 is held as written: every service referenced anywhere — rate card,
 * proposal line, contract line — is a FACILIO SERVICES RECORD ID, never an
 * app-local definition. The trap it exists to prevent is an app-local
 * catalogue quietly hardening into the source of truth, which is exactly what
 * a free-text service box becomes once a hundred rows reference it.
 *
 * So the local code is treated as a LOOKUP KEY and nothing more: it must name a
 * real `fl_service_line` row, and the Facilio id is read from that row's
 * mapping rather than typed again here. An admin links a service once on the
 * Service links page and every rate card row referencing it inherits the id —
 * which is what makes the mapping load-bearing instead of decorative. Before
 * today nothing read it at all.
 *
 * The id stays NULLABLE on purpose. L10 (the Facilio Services read action and
 * its id shape) is unresolved and G1 has never been run, so there is nothing to
 * populate it from yet. Refusing to save an unlinked service would block the
 * whole lane on an unanswered question; recording the code and leaving the id
 * null is §14.6's stated position — nullable referencing columns, no invented
 * catalogue.
 */
function resolveService(
  serviceCode: string | null | undefined,
  explicitFacilioId: string | null | undefined
): ResolvedService {
  const code = typeof serviceCode === "string" ? serviceCode.trim() : "";
  if (!code) {
    // No code is legitimate — a custom line prices something the catalogue
    // does not carry, which is the whole point of the custom mode.
    return { serviceCode: null, facilioServiceId: explicitFacilioId ?? null };
  }

  const line = one<{ id: string; code: string; active: string | null; data: { facilio_service_id?: string } | null }>(
    `select id, code, active, data_json from fl_service_line where code = $1 limit 1`,
    [code]
  );

  if (!line) {
    throw new Error(
      `"${code}" is not a service — add it on the Service links page first, so every row that prices it points at one record`
    );
  }
  if (line.active === "false") {
    throw new Error(`service "${code}" is retired — reactivate it before pricing against it`);
  }

  // An explicitly supplied id wins, so a one-off correction is possible without
  // editing the catalogue; otherwise inherit the mapping.
  const mapped = line.data?.facilio_service_id ?? null;
  return {
    serviceCode: line.code,
    facilioServiceId: explicitFacilioId ?? (mapped && mapped !== "none" ? mapped : null),
  };
}

function loadCards(): ResolvableCard[] {
  return many<ResolvableCard>(
    `select id, name, status, region, client_account_id, priority,
            effective_from, effective_to
       from fl_rate_card
      where is_active = 'true'
      limit 200`
  );
}

function loadCardRows(rateCardId: string): RateCardRow[] {
  return many<RateCardRow>(
    `select id, estimation_key, description, service_code, facilio_service_id,
            pricing_basis, uom, price, min_charge, condition_multipliers_json,
            default_frequency
       from fl_rate_card_row
      where rate_card_id = $1 and is_active = 'true'
      limit 1000`,
    [rateCardId]
  );
}

/** A card row as `domain/pricing.ts` wants it: minor units, typed frequency. */
function toRateEntry(row: RateCardRow, direction: ScaleDirection): RateEntry {
  const frequency = row.defaultFrequency;
  return {
    estimationKey: row.estimationKey,
    description: row.description,
    serviceCode: row.serviceCode,
    facilioServiceId: row.facilioServiceId,
    uom: row.uom,
    price: toMinor(row.price) ?? 0,
    minCharge: toMinor(row.minCharge),
    conditionMultipliers: row.conditionMultipliers,
    conditionScaleDirection: direction,
    defaultFrequency: isFrequency(frequency) ? frequency : "one_time",
  };
}

// --- create --------------------------------------------------------------------

export interface CreateProposalInput {
  dealId: string;
  /** Optional: C22, a simple customer is priced straight from a call. */
  surveyRevisionId?: string | null;
  title?: string | null;
  contractType?: string | null;
  actor: string;
}

export function createProposal(input: CreateProposalInput): { proposal: Row } {
  // Region drives which rate card applies, and it is not stored in one place:
  // the account carries a free-form address, while `site_region` is captured on
  // the originating lead. Prefer the account (it is the enduring record) and
  // fall back to the lead, rather than silently resolving a card as unregioned.
  const deal = one<{ id: string; accountId: string | null; title: string | null; region: string | null }>(
    `select d.id, d.account_id, d.title,
            coalesce(
              (select (coalesce(nullif(a.address_json::text, ''), '{}'))::jsonb ->> 'region'
                 from fl_account a where a.id = d.account_id limit 1),
              (select l.site_region from fl_lead l where l.id = d.lead_id limit 1)
            ) as region
       from fl_deal d where d.id = $1 limit 1`,
    [input.dealId]
  );
  if (!deal) throw new Error(`deal ${input.dealId} not found`);

  // The revision must exist AND be readable before anything is stamped: a
  // proposal pointing at a payload nobody can open is worse than no proposal.
  let revision: { id: string; surveyId: string } | null = null;
  if (input.surveyRevisionId) {
    revision = one(
      `select id, survey_id from fl_survey_revision where id = $1 limit 1`,
      [input.surveyRevisionId]
    );
    if (!revision) throw new Error(`survey revision ${input.surveyRevisionId} not found`);
  }

  const now = nowIso();
  const resolution = resolveRateCard(loadCards(), {
    region: deal.region,
    accountId: deal.accountId,
    on: now,
  });

  // No card is not an error — an estimator can still build a proposal by hand
  // out of custom lines. It IS something they must be told, in words.
  const reason =
    resolution?.reason ??
    "no active rate card matched this client, region and date — lines must be priced by hand";

  const card = resolution
    ? one<{ currency: string | null; conditionScaleDirection: string | null }>(
        `select currency, condition_scale_direction from fl_rate_card where id = $1 limit 1`,
        [resolution.card.id]
      )
    : null;

  const refNo = nextRef("proposal");

  const row = one<{ id: string }>(
    `insert into fl_proposal
       (id, ref_no, deal_id, account_id, survey_id, survey_revision_id,
        rate_card_id, rate_card_resolved_reason, title, status, currency,
        contract_type, condition_scale_direction,
        one_time_subtotal, recurring_monthly_subtotal,
        optional_one_time_total, optional_recurring_monthly_total,
        tax_pct, tax_one_time, tax_recurring_monthly,
        total_one_time, total_recurring_monthly,
        document_json, deviation_pct, frozen_json, revision_no,
        created_by, updated_by, is_active, data_json, created_at, updated_at)
     values (gen_random_uuid()::text, $1, $2, $3, $4, $5,
             $6, $7, $8, 'draft', $9,
             $10, $11,
             0, 0, 0, 0,
             0, 0, 0, 0, 0,
             '{}', 0, '{}', 1,
             $12, $12, 'true', '{}', $13, $13)
     returning id`,
    [
      refNo,
      deal.id,
      deal.accountId,
      revision?.surveyId ?? null,
      revision?.id ?? null,
      resolution?.card.id ?? null,
      reason,
      input.title ?? deal.title ?? refNo,
      // Currency is stamped from the resolved card at creation and never moves
      // (spec §10 call 7): one proposal, one currency.
      card?.currency ?? "AED",
      input.contractType ?? "non_comprehensive",
      card?.conditionScaleDirection ?? "1_is_worst",
      input.actor,
      now,
    ]
  );
  if (!row) throw new Error("proposal insert returned no row");

  appendEvent({
    entityType: "proposal",
    entityId: row.id,
    kind: "created",
    actor: input.actor,
    body: `${refNo} created — ${reason}`,
    meta: { refNo, rateCardId: resolution?.card.id ?? null, surveyRevisionId: revision?.id ?? null },
  });

  return getProposal(row.id);
}

// --- line generation (the survey -> priced scope moment) ------------------------

export function generateLines(proposalId: string, actor: string): {
  proposal: Row;
  created: number;
  unpriced: Array<{ reason: string; estimationKey?: string; label?: string }>;
  warnings: string[];
} {
  const proposal = one<Row>(
    `select id, ref_no, survey_revision_id, rate_card_id, condition_scale_direction, status
       from fl_proposal where id = $1 and is_active = 'true' limit 1`,
    [proposalId]
  );
  if (!proposal) throw new Error(`proposal ${proposalId} not found`);
  if (proposal.status !== "draft") {
    throw new Error(`lines can only be generated on a draft — this proposal is ${proposal.status}`);
  }
  if (!proposal.surveyRevisionId) {
    throw new Error("this proposal has no survey revision — add lines by hand instead");
  }
  if (!proposal.rateCardId) {
    throw new Error("no rate card resolved for this proposal — lines must be priced by hand");
  }

  const revision = one<{ snapshot: HandoffPayload | null; checksum: string | null; surveyId: string }>(
    `select snapshot_json, checksum, survey_id from fl_survey_revision where id = $1 limit 1`,
    [proposal.surveyRevisionId]
  );
  if (!revision) throw new Error(`survey revision ${proposal.surveyRevisionId} not found`);

  // §5 rule 3: a cancelled survey never appears in a handoff. Enforced here,
  // explicitly, rather than trusted to whoever built the payload.
  const survey = one<{ status: string }>(
    `select status from fl_survey where id = $1 limit 1`,
    [revision.surveyId]
  );
  if (survey?.status === "cancelled") {
    throw new Error("this survey was cancelled — a cancelled survey is never priced");
  }

  const payload = revision.snapshot ?? {};
  const direction: ScaleDirection =
    proposal.conditionScaleDirection === "1_is_best" ? "1_is_best" : "1_is_worst";

  const cardRows = loadCardRows(String(proposal.rateCardId));
  const byKey = new Map(cardRows.filter((r) => r.estimationKey).map((r) => [r.estimationKey as string, r]));
  const entries = cardRows.map((r) => toRateEntry(r, direction));

  const draft = draftLinesFromHandoff(payload, entries);

  // Replacing, not appending: re-running generation on a draft must be
  // idempotent, or a second click doubles the price of the job.
  const removed = mutate(
    `update fl_proposal_line set is_active = 'false', updated_at = $2, updated_by = $3
      where proposal_id = $1 and is_active = 'true' and source in ('survey_entry', 'recommendation')`,
    [proposalId, nowIso(), actor]
  );

  const now = nowIso();
  let sequenceNo = 0;
  for (const line of draft.lines) {
    const cardRow = line.estimationKey ? byKey.get(line.estimationKey) : undefined;
    sequenceNo += 1;

    // Generated lines start at standard: the card price IS the applied price
    // until a human decides otherwise, and every deviation after that is theirs.
    const cardPrice = line.cardPrice;
    const lineTotal = line.oneTime ?? line.monthlyEquivalent ?? null;

    mutate(
      `insert into fl_proposal_line
         (id, proposal_id, sequence_no, description, facilio_service_id, service_code,
          scope_node_id, estimation_key, source, source_ref_id, qty, pricing_basis, uom,
          frequency, rate_card_id, rate_card_row_id, card_price, pricing_mode,
          delta_type, delta_value, delta_reason, applied_price, line_total,
          condition_score, condition_multiplier, per_occurrence_amount,
          monthly_equivalent_amount, one_time_amount, is_optional, notes,
          source_answer_id, source_observation_id,
          created_by, updated_by, is_active, data_json, created_at, updated_at)
       values (gen_random_uuid()::text, $1, $2, $3, $4, $5,
               $6, $7, $8, null, $9, $10, $11,
               $12, $13, $14, $15, 'standard',
               null, 0, null, $16, $17,
               $18, $19, $20,
               $21, $22, $23, null,
               null, null,
               $24, $24, 'true', '{}', $25, $25)`,
      [
        proposalId,
        sequenceNo,
        line.description,
        line.facilioServiceId,
        line.serviceCode,
        line.scopeNodeId,
        line.estimationKey,
        line.sourceRole === "recommendation" ? "recommendation" : "survey_entry",
        line.qty,
        cardRow?.pricingBasis ?? "unit",
        line.uom,
        line.frequency,
        proposal.rateCardId,
        cardRow?.id ?? null,
        toMajor(cardPrice),
        toMajor(cardPrice),
        toMajor(lineTotal),
        line.conditionScore,
        line.conditionMultiplier,
        toMajor(line.perOccurrence),
        toMajor(line.monthlyEquivalent),
        toMajor(line.oneTime),
        flag(line.isOptional),
        actor,
        now,
      ]
    );
  }

  recomputeTotals(proposalId, actor);

  appendEvent({
    entityType: "proposal",
    entityId: proposalId,
    kind: "lines_generated",
    actor,
    body: `${draft.lines.length} line(s) drafted from the survey${
      draft.unpriced.length ? `, ${draft.unpriced.length} unpriced` : ""
    }`,
    meta: { created: draft.lines.length, replaced: removed, unpriced: draft.unpriced, warnings: draft.warnings },
  });

  return {
    ...getProposal(proposalId),
    created: draft.lines.length,
    // Published, never dropped — the estimator prices with eyes open.
    unpriced: draft.unpriced,
    warnings: draft.warnings,
  };
}

// --- totals --------------------------------------------------------------------

/**
 * Recomputed from the lines after every write. Derived, never accumulated: an
 * incrementally-maintained total drifts the first time a write half-fails, and
 * there are no transactions here to prevent that.
 */
export function recomputeTotals(proposalId: string, actor: string): void {
  const lines = many<Row>(
    `select is_optional, one_time_amount, monthly_equivalent_amount,
            card_price, applied_price, qty, condition_multiplier
       from fl_proposal_line
      where proposal_id = $1 and is_active = 'true'
      limit 1000`,
    [proposalId]
  );

  const totals = quoteTotals(
    lines.map((l) => ({
      isOptional: bool(l.isOptional),
      oneTime: toMinor(l.oneTimeAmount),
      monthlyEquivalent: toMinor(l.monthlyEquivalentAmount),
    }))
  );

  // Deviation is measured on the committed lines only: an optional line nobody
  // has bought yet should not send a proposal to an approver.
  //
  // It is WEIGHTED BY QUANTITY, and that matters. Summing bare unit prices puts
  // a 0.10 floor rate and a 450.00 call-out rate on equal footing, so a deep
  // discount on the line that carries the money reads as a rounding error.
  // What the approver needs is "how far did the MONEY move from the card",
  // which is the per-occurrence amount either side of the mode. Frequency is
  // identical on both sides of a line, so it cancels and is left out.
  const committed = lines.filter((l) => !bool(l.isOptional));
  const weigh = (price: unknown, l: Row): number => {
    const unit = toMinor(price);
    if (unit === null) return 0;
    const qty = Number(l.qty);
    const multiplier = Number(l.conditionMultiplier);
    return unit * (Number.isFinite(qty) ? qty : 0) * (Number.isFinite(multiplier) ? multiplier : 1);
  };
  const cardSum = committed.reduce((n, l) => n + weigh(l.cardPrice, l), 0);
  const appliedSum = committed.reduce((n, l) => n + weigh(l.appliedPrice, l), 0);

  mutate(
    `update fl_proposal
        set one_time_subtotal = $2, recurring_monthly_subtotal = $3,
            optional_one_time_total = $4, optional_recurring_monthly_total = $5,
            total_one_time = $2, total_recurring_monthly = $3,
            deviation_pct = $6, updated_at = $7, updated_by = $8
      where id = $1`,
    [
      proposalId,
      toMajor(totals.oneTimeSubtotal),
      toMajor(totals.recurringMonthlySubtotal),
      toMajor(totals.optionalOneTimeTotal),
      toMajor(totals.optionalRecurringMonthlyTotal),
      deviationPct(cardSum, appliedSum),
      nowIso(),
      actor,
    ]
  );
}

// --- approval threshold (spec §4, §10 call 4) ------------------------------------

/**
 * ONE threshold, ONE setting. Admin-editable, because 10% is a starting position
 * and not a law of nature.
 */
export const DISCOUNT_APPROVAL_PCT_KEY = "proposal.discount_approval_pct";
const DEFAULT_APPROVAL_PCT = 10;

/**
 * A setting stored before it had a shape can hold `{}`, and `value_json` may
 * hand back `"10"` rather than `10`. Both fall back rather than turning into
 * `NaN` — a NaN threshold sends every proposal to an approver, or none.
 */
const readPct = (raw: unknown): number => {
  if (raw === null || raw === undefined || typeof raw === "object") return DEFAULT_APPROVAL_PCT;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.abs(n) : DEFAULT_APPROVAL_PCT;
};

/** For callers outside the batched read — `send`, mainly. One query. */
export function approvalThresholdPct(): number {
  const row = one<{ value: unknown }>(
    "select value_json from fl_setting where key = $1 limit 1",
    [DISCOUNT_APPROVAL_PCT_KEY]
  );
  return readPct(row?.value);
}

// --- read ----------------------------------------------------------------------

export function getProposal(proposalId: string): { proposal: Row } {
  // ONE statement, not five: every query costs ~194ms of fixed bridge overhead
  // regardless of what it does (shared/db.ts). The approval threshold rides
  // along for the same reason — it is one row, and it is not worth 194ms.
  const row = one<Row>(
    `select
       (select row_to_json(x) from (
          select ${PROPOSAL_COLUMNS} from fl_proposal where id = $1 and is_active = 'true' limit 1
        ) x) as proposal_obj,

       (select coalesce(json_agg(x order by x.sequence_no), '[]'::json) from (
          select ${LINE_COLUMNS} from fl_proposal_line
           where proposal_id = $1 and is_active = 'true'
        ) x) as lines_arr,

       (select row_to_json(x) from (
          select id, name, currency, region, client_account_id, priority, status,
                 effective_from, effective_to, condition_scale_direction
            from fl_rate_card
           where id = (select rate_card_id from fl_proposal where id = $1)
           limit 1
        ) x) as rate_card_obj,

       (select row_to_json(x) from (
          select p.id, p.ref_no, p.revision_no, p.status
            from fl_proposal p
           where p.id = (select parent_proposal_id from fl_proposal where id = $1)
           limit 1
        ) x) as parent_obj,

       (select value_json from fl_setting where key = $2 limit 1) as approval_pct`,
    [proposalId, DISCOUNT_APPROVAL_PCT_KEY]
  );

  // `mapRow` STRIPS the `_obj` / `_arr` alias rather than camel-casing it, so
  // `proposal_obj` arrives as `proposal` and `lines_arr` as `lines`.
  const proposal = (row?.proposal ?? null) as Row | null;
  if (!proposal) throw new Error(`proposal ${proposalId} not found`);

  readMoney(proposal, PROPOSAL_MONEY);
  const lines = ((row?.lines ?? []) as Row[]).map((l) => {
    readMoney(l, LINE_MONEY);
    l.isOptional = bool(l.isOptional);
    return l;
  });

  proposal.lines = lines;
  proposal.rateCard = row?.rateCard ?? null;
  // Client-facing labels are v1, v2, v3 sharing one ref (spec §5 R5), so the
  // parent is what tells a reader which of them they are looking at.
  proposal.parent = row?.parent ?? null;

  const events = timeline("proposal", proposalId, 100);
  proposal.events = events;
  // The negotiation thread is a FILTERED QUERY over the one audit spine, not a
  // table of its own (spec §5 R2). A counter-offer is a thing that happened.
  proposal.negotiation = events.filter((e) => isNegotiationKind(e.kind));

  // Expiry is computed here, never stored, and never by a job (spec §5 R8).
  const now = nowIso();
  const stored = (proposal.status as ProposalStatus) ?? "draft";
  proposal.storedStatus = stored;
  proposal.status = effectiveStatus(stored, proposal.validUntil as string | null, now);
  proposal.daysToExpiry = daysToExpiry(proposal.validUntil as string | null, now);

  // What the approver would see if this were submitted now — the exception
  // list, not the document. Computed on read so the estimator sees the same
  // thing the approver will, before they send it on.
  proposal.approval = approvalDecision({
    thresholdPct: readPct(row?.approvalPct),
    lines: lines.map((l) => ({
      pricingMode: l.pricingMode as string | null,
      deviationPct: deviationPct(l.cardPrice as number | null, l.appliedPrice as number | null),
      isOptional: Boolean(l.isOptional),
      deltaReason: l.deltaReason as string | null,
      description: l.description as string | null,
    })),
  });

  // Warnings, never blocks (C8). The estimator decides; the app tells the truth.
  proposal.warnings = quoteReadiness({
    contractType: proposal.contractType as string | null,
    liabilityThresholdAmount: proposal.liabilityThresholdAmount as number | null,
    lines: lines.map((l) => ({
      cardPrice: l.cardPrice as number | null,
      isOptional: Boolean(l.isOptional),
    })),
    notVisitedPct: readNotVisitedPct(proposal.surveyRevisionId as string | null),
  });

  return { proposal };
}

/** From the frozen payload, not the live survey — the snapshot is the contract. */
function readNotVisitedPct(surveyRevisionId: string | null): number | null {
  if (!surveyRevisionId) return null;
  const row = one<{ snapshot: HandoffPayload | null }>(
    `select snapshot_json from fl_survey_revision where id = $1 limit 1`,
    [surveyRevisionId]
  );
  const pct = row?.snapshot?.survey?.not_visited_pct;
  return typeof pct === "number" ? pct : null;
}

export interface ListProposalsInput {
  status?: string | null;
  dealId?: string | null;
  accountId?: string | null;
  limit: number;
  offset: number;
}

export function listProposals(input: ListProposalsInput): { proposals: Row[]; truncated: boolean } {
  const where: string[] = ["p.is_active = 'true'"];
  const params: unknown[] = [];

  if (input.status) {
    params.push(input.status);
    where.push(`p.status = $${params.length}`);
  }
  if (input.dealId) {
    params.push(input.dealId);
    where.push(`p.deal_id = $${params.length}`);
  }
  if (input.accountId) {
    params.push(input.accountId);
    where.push(`p.account_id = $${params.length}`);
  }

  const rows = many<Row>(
    `select ${PROPOSAL_COLUMNS.replace(/\bid\b/, "p.id").trim()},
            (select a.name from fl_account a where a.id = p.account_id limit 1) as account_name,
            (select count(*) from fl_proposal_line l
              where l.proposal_id = p.id and l.is_active = 'true') as line_count
       from fl_proposal p
      where ${where.join(" and ")}
      order by p.created_at desc
      limit ${Math.max(1, Math.min(200, Math.floor(input.limit)))}
     offset ${Math.max(0, Math.floor(input.offset))}`,
    params
  );

  for (const r of rows) {
    readMoney(r, PROPOSAL_MONEY);
    // `deviation_pct` is `numeric` but not in row-map's coercion list, and this
    // read is on the FLAT wire where numerics arrive as strings — unlike `get`,
    // where `row_to_json` has already made them numbers. A list sorting on a
    // string percentage puts "9" after "10".
    const deviation = Number(r.deviationPct);
    r.deviationPct = Number.isFinite(deviation) ? deviation : 0;
  }

  return { proposals: rows, truncated: rows.length >= input.limit };
}

// --- line edits ----------------------------------------------------------------

export interface LineInput {
  proposalId: string;
  lineId?: string;
  description?: string | null;
  qty?: number | null;
  pricingBasis?: string | null;
  uom?: string | null;
  frequency?: string | null;
  cardPrice?: number | null;
  pricingMode?: string | null;
  deltaType?: string | null;
  deltaValue?: number | null;
  deltaReason?: string | null;
  isOptional?: boolean | null;
  facilioServiceId?: string | null;
  serviceCode?: string | null;
  notes?: string | null;
  actor: string;
}

function assertDraft(proposalId: string): Row {
  const proposal = one<Row>(
    `select id, ref_no, status, rate_card_id, condition_scale_direction
       from fl_proposal where id = $1 and is_active = 'true' limit 1`,
    [proposalId]
  );
  if (!proposal) throw new Error(`proposal ${proposalId} not found`);
  if (proposal.status !== "draft" && proposal.status !== "pending_approval") {
    // The revision boundary is `sent` (spec §5 R1). Before it, edits are just
    // edits; after it, a change means a new revision.
    throw new Error(`a ${proposal.status} proposal cannot be edited — revise it instead`);
  }
  return proposal;
}

/**
 * Price one line from its own inputs. Shared by add and update so the mode,
 * the floor and the rounding can never diverge between the two paths.
 */
function priceOne(
  line: {
    qty: number;
    cardPrice: number | null;
    pricingMode: PricingMode;
    deltaType: DeltaType | null;
    deltaValue: number | null;
    deltaReason: string | null;
    frequency: Frequency;
    conditionScore: number | null;
    minCharge: number | null;
    multipliers: Record<string, number> | null;
    direction: ScaleDirection;
  }
): {
  appliedPrice: number | null;
  perOccurrence: number | null;
  monthlyEquivalent: number | null;
  oneTime: number | null;
  lineTotal: number | null;
  multiplier: number;
  problems: string[];
} {
  const adjustment = conditionMultiplier(
    line.conditionScore,
    line.multipliers,
    line.direction,
    line.direction
  );

  const appliedPrice = applyMode({
    mode: line.pricingMode,
    deltaType: line.deltaType,
    deltaValue: line.deltaValue,
    deltaReason: line.deltaReason,
    cardPrice: line.cardPrice,
    // For a custom line the estimator's number arrives as the card price,
    // because there is no card row behind it to copy from.
    customPrice: line.cardPrice,
  });

  const problems = modeBlockers({
    mode: line.pricingMode,
    deltaType: line.deltaType,
    deltaValue: line.deltaValue,
    deltaReason: line.deltaReason,
    cardPrice: line.cardPrice,
    customPrice: line.cardPrice,
  });

  if (appliedPrice === null) {
    return {
      appliedPrice: null,
      perOccurrence: null,
      monthlyEquivalent: null,
      oneTime: null,
      lineTotal: null,
      multiplier: adjustment.multiplier,
      problems,
    };
  }

  // The floor applies to the price AFTER the mode, so a discount cannot take a
  // job below the cost of mobilising a crew.
  const price = priceLine({
    qty: line.qty,
    unitRate: appliedPrice,
    multiplier: adjustment.multiplier,
    minCharge: line.minCharge,
    frequency: line.frequency,
  });

  return {
    appliedPrice,
    perOccurrence: price.perOccurrence,
    monthlyEquivalent: price.monthlyEquivalent,
    oneTime: price.oneTime,
    lineTotal: price.oneTime ?? price.monthlyEquivalent,
    multiplier: adjustment.multiplier,
    problems,
  };
}

export function saveLine(input: LineInput): { proposal: Row; problems: string[] } {
  const proposal = assertDraft(input.proposalId);
  const direction: ScaleDirection =
    proposal.conditionScaleDirection === "1_is_best" ? "1_is_best" : "1_is_worst";

  const existing = input.lineId
    ? one<Row>(
        `select ${LINE_COLUMNS} from fl_proposal_line
          where id = $1 and proposal_id = $2 and is_active = 'true' limit 1`,
        [input.lineId, input.proposalId]
      )
    : null;
  if (input.lineId && !existing) throw new Error(`line ${input.lineId} not found on this proposal`);

  const cardRow = existing?.rateCardRowId
    ? one<RateCardRow>(
        `select id, price, min_charge, condition_multipliers_json, pricing_basis, uom
           from fl_rate_card_row where id = $1 limit 1`,
        [existing.rateCardRowId]
      )
    : null;

  const pick = <T>(next: T | null | undefined, prev: T | null | undefined, fallback: T): T =>
    next !== null && next !== undefined ? next : prev !== null && prev !== undefined ? prev : fallback;

  const mode = pick(input.pricingMode, existing?.pricingMode as string, "standard");
  const frequency = pick(input.frequency, existing?.frequency as string, "one_time");
  const basis = pick(input.pricingBasis, existing?.pricingBasis as string, "unit");

  if (!isPricingMode(mode)) throw new Error(`"${mode}" is not a pricing mode`);
  if (!isFrequency(frequency)) throw new Error(`"${frequency}" is not a frequency`);

  const deltaType = input.deltaType ?? (existing?.deltaType as string | null) ?? null;

  const priced = priceOne({
    qty: Number(pick(input.qty, existing?.qty as number, 1)),
    cardPrice: input.cardPrice ?? toMinor(existing?.cardPrice) ?? null,
    pricingMode: mode,
    deltaType: isDeltaType(deltaType) ? deltaType : null,
    deltaValue: input.deltaValue ?? (existing?.deltaValue as number | null) ?? null,
    deltaReason: input.deltaReason ?? (existing?.deltaReason as string | null) ?? null,
    frequency,
    conditionScore: (existing?.conditionScore as number | null) ?? null,
    minCharge: toMinor(cardRow?.minCharge),
    multipliers: cardRow?.conditionMultipliers ?? null,
    direction,
  });

  // Same C23 resolution the rate card uses: a named service must be a real
  // catalogue row and inherits its Facilio id, while a line with no service at
  // all stays legal — that is the custom-price case.
  const lineService = resolveService(
    input.serviceCode ?? (existing?.serviceCode as string | null),
    input.facilioServiceId ?? (existing?.facilioServiceId as string | null)
  );

  const now = nowIso();
  const qty = Number(pick(input.qty, existing?.qty as number, 1));
  const cardPrice = input.cardPrice ?? toMinor(existing?.cardPrice) ?? null;

  if (existing) {
    mutate(
      `update fl_proposal_line
          set description = $2, qty = $3, pricing_basis = $4, uom = $5, frequency = $6,
              card_price = $7, pricing_mode = $8, delta_type = $9, delta_value = $10,
              delta_reason = $11, applied_price = $12, line_total = $13,
              condition_multiplier = $14, per_occurrence_amount = $15,
              monthly_equivalent_amount = $16, one_time_amount = $17,
              is_optional = $18, facilio_service_id = $19, service_code = $20,
              notes = $21, updated_at = $22, updated_by = $23
        where id = $1`,
      [
        existing.id,
        pick(input.description, existing.description as string, ""),
        qty,
        basis,
        pick(input.uom, existing.uom as string, "each"),
        frequency,
        toMajor(cardPrice),
        mode,
        isDeltaType(deltaType) ? deltaType : null,
        input.deltaValue ?? existing.deltaValue ?? 0,
        input.deltaReason ?? existing.deltaReason ?? null,
        toMajor(priced.appliedPrice),
        toMajor(priced.lineTotal),
        priced.multiplier,
        toMajor(priced.perOccurrence),
        toMajor(priced.monthlyEquivalent),
        toMajor(priced.oneTime),
        flag(input.isOptional ?? bool(existing.isOptional)),
        lineService.facilioServiceId,
        lineService.serviceCode,
        input.notes ?? existing.notes ?? null,
        now,
        input.actor,
      ]
    );
  } else {
    const next = one<{ n: number }>(
      `select coalesce(max(sequence_no), 0) + 1 as n from fl_proposal_line
        where proposal_id = $1 and is_active = 'true'`,
      [input.proposalId]
    );

    mutate(
      `insert into fl_proposal_line
         (id, proposal_id, sequence_no, description, facilio_service_id, service_code,
          scope_node_id, estimation_key, source, source_ref_id, qty, pricing_basis, uom,
          frequency, rate_card_id, rate_card_row_id, card_price, pricing_mode,
          delta_type, delta_value, delta_reason, applied_price, line_total,
          condition_score, condition_multiplier, per_occurrence_amount,
          monthly_equivalent_amount, one_time_amount, is_optional, notes,
          source_answer_id, source_observation_id,
          created_by, updated_by, is_active, data_json, created_at, updated_at)
       values (gen_random_uuid()::text, $1, $2, $3, $4, $5,
               null, null, 'manual', null, $6, $7, $8,
               $9, $10, null, $11, $12,
               $13, $14, $15, $16, $17,
               null, $18, $19,
               $20, $21, $22, $23,
               null, null,
               $24, $24, 'true', '{}', $25, $25)`,
      [
        input.proposalId,
        next?.n ?? 1,
        input.description ?? "New line",
        lineService.facilioServiceId,
        lineService.serviceCode,
        qty,
        basis,
        input.uom ?? "each",
        frequency,
        proposal.rateCardId ?? null,
        toMajor(cardPrice),
        mode,
        isDeltaType(deltaType) ? deltaType : null,
        input.deltaValue ?? 0,
        input.deltaReason ?? null,
        toMajor(priced.appliedPrice),
        toMajor(priced.lineTotal),
        priced.multiplier,
        toMajor(priced.perOccurrence),
        toMajor(priced.monthlyEquivalent),
        toMajor(priced.oneTime),
        flag(input.isOptional ?? false),
        input.notes ?? null,
        input.actor,
        now,
      ]
    );
  }

  recomputeTotals(input.proposalId, input.actor);

  // Every deviation is written to the audit spine with its stated reason —
  // that is what the approver reads, and what makes the number defensible.
  if (mode !== "standard") {
    appendEvent({
      entityType: "proposal",
      entityId: input.proposalId,
      kind: "line_repriced",
      actor: input.actor,
      body: `${mode}${input.deltaValue ? ` ${input.deltaValue}${deltaType === "amount" ? "" : "%"}` : ""}${
        input.deltaReason ? ` — ${input.deltaReason}` : ""
      }`,
      meta: {
        lineId: existing?.id ?? null,
        mode,
        deltaType,
        deltaValue: input.deltaValue ?? null,
        reason: input.deltaReason ?? null,
        cardPrice,
        appliedPrice: priced.appliedPrice,
      },
    });
  }

  return { ...getProposal(input.proposalId), problems: priced.problems };
}

export function removeLine(proposalId: string, lineId: string, actor: string): { proposal: Row } {
  assertDraft(proposalId);

  // Deactivate, never hard-delete: the line is part of how this price was
  // arrived at, and an audit you can erase is not an audit.
  const affected = mutate(
    `update fl_proposal_line set is_active = 'false', updated_at = $3, updated_by = $4
      where id = $1 and proposal_id = $2 and is_active = 'true'`,
    [lineId, proposalId, nowIso(), actor]
  );
  if (!affected) throw new Error(`line ${lineId} not found on this proposal`);

  recomputeTotals(proposalId, actor);
  appendEvent({
    entityType: "proposal",
    entityId: proposalId,
    kind: "line_removed",
    actor,
    meta: { lineId },
  });

  return getProposal(proposalId);
}

// --- proposal edits -------------------------------------------------------------

export interface UpdateProposalInput {
  proposalId: string;
  title?: string | null;
  contractType?: string | null;
  liabilityThresholdAmount?: number | null;
  validUntil?: string | null;
  paymentTerms?: string | null;
  expectedProgramme?: string | null;
  notes?: string | null;
  actor: string;
}

/** Status is deliberately absent — status changes are their own operation. */
export function updateProposal(input: UpdateProposalInput): { proposal: Row } {
  assertDraft(input.proposalId);

  const sets: string[] = [];
  const params: unknown[] = [input.proposalId];
  const set = (column: string, value: unknown) => {
    if (value === undefined) return;
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };

  set("title", input.title);
  set("contract_type", input.contractType);
  // `toMajor(undefined)` is null, and `set` writes a null — so the undefined
  // has to be preserved BEFORE the conversion or "leave it alone" becomes
  // "clear it".
  set(
    "liability_threshold_amount",
    input.liabilityThresholdAmount === undefined ? undefined : toMajor(input.liabilityThresholdAmount)
  );
  set("valid_until", input.validUntil);
  set("payment_terms", input.paymentTerms);
  set("expected_programme", input.expectedProgramme);
  set("notes", input.notes);

  if (!sets.length) return getProposal(input.proposalId);

  params.push(nowIso(), input.actor);
  mutate(
    `update fl_proposal set ${sets.join(", ")}, updated_at = $${params.length - 1},
            updated_by = $${params.length}
      where id = $1`,
    params
  );

  appendEvent({
    entityType: "proposal",
    entityId: input.proposalId,
    kind: "updated",
    actor: input.actor,
    meta: { fields: sets.length },
  });

  return getProposal(input.proposalId);
}

// --- lifecycle (spec §1.3, §4) ---------------------------------------------------

interface LifecycleRow extends Row {
  id: string;
  refNo: string | null;
  status: string | null;
  validUntil: string | null;
  revisionNo: number | null;
  parentProposalId: string | null;
}

function loadLifecycle(proposalId: string): LifecycleRow {
  const row = one<LifecycleRow>(
    `select id, ref_no, status, valid_until, revision_no, parent_proposal_id
       from fl_proposal where id = $1 and is_active = 'true' limit 1`,
    [proposalId]
  );
  if (!row) throw new Error(`proposal ${proposalId} not found`);
  return row;
}

/** A status that came back out of a text column, narrowed. */
const storedStatus = (value: unknown): ProposalStatus =>
  isProposalStatus(value) ? value : "draft";

const label = (status: ProposalStatus): string => STATUS_LABEL[status].toLowerCase();

interface StatusWrite {
  proposalId: string;
  transition: TransitionName;
  /**
   * The status the DATABASE holds, never the effective one. Expiry is a
   * read-time reading of `sent` (spec §5 R8), and a client accepting a day
   * after the validity date is an acceptance to be recorded, not an error.
   */
  from: ProposalStatus;
  reason?: string | null;
  /** Columns stamped in the SAME statement as the status. */
  extra?: Array<[string, unknown]>;
  actor: string;
}

/**
 * The only path that moves a proposal's status. Every rule — which states an
 * action is legal from, and which actions owe a reason — comes from
 * `domain/proposal-state.ts` and is never re-stated here, because a rule
 * written twice is a rule that will be right once.
 */
function transition(write: StatusWrite): ProposalStatus {
  const blocker = transitionBlocker({
    status: write.from,
    transition: write.transition,
    reason: write.reason ?? null,
  });
  if (blocker) throw new Error(blocker);

  const to = nextStatus(write.transition);
  const sets = ["status = $2"];
  const params: unknown[] = [write.proposalId, to];

  for (const [column, value] of write.extra ?? []) {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  }

  params.push(nowIso(), write.actor);
  mutate(
    `update fl_proposal set ${sets.join(", ")},
            updated_at = $${params.length - 1}, updated_by = $${params.length}
      where id = $1`,
    params
  );

  return to;
}

/**
 * Spec §1.3 has TWO edges out of draft, not one: over the threshold it goes to
 * an approver, within authority it is approved automatically. §4 says the same
 * thing as a table — every line standard or marked up, or any discount inside
 * `proposal.discount_approval_pct`, needs nobody.
 *
 * Branching here is the difference between an approval GATE and an approval
 * TAX. Sending every clean proposal — the common case — to a human who has
 * nothing to decide is exactly the queue the threshold exists to prevent.
 */
export function submitForApproval(proposalId: string, actor: string): { proposal: Row } {
  const current = getProposal(proposalId).proposal;
  const from = storedStatus(current.storedStatus);
  const approval = current.approval as { needsApproval?: boolean; reason?: string; exceptions?: unknown[] } | null;
  const refNo = `${current.refNo} v${current.revisionNo ?? 1}`;

  if (!approval?.needsApproval) {
    const now = nowIso();
    transition({
      proposalId,
      transition: "approve",
      from,
      actor,
      // Stamped with the submitter, because the submitter is who carried the
      // authority — there was no second person, and pretending otherwise would
      // put a name against a decision nobody made.
      extra: [
        ["approved_by", actor],
        ["approved_at", now],
      ],
    });

    appendEvent({
      entityType: "proposal",
      entityId: proposalId,
      kind: "approved",
      actor,
      body: `${refNo} approved automatically — ${approval?.reason ?? "within authority"}. Nobody was asked.`,
      meta: { automatic: true },
    });

    return getProposal(proposalId);
  }

  transition({ proposalId, transition: "submit_for_approval", from, actor });

  appendEvent({
    entityType: "proposal",
    entityId: proposalId,
    kind: "submitted_for_approval",
    actor,
    body: `${refNo} sent for approval — ${approval.reason}`,
    meta: { exceptions: approval.exceptions ?? [] },
  });

  return getProposal(proposalId);
}

/**
 * Approves a DEVIATION FROM THE PRICE LIST, not the price list itself — the
 * rate card carries its own approval and the two must never be conflated
 * (spec §4). Allowed straight from draft as well, because a proposal within
 * authority is approved by the act of not needing anyone.
 */
export function approveProposal(proposalId: string, note: string | null, actor: string): { proposal: Row } {
  const row = loadLifecycle(proposalId);
  const now = nowIso();

  transition({
    proposalId,
    transition: "approve",
    from: storedStatus(row.status),
    actor,
    extra: [
      ["approved_by", actor],
      ["approved_at", now],
    ],
  });

  appendEvent({
    entityType: "proposal",
    entityId: proposalId,
    kind: "approved",
    actor,
    body: note ?? `${row.refNo} v${row.revisionNo ?? 1} approved`,
  });

  return getProposal(proposalId);
}

/** Back to draft, with the reason the estimator's next move depends on. */
export function returnProposal(proposalId: string, reason: string, actor: string): { proposal: Row } {
  const row = loadLifecycle(proposalId);

  transition({
    proposalId,
    transition: "return",
    from: storedStatus(row.status),
    reason,
    actor,
    // A returned proposal that still reads as approved is a proposal that can
    // be sent by anyone who does not look twice.
    extra: [
      ["approved_by", null],
      ["approved_at", null],
    ],
  });

  appendEvent({
    entityType: "proposal",
    entityId: proposalId,
    kind: "returned",
    actor,
    body: reason,
  });

  return getProposal(proposalId);
}

/**
 * Everything the client was issued, in the shape the app reads it — MINOR
 * units, exactly as `getProposal` hands them out. Freezing raw major-unit rows
 * on one path and mapped minor units on another would make two freezes of one
 * proposal disagree for a reason that has nothing to do with the offer.
 *
 * The timeline is deliberately absent: it keeps growing after the send, and a
 * payload that keeps changing cannot be checksummed.
 */
const FROZEN_SKIP = new Set([
  "lines",
  "rateCard",
  "parent",
  "events",
  "negotiation",
  "approval",
  "warnings",
  "document",
  "status",
  "storedStatus",
  "daysToExpiry",
]);

function freezePayload(
  proposal: Row,
  document: RenderedDocument,
  sentAt: string,
  sentBy: string
): Row {
  const core: Row = {};
  for (const key of Object.keys(proposal)) {
    if (!FROZEN_SKIP.has(key)) core[key] = proposal[key];
  }

  return {
    payloadVersion: "1.0",
    // `templateId` is taken from the document because the proposal row was
    // read BEFORE the render that may have stamped it — an audit artifact
    // that contradicts itself is worse than one that is merely terse.
    proposal: { ...core, status: "sent", templateId: document.templateId },
    lines: proposal.lines ?? [],
    rateCard: proposal.rateCard ?? null,
    document,
    sentAt,
    sentBy,
  };
}

/**
 * SEND — the irreversible one, and the only place three separate promises are
 * kept at once (spec §1.1, §5 R3):
 *
 *   the payload is frozen and checksummed, so their copy never changes;
 *   the document is snapshotted, so it is the page they were actually shown;
 *   the PARENT flips to superseded HERE and nowhere else — exactly one
 *   revision is live at a time, and honouring a price you never issued is
 *   what happens when that flip goes anywhere earlier.
 */
export function sendProposal(proposalId: string, actor: string): {
  proposal: Row;
  checksum: string;
  supersededProposalId: string | null;
} {
  const current = getProposal(proposalId).proposal;
  const stored = storedStatus(current.storedStatus);

  const blocker = transitionBlocker({ status: stored, transition: "send" });
  if (blocker) throw new Error(blocker);

  // The state table already restricts `send` to an approved proposal, so this
  // cannot fire today. It states the BUSINESS rule (spec §4) rather than the
  // table's, so that loosening the table can never quietly let a deviation out
  // of the building unapproved.
  const approval = current.approval as { needsApproval?: boolean; reason?: string } | null;
  if (approval?.needsApproval && stored !== "approved") {
    throw new Error(`this proposal needs approval before it can be sent — ${approval.reason ?? ""}`);
  }

  const document = renderProposal({ proposalId, actor }).document;

  const now = nowIso();
  const frozen = freezePayload(current, document, now, actor);
  const stamp = checksum(frozen);

  transition({
    proposalId,
    transition: "send",
    from: stored,
    actor,
    extra: [
      ["frozen_json", JSON.stringify(frozen)],
      ["checksum", stamp],
      ["sent_by", actor],
      ["sent_at", now],
    ],
  });

  let supersededProposalId: string | null = null;
  let supersedeSkipped: string | null = null;
  const parentId = current.parentProposalId as string | null;

  if (parentId) {
    const parent = loadLifecycle(parentId);
    const parentBlocker = transitionBlocker({
      status: storedStatus(parent.status),
      transition: "supersede",
    });

    if (parentBlocker) {
      // A parent that already ended stays ended. The child's send must not
      // fail because v1 was rejected — v2 is still the offer we just issued.
      supersedeSkipped = parentBlocker;
    } else {
      mutate(
        `update fl_proposal
            set status = 'superseded', superseded_by_proposal_id = $2,
                updated_at = $3, updated_by = $4
          where id = $1`,
        [parentId, proposalId, nowIso(), actor]
      );
      supersededProposalId = parentId;

      appendEvent({
        entityType: "proposal",
        entityId: parentId,
        kind: "superseded",
        actor,
        body: `superseded by ${current.refNo} v${current.revisionNo}`,
        meta: { supersededByProposalId: proposalId },
      });
    }
  }

  appendEvent({
    entityType: "proposal",
    entityId: proposalId,
    kind: "sent",
    actor,
    body: `${current.refNo} v${current.revisionNo} sent — frozen at checksum ${stamp}`,
    meta: {
      checksum: stamp,
      lineCount: ((current.lines as Row[]) ?? []).length,
      supersededProposalId,
      supersedeSkipped,
    },
  });

  return { ...getProposal(proposalId), checksum: stamp, supersededProposalId };
}

/** We pull the offer. Their copy still exists; it is simply no longer open. */
export function withdrawProposal(proposalId: string, reason: string, actor: string): { proposal: Row } {
  const row = loadLifecycle(proposalId);
  const now = nowIso();

  transition({
    proposalId,
    transition: "withdraw",
    from: storedStatus(row.status),
    reason,
    actor,
    extra: [
      ["withdrawn_at", now],
      ["withdraw_reason", reason],
    ],
  });

  appendEvent({
    entityType: "proposal",
    entityId: proposalId,
    kind: "withdrawn",
    actor,
    body: reason,
  });

  return getProposal(proposalId);
}

export interface RespondInput {
  proposalId: string;
  decision: "accepted" | "rejected";
  reason?: string | null;
  /**
   * WHICH OPTIONAL LINES THE CLIENT TOOK (spec §10 call 5). The accepted set is
   * what drives the work orders, so forcing a re-sign to add an upsell is how
   * you lose the upsell.
   */
  acceptedLineIds?: string[] | null;
  actor: string;
}

export function respondToProposal(input: RespondInput): {
  proposal: Row;
  acceptedLineIds: string[];
} {
  if (input.decision !== "accepted" && input.decision !== "rejected") {
    throw new Error(`decision must be "accepted" or "rejected"`);
  }

  const row = one<LifecycleRow & { dataRaw: unknown }>(
    `select id, ref_no, status, valid_until, revision_no, parent_proposal_id,
            data_json::text as data_raw
       from fl_proposal where id = $1 and is_active = 'true' limit 1`,
    [input.proposalId]
  );
  if (!row) throw new Error(`proposal ${input.proposalId} not found`);

  const now = nowIso();
  const accepted: string[] = [];

  if (input.decision === "accepted") {
    const asked = (input.acceptedLineIds ?? []).map((id) => String(id).trim()).filter(Boolean);
    if (asked.length) {
      const known = new Set(
        many<{ id: string }>(
          `select id from fl_proposal_line where proposal_id = $1 and is_active = 'true' limit 1000`,
          [input.proposalId]
        ).map((l) => l.id)
      );
      for (const id of asked) {
        if (!known.has(id)) throw new Error(`line ${id} is not on this proposal`);
        if (!accepted.includes(id)) accepted.push(id);
      }
    }
  }

  const extra: Array<[string, unknown]> = [
    ["decision", input.decision],
    ["decision_reason", input.reason ?? null],
    ["decided_at", now],
  ];

  if (input.decision === "accepted") {
    extra.push(["accepted_at", now]);
    // The taken set rides in `data_json` because there is no column for it and
    // no ALTER available. It is NOT written back onto the lines: flipping
    // `is_optional` would rewrite the offer the client is holding and make the
    // diff against the next revision read as a change we never made.
    extra.push([
      "data_json",
      upsertJsonKey(row.dataRaw, "accepted_line_ids", accepted.length ? JSON.stringify(accepted) : null),
    ]);
  } else {
    extra.push(["rejected_at", now]);
    extra.push(["reject_reason", input.reason ?? null]);
  }

  transition({
    proposalId: input.proposalId,
    transition: input.decision === "accepted" ? "accept" : "reject",
    from: storedStatus(row.status),
    reason: input.reason,
    actor: input.actor,
    extra,
  });

  appendEvent({
    entityType: "proposal",
    entityId: input.proposalId,
    kind: input.decision === "accepted" ? "accepted" : "rejected",
    actor: input.actor,
    body: input.reason ?? `${row.refNo} v${row.revisionNo ?? 1} ${input.decision}`,
    meta: { acceptedLineIds: accepted },
  });

  return { ...getProposal(input.proposalId), acceptedLineIds: accepted };
}

// --- negotiation (spec §5 R2) ------------------------------------------------------

export interface NegotiationInput {
  proposalId: string;
  kind: string;
  body?: string | null;
  /** Minor units, for a counter-offer. Event meta, never a numeric column. */
  amount?: number | null;
  actor: string;
}

/**
 * A COUNTER-OFFER IS NOT A STATE CHANGE. It is a thing that happened, written
 * to the one audit spine and read back as a filtered query. Without that split
 * you get v7 where nothing changed — and a revision exists only when we
 * deliberately re-price.
 */
export function addNegotiationEvent(input: NegotiationInput): { proposal: Row } {
  if (!isNegotiationKind(input.kind)) {
    throw new Error(`"${input.kind}" is not a negotiation event (${NEGOTIATION_KINDS.join(", ")})`);
  }

  const row = loadLifecycle(input.proposalId);
  const status = effectiveStatus(storedStatus(row.status), row.validUntil, nowIso());
  if (!canRecordNegotiation(status)) {
    throw new Error(`this proposal is ${label(status)} — there is no open conversation to record against`);
  }

  appendEvent({
    entityType: "proposal",
    entityId: input.proposalId,
    kind: input.kind,
    actor: input.actor,
    body: input.body ?? null,
    meta: { amount: input.amount ?? null, refNo: row.refNo, revisionNo: row.revisionNo },
  });

  return getProposal(input.proposalId);
}

// --- revision (spec §5) -------------------------------------------------------------

/** Read raw — money stays in MAJOR units all the way through a copy, so the
 *  minor/major boundary is never crossed twice and can never round twice. */
const REVISABLE_COLUMNS = `
  id, ref_no, deal_id, account_id, survey_id, survey_revision_id,
  rate_card_id, rate_card_resolved_reason, title, status, currency,
  contract_type, liability_threshold_amount, condition_scale_direction,
  payment_terms, expected_programme, valid_until, template_id,
  revision_no, notes`;

const COPIED_LINE_COLUMNS = [
  "sequence_no",
  "description",
  "facilio_service_id",
  "service_code",
  "scope_node_id",
  "estimation_key",
  "source",
  "source_ref_id",
  "qty",
  "pricing_basis",
  "uom",
  "frequency",
  "rate_card_id",
  "rate_card_row_id",
  "card_price",
  "pricing_mode",
  "delta_type",
  "delta_value",
  "delta_reason",
  "applied_price",
  "line_total",
  "condition_score",
  "condition_multiplier",
  "per_occurrence_amount",
  "monthly_equivalent_amount",
  "one_time_amount",
  "is_optional",
  "notes",
  "source_answer_id",
  "source_observation_id",
  "data_json",
] as const;

/**
 * v-next. A NEW `fl_proposal` row with a parent link and the parent's lines
 * copied onto it — that is what makes "their copy never changes" structurally
 * true rather than a rule someone has to remember (spec §10 call 1).
 *
 * The ref number is SHARED: PRP-0042 v2 is the same proposal, not a new one.
 * The parent is NOT superseded here — that happens only when this child is
 * sent (§5 R3).
 */
export function reviseProposal(proposalId: string, actor: string): {
  proposal: Row;
  parentProposalId: string;
  copiedLines: number;
} {
  const parent = one<Row>(
    `select ${REVISABLE_COLUMNS} from fl_proposal where id = $1 and is_active = 'true' limit 1`,
    [proposalId]
  );
  if (!parent) throw new Error(`proposal ${proposalId} not found`);

  const now = nowIso();
  const status = effectiveStatus(storedStatus(parent.status), parent.validUntil as string | null, now);
  if (!canRevise(status)) {
    throw new Error(
      `this proposal is ${label(status)} and cannot be revised — the revision boundary is \`sent\`, and before it an edit is just an edit`
    );
  }

  const revisionNo = Number(parent.revisionNo ?? 1) + 1;

  // Everything the client has not agreed to yet resets: no approval, no send
  // stamps, no decision, no frozen payload, and no document snapshot — a child
  // inheriting the parent's snapshot would never take a first render, and the
  // §6 rule would break in silence. `valid_until` resets too (§5 R6): the
  // previous revision is superseded, not expired.
  const child = one<{ id: string }>(
    `insert into fl_proposal
       (id, ref_no, deal_id, account_id, survey_id, survey_revision_id,
        rate_card_id, rate_card_resolved_reason, title, status, currency,
        contract_type, liability_threshold_amount, condition_scale_direction,
        payment_terms, expected_programme,
        one_time_subtotal, recurring_monthly_subtotal,
        optional_one_time_total, optional_recurring_monthly_total,
        tax_pct, tax_one_time, tax_recurring_monthly,
        total_one_time, total_recurring_monthly, valid_until,
        template_id, document_json, deviation_pct, frozen_json,
        revision_no, parent_proposal_id, notes,
        created_by, updated_by, is_active, data_json, created_at, updated_at)
     values (gen_random_uuid()::text, $1, $2, $3, $4, $5,
             $6, $7, $8, 'draft', $9,
             $10, $11, $12,
             $13, $14,
             0, 0, 0, 0,
             0, 0, 0, 0, 0, null,
             $15, '{}', 0, '{}',
             $16, $17, $18,
             $19, $19, 'true', '{}', $20, $20)
     returning id`,
    [
      parent.refNo,
      parent.dealId,
      parent.accountId,
      parent.surveyId,
      parent.surveyRevisionId,
      parent.rateCardId,
      parent.rateCardResolvedReason,
      parent.title,
      parent.currency,
      parent.contractType,
      parent.liabilityThresholdAmount,
      parent.conditionScaleDirection,
      parent.paymentTerms,
      parent.expectedProgramme,
      parent.templateId,
      revisionNo,
      parent.id,
      parent.notes,
      actor,
      now,
    ]
  );
  if (!child) throw new Error("revision insert returned no row");

  const parentLines = many<Row>(
    `select id, ${COPIED_LINE_COLUMNS.filter((c) => c !== "data_json").join(", ")},
            data_json::text as data_raw
       from fl_proposal_line
      where proposal_id = $1 and is_active = 'true'
      order by sequence_no
      limit 1000`,
    [proposalId]
  );

  if (parentLines.length) {
    // ONE multi-row INSERT, not one per line: it is the only atomicity
    // primitive available (ARCHITECTURE.md §7), and it is also ~194ms a line
    // cheaper.
    const params: unknown[] = [child.id, now, actor];
    const tuples: string[] = [];

    parentLines.forEach((line, index) => {
      const values = [
        index + 1,
        line.description,
        line.facilioServiceId,
        line.serviceCode,
        line.scopeNodeId,
        line.estimationKey,
        line.source,
        line.sourceRefId,
        line.qty,
        line.pricingBasis,
        line.uom,
        line.frequency,
        line.rateCardId,
        line.rateCardRowId,
        line.cardPrice,
        line.pricingMode,
        line.deltaType,
        line.deltaValue,
        line.deltaReason,
        line.appliedPrice,
        line.lineTotal,
        line.conditionScore,
        line.conditionMultiplier,
        line.perOccurrenceAmount,
        line.monthlyEquivalentAmount,
        line.oneTimeAmount,
        flag(bool(line.isOptional)),
        line.notes,
        line.sourceAnswerId,
        line.sourceObservationId,
        // The diff matches on this and on nothing else that survives a
        // re-price — a description the estimator rewrote is not an identity.
        upsertJsonKey(line.dataRaw, "origin_line_id", String(line.id)),
      ];

      const start = params.length;
      params.push(...values);
      const placeholders = values.map((_, i) => `$${start + i + 1}`).join(", ");
      tuples.push(`(gen_random_uuid()::text, $1, ${placeholders}, $3, $3, 'true', $2, $2)`);
    });

    mutate(
      `insert into fl_proposal_line
         (id, proposal_id, ${COPIED_LINE_COLUMNS.join(", ")},
          created_by, updated_by, is_active, created_at, updated_at)
       values ${tuples.join(", ")}`,
      params
    );
  }

  recomputeTotals(child.id, actor);

  appendEvent({
    entityType: "proposal",
    entityId: child.id,
    kind: "revision_created",
    actor,
    body: `${parent.refNo} v${revisionNo} raised from v${parent.revisionNo ?? 1}`,
    meta: { parentProposalId: parent.id, revisionNo, copiedLines: parentLines.length },
  });

  appendEvent({
    entityType: "proposal",
    entityId: String(parent.id),
    kind: "revised",
    actor,
    body: `v${revisionNo} raised — this revision stays live until v${revisionNo} is sent`,
    meta: { childProposalId: child.id, revisionNo },
  });

  return {
    ...getProposal(child.id),
    parentProposalId: String(parent.id),
    copiedLines: parentLines.length,
  };
}

const toDiffable = (line: Row): DiffableLine => ({
  id: String(line.id),
  originLineId: ((line.data as Row | null)?.origin_line_id as string | null) ?? null,
  estimationKey: (line.estimationKey as string | null) ?? null,
  description: String(line.description ?? ""),
  qty: Number(line.qty ?? 0),
  cardPrice: toMinor(line.cardPrice),
  appliedPrice: toMinor(line.appliedPrice),
  lineTotal: toMinor(line.lineTotal),
  pricingMode: (line.pricingMode as string | null) ?? null,
  deltaReason: (line.deltaReason as string | null) ?? null,
  frequency: (line.frequency as string | null) ?? null,
  isOptional: bool(line.isOptional),
});

interface RevisionRef {
  id: string;
  refNo: string;
  revisionNo: number;
}

/**
 * What changed, by how much, and what it did to the totals — in one screen.
 * The cost of a revision was never the re-pricing; it was a human re-reading
 * two documents side by side to find out what moved.
 */
export function diffProposal(proposalId: string): {
  diff: ProposalDiff;
  proposal: RevisionRef;
  parent: RevisionRef;
} {
  const row = one<Row>(
    `select
       (select row_to_json(x) from (
          select id, ref_no, revision_no, parent_proposal_id
            from fl_proposal where id = $1 and is_active = 'true' limit 1
        ) x) as head_obj,

       (select row_to_json(x) from (
          select id, ref_no, revision_no from fl_proposal
           where id = (select parent_proposal_id from fl_proposal where id = $1)
           limit 1
        ) x) as parent_obj,

       (select coalesce(json_agg(x order by x.sequence_no), '[]'::json) from (
          select ${LINE_COLUMNS}, data_json from fl_proposal_line
           where proposal_id = $1 and is_active = 'true'
        ) x) as after_arr,

       (select coalesce(json_agg(x order by x.sequence_no), '[]'::json) from (
          select ${LINE_COLUMNS}, data_json from fl_proposal_line
           where proposal_id = (select parent_proposal_id from fl_proposal where id = $1)
             and is_active = 'true'
        ) x) as before_arr`,
    [proposalId]
  );

  const head = (row?.head ?? null) as Row | null;
  if (!head) throw new Error(`proposal ${proposalId} not found`);

  const parent = (row?.parent ?? null) as Row | null;
  if (!parent) {
    throw new Error("this is the first revision — there is nothing before it to diff against");
  }

  const before = ((row?.before ?? []) as Row[]).map(toDiffable);
  const after = ((row?.after ?? []) as Row[]).map(toDiffable);

  return {
    diff: diffProposals(before, after),
    proposal: {
      id: String(head.id),
      refNo: String(head.refNo ?? ""),
      revisionNo: Number(head.revisionNo ?? 1),
    },
    parent: {
      id: String(parent.id),
      refNo: String(parent.refNo ?? ""),
      revisionNo: Number(parent.revisionNo ?? 1),
    },
  };
}

// --- templates and the document (spec §6) --------------------------------------------

export const TEMPLATE_STATUSES = ["draft", "published", "archived"] as const;

/** Whatever `sections_json` holds, narrowed to sections the renderer can use. */
function normaliseSections(raw: unknown): TemplateSection[] {
  if (!Array.isArray(raw)) return [];
  const out: TemplateSection[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const section = item as Record<string, unknown>;
    const type = section.type === "system" ? "system" : "text";
    const key = String(section.key ?? "").trim();
    if (!key) continue;

    if (type === "system" && !isSystemSectionKey(key)) {
      throw new Error(
        `"${key}" is not a system section (${SYSTEM_SECTION_KEYS.join(", ")}) — a text section needs type "text"`
      );
    }

    out.push({
      type,
      key,
      title: String(section.title ?? key),
      body: type === "text" ? String(section.body ?? "") : "",
    });
  }

  return out;
}

export function listTemplates(): { templates: Row[] } {
  return {
    templates: many<Row>(
      `select id, name, description, status, version_no, sections_json, is_default,
              published_by, published_at, created_by, updated_by, created_at, updated_at
         from fl_proposal_template
        where is_active = 'true'
        order by is_default desc, name
        limit 100`
    ),
  };
}

export interface SaveTemplateInput {
  templateId?: string | null;
  name?: string | null;
  description?: string | null;
  status?: string | null;
  /** The ORDERED section list. Order is the template. */
  sections?: unknown;
  isDefault?: boolean | null;
  actor: string;
}

export function saveTemplate(input: SaveTemplateInput): { template: Row } {
  const now = nowIso();

  const existing = input.templateId
    ? one<Row>(
        `select id, name, description, status, version_no, sections_json, is_default
           from fl_proposal_template where id = $1 and is_active = 'true' limit 1`,
        [input.templateId]
      )
    : null;
  if (input.templateId && !existing) throw new Error(`template ${input.templateId} not found`);

  const status = input.status ?? (existing?.status as string | null) ?? "draft";
  if (!(TEMPLATE_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`status must be one of: ${TEMPLATE_STATUSES.join(", ")}`);
  }

  // A rename must not empty the template. `sections` absent means "leave the
  // ordered list alone"; an explicitly EMPTY list is refused, because a
  // template that renders nothing is not an edit anyone meant to make — and
  // `loadTemplate` would then quietly serve the shipped default and hide it.
  const sections =
    input.sections === undefined || input.sections === null
      ? normaliseSections(existing?.sections)
      : normaliseSections(input.sections);
  if (!sections.length) throw new Error("a template with no sections renders nothing");

  const name = input.name ?? (existing?.name as string | null) ?? DEFAULT_TEMPLATE.name;
  const isDefault = input.isDefault ?? (existing ? bool(existing.isDefault) : false);

  let templateId: string;

  if (existing) {
    // `version_no` moves on every save so a reader can tell two edits apart.
    // The proposal is protected by its own snapshot, not by this number.
    mutate(
      `update fl_proposal_template
          set name = $2, description = $3, status = $4, sections_json = $5,
              is_default = $6, version_no = coalesce(version_no, 0) + 1,
              published_by = case when $4 = 'published' then $7 else published_by end,
              published_at = case when $4 = 'published' then $8 else published_at end,
              updated_by = $7, updated_at = $8
        where id = $1`,
      [
        existing.id,
        name,
        input.description ?? existing.description ?? null,
        status,
        JSON.stringify(sections),
        flag(isDefault),
        input.actor,
        now,
      ]
    );
    templateId = String(existing.id);
  } else {
    const row = one<{ id: string }>(
      `insert into fl_proposal_template
         (id, name, description, status, version_no, sections_json, is_default,
          published_by, published_at, created_by, updated_by, is_active,
          data_json, created_at, updated_at)
       values (gen_random_uuid()::text, $1, $2, $3, 1, $4, $5,
               case when $3 = 'published' then $6 else null end,
               case when $3 = 'published' then $7 else null end,
               $6, $6, 'true', '{}', $7, $7)
       returning id`,
      [
        name,
        input.description ?? null,
        status,
        JSON.stringify(sections),
        flag(isDefault),
        input.actor,
        now,
      ]
    );
    if (!row) throw new Error("template insert returned no row");
    templateId = row.id;
  }

  // One default, or the fallback lookup picks whichever row sorted first.
  if (isDefault) {
    mutate(
      `update fl_proposal_template set is_default = 'false', updated_at = $2, updated_by = $3
        where id <> $1 and is_default = 'true'`,
      [templateId, now, input.actor]
    );
  }

  appendEvent({
    entityType: "proposal_template",
    entityId: templateId,
    kind: existing ? "updated" : "created",
    actor: input.actor,
    body: `${name} — ${sections.length} section(s), ${status}`,
  });

  const saved = one<Row>(
    `select id, name, description, status, version_no, sections_json, is_default,
            published_by, published_at, created_by, updated_by, created_at, updated_at
       from fl_proposal_template where id = $1 limit 1`,
    [templateId]
  );
  if (!saved) throw new Error("template save did not take");

  return { template: saved };
}

function loadTemplate(templateId: string | null): ProposalTemplate {
  const row = templateId
    ? one<Row>(
        `select id, name, sections_json from fl_proposal_template
          where id = $1 and is_active = 'true' limit 1`,
        [templateId]
      )
    : one<Row>(
        `select id, name, sections_json from fl_proposal_template
          where is_active = 'true' and status = 'published'
          order by is_default desc, updated_at desc
          limit 1`
      );

  const sections = normaliseSections(row?.sections);

  // P1 ships one seeded template, and a missing seed must never make a
  // proposal unrenderable — the shipped constant is the same list the seeder
  // writes, so the fallback and the row cannot disagree.
  if (!sections.length) {
    return { id: row ? String(row.id) : null, name: DEFAULT_TEMPLATE.name, sections: DEFAULT_TEMPLATE.sections };
  }

  return {
    id: String(row?.id ?? ""),
    name: String(row?.name ?? DEFAULT_TEMPLATE.name),
    sections,
  };
}

/**
 * The parts of the frozen survey payload the DOCUMENT needs.
 * `pricing.ts`'s `HandoffPayload` deliberately describes only what the PRICE
 * needs, and widening a domain module for a caller's convenience is how a pure
 * type stops meaning anything.
 */
interface DocumentPayload {
  portfolio?: Array<{
    node_type?: string | null;
    name?: string | null;
    verdict?: string | null;
    attributes?: Record<string, unknown> | null;
  }> | null;
  qualifications?: Array<{ text?: string | null; source?: string | null }> | null;
}

/** Minor units -> what a human reads. `Intl` does not exist in QuickJS. */
function formatMoney(minor: unknown, currency: string): string {
  const value = typeof minor === "number" ? minor : Number(minor);
  const major = toMajor(Number.isFinite(value) ? value : null);
  if (major === null) return "";

  const [whole, fraction] = Math.abs(major).toFixed(MINOR_DIGITS).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${major < 0 ? "-" : ""}${currency} ${grouped}.${fraction}`;
}

const AREA_KEYS: Array<[string, string]> = [
  ["area_sqft", "sq ft"],
  ["floor_count", "floors"],
  ["room_count", "rooms"],
  ["restroom_count", "restrooms"],
];

/**
 * What we surveyed — so a not-visited node is deliberately absent. It appears
 * in the exclusions instead, which is the honest place for it (spec §6).
 */
function siteSummary(payload: DocumentPayload | null): Array<{ name: string; detail: string }> {
  const nodes = payload?.portfolio ?? [];
  const out: Array<{ name: string; detail: string }> = [];

  for (const node of nodes) {
    if (!node || node.verdict === "not_visited") continue;

    const parts: string[] = [];
    if (node.node_type) parts.push(String(node.node_type).replace(/_/g, " "));
    for (const [key, unit] of AREA_KEYS) {
      const value = node.attributes?.[key];
      if (typeof value === "number" && value > 0) parts.push(`${value.toLocaleString()} ${unit}`);
    }

    out.push({ name: String(node.name ?? "Unnamed"), detail: parts.join(" · ") });
  }

  return out;
}

export interface RenderProposalInput {
  proposalId: string;
  /** Override the template. Only honoured on a render that actually snapshots. */
  templateId?: string | null;
  /** Re-snapshot. Refused once the proposal has left draft — see below. */
  force?: boolean | null;
  actor: string;
}

export function renderProposal(input: RenderProposalInput): {
  proposal: Row;
  document: RenderedDocument;
  snapshotted: boolean;
} {
  const { proposal } = getProposal(input.proposalId);
  const stored = proposal.document as RenderedDocument | null;

  // `document_json` is seeded `'{}'` at creation, which parses to a TRUTHY
  // empty object — testing the sections is the only test that means anything.
  const hasSnapshot = Boolean(stored && Array.isArray(stored.sections) && stored.sections.length);
  const status = storedStatus(proposal.storedStatus);

  // THE LOAD-BEARING RULE (spec §6): snapshotted at first render, read forever
  // after. An admin editing the cover letter on Friday must not change a
  // proposal that went to a client on Thursday.
  if (hasSnapshot && !input.force) {
    return { proposal, document: stored as RenderedDocument, snapshotted: false };
  }
  if (hasSnapshot && input.force && status !== "draft") {
    throw new Error(
      `this proposal is already ${label(status)} — re-rendering it would change a document a client is holding`
    );
  }

  const context = one<{ accountName: string | null; snapshot: DocumentPayload | null }>(
    `select
       (select a.name from fl_account a where a.id = $1 limit 1) as account_name,
       (select r.snapshot_json from fl_survey_revision r where r.id = $2 limit 1) as snapshot_json`,
    [proposal.accountId ?? null, proposal.surveyRevisionId ?? null]
  );

  const payload = context?.snapshot ?? null;
  const summary = siteSummary(payload);
  const currency = String(proposal.currency ?? "AED");

  const lines = ((proposal.lines ?? []) as Row[]).map(
    (line): RenderLine => ({
      description: String(line.description ?? ""),
      qty: Number(line.qty ?? 0),
      uom: (line.uom as string | null) ?? null,
      frequency: (line.frequency as string | null) ?? null,
      // Already MINOR here: `getProposal` converted them at the boundary.
      appliedPrice: (line.appliedPrice as number | null) ?? null,
      lineTotal: (line.lineTotal as number | null) ?? null,
      isOptional: bool(line.isOptional),
    })
  );

  const tokens: TokenValues = {
    client_name: context?.accountName ?? "",
    site_name: summary[0]?.name ?? "",
    proposal_number: String(proposal.refNo ?? ""),
    revision_no: String(proposal.revisionNo ?? 1),
    proposal_date: String(proposal.sentAt ?? proposal.createdAt ?? "").slice(0, 10),
    valid_until: String(proposal.validUntil ?? "").slice(0, 10),
    one_time_total: formatMoney(proposal.totalOneTime, currency),
    recurring_total: formatMoney(proposal.totalRecurringMonthly, currency),
    recurring_period: "monthly",
    currency,
    prepared_by: String(proposal.createdBy ?? ""),
    payment_terms: String(proposal.paymentTerms ?? ""),
    contract_type: String(proposal.contractType ?? "").replace(/_/g, " "),
    threshold_amount: formatMoney(proposal.liabilityThresholdAmount, currency),
  };

  const templateId = input.templateId ?? (proposal.templateId as string | null) ?? null;
  const template = loadTemplate(templateId);

  const now = nowIso();
  const document = renderDocument(
    {
      template,
      tokens,
      lines,
      exclusions: (payload?.qualifications ?? [])
        .map((q) => String(q?.text ?? "").trim())
        .filter(Boolean),
      siteSummary: summary,
    },
    now
  );

  mutate(
    `update fl_proposal set document_json = $2, template_id = $3, updated_at = $4, updated_by = $5
      where id = $1`,
    [input.proposalId, JSON.stringify(document), template.id ?? null, now, input.actor]
  );

  appendEvent({
    entityType: "proposal",
    entityId: input.proposalId,
    kind: hasSnapshot ? "document_re_rendered" : "document_rendered",
    actor: input.actor,
    body: `${template.name} — ${document.sections.length} section(s)`,
    meta: { templateId: template.id ?? null, warnings: document.warnings },
  });

  // Patched rather than re-read: `getProposal` is three queries, and the only
  // thing that moved is the snapshot we just wrote.
  proposal.document = document;
  proposal.templateId = template.id ?? null;

  return { proposal, document, snapshotted: true };
}

// --- rate card admin (spec §3) ---------------------------------------------------

export const CARD_STATUSES = ["draft", "active", "archived"] as const;
export const SCALE_DIRECTIONS = ["1_is_worst", "1_is_best"] as const;

/**
 * `is_active = 'false'` is this schema's delete. Without a way to SEE a
 * deactivated row there is no way to bring one back, and an admin who
 * mis-clicks has destroyed a rate with no undo — so the filter is optional.
 */
const activeFilter = (alias: string, includeInactive: boolean): string =>
  includeInactive ? "" : ` and ${alias}.is_active = 'true'`;

/**
 * `priority` is a `numeric` column that row-map does not coerce, so it arrives
 * as the string "20" — and `is_active` is `'true'`/`'false'` text, this
 * schema's only boolean. Both are corrected here rather than in row-map, which
 * is shared: adding a column name there changes every module's reads at once,
 * and this one is the proposal lane's to answer for.
 */
const normaliseCardRow = (row: Row): Row => {
  readMoney(row, CARD_ROW_MONEY);
  row.isActive = bool(row.isActive);
  return row;
};

const normaliseCard = (card: Row): Row => {
  const priority = Number(card.priority);
  card.priority = Number.isFinite(priority) ? priority : 0;
  card.isActive = bool(card.isActive);
  for (const row of (card.rows ?? []) as Row[]) normaliseCardRow(row);
  return card;
};

export function listCards(includeRows: boolean, includeInactive = false): { cards: Row[] } {
  const rowsSubquery = includeRows
    ? `,
       (select coalesce(json_agg(x order by x.sequence_no), '[]'::json) from (
          select id, rate_card_id, facilio_service_id, service_code, description,
                 estimation_key, pricing_basis, uom, price, min_charge,
                 condition_multipliers_json, default_frequency, sequence_no, notes,
                 is_active
            from fl_rate_card_row r
           where r.rate_card_id = c.id${activeFilter("r", includeInactive)}
        ) x) as rows_arr`
    : "";

  const cards = many<Row>(
    `select c.id, c.name, c.description, c.currency, c.region, c.client_account_id,
            c.priority, c.status, c.effective_from, c.effective_to,
            c.condition_scale_direction, c.version_no, c.is_active,
            c.created_by, c.updated_by, c.created_at, c.updated_at${rowsSubquery}
       from fl_rate_card c
      where 1 = 1${activeFilter("c", includeInactive)}
      order by c.priority desc, c.name
      limit 100`
  );

  for (const card of cards) normaliseCard(card);

  return { cards };
}

export interface SaveCardInput {
  rateCardId?: string | null;
  name?: string | null;
  description?: string | null;
  currency?: string | null;
  /** Null means every region — and every client. Both widen, never narrow. */
  region?: string | null;
  clientAccountId?: string | null;
  priority?: number | null;
  status?: string | null;
  /** Plain `YYYY-MM-DD` is safe — `resolveRateCard` normalises the precision. */
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  conditionScaleDirection?: string | null;
  /** `false` retires the card; `true` brings a retired one back. */
  active?: boolean | null;
  actor: string;
}

/**
 * `resolveRateCard` reads null, "" and the CSV's literal "none" as "applies to
 * everyone". Only one of the three is written, so a card's scope never depends
 * on which screen last saved it.
 */
const scopeOrAll = (value: string | null | undefined): string | null => {
  const text = String(value ?? "").trim();
  return text === "" || text === "none" ? null : text;
};

export function saveCard(input: SaveCardInput): { card: Row } {
  const now = nowIso();
  // Deliberately NOT filtered on `is_active`: reactivating a retired card is
  // the whole reason `active` is an input.
  const existing = input.rateCardId
    ? one<Row>(
        `select id, name, description, currency, region, client_account_id, priority, status,
                effective_from, effective_to, condition_scale_direction, is_active
           from fl_rate_card where id = $1 limit 1`,
        [input.rateCardId]
      )
    : null;
  if (input.rateCardId && !existing) throw new Error(`rate card ${input.rateCardId} not found`);

  /**
   * EVERY field falls back to what is already stored before it falls back to a
   * default. Defaulting straight to `"draft"` means a UI sending only a new
   * name un-publishes the card — and `resolveRateCard` only considers active
   * cards, so one rename would stop the whole app resolving any price at all.
   */
  const keep = <T>(next: T | null | undefined, stored: unknown, fallback: T): T =>
    next !== null && next !== undefined
      ? next
      : stored !== null && stored !== undefined && stored !== ""
        ? (stored as T)
        : fallback;

  const status = keep(input.status, existing?.status, "draft");
  if (!(CARD_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`status must be one of: ${CARD_STATUSES.join(", ")}`);
  }

  const direction = keep(input.conditionScaleDirection, existing?.conditionScaleDirection, "1_is_worst");
  if (!(SCALE_DIRECTIONS as readonly string[]).includes(direction)) {
    // A score read the wrong way round is real money on a semi-comprehensive
    // contract, so this one is validated rather than defaulted quietly.
    throw new Error(`conditionScaleDirection must be one of: ${SCALE_DIRECTIONS.join(", ")}`);
  }

  const description = input.description ?? (existing?.description as string | null) ?? null;
  const currency = keep(input.currency, existing?.currency, "AED");
  const region = scopeOrAll(input.region ?? (existing?.region as string | null));
  const clientAccountId = scopeOrAll(input.clientAccountId ?? (existing?.clientAccountId as string | null));
  const priority = Number(keep(input.priority, existing?.priority, 0));
  const effectiveFrom = input.effectiveFrom ?? (existing?.effectiveFrom as string | null) ?? null;
  const effectiveTo = input.effectiveTo ?? (existing?.effectiveTo as string | null) ?? null;
  const active = input.active ?? (existing ? bool(existing.isActive) : true);

  const name = input.name ?? (existing?.name as string | null);
  if (!name) throw new Error("a rate card needs a name");

  let cardId: string;

  if (existing) {
    mutate(
      `update fl_rate_card
          set name = $2, description = $3, currency = $4, region = $5,
              client_account_id = $6, priority = $7, status = $8,
              effective_from = $9, effective_to = $10,
              condition_scale_direction = $11, is_active = $12,
              version_no = coalesce(version_no, 0) + 1,
              updated_by = $13, updated_at = $14
        where id = $1`,
      [
        existing.id,
        name,
        description,
        currency,
        region,
        clientAccountId,
        priority,
        status,
        effectiveFrom,
        effectiveTo,
        direction,
        flag(active),
        input.actor,
        now,
      ]
    );
    cardId = String(existing.id);
  } else {
    const row = one<{ id: string }>(
      `insert into fl_rate_card
         (id, name, description, currency, region, client_account_id, priority, status,
          effective_from, effective_to, condition_scale_direction, version_no,
          created_by, updated_by, is_active, data_json, created_at, updated_at)
       values (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7,
               $8, $9, $10, 1,
               $11, $11, $12, '{}', $13, $13)
       returning id`,
      [
        name,
        description,
        currency,
        region,
        clientAccountId,
        priority,
        status,
        effectiveFrom,
        effectiveTo,
        direction,
        input.actor,
        flag(active),
        now,
      ]
    );
    if (!row) throw new Error("rate card insert returned no row");
    cardId = row.id;
  }

  appendEvent({
    entityType: "rate_card",
    entityId: cardId,
    kind: existing ? "updated" : "created",
    actor: input.actor,
    body: `${name} — ${status}, priority ${priority}`,
    meta: { region, clientAccountId, effectiveFrom, effectiveTo, active },
  });

  const saved = one<Row>(
    `select id, name, description, currency, region, client_account_id, priority, status,
            effective_from, effective_to, condition_scale_direction, version_no, is_active,
            created_by, updated_by, created_at, updated_at
       from fl_rate_card where id = $1 limit 1`,
    [cardId]
  );
  if (!saved) throw new Error("rate card save did not take");

  return { card: normaliseCard(saved) };
}

export interface SaveCardRowInput {
  rateCardId: string;
  rowId?: string | null;
  facilioServiceId?: string | null;
  serviceCode?: string | null;
  description?: string | null;
  /** Joins the survey's `estimation_values` to a price (§5 rule 2). */
  estimationKey?: string | null;
  pricingBasis?: string | null;
  uom?: string | null;
  /** Minor units, both. */
  price?: number | null;
  minCharge?: number | null;
  conditionMultipliers?: Record<string, number> | null;
  defaultFrequency?: string | null;
  sequenceNo?: number | null;
  notes?: string | null;
  /** `false` retires the row; `true` brings a retired one back. */
  active?: boolean | null;
  actor: string;
}

export function saveCardRow(input: SaveCardRowInput): { card: Row } {
  const card = one<Row>(`select id, name from fl_rate_card where id = $1 limit 1`, [
    input.rateCardId,
  ]);
  if (!card) throw new Error(`rate card ${input.rateCardId} not found`);

  // Unfiltered on purpose: a row deactivated by mistake is only recoverable if
  // this can still find it.
  const existing = input.rowId
    ? one<Row>(
        `select id, pricing_basis, uom, price, min_charge, description, estimation_key,
                service_code, facilio_service_id, default_frequency, sequence_no, notes,
                condition_multipliers_json, is_active
           from fl_rate_card_row where id = $1 and rate_card_id = $2 limit 1`,
        [input.rowId, input.rateCardId]
      )
    : null;
  if (input.rowId && !existing) throw new Error(`row ${input.rowId} is not on this rate card`);

  const basis = input.pricingBasis ?? (existing?.pricingBasis as string | null) ?? "unit";
  if (!(PRICING_BASES as readonly string[]).includes(basis)) {
    throw new Error(`pricingBasis must be one of: ${PRICING_BASES.join(", ")}`);
  }

  // Price, basis and unit are ONE atomic fact (spec §3) — a price with no basis
  // is unusable, and a unit that does not belong to its basis is worse.
  const units = UNITS_BY_BASIS[basis] ?? [];
  const uom = input.uom ?? (existing?.uom as string | null) ?? units[0];
  if (!units.includes(uom)) {
    throw new Error(`uom for a "${basis}" row must be one of: ${units.join(", ")}`);
  }

  const frequency = input.defaultFrequency ?? (existing?.defaultFrequency as string | null) ?? "one_time";
  if (!isFrequency(frequency)) throw new Error(`"${frequency}" is not a frequency`);

  const service = resolveService(
    input.serviceCode ?? (existing?.serviceCode as string | null),
    input.facilioServiceId ?? (existing?.facilioServiceId as string | null)
  );

  const price = input.price ?? toMinor(existing?.price) ?? 0;
  const minCharge = input.minCharge ?? toMinor(existing?.minCharge) ?? 0;
  // Kept when the caller did not mention them: a save that only flips `active`
  // must not quietly drop the condition curve this row prices by.
  const multipliers =
    input.conditionMultipliers ?? (existing?.conditionMultipliers as Record<string, number> | null) ?? {};
  // Same rule: a save that does not mention `active` must not resurrect a row
  // somebody retired on purpose.
  const active = input.active ?? (existing ? bool(existing.isActive) : true);
  const now = nowIso();

  if (existing) {
    mutate(
      `update fl_rate_card_row
          set facilio_service_id = $2, service_code = $3, description = $4,
              estimation_key = $5, pricing_basis = $6, uom = $7, price = $8,
              min_charge = $9, condition_multipliers_json = $10,
              default_frequency = $11, sequence_no = $12, notes = $13,
              is_active = $14, updated_by = $15, updated_at = $16
        where id = $1`,
      [
        existing.id,
        service.facilioServiceId,
        service.serviceCode,
        input.description ?? existing.description ?? null,
        input.estimationKey ?? existing.estimationKey ?? null,
        basis,
        uom,
        toMajor(price),
        toMajor(minCharge),
        JSON.stringify(multipliers),
        frequency,
        input.sequenceNo ?? existing.sequenceNo ?? 0,
        input.notes ?? existing.notes ?? null,
        flag(active),
        input.actor,
        now,
      ]
    );
  } else {
    const next = one<{ n: number }>(
      `select coalesce(max(sequence_no), 0) + 1 as n from fl_rate_card_row
        where rate_card_id = $1 and is_active = 'true'`,
      [input.rateCardId]
    );

    mutate(
      `insert into fl_rate_card_row
         (id, rate_card_id, facilio_service_id, service_code, description, estimation_key,
          pricing_basis, uom, price, min_charge, condition_multipliers_json,
          default_frequency, sequence_no, notes, created_by, updated_by, is_active,
          data_json, created_at, updated_at)
       values (gen_random_uuid()::text, $1, $2, $3, $4, $5,
               $6, $7, $8, $9, $10,
               $11, $12, $13, $14, $14, $15,
               '{}', $16, $16)`,
      [
        input.rateCardId,
        service.facilioServiceId,
        service.serviceCode,
        input.description ?? null,
        input.estimationKey ?? null,
        basis,
        uom,
        toMajor(price),
        toMajor(minCharge),
        JSON.stringify(multipliers),
        frequency,
        input.sequenceNo ?? next?.n ?? 1,
        input.notes ?? null,
        input.actor,
        flag(active),
        now,
      ]
    );
  }

  // Rates DO change, and a price nobody can trace back is a price nobody can
  // defend. `fl_event` is the card's audit trail (spec §3).
  appendEvent({
    entityType: "rate_card",
    entityId: input.rateCardId,
    kind: existing ? "row_updated" : "row_added",
    actor: input.actor,
    body: `${input.description ?? existing?.description ?? "row"} — ${basis}/${uom} at ${price} minor`,
    meta: { rowId: existing?.id ?? null, price, minCharge, frequency },
  });

  return { card: listCardRowsFor(input.rateCardId) };
}

export function removeCardRow(rateCardId: string, rowId: string, actor: string): { card: Row } {
  // Deactivate, never hard-delete: a sent proposal points at this row, and an
  // audit you can erase is not an audit.
  const affected = mutate(
    `update fl_rate_card_row set is_active = 'false', updated_at = $3, updated_by = $4
      where id = $1 and rate_card_id = $2 and is_active = 'true'`,
    [rowId, rateCardId, nowIso(), actor]
  );
  if (!affected) throw new Error(`row ${rowId} is not on this rate card`);

  appendEvent({
    entityType: "rate_card",
    entityId: rateCardId,
    kind: "row_removed",
    actor,
    meta: { rowId },
  });

  return { card: listCardRowsFor(rateCardId) };
}

/**
 * One card with its rows, in one statement. Retired rows are INCLUDED here,
 * carrying `isActive` — this is what a write returns, and a row that vanished
 * because the write worked reads exactly like a write that failed.
 */
function listCardRowsFor(rateCardId: string): Row {
  const row = one<Row>(
    `select
       (select row_to_json(x) from (
          select id, name, description, currency, region, client_account_id, priority,
                 status, effective_from, effective_to, condition_scale_direction,
                 version_no, is_active
            from fl_rate_card where id = $1 limit 1
        ) x) as card_obj,

       (select coalesce(json_agg(x order by x.sequence_no), '[]'::json) from (
          select id, rate_card_id, facilio_service_id, service_code, description,
                 estimation_key, pricing_basis, uom, price, min_charge,
                 condition_multipliers_json, default_frequency, sequence_no, notes,
                 is_active
            from fl_rate_card_row where rate_card_id = $1
        ) x) as rows_arr`,
    [rateCardId]
  );

  const card = (row?.card ?? null) as Row | null;
  if (!card) throw new Error(`rate card ${rateCardId} not found`);

  card.rows = (row?.rows ?? []) as Row[];

  return normaliseCard(card);
}

// --- reference ------------------------------------------------------------------

export function reference(): Row {
  return {
    statuses: PROPOSAL_STATUSES,
    pricingModes: ["standard", "discount", "markup", "custom"],
    deltaTypes: ["pct", "amount"],
    pricingBases: PRICING_BASES,
    unitsByBasis: UNITS_BY_BASIS,
    lineSources: LINE_SOURCES,
    frequencies: ["one_time", "daily", "weekly", "fortnightly", "monthly", "quarterly", "annual"],
    negotiationKinds: NEGOTIATION_KINDS,
    systemSectionKeys: SYSTEM_SECTION_KEYS,
    templateStatuses: TEMPLATE_STATUSES,
    cardStatuses: CARD_STATUSES,
    scaleDirections: SCALE_DIRECTIONS,
    // Free text in P1; a seeded list the hour after. Structured reasons are what
    // make a future markup-suggestion layer worth having.
    deltaReasons: [
      "term commitment agreed",
      "competitive pressure",
      "access constraints (lift, overnight crew)",
      "condition worse than standard",
      "volume across multiple sites",
      "mobilisation complexity",
    ],
  };
}

/** Exported for the seeder and tests; parseJson is the shared text->json read. */
export const __internal = { toMinor, toMajor, parseJson };
