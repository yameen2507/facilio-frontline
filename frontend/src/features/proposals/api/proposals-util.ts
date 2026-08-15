/**
 * The proposal data layer.
 *
 * LIVE — every wrapper below. All 24 handlers are registered in
 * `src/functions/proposal/index.ts` and exercised against the deployed app:
 * the pricing slice (§9 L1–L2), the document slice (L3), and the lifecycle
 * slice (L4–L5). There is no seam in this file and nothing here is mocked.
 *
 * A rejection is a normal response, never a throw — `requestFrom` returns
 * `{ data, error }` and every surface renders the server's message VERBATIM.
 * That is why a refused transition reads as the reason it was refused rather
 * than as a spinner that never resolves.
 *
 * | handler               | args                                                | returns                        |
 * | --------------------- | --------------------------------------------------- | ------------------------------ |
 * | `create`              | dealId, surveyRevisionId?, title?, contractType?     | `{ proposal }`                 |
 * | `get`                 | proposalId                                           | proposal + lines + card + trail |
 * | `list`                | status?, dealId?, accountId?, limit, offset          | `{ proposals[], truncated }`   |
 * | `update`              | proposalId, title, contractType, validUntil, …       | `{ proposal }`                 |
 * | `line-generate`       | proposalId, actorEmail                               | `{ proposal, created, unpriced[], warnings[] }` |
 * | `line-save`           | proposalId, lineId?, qty, pricingMode, delta*, …     | `{ proposal, problems[] }`     |
 * | `line-remove`         | proposalId, lineId, actorEmail                       | `{ proposal }`                 |
 * | `reference`           | —                                                    | the enum vocabulary            |
 * | `submit-for-approval` | proposalId, actorEmail                               | `{ proposal }`                 |
 * | `approve`             | proposalId, actorEmail                               | `{ proposal }`                 |
 * | `return`              | proposalId, reason, actorEmail                       | `{ proposal }`                 |
 * | `send`                | proposalId, actorEmail                               | `{ proposal }`                 |
 * | `withdraw`            | proposalId, reason, actorEmail                       | `{ proposal }`                 |
 * | `respond`             | proposalId, decision, reason, actorEmail             | `{ proposal }`                 |
 * | `event-add`           | proposalId, kind, body, actorEmail                   | `{ proposal }`                 |
 * | `revise`              | proposalId, actorEmail                               | `{ proposal }` — the CHILD     |
 * | `diff`                | proposalId, againstProposalId?                       | `{ diff }`                     |
 * | `template-list`       | —                                                    | `{ templates[] }`              |
 * | `template-save`       | templateId?, payload:{name, sections[]}              | `{ template }`                 |
 * | `render`              | proposalId, templateId?, actorEmail                  | `{ document }`                 |
 *
 * TWO PLATFORM RULES SHAPE EVERY WRAPPER BELOW:
 *
 * 1. Handler parameters may only be `string` or `number`, so anything with an
 *    array, an object or a boolean in it rides in `payload` as a JSON string.
 * 2. A BLANK FLAT FIELD IS DROPPED UPSTREAM rather than arriving as `""` — it
 *    resolves as an empty connection-action template. So an optional filter is
 *    spread conditionally, and CLEARING a value (emptying a delta reason when a
 *    line goes back to standard) MUST go through the payload envelope, which is
 *    why every line write does.
 */

import { requestFrom, type Result } from "../../../lib/request";
import type {
  DiffResponse,
  PricingMode,
  Proposal,
  ProposalDetailResponse,
  ProposalListResponse,
  ProposalReference,
  ProposalTemplate,
  RenderResponse,
} from "../types/proposal";

/** Its own platform function — never widen `survey` or `lead` for this module. */
const FN = "proposal";

export const LIST_LIMIT = 100;

const call = <T>(handler: string, args: Record<string, unknown> = {}): Promise<Result<T>> =>
  requestFrom<T>(FN, handler, args);

/** Arrays, objects and booleans cannot be flat fields — they ride in `payload`. */
const payload = (body: Record<string, unknown>) => ({ payload: JSON.stringify(body) });

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * `proposal.list` — one hardcoded default list, sliced client-side. Saved views,
 * column config and cross-record search stay a PLATFORM concern, solved once
 * across leads, deals and proposals; what this module owes that layer is its
 * filterable fields: status, dealId, accountId, validUntil, revisionNo.
 */
export const listProposals = (status: string, dealId?: string, accountId?: string) =>
  call<ProposalListResponse>("list", {
    limit: LIST_LIMIT,
    offset: 0,
    // Sent only when set: a blank flat field is dropped upstream (see the
    // header), so "" would not clear the filter — it would vanish.
    ...(status && status !== "all" ? { status } : {}),
    ...(dealId ? { dealId } : {}),
    ...(accountId ? { accountId } : {}),
  });

/** `proposal.get` — proposal, lines, rate card, approval, warnings and the
    timeline in ONE batched query. Expiry and the exception list are computed
    here, so the estimator reads exactly what the approver will. */
export const getProposal = (proposalId: string) =>
  call<ProposalDetailResponse>("get", { proposalId });

/** `proposal.reference` — the enum vocabulary. Read, never hardcoded: the
    units a basis allows are a master the backend owns. */
export const getReference = () => call<ProposalReference>("reference");

// ── Creation and the commercial shape ────────────────────────────────────────

/**
 * `proposal.create` — a proposal is raised AGAINST a deal. `surveyRevisionId` is
 * optional on purpose (C22: a simple customer is priced straight from a call);
 * without one there is nothing for `line-generate` to read, and the lines are
 * added by hand instead.
 */
export const createProposal = (
  dealId: string,
  actorEmail: string,
  opts: { surveyRevisionId?: string; title?: string; contractType?: string } = {}
) => call<{ proposal: Proposal }>("create", { dealId, actorEmail, ...opts });

/**
 * `proposal.update` — validity, payment terms, contract type, threshold.
 * Status is deliberately absent: a status change is its own operation, with its
 * own guard and its own event.
 *
 * Through the envelope because this is the form that CLEARS things — emptying
 * the payment terms has to arrive as `""` and not as a field that was never
 * sent (header rule 2).
 */
export const updateProposal = (
  proposalId: string,
  actorEmail: string,
  fields: Record<string, unknown>
) => call<ProposalDetailResponse>("update", { ...payload({ proposalId, actorEmail, ...fields }) });

/** The cards an estimator may pick from. Every card, so a draft or expired one
    can be SEEN and explained rather than silently absent — the handler is what
    refuses anything but an active card. */
export type SelectableCard = {
  id: string;
  name: string | null;
  status: string | null;
  currency: string | null;
  region: string | null;
};

export const listSelectableCards = () =>
  call<{ cards: SelectableCard[] }>("card-list", {});

/**
 * `proposal.set-rate-card` — override the resolved card.
 *
 * The reason is not optional and not decoration: it becomes the proposal's
 * resolved-reason, which is the sentence the pricing surface prints. Resolution
 * explains itself; a manual choice has to as well, or the price becomes the one
 * number on the document nobody can account for.
 */
export const setRateCard = (
  proposalId: string,
  rateCardId: string,
  reason: string,
  actorEmail: string
) => call<ProposalDetailResponse>("set-rate-card", { proposalId, rateCardId, reason, actorEmail });

// ── Lines ────────────────────────────────────────────────────────────────────

/** What `line-generate` could not price. Never dropped — an unpriced item the
    estimator cannot see is an item that quietly leaves the proposal. */
export type UnpricedItem = { reason: string; estimationKey?: string; label?: string };

/**
 * `proposal.line-generate` — draft priced lines from the frozen survey revision,
 * joining `estimation_key` to the rate card. IDEMPOTENT: re-running replaces the
 * generated lines rather than adding to them. Draft only.
 */
export const generateLines = (proposalId: string, actorEmail: string) =>
  call<{ proposal: Proposal; created: number; unpriced: UnpricedItem[]; warnings: string[] }>(
    "line-generate",
    { proposalId, actorEmail }
  );

/** The fields a line write may carry. `deltaValue` is a percentage when
    `deltaType` is `pct` and MINOR UNITS when it is `amount`; for a custom line
    the estimator's own price arrives as `cardPrice`, because there is no card
    row behind it to copy from. */
export type LineDraft = {
  lineId?: string;
  description?: string;
  qty?: number;
  pricingBasis?: string;
  uom?: string;
  frequency?: string;
  cardPrice?: number;
  pricingMode?: PricingMode;
  deltaType?: string | null;
  deltaValue?: number | null;
  deltaReason?: string | null;
  isOptional?: boolean;
  serviceCode?: string | null;
  notes?: string | null;
};

/**
 * `proposal.line-save` — add a line, or update one by `lineId`. Applies the
 * mode, then the per-occurrence floor, then the frequency math, then recomputes
 * both totals; the whole proposal comes back so the page never adds up money
 * itself.
 *
 * `problems[]` are WARNINGS, shown and never used to block (C8) — the mandatory
 * delta reason is enforced in the editor, which is a different thing from
 * swallowing a server rejection.
 *
 * Everything goes through the envelope: `isOptional` is a boolean, and clearing
 * `deltaReason` when a line returns to standard needs a field that can actually
 * arrive empty.
 */
export const saveLine = (proposalId: string, actorEmail: string, draft: LineDraft) =>
  call<ProposalDetailResponse & { problems: string[] }>("line-save", {
    ...payload({ proposalId, actorEmail, ...draft }),
  });

/** `proposal.line-remove` — deactivates. Never a hard delete: the line is part
    of how this price was reached. */
export const removeLine = (proposalId: string, lineId: string, actorEmail: string) =>
  call<ProposalDetailResponse>("line-remove", { proposalId, lineId, actorEmail });

// ── Lifecycle ────────────────────────────────────────────────────────────────

/** `proposal.submit-for-approval` — only when a deviation needs one. */
export const submitForApproval = (proposalId: string, actorEmail: string) =>
  call<ProposalDetailResponse>("submit-for-approval", { proposalId, actorEmail });

/** `proposal.approve` — approves a DEVIATION from the card, not the card
    itself. The rate card carries its own approval, and the two are not the same. */
export const approveProposal = (proposalId: string, actorEmail: string) =>
  call<ProposalDetailResponse>("approve", { proposalId, actorEmail });

/** `proposal.return` — back to draft, reason mandatory. Named for the
    handler; `return` is a reserved word. */
export const returnProposal = (proposalId: string, reason: string, actorEmail: string) =>
  call<ProposalDetailResponse>("return", { ...payload({ proposalId, reason, actorEmail }) });

/** `proposal.send` — FREEZES the revision, stamps the checksum and
    `sent_at`, and supersedes the parent. Everything after this is a new revision. */
export const sendProposal = (proposalId: string, actorEmail: string) =>
  call<ProposalDetailResponse>("send", { proposalId, actorEmail });

/** `proposal.withdraw` — we pull the offer. Reason mandatory. */
export const withdrawProposal = (proposalId: string, reason: string, actorEmail: string) =>
  call<ProposalDetailResponse>("withdraw", { ...payload({ proposalId, reason, actorEmail }) });

/** `proposal.respond` — accept or reject, as the client answered. A
    rejection carries its reason into win/loss. */
export const respondToProposal = (
  proposalId: string,
  decision: "accepted" | "rejected",
  reason: string,
  actorEmail: string
) => call<ProposalDetailResponse>("respond", { ...payload({ proposalId, decision, reason, actorEmail }) });

/**
 * `proposal.event-add` — one entry on the negotiation thread. This is
 * NOT a status change: a client saying "do it for 40k" is a thing that
 * happened, and a revision exists only when we deliberately re-price (spec §5
 * R2). Through the envelope because the body is prose that may be empty.
 */
export const addNegotiationEvent = (
  proposalId: string,
  kind: string,
  body: string,
  actorEmail: string
) => call<ProposalDetailResponse>("event-add", { ...payload({ proposalId, kind, body, actorEmail }) });

/** `proposal.revise` — copies the lines into a new DRAFT child, resets
    the validity, and returns the child. The parent only flips to superseded when
    the child is actually sent (spec §5 R3). */
export const reviseProposal = (proposalId: string, actorEmail: string) =>
  call<{ proposal: Proposal }>("revise", { proposalId, actorEmail });

/**
 * `proposal.diff` — line-level: added, removed, repriced, plus the delta
 * to each total. Against the parent revision unless another is named.
 *
 * The `{ diff }` wrapper is a GUESS, matching the `{ proposal }` house style —
 * this handler is not registered yet, so nothing has proved the shape.
 */
export const diffProposal = (proposalId: string, againstProposalId?: string) =>
  call<DiffResponse>("diff", {
    proposalId,
    ...(againstProposalId ? { againstProposalId } : {}),
  });

// ── The document ─────────────────────────────────────────────────────────────

/** `proposal.template-list` — P1 ships one seeded template. */
export const listTemplates = () => call<{ templates: ProposalTemplate[] }>("template-list");

/** `proposal.template-save` — sections are an array, so the envelope. */
export const saveTemplate = (template: ProposalTemplate, actorEmail: string) =>
  call<{ template: ProposalTemplate }>("template-save", { ...payload({ ...template, actorEmail }) });

/**
 * `proposal.render` — merges the tokens and builds the section snapshot.
 *
 * THE SNAPSHOT IS TAKEN AT FIRST RENDER and written to `document_json`. An admin
 * editing the template on Friday must not change a proposal already with a
 * client, and a frozen revision must reproduce byte-identically — the same
 * problem, and the same solution, as the survey question snapshot.
 */
export const renderProposal = (
  proposalId: string,
  actorEmail: string,
  templateId?: string,
  /**
   * Re-snapshot instead of reading the stored one. The handler refuses it on
   * anything past draft — a document a client is holding does not get rewritten
   * — which is exactly why the caller may ask for it freely.
   */
  force?: boolean
) =>
  call<RenderResponse>("render", {
    proposalId,
    actorEmail,
    ...(templateId ? { templateId } : {}),
    ...(force ? { force: "true" } : {}),
  });

// ── Elsewhere ────────────────────────────────────────────────────────────────

/** A deal as the create-proposal picker needs it. */
export type DealOption = {
  id: string;
  refNo: string;
  title: string | null;
  stage: string;
  accountName: string | null;
  estimatedValue: number | null;
  currency: string | null;
};

/**
 * `survey.deal-list` — a proposal is raised AGAINST a deal, so the picker needs
 * them. Calls the `survey` function directly rather than importing the survey
 * feature's api-util: features do not reach into each other's internals, and
 * this thin duplicate is the cheapest honest boundary. When the proposal
 * function grows its own deal reader, this is the one line that moves.
 */
export const listDeals = () => requestFrom<{ deals: DealOption[] }>("survey", "deal-list");

/**
 * The service catalogue, for the line editor's Service picker.
 *
 * `proposal.reference` carries the ENUMS the UI needs; the catalogue is data,
 * not an enum, and it is owned by Settings — so it is read from the `lead`
 * function that serves it rather than duplicated into the reference payload.
 * Retired services are dropped: a line may not be priced against one, and the
 * server refuses it in those words.
 */
export const listServiceOptions = () =>
  requestFrom<{ services: { code: string; name: string; active?: string | null }[] }>(
    "lead",
    "service-list"
  );

/** A frozen survey revision, as the create dialog needs to describe it. */
export type SurveyRevisionOption = {
  id: string;
  surveyId: string;
  revisionNo: number;
  frozenAt?: string | null;
  surveyRefNo?: string | null;
  surveyTitle?: string | null;
  completenessPct?: number | null;
  notVisitedPct?: number | null;
};

/**
 * `survey.revision-list` — the frozen surveys this deal can be priced from.
 *
 * Calls the `survey` function directly, exactly as `listDeals` a few lines
 * below already does: features do not import each other's internals, and a thin
 * duplicate at the boundary is cheaper than a dependency between two lanes that
 * are owned separately.
 *
 * Completed surveys only — the handler enforces that, because a revision frozen
 * beside a status change that did not land is inert by design.
 */
export const listSurveyRevisions = (dealId: string) =>
  requestFrom<{ revisions: SurveyRevisionOption[] }>("survey", "revision-list", { dealId });

