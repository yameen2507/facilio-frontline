/**
 * Conversion: a qualified lead becomes an Account, a Contact and a Deal, and the
 * Facilio-side client/contact records are queued rather than written inline.
 *
 * Nothing here calls Facilio directly. Two serialised ~10s fetches inside a
 * request would risk a timeout with a half-created client and no way back; the
 * outbox makes the whole thing retryable and idempotent.
 */

import { mutate, nowIso, one } from "../shared/db";
import { appendEvent } from "../shared/events";
import { nextRef } from "../shared/ids";
import { enqueue } from "../shared/outbox";
import { getLead, transitionLead } from "./lead";

export interface ConvertInput {
  leadId: string;
  actor?: string | null;
  dealTitle?: string | null;
  estimatedValue?: number | null;
  salesOwnerEmail?: string | null;
}

export interface ConvertResult {
  leadId: string;
  accountId: string;
  contactId: string | null;
  dealId: string;
  dealRefNo: string;
  queued: string[];
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

  const now = nowIso();
  const queued: string[] = [];

  // --- account ---
  let accountId = lead.accountId;
  if (!accountId) {
    const existing = one<{ id: string }>("select id from fl_account where lead_id = $1 limit 1", [
      lead.id,
    ]);
    accountId = existing?.id ?? null;
  }

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
  let contactId = lead.contactId;
  if (!contactId) {
    const existing = one<{ id: string }>(
      "select id from fl_account_contact where account_id = $1 limit 1",
      [accountId]
    );
    contactId = existing?.id ?? null;
  }

  if (!contactId && lead.contactEmail) {
    const row = one<{ id: string }>(
      `insert into fl_account_contact
         (id, account_id, lead_id, name, email, phone, is_primary,
          facilio_contact_id, sync_status, data_json, created_at, updated_at)
       values (gen_random_uuid()::text, $1, $2, $3, $4, $5, 'true', null, 'pending', '{}', $6, $6)
       returning id`,
      [accountId, lead.id, lead.contactName ?? lead.companyName ?? "Contact", lead.contactEmail, lead.contactPhone, now]
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
       values (gen_random_uuid()::text, $1, $2, $3, $4, $5, 'open', $6, $7, $8, $9, '{}', $10, $10)
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
        now,
      ]
    );
    if (!row) throw new Error("could not create deal");
    dealId = row.id;
  }

  // --- link back onto the lead ---
  mutate(
    `update fl_lead set account_id = $2, contact_id = $3, deal_id = $4,
            sales_owner_email = coalesce($5, sales_owner_email), updated_at = $6
      where id = $1`,
    [lead.id, accountId, contactId, dealId, input.salesOwnerEmail ?? null, now]
  );

  // --- queue the Facilio writes ---
  // Deterministic keys mean a retry can never create a second Facilio client.
  const clientKey = `account:${accountId}:create_client`;
  if (enqueue({
    aggregateType: "account",
    aggregateId: accountId,
    action: "create_client",
    idempotencyKey: clientKey,
    payload: {
      name: lead.companyName,
      primaryContactEmail: lead.contactEmail,
      primaryContactName: lead.contactName,
      primaryContactPhone: lead.contactPhone,
      address: {
        street: lead.siteAddress ?? undefined,
        city: lead.siteCity ?? undefined,
        state: lead.siteRegion ?? undefined,
      },
    },
  }).created) {
    queued.push(clientKey);
  }

  if (contactId) {
    const contactKey = `contact:${contactId}:create_client_contact`;
    if (enqueue({
      aggregateType: "contact",
      aggregateId: contactId,
      action: "create_client_contact",
      idempotencyKey: contactKey,
      // The Facilio client id does not exist yet; the drain resolves it from the
      // account row and defers this task until it does.
      dependsOnId: accountId,
      payload: {
        accountId,
        name: lead.contactName ?? lead.companyName,
        email: lead.contactEmail,
        phone: lead.contactPhone,
      },
    }).created) {
      queued.push(contactKey);
    }
  }

  appendEvent({
    entityType: "lead",
    entityId: lead.id,
    kind: "converted",
    actor: input.actor ?? null,
    body: `Converted to account + deal ${dealRefNo}`,
    meta: { accountId, contactId, dealId, dealRefNo, queued },
  });

  if (lead.status === "qualified") {
    transitionLead({
      leadId: lead.id,
      toStatus: "converted",
      actor: input.actor,
      note: `Converted to deal ${dealRefNo}`,
    });
  }

  return { leadId: lead.id, accountId, contactId, dealId: dealId as string, dealRefNo, queued };
}
