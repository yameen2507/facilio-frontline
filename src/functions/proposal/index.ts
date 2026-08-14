/**
 * The proposal module's API — function `proposal`, its own platform function
 * (ARCHITECTURE.md §9 rule 4: never widen an existing function for a different
 * module). Thin adapters only — read the input, call a module, return
 * `{ ok, data?, error? }`.
 *
 * The whole module (Proposal Spec v1 §9 L1–L5): create and price from a frozen
 * survey revision (L1–L2), the document and its template (L3), send / revise /
 * diff (L4), approval and the rate card behind it (L5).
 *
 * Three of these carry a rule that is not obvious from the name, so it is
 * stated once here and again on the handler:
 *
 *   `send`   freezes the payload AND flips the parent revision to superseded.
 *   `render` snapshots the template onto the proposal on FIRST render only.
 *   `event-add` records a negotiation and changes no status whatsoever.
 *
 * Money crosses the wire in MINOR units, matching ARCHITECTURE.md §7 and the
 * frontend. `src/modules/proposal.ts` is the only place it becomes major.
 *
 * Anything that is not a string or a number — `sections`, `acceptedLineIds`,
 * `conditionMultipliers` — travels inside the `payload` envelope, because the
 * platform accepts no other parameter type.
 */

import StudioFunctions from "@facilio/studio-functions";
import {
  handle,
  limit as readLimit,
  offset as readOffset,
  oneOf,
  optArray,
  optBool,
  optNum,
  optStr,
  parsePayload,
  str,
  type Payload,
} from "../../shared/envelope";
import {
  addNegotiationEvent,
  approveProposal,
  createProposal,
  diffProposal,
  generateLines,
  getProposal,
  listCards,
  listProposals,
  listTemplates,
  reference,
  removeCardRow,
  removeLine,
  renderProposal,
  respondToProposal,
  returnProposal,
  reviseProposal,
  saveCard,
  saveCardRow,
  saveLine,
  saveTemplate,
  sendProposal,
  submitForApproval,
  updateProposal,
  withdrawProposal,
  CARD_STATUSES,
  PROPOSAL_STATUSES,
  SCALE_DIRECTIONS,
  TEMPLATE_STATUSES,
} from "../../modules/proposal";
import { NEGOTIATION_KINDS } from "../../domain/proposal-state";

const S = (description: string) => ({ description, type: "string" as const });
const N = (description: string) => ({ description, type: "number" as const });

/** Every handler accepts the envelope as an alternative to flat fields. */
const ENV = { payload: S("Optional: the whole input as a JSON object string") };

const PROPOSAL_ID = S("Proposal id (uuid)");
const ACTOR = S("Email of the user performing this action");

/**
 * A field the caller never mentioned comes back `undefined`, not `null`.
 *
 * `optStr` returns null for both "absent" and "explicitly blank", and
 * `updateProposal` writes every value it is handed — so without this a caller
 * editing only the validity date silently blanks the title, the contract type
 * and the payment terms. Verified against the live app, the expensive way.
 */
const supplied = <T>(p: Payload, key: string, read: (payload: Payload, k: string) => T): T | undefined =>
  Object.prototype.hasOwnProperty.call(p, key) ? read(p, key) : undefined;

const server = new StudioFunctions({ name: "proposal" });

server.addHandler({
  name: "create",
  description:
    "Start a proposal against a deal. Resolves the rate card and stamps the currency. " +
    "surveyRevisionId is optional — C22, a simple customer is priced straight from a call.",
  parameters: {
    ...ENV,
    dealId: S("Deal this proposal belongs to"),
    surveyRevisionId: S("Optional: the frozen survey revision to price from"),
    title: S("Optional: defaults to the deal title"),
    contractType: S("comprehensive | semi_comprehensive | non_comprehensive"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return createProposal({
        dealId: str(p, "dealId"),
        surveyRevisionId: optStr(p, "surveyRevisionId"),
        title: optStr(p, "title"),
        contractType: optStr(p, "contractType"),
        actor: str(p, "actorEmail"),
      });
    }),
});

server.addHandler({
  name: "get",
  description:
    "One proposal with its lines, resolved rate card, timeline and readiness warnings. " +
    "One batched query — see shared/db.ts on why.",
  parameters: { ...ENV, proposalId: PROPOSAL_ID },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return getProposal(str(p, "proposalId"));
    }),
});

server.addHandler({
  name: "list",
  description: "List proposals — one hardcoded default list; saved views are a platform item (C19).",
  parameters: {
    ...ENV,
    status: S(`Filter by status: ${PROPOSAL_STATUSES.join(", ")}`),
    dealId: S("Filter by deal"),
    accountId: S("Filter by account"),
    limit: N("Page size, default 50, max 200"),
    offset: N("Page offset"),
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return listProposals({
        status: optStr(p, "status"),
        dealId: optStr(p, "dealId"),
        accountId: optStr(p, "accountId"),
        limit: readLimit(p),
        offset: readOffset(p),
      });
    }),
});

server.addHandler({
  name: "line-generate",
  description:
    "Draft priced lines from the proposal's frozen survey revision, joining estimation_key to " +
    "the rate card. Idempotent: re-running replaces the generated lines rather than adding to " +
    "them. Anything the card cannot price comes back in `unpriced`, never dropped.",
  parameters: { ...ENV, proposalId: PROPOSAL_ID, actorEmail: ACTOR },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return generateLines(str(p, "proposalId"), str(p, "actorEmail"));
    }),
});

server.addHandler({
  name: "update",
  description: "Edit the commercial shape — validity, payment terms, contract type, threshold.",
  parameters: {
    ...ENV,
    proposalId: PROPOSAL_ID,
    title: S("Proposal title"),
    contractType: S("comprehensive | semi_comprehensive | non_comprehensive"),
    liabilityThresholdAmount: N("Minor units. Prints on the proposal for semi-comprehensive (C14)"),
    validUntil: S("ISO date the offer expires"),
    paymentTerms: S("Free text, e.g. '30 days from invoice'"),
    expectedProgramme: S("Free text, e.g. 'mobilisation within 2 weeks'"),
    notes: S("Internal notes"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return updateProposal({
        proposalId: str(p, "proposalId"),
        title: supplied(p, "title", optStr),
        contractType: supplied(p, "contractType", optStr),
        liabilityThresholdAmount: supplied(p, "liabilityThresholdAmount", optNum),
        validUntil: supplied(p, "validUntil", optStr),
        paymentTerms: supplied(p, "paymentTerms", optStr),
        expectedProgramme: supplied(p, "expectedProgramme", optStr),
        notes: supplied(p, "notes", optStr),
        actor: str(p, "actorEmail"),
      });
    }),
});

server.addHandler({
  name: "line-save",
  description:
    "Add a line, or update one by lineId. Applies the pricing mode, then the per-occurrence " +
    "floor, then the frequency math. Returns `problems` — warnings such as a missing delta " +
    "reason — which are shown, never used to block the save (C8).",
  parameters: {
    ...ENV,
    proposalId: PROPOSAL_ID,
    lineId: S("Omit to add a new line"),
    description: S("What the client reads on this line"),
    qty: N("Quantity, in the line's unit"),
    pricingBasis: S("unit | hour | visit"),
    uom: S("Unit — depends on the basis (sq_ft, hour, per_visit …)"),
    frequency: S("one_time | daily | weekly | fortnightly | monthly | quarterly | annual"),
    cardPrice: N("Minor units. The card's price, or the estimator's own for a custom line"),
    pricingMode: S("standard | discount | markup | custom"),
    deltaType: S("pct | amount"),
    deltaValue: N("Magnitude — the mode owns the sign"),
    deltaReason: S("Mandatory for discount, markup and custom. The approver reads this"),
    isOptional: S("'true' shows the line but keeps it out of the totals (C10)"),
    facilioServiceId: S("Facilio Services record id (C23) — nullable until L10"),
    serviceCode: S("Our own catalogue code (fl_service_line.code)"),
    notes: S("Internal notes"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return saveLine({
        proposalId: str(p, "proposalId"),
        lineId: optStr(p, "lineId") ?? undefined,
        description: optStr(p, "description"),
        qty: optNum(p, "qty"),
        pricingBasis: optStr(p, "pricingBasis"),
        uom: optStr(p, "uom"),
        frequency: optStr(p, "frequency"),
        cardPrice: optNum(p, "cardPrice"),
        pricingMode: optStr(p, "pricingMode"),
        deltaType: optStr(p, "deltaType"),
        deltaValue: optNum(p, "deltaValue"),
        deltaReason: optStr(p, "deltaReason"),
        isOptional: optBool(p, "isOptional"),
        facilioServiceId: optStr(p, "facilioServiceId"),
        serviceCode: optStr(p, "serviceCode"),
        notes: optStr(p, "notes"),
        actor: str(p, "actorEmail"),
      });
    }),
});

server.addHandler({
  name: "line-remove",
  description: "Deactivate a line. Never a hard delete — the line is part of how this price was reached.",
  parameters: { ...ENV, proposalId: PROPOSAL_ID, lineId: S("Line id (uuid)"), actorEmail: ACTOR },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return removeLine(str(p, "proposalId"), str(p, "lineId"), str(p, "actorEmail"));
    }),
});

// --- lifecycle (spec §1.3, §4) -----------------------------------------------------

server.addHandler({
  name: "submit-for-approval",
  description:
    "Send a draft to an approver. What they should be shown is `approval.exceptions` from " +
    "`get` — the lines that deviated, not the document.",
  parameters: { ...ENV, proposalId: PROPOSAL_ID, actorEmail: ACTOR },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return submitForApproval(str(p, "proposalId"), str(p, "actorEmail"));
    }),
});

server.addHandler({
  name: "approve",
  description:
    "Approve the DEVIATION from the price list — not the price list, which carries its own " +
    "approval. Records approvedBy and approvedAt. Allowed from draft as well: a proposal " +
    "within authority needs nobody.",
  parameters: { ...ENV, proposalId: PROPOSAL_ID, note: S("Optional note for the timeline"), actorEmail: ACTOR },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return approveProposal(str(p, "proposalId"), optStr(p, "note"), str(p, "actorEmail"));
    }),
});

server.addHandler({
  name: "return",
  description:
    "Send a proposal back to draft. The reason is MANDATORY — without it the approver's job " +
    "is invisible and the estimator's next move is a guess.",
  parameters: { ...ENV, proposalId: PROPOSAL_ID, reason: S("Why it is coming back"), actorEmail: ACTOR },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return returnProposal(str(p, "proposalId"), str(p, "reason"), str(p, "actorEmail"));
    }),
});

server.addHandler({
  name: "send",
  description:
    "Issue the proposal. Freezes the full payload to frozenJson with a checksum, snapshots the " +
    "document if it has not been rendered, stamps sentBy/sentAt, and flips the PARENT revision " +
    "to superseded — exactly one revision is live at a time.",
  parameters: { ...ENV, proposalId: PROPOSAL_ID, actorEmail: ACTOR },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return sendProposal(str(p, "proposalId"), str(p, "actorEmail"));
    }),
});

server.addHandler({
  name: "withdraw",
  description: "Pull a sent proposal. Reason mandatory — this is us changing our mind, on the record.",
  parameters: { ...ENV, proposalId: PROPOSAL_ID, reason: S("Why it is being pulled"), actorEmail: ACTOR },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return withdrawProposal(str(p, "proposalId"), str(p, "reason"), str(p, "actorEmail"));
    }),
});

server.addHandler({
  name: "respond",
  description:
    "Record the client's decision. Rejection needs a reason — win/loss analysis is only as good " +
    "as that field. On acceptance, acceptedLineIds records WHICH optional lines they took, which " +
    "is what drives the work orders.",
  parameters: {
    ...ENV,
    proposalId: PROPOSAL_ID,
    decision: S("accepted | rejected"),
    reason: S("Mandatory on rejection"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      const ids = (optArray(p, "acceptedLineIds") ?? []).map((v) => String(v));
      return respondToProposal({
        proposalId: str(p, "proposalId"),
        decision: oneOf(p, "decision", ["accepted", "rejected"] as const),
        reason: optStr(p, "reason"),
        acceptedLineIds: ids,
        actor: str(p, "actorEmail"),
      });
    }),
});

// --- negotiation and revision (spec §5) --------------------------------------------

server.addHandler({
  name: "event-add",
  description:
    `Record a negotiation event: ${NEGOTIATION_KINDS.join(", ")}. NOT a status change — a ` +
    "counter-offer is a thing that happened, and a revision exists only when we deliberately re-price.",
  parameters: {
    ...ENV,
    proposalId: PROPOSAL_ID,
    kind: S(NEGOTIATION_KINDS.join(" | ")),
    body: S("What was said"),
    amount: N("Minor units — the number they countered with, when there is one"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return addNegotiationEvent({
        proposalId: str(p, "proposalId"),
        kind: str(p, "kind"),
        body: optStr(p, "body"),
        amount: optNum(p, "amount"),
        actor: str(p, "actorEmail"),
      });
    }),
});

server.addHandler({
  name: "revise",
  description:
    "Raise v-next: a new proposal row sharing this one's ref number, with every active line " +
    "copied onto it and validity reset. The parent stays live until the revision is SENT.",
  parameters: { ...ENV, proposalId: PROPOSAL_ID, actorEmail: ACTOR },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return reviseProposal(str(p, "proposalId"), str(p, "actorEmail"));
    }),
});

server.addHandler({
  name: "diff",
  description:
    "Line-level diff against the parent revision — added, removed, quantity, rate, mode, " +
    "frequency, optional — plus what each did to the totals. Lines are matched by identity, " +
    "never by position.",
  parameters: { ...ENV, proposalId: PROPOSAL_ID },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return diffProposal(str(p, "proposalId"));
    }),
});

// --- the document (spec §6) ---------------------------------------------------------

server.addHandler({
  name: "template-list",
  description: "Proposal templates — an ordered section list each, not an uploaded file.",
  parameters: { ...ENV },
  execute: async () => handle(() => listTemplates()),
});

server.addHandler({
  name: "template-save",
  description:
    "Create or update a template. `sections` is the ORDERED list — order is the template. Each " +
    "is { type: 'system'|'text', key, title, body }; a system key must be one the renderer knows.",
  parameters: {
    ...ENV,
    templateId: S("Omit to create"),
    name: S("Template name"),
    description: S("What this template is for"),
    status: S(TEMPLATE_STATUSES.join(" | ")),
    isDefault: S("'true' makes this the template a proposal falls back to"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      // `supplied` throughout: a rename must leave the section list, the
      // published status and the default flag exactly as they were.
      return saveTemplate({
        templateId: optStr(p, "templateId"),
        name: supplied(p, "name", optStr),
        description: supplied(p, "description", optStr),
        status: supplied(p, "status", optStr),
        sections: supplied(p, "sections", optArray),
        isDefault: supplied(p, "isDefault", optBool),
        actor: str(p, "actorEmail"),
      });
    }),
});

server.addHandler({
  name: "render",
  description:
    "Build the proposal document and SNAPSHOT it onto the proposal — on first render only. " +
    "After that the stored snapshot comes back unchanged, so an admin editing a template cannot " +
    "change a proposal a client is already holding. `force` re-snapshots, and only while it is a draft.",
  parameters: {
    ...ENV,
    proposalId: PROPOSAL_ID,
    templateId: S("Optional: render with a specific template"),
    force: S("'true' re-snapshots — refused unless the proposal is still a draft"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return renderProposal({
        proposalId: str(p, "proposalId"),
        templateId: optStr(p, "templateId"),
        force: optBool(p, "force"),
        actor: str(p, "actorEmail"),
      });
    }),
});

// --- rate card admin (spec §3) ------------------------------------------------------

server.addHandler({
  name: "card-list",
  description:
    "Rate cards, most specific first. `includeRows` brings each card's rows in the same query; " +
    "`includeInactive` shows retired cards and rows so one can be brought back. Prices are MINOR units.",
  parameters: {
    ...ENV,
    includeRows: S("'true' to include each card's rows"),
    includeInactive: S("'true' to include retired cards and rows"),
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return listCards(optBool(p, "includeRows") ?? false, optBool(p, "includeInactive") ?? false);
    }),
});

server.addHandler({
  name: "card-save",
  description:
    "Create or update a rate card header. Region and client are nullable and both mean 'applies " +
    "to everyone'; most specific wins at resolution and priority breaks ties. Dates may be plain " +
    "YYYY-MM-DD.",
  parameters: {
    ...ENV,
    rateCardId: S("Omit to create"),
    name: S("Card name"),
    description: S("What this card covers"),
    currency: S("ISO code, default AED"),
    region: S("Null/blank = every region"),
    clientAccountId: S("Null/blank = every client"),
    priority: N("Breaks ties between cards of equal specificity"),
    status: S(CARD_STATUSES.join(" | ")),
    effectiveFrom: S("ISO date"),
    effectiveTo: S("ISO date, blank = open-ended"),
    conditionScaleDirection: S(SCALE_DIRECTIONS.join(" | ")),
    active: S("'false' retires the card, 'true' brings it back"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      // `supplied` throughout: editing one field must not default the other
      // eight. An active card silently reverting to draft stops the whole app
      // resolving a rate.
      return saveCard({
        rateCardId: optStr(p, "rateCardId"),
        name: supplied(p, "name", optStr),
        description: supplied(p, "description", optStr),
        currency: supplied(p, "currency", optStr),
        region: supplied(p, "region", optStr),
        clientAccountId: supplied(p, "clientAccountId", optStr),
        priority: supplied(p, "priority", optNum),
        status: supplied(p, "status", optStr),
        effectiveFrom: supplied(p, "effectiveFrom", optStr),
        effectiveTo: supplied(p, "effectiveTo", optStr),
        conditionScaleDirection: supplied(p, "conditionScaleDirection", optStr),
        active: supplied(p, "active", optBool),
        actor: str(p, "actorEmail"),
      });
    }),
});

server.addHandler({
  name: "card-row-save",
  description:
    "Add or update a rate card row. Price, basis and unit are one atomic fact — the unit is " +
    "validated against the basis. `price` and `minCharge` are MINOR units. `active: 'false'` " +
    "retires the row, 'true' brings it back.",
  parameters: {
    ...ENV,
    rateCardId: S("Card this row belongs to"),
    rowId: S("Omit to add a new row"),
    facilioServiceId: S("Facilio Services record id (C23)"),
    serviceCode: S("Our own catalogue code"),
    description: S("What this row prices"),
    estimationKey: S("Joins the survey's estimation_values to this price"),
    pricingBasis: S("unit | hour | visit"),
    uom: S("Depends on the basis — sq_ft, washroom, hour, per_visit …"),
    price: N("Minor units. ONE price per row — no cost, no floor, no minimum"),
    minCharge: N("Minor units"),
    defaultFrequency: S("one_time | daily | weekly | fortnightly | monthly | quarterly | annual"),
    sequenceNo: N("Display order"),
    notes: S("Internal notes"),
    active: S("'false' retires the row, 'true' brings it back"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      const multipliers = p.conditionMultipliers;
      return saveCardRow({
        rateCardId: str(p, "rateCardId"),
        rowId: optStr(p, "rowId"),
        facilioServiceId: supplied(p, "facilioServiceId", optStr),
        serviceCode: supplied(p, "serviceCode", optStr),
        description: supplied(p, "description", optStr),
        estimationKey: supplied(p, "estimationKey", optStr),
        pricingBasis: supplied(p, "pricingBasis", optStr),
        uom: supplied(p, "uom", optStr),
        price: supplied(p, "price", optNum),
        minCharge: supplied(p, "minCharge", optNum),
        conditionMultipliers:
          multipliers && typeof multipliers === "object" && !Array.isArray(multipliers)
            ? (multipliers as Record<string, number>)
            : null,
        defaultFrequency: supplied(p, "defaultFrequency", optStr),
        sequenceNo: supplied(p, "sequenceNo", optNum),
        notes: supplied(p, "notes", optStr),
        active: supplied(p, "active", optBool),
        actor: str(p, "actorEmail"),
      });
    }),
});

server.addHandler({
  name: "card-row-remove",
  description:
    "Retire a rate card row. Never a hard delete — a sent proposal points at it. Bring it back " +
    "with card-row-save and active: 'true'.",
  parameters: { ...ENV, rateCardId: S("Card the row belongs to"), rowId: S("Row id (uuid)"), actorEmail: ACTOR },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return removeCardRow(str(p, "rateCardId"), str(p, "rowId"), str(p, "actorEmail"));
    }),
});

server.addHandler({
  name: "reference",
  description:
    "Enum vocabulary for the UI — statuses, pricing modes, bases, units per basis, frequencies, " +
    "negotiation kinds, document section keys, template and card statuses.",
  parameters: { ...ENV },
  execute: async () => handle(() => reference()),
});

server.execute();
