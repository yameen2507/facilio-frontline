/**
 * Conversion: a qualified lead becomes an Account, a Contact and a Deal —
 * LOCAL rows only. The Facilio-side client/contact writes moved to the deal's
 * `won` transition (F-08, see queueClientSync in modules/account.ts): a client
 * is a company we work for, which becomes true at the win, not at convert.
 *
 * Nothing here calls Facilio directly, and nothing here queues it either.
 */

import { many, mutate, nowIso, one } from "../shared/db";
import { appendEvent } from "../shared/events";
import { nextRef } from "../shared/ids";
import { dedupKeys, normalizeEmail } from "../domain/normalize";
import { getLead, transitionLead, type Lead } from "./lead";

export interface ConvertInput {
  leadId: string;
  actor?: string | null;
  dealTitle?: string | null;
  estimatedValue?: number | null;
  salesOwnerEmail?: string | null;
  /** F-06: converting a lead the AI assessed `not_relevant` demands this —
      a deliberate decision, recorded, never a default click-through. */
  overrideAssessment?: boolean;
}

export interface ConvertResult {
  leadId: string;
  accountId: string;
  /** False when this lead joined a company we already had an account for. */
  accountCreated: boolean;
  contactId: string | null;
  dealId: string;
  dealRefNo: string;
  queued: string[];
}

/**
 * An account belongs to a company, not to a lead. When an existing customer
 * enquires again, that second lead has to land on the account we already have —
 * otherwise conversion mints a second `fl_account` and, through the outbox, a
 * second Facilio client for one company.
 *
 * The company is matched on `fl_lead`'s normalised keys rather than on
 * `fl_account.website_domain`, because those are the values dedup already
 * computes: the two can never disagree about what counts as the same company.
 * Phone is deliberately not a key — a mobile number follows the person, not the
 * company.
 *
 * All four candidates resolve in ONE statement, ranked narrowest-first, because
 * every query costs ~194ms of fixed bridge overhead (shared/db.ts). A null
 * parameter simply never matches, so absent keys need no branching.
 */
function findAccount(lead: Lead): { id: string; facilioClientId: string | null } | null {
  const keys = dedupKeys(lead);
  return one<{ id: string; facilioClientId: string | null }>(
    `select a.id, a.facilio_client_id
       from fl_account a
       join fl_lead l on l.id = a.lead_id
      where a.id = $1
         or a.lead_id = $2
         or l.domain_norm = $3
         or l.email_norm = $4
      order by case when a.id = $1 then 0        -- already linked to this lead
                    when a.lead_id = $2 then 1   -- created by this lead, earlier run
                    when l.domain_norm = $3 then 2
                    else 3 end,
               a.created_at
      limit 1`,
    [lead.accountId, lead.id, keys.domainNorm, keys.emailNorm]
  );
}

/**
 * Idempotent by construction: if the lead already has an account/deal, the
 * existing ids are reused rather than a second set created. Re-running after a
 * partial failure finishes the job instead of duplicating it.
 */
export function convertLead(input: ConvertInput): ConvertResult {
  const lead = getLead(input.leadId);
  if (!lead) throw new Error(`lead ${input.leadId} not found`);

  if (lead.status !== "qualified" && lead.status !== "converted") {
    throw new Error(`only a qualified lead can be converted (this one is ${lead.status})`);
  }

  // F-06: a 2/100 "not relevant" lead used to sail through here with no guard.
  // The assessment is advice, not law — so this is an override, not a wall —
  // but overriding has to be said out loud and it lands on the audit trail.
  if (lead.verdict === "not_relevant" && !input.overrideAssessment) {
    throw new Error(
      `the assessment called this lead not relevant${
        lead.score != null ? ` (${lead.score}/100)` : ""
      } — re-assess it, or convert with an explicit override`
    );
  }

  const now = nowIso();
  const queued: string[] = [];

  // --- account ---
  const existingAccount = findAccount(lead);
  let accountId = existingAccount?.id ?? null;
  const accountCreated = !accountId;

  if (!accountId) {
    const row = one<{ id: string }>(
      `insert into fl_account
         (id, lead_id, name, email, phone, website_domain, address_json,
          facilio_client_id, sync_status, data_json, created_at, updated_at)
       values (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, null, 'pending', '{}', $7, $7)
       returning id`,
      [
        lead.id,
        lead.companyName ?? "Unnamed account",
        lead.contactEmail,
        lead.contactPhone,
        lead.websiteDomain,
        JSON.stringify({
          street: lead.siteAddress ?? null,
          city: lead.siteCity ?? null,
          state: lead.siteRegion ?? null,
        }),
        now,
      ]
    );
    if (!row) throw new Error("could not create account");
    accountId = row.id;
  }

  // --- contact (only if we have an email; Facilio requires one) ---
  // Matched by email inside the account, not just "the first contact on it":
  // a second enquiry from a different person at the same company is a second
  // contact, and hanging the deal off the wrong one is worse than having none.
  // An account created a moment ago cannot have contacts, and a lead that
  // already carries one needs no lookup — both skip the read entirely.
  const contacts =
    accountCreated || lead.contactId
      ? []
      : many<{ id: string; email: string | null; isPrimary: unknown }>(
          "select id, email, is_primary from fl_account_contact where account_id = $1 order by created_at",
          [accountId]
        );

  const emailNorm = normalizeEmail(lead.contactEmail);
  let contactId = lead.contactId;

  if (!contactId) {
    const match = emailNorm
      ? contacts.find((c) => normalizeEmail(c.email) === emailNorm)
      : // Nothing to match on, so the account's oldest contact is the best we have.
        contacts[0];
    contactId = match?.id ?? null;
  }

  if (!contactId && lead.contactEmail) {
    // An account keeps its original primary contact; a newcomer joins alongside.
    const primary = contacts.some((c) => c.isPrimary === true || c.isPrimary === "true");
    const row = one<{ id: string }>(
      `insert into fl_account_contact
         (id, account_id, lead_id, name, email, phone, is_primary,
          facilio_contact_id, sync_status, data_json, created_at, updated_at)
       values (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, null, 'pending', '{}', $7, $7)
       returning id`,
      [
        accountId,
        lead.id,
        lead.contactName ?? lead.companyName ?? "Contact",
        lead.contactEmail,
        lead.contactPhone,
        primary ? "false" : "true",
        now,
      ]
    );
    contactId = row?.id ?? null;
  }

  // --- deal ---
  let dealId = lead.dealId;
  let dealRefNo: string;

  const existingDeal = dealId
    ? one<{ id: string; refNo: string }>("select id, ref_no from fl_deal where id = $1 limit 1", [dealId])
    : one<{ id: string; refNo: string }>("select id, ref_no from fl_deal where lead_id = $1 limit 1", [lead.id]);

  if (existingDeal) {
    dealId = existingDeal.id;
    dealRefNo = existingDeal.refNo;
  } else {
    dealRefNo = nextRef("deal");
    const row = one<{ id: string }>(
      `insert into fl_deal
         (id, ref_no, lead_id, account_id, contact_id, title, stage,
          estimated_value, currency, sales_owner_email, source,
          data_json, created_at, updated_at)
       values (gen_random_uuid()::text, $1, $2, $3, $4, $5, 'opportunity', $6, $7, $8, $9, $10, $11, $11)
       returning id`,
      [
        dealRefNo,
        lead.id,
        accountId,
        contactId,
        input.dealTitle ?? `${lead.companyName ?? "Lead"} — ${lead.serviceType ?? "service"}`,
        input.estimatedValue ?? lead.estimatedValue,
        lead.currency ?? "AED",
        input.salesOwnerEmail ?? lead.salesOwnerEmail,
        lead.source,
        // D-05 travels with the money: a recurring 12,000 must still read as a
        // 144k/year contract after conversion, or the split was theatre.
        JSON.stringify({
          ...(lead.valueType ? { valueType: lead.valueType } : {}),
          ...(lead.valueFrequency ? { valueFrequency: lead.valueFrequency } : {}),
        }),
        now,
      ]
    );
    if (!row) throw new Error("could not create deal");
    dealId = row.id;

    // The deal's own timeline root — "Assigned to Sales" in deal.md's terms.
    // Only on creation: an idempotent re-run reuses the deal and says nothing.
    appendEvent({
      entityType: "deal",
      entityId: dealId,
      kind: "created",
      actor: input.actor ?? null,
      body: `${dealRefNo} opened from lead ${lead.refNo}${
        input.salesOwnerEmail ?? lead.salesOwnerEmail
          ? ` — sales owner ${input.salesOwnerEmail ?? lead.salesOwnerEmail}`
          : ""
      }`,
      meta: { leadId: lead.id, accountId, contactId },
    });
  }

  // --- link back onto the lead ---
  mutate(
    `update fl_lead set account_id = $2, contact_id = $3, deal_id = $4,
            sales_owner_email = coalesce($5, sales_owner_email), updated_at = $6
      where id = $1`,
    [lead.id, accountId, contactId, dealId, input.salesOwnerEmail ?? null, now]
  );

  /**
   * PROSPECT PORTFOLIO §4.1 — carry the portfolio forward with the lead.
   *
   * A building can be named in an enquiry long before any deal exists: *"the
   * address of the sites… the full addresses"* arrives with the RFP. Those rows
   * are created carrying only `lead_id`. If conversion did not stamp the account
   * and the deal onto them, they would stay stranded on the Lead tab — invisible
   * from the pursuit they now belong to, and invisible from the client's own
   * portfolio, which is the repeat-business question the module exists to answer.
   *
   * Only fills what is EMPTY (`coalesce`). A location already scoped to another
   * deal belongs to that pursuit; copy-forward, not conversion, is what moves a
   * building between pursuits, and overwriting here would silently re-home it.
   */
  const portfolioStamped = mutate(
    `update fl_portfolio_location
        set account_id = coalesce(account_id, $2),
            deal_id = coalesce(deal_id, $3),
            updated_at = $4
      where lead_id = $1 and (account_id is null or deal_id is null)`,
    [lead.id, accountId, dealId, now]
  );

  /**
   * F-08, as of 15 Aug: NO Facilio writes here. Convert used to enqueue the
   * client and contact, which minted Facilio clients for deals that then
   * died — a client is a company we WORK FOR, and that becomes true at the
   * deal's `won` transition, where `queueClientSync` now runs (modules/deal.ts).
   * The local account and contact rows above still appear at convert; only the
   * outward write moved. The same deterministic idempotency keys are used
   * there, so accounts synced under the old rule are never re-sent.
   */

  appendEvent({
    entityType: "lead",
    entityId: lead.id,
    kind: "converted",
    actor: input.actor ?? null,
    body: accountCreated
      ? `Converted to account + deal ${dealRefNo}`
      : `Converted to deal ${dealRefNo} on the existing account`,
    meta: {
      accountId,
      accountCreated,
      contactId,
      dealId,
      dealRefNo,
      queued,
      ...(portfolioStamped ? { portfolioStamped } : {}),
      // F-06: an override is a decision — it survives on the trail.
      ...(input.overrideAssessment ? { overrodeAssessment: true, verdict: lead.verdict, score: lead.score } : {}),
    },
  });

  if (lead.status === "qualified") {
    transitionLead({
      leadId: lead.id,
      toStatus: "converted",
      actor: input.actor,
      note: `Converted to deal ${dealRefNo}`,
    });
  }

  return {
    leadId: lead.id,
    accountId,
    accountCreated,
    contactId,
    dealId: dealId as string,
    dealRefNo,
    queued,
  };
}
