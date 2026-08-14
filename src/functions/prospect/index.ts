/**
 * The `prospect` function — the prospect portfolio's own handlers.
 * `Prospect Portfolio Module v1.1.md` §11.
 *
 * WHY ITS OWN FUNCTION and not more handlers on `survey`: §2. A location is born
 * three ways and only one is a walk. A deal that is priced from a blueprint never
 * creates a survey, so a portfolio reachable only through `survey/*` is a
 * portfolio that cannot exist for a large share of real pursuits.
 *
 * WHAT IS DELIBERATELY MISSING, and why — because a handler list with quiet gaps
 * is worse than one with stated gaps:
 *
 *   `convert-to-facilio` / `convert-status` — the Facilio write. Blocked on G1:
 *       L9 (mandatory enums on a portfolio create), L20 (does the API accept a
 *       space directly under a site?), L21 (can our role deactivate, for §7.5's
 *       reverse walk?) and L22 (client contact create) are all unanswered.
 *       §3a: a requirement that violates a platform constraint is not a
 *       requirement, it is a wish. `convert-preflight` IS here, because it reads
 *       and reports and touches Facilio not at all.
 *
 *   `update` — there is NO attribute-setting handler, on purpose, and its absence
 *       is §4.3's rule made structural: **a location's attribute columns are a
 *       cache of the latest accepted observation, and acceptance is the only
 *       thing that writes them.** To change an area you `observe` a new one, and
 *       if it disagrees with what is accepted a person resolves it. An `update`
 *       that poked `area_sqft` directly would be exactly the silent overwrite
 *       C25 forbids — so the handler does not exist, rather than existing and
 *       being discouraged in a comment nobody reads.
 *
 *   `ingest-input` / `ingest-store` — C37, explicitly NOT P1 (§6).
 *
 *   `attach*` — L17 resolved to reusing `fl_photo`, which already carries `kind`,
 *       `captured_at` and geo in `data_json`, so attachments ride the existing
 *       `survey.attach` path rather than a new table (§5.3's own condition).
 */

import StudioFunctions from "@facilio/studio-functions";
import { FIELD_KEYS, RECONCILIATION_DECISIONS } from "../../domain/observation-state";
import {
  CONVERT_TARGETS,
  LOCATION_TYPES,
  PROVENANCES,
  PURSUIT_DECISIONS,
  VERDICTS,
} from "../../domain/prospect-state";
import {
  convertPreflight,
  copyForward,
  decideObservation,
  createLocation,
  deactivateLocation,
  getLocation,
  linkFacilio,
  listConflicts,
  listLocations,
  listObservations,
  listSites,
  observe,
  reference,
  reparentLocation,
  setDecision,
  setVerdict,
} from "../../modules/prospect";
import { handle, optBool, optStr, oneOf, parsePayload, str } from "../../shared/envelope";

const S = (description: string) => ({ description, type: "string" as const });

/** Every handler accepts the envelope as an alternative to flat fields. */
const ENV = { payload: S("Optional: the whole input as a JSON object string") };

const DEAL_ID = S("Deal id (uuid) — the pursuit this belongs to");
const LOCATION_ID = S("Prospect location id (uuid)");
const ACTOR = S("Email of the user performing this action");

const server = new StudioFunctions({ name: "prospect" });

// ── Locations ────────────────────────────────────────────────────────────────

server.addHandler({
  name: "create",
  description:
    "Create one location at any level. `name` is the ONLY mandatory descriptive field — a phone call gives you 'the Bleecker Street store' and nothing else. Level rules: a site has no parent, a building hangs off a site, a space off a building OR directly off a site (a car park has no building). ancestry_path is stamped here.",
  parameters: {
    ...ENV,
    dealId: DEAL_ID,
    type: S(`One of: ${LOCATION_TYPES.join(", ")}`),
    name: S("What it is called — required"),
    parentId: S("Parent location id — omit for a site"),
    provenance: S(`Where it came from. One of: ${PROVENANCES.join(", ")}. Defaults to manual`),
    surveyId: S("The survey that created it, when it came off a walk"),
    code: S("The client's own reference for it — tenders are scored against their numbering"),
    clientLevelLabel: S("What the CLIENT calls this level — facility, tower, block, unit"),
    addressLine: S("Street address"),
    city: S("City"),
    region: S("Region or emirate"),
    country: S("Country code"),
    postcode: S("Postcode"),
    sourceAttachmentId: S("The document this was extracted from, if any"),
    verdict: S(`Initial verdict. One of: ${VERDICTS.join(", ")}. Defaults to unverified`),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return createLocation({
        dealId: str(p, "dealId"),
        type: oneOf(p, "type", LOCATION_TYPES),
        name: str(p, "name"),
        parentId: optStr(p, "parentId"),
        provenance: optStr(p, "provenance") as never,
        surveyId: optStr(p, "surveyId"),
        code: optStr(p, "code"),
        clientLevelLabel: optStr(p, "clientLevelLabel"),
        addressLine: optStr(p, "addressLine"),
        city: optStr(p, "city"),
        region: optStr(p, "region"),
        country: optStr(p, "country"),
        postcode: optStr(p, "postcode"),
        sourceAttachmentId: optStr(p, "sourceAttachmentId"),
        verdict: optStr(p, "verdict") as never,
        actor: optStr(p, "actorEmail"),
      });
    }),
});

server.addHandler({
  name: "get",
  description: "One location with every attribute.",
  parameters: { ...ENV, locationId: LOCATION_ID },
  execute: async (args) => handle(() => getLocation(str(parsePayload(args), "locationId"))),
});

server.addHandler({
  name: "list",
  description:
    "The whole tree for a pursuit, ordered by ancestry_path — which IS depth-first tree order, so no client-side sort is needed. no_bid rows are excluded unless includeNoBid is true, because a no_bid drops out of every total.",
  parameters: {
    ...ENV,
    dealId: DEAL_ID,
    type: S(`Filter to one level: ${LOCATION_TYPES.join(", ")}`),
    includeNoBid: S("true to include locations marked no_bid"),
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return listLocations({
        dealId: str(p, "dealId"),
        type: optStr(p, "type") as never,
        includeNoBid: optBool(p, "includeNoBid") ?? false,
      });
    }),
});

server.addHandler({
  name: "site-list",
  description:
    "Sites on a deal, with a child count and address — this is what every 'which property?' picker in the app reads, including the survey create form. Deal-scoped: a building bid before is copied forward into this deal (copy-forward), never shared across two, because a survey is a point-in-time record.",
  parameters: { ...ENV, dealId: DEAL_ID },
  execute: async (args) => handle(() => listSites(str(parsePayload(args), "dealId"))),
});

server.addHandler({
  name: "reparent",
  description:
    "Move a location and RE-STAMP THE WHOLE SUBTREE beneath it. Rejects a cycle and an illegal level. Omit newParentId to make it a site. Re-stamping the descendants is the part that is easy to forget and expensive to miss: their ancestry_path embeds the old chain.",
  parameters: {
    ...ENV,
    locationId: LOCATION_ID,
    newParentId: S("New parent id — omit to move it to the top level"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return reparentLocation({
        locationId: str(p, "locationId"),
        newParentId: optStr(p, "newParentId"),
        actor: optStr(p, "actorEmail"),
      });
    }),
});

server.addHandler({
  name: "deactivate",
  description:
    "Soft-remove a location and its subtree. Never a hard delete (§9). Refused once the location is in Facilio — `converted` beats every role, Admin included.",
  parameters: { ...ENV, locationId: LOCATION_ID, reason: S("Why"), actorEmail: ACTOR },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return deactivateLocation({
        locationId: str(p, "locationId"),
        reason: optStr(p, "reason"),
        actor: optStr(p, "actorEmail"),
      });
    }),
});

// ── Decisions ────────────────────────────────────────────────────────────────

server.addHandler({
  name: "set-decision",
  description:
    "The bid / no-bid call, per site. A note is MANDATORY on no_bid — 'outside our coverage area' is exactly what you will want the next time this client tenders. A no_bid row drops out of every total and never converts.",
  parameters: {
    ...ENV,
    locationId: LOCATION_ID,
    decision: S(`One of: ${PURSUIT_DECISIONS.join(", ")}`),
    note: S("Why — mandatory on no_bid"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return setDecision({
        locationId: str(p, "locationId"),
        decision: oneOf(p, "decision", PURSUIT_DECISIONS),
        note: optStr(p, "note"),
        actor: optStr(p, "actorEmail"),
      });
    }),
});

server.addHandler({
  name: "set-verdict",
  description:
    "Is this location actually real? A note is MANDATORY on changed / not_found / not_visited, because it prints on the proposal as a qualification and a blank is a scope gap you cannot defend. If the location already carries a Facilio id, `changed` raises a DISCREPANCY and writes nothing to Facilio.",
  parameters: {
    ...ENV,
    locationId: LOCATION_ID,
    verdict: S(`One of: ${VERDICTS.join(", ")}`),
    note: S("Mandatory on changed / not_found / not_visited"),
    visitId: S("The visit this finding came from"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return setVerdict({
        locationId: str(p, "locationId"),
        verdict: oneOf(p, "verdict", VERDICTS),
        note: optStr(p, "note"),
        visitId: optStr(p, "visitId"),
        actor: optStr(p, "actorEmail"),
      });
    }),
});

// ── Repeat pursuits ──────────────────────────────────────────────────────────

server.addHandler({
  name: "copy-forward",
  description:
    "Add a location from an EARLIER pursuit — copies structure, area, address and the Facilio id into this deal and links previous_pursuit_id. This replaces a clone feature entirely. Copying beats sharing one row across two deals because a survey is point-in-time: that building's condition in March is not its condition eighteen months later.",
  parameters: {
    ...ENV,
    sourceLocationId: S("The location on the earlier deal"),
    dealId: DEAL_ID,
    parentId: S("Where it lands in THIS deal's tree — omit for a site"),
    withDescendants: S("true to bring its buildings and spaces too"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return copyForward({
        sourceLocationId: str(p, "sourceLocationId"),
        dealId: str(p, "dealId"),
        parentId: optStr(p, "parentId"),
        withDescendants: optBool(p, "withDescendants") ?? false,
        actor: optStr(p, "actorEmail"),
      });
    }),
});

// ── Facilio ──────────────────────────────────────────────────────────────────

server.addHandler({
  name: "link-facilio",
  description:
    "Record that this location ALREADY exists in Facilio (a repeat client's building). A HUMAN confirms the match — the system never guesses, which is why the building-matching UI was cut. Sets convert_state to already_linked, so the convert skips it.",
  parameters: {
    ...ENV,
    locationId: LOCATION_ID,
    facilioId: S("The Facilio record id"),
    facilioModule: S(`Which Facilio module it points at: ${CONVERT_TARGETS.join(", ")}`),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return linkFacilio({
        locationId: str(p, "locationId"),
        facilioId: str(p, "facilioId"),
        facilioModule: oneOf(p, "facilioModule", CONVERT_TARGETS),
        actor: optStr(p, "actorEmail"),
      });
    }),
});

server.addHandler({
  name: "convert-preflight",
  description:
    "READ-ONLY. What a convert run WOULD do: create / skip / flag per location, plus the blockers a person must clear first — including C3's ordering dependency, that a parent must be in Facilio before its child. Enrichment happens at THIS gate, not after (C26). Touches Facilio not at all. The RUN itself is not built: it is blocked on G1 (L9, L20, L21, L22).",
  parameters: {
    ...ENV,
    dealId: DEAL_ID,
    dealIsWon: S("true when the deal is Won — nothing converts before that"),
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return convertPreflight({
        dealId: str(p, "dealId"),
        dealIsWon: optBool(p, "dealIsWon") ?? false,
      });
    }),
});

// ── Observations (§4.3) ──────────────────────────────────────────────────────

server.addHandler({
  name: "observe",
  description:
    "Record a value someone or something observed about a location — the ONE entry point for every feed (a document, the walk, a person typing). What happens next is not the caller's choice: nothing recorded yet auto-accepts; a value that AGREES with the accepted one is absorbed silently; a value that DISAGREES becomes a conflict, both are kept, and the location's attribute is NOT written until a person decides. Append-only — nothing is ever updated in place.",
  parameters: {
    ...ENV,
    locationId: LOCATION_ID,
    fieldKey: S(`Which attribute. One of: ${FIELD_KEYS.join(", ")}`),
    value: S("The observed value. A numeric field refuses anything that will not parse"),
    provenance: S(`Which feed said it: ${PROVENANCES.join(", ")}. Defaults to manual`),
    surveyId: S("The survey it came from, when it came off a walk"),
    visitId: S("The visit it came from"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return observe({
        locationId: str(p, "locationId"),
        fieldKey: str(p, "fieldKey"),
        value: str(p, "value"),
        provenance: optStr(p, "provenance") as never,
        surveyId: optStr(p, "surveyId"),
        visitId: optStr(p, "visitId"),
        actor: optStr(p, "actorEmail"),
      });
    }),
});

server.addHandler({
  name: "observation-list",
  description:
    "Every observation on one location, grouped by field and newest first — the history behind each attribute, with the feed that said it. A superseded value stays here: the chain is how 'who said 4,500 and when' survives the decision that replaced it.",
  parameters: { ...ENV, locationId: LOCATION_ID },
  execute: async (args) => handle(() => listObservations(str(parsePayload(args), "locationId"))),
});

server.addHandler({
  name: "reconcile-list",
  description:
    "Open conflicts across a pursuit — every field where two feeds disagree, with both values side by side. 'Open' means neither accepted nor superseded, so a resolved conflict leaves this list without leaving the record.",
  parameters: { ...ENV, dealId: DEAL_ID },
  execute: async (args) => handle(() => listConflicts(str(parsePayload(args), "dealId"))),
});

server.addHandler({
  name: "reconcile-decide",
  description:
    "A person resolves one conflict. `manual_override` needs its own value; `pushed_to_clarification` deliberately writes NOTHING, because the question has gone back to the tenderer and a placeholder would hide that. Losing values are superseded, never removed, and the decision is stamped on them so 'why is this 5,200?' stays answerable.",
  parameters: {
    ...ENV,
    locationId: LOCATION_ID,
    fieldKey: S("The field being resolved"),
    decision: S(`One of: ${RECONCILIATION_DECISIONS.join(", ")}`),
    manualValue: S("Required on manual_override — the value you want recorded"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return decideObservation({
        locationId: str(p, "locationId"),
        fieldKey: str(p, "fieldKey"),
        decision: oneOf(p, "decision", RECONCILIATION_DECISIONS),
        manualValue: optStr(p, "manualValue"),
        actor: optStr(p, "actorEmail"),
      });
    }),
});

// ── Reference ────────────────────────────────────────────────────────────────

server.addHandler({
  name: "reference",
  description: "Allowed enum values, so callers never hardcode them",
  parameters: {},
  execute: async () => handle(() => reference()),
});

server.execute();
