/**
 * Rate card data layer — served by the `proposal` function, NOT `lead`.
 *
 * | handler          | returns / accepts                                          |
 * | ---------------- | ---------------------------------------------------------- |
 * | `card-list`      | `{ cards: [...] }`, `includeRows` to bring the rows with it |
 * | `card-save`      | the 9 header fields; no `rateCardId` creates                |
 * | `card-row-save`  | one pricing row; no `rowId` creates                         |
 * | `card-row-remove`| deactivates a row (there is no hard delete)                 |
 *
 * ── THE CARD ID IS `rateCardId` ON THE WIRE ──────────────────────────────────
 * The app calls it `cardId`; all three handlers read `rateCardId`. The rename
 * happens HERE so no page has to know. It matters more than a naming nit:
 * `card-save` reads the id with `optStr`, so a mis-keyed id does not error — it
 * reads as absent and every EDIT silently CREATES a second card.
 *
 * ── EVERY WRITE CARRIES `actorEmail` ─────────────────────────────────────────
 * All three handlers read it with `str`, which throws on blank, so a save that
 * omits it is rejected outright. Passed as the second argument, matching
 * `saveUser`/`saveRole` in access-util.ts; call sites read it from `useActor()`.
 *
 * ── MONEY ────────────────────────────────────────────────────────────────────
 * `price` crosses the wire in integer MINOR units (10000 = 100.00). The two
 * conversions live HERE and nowhere else: `readCard` divides on the way in,
 * `saveRateCardRow` multiplies on the way out. A component that converted as
 * well would be out by 100×, and the mistake is invisible until an invoice.
 *
 * ── WHY EVERY SAVE USES THE PAYLOAD ENVELOPE ─────────────────────────────────
 * Region, Client, Effective To, Frequency and Estimation key are all nullable
 * BY DESIGN — a null region means "every region". Clearing one means sending an
 * empty string, and a blank flat field is dropped upstream (the same reason
 * `saveService` in settings-util.ts uses the envelope). Through `payload` the
 * empty string survives, so a scope an admin set can also be un-set.
 *
 * ── "none" IS A THIRD SPELLING OF NULL ───────────────────────────────────────
 * `blank()` in src/domain/proposal-pricing.ts treats null, "", whitespace AND
 * the literal "none" as unset, and the seed CSV writes `none` into `region` and
 * `client_account_id`. `unset()` below matches that reading exactly, so a
 * seeded card reads as unscoped instead of showing a region called "none".
 */

import { requestFrom } from "../../../lib/request";

/** One function per module (ARCHITECTURE §9) — rate cards belong to `proposal`. */
const FN = "proposal";

// ── Vocabulary. Lowercase on the wire, capitalized on screen ─────────────────

export const CARD_STATUSES = ["draft", "active", "archived"] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  active: "Active",
  archived: "Archived",
};

/** Currencies the funnel quotes in. `createProposal` defaults to AED. */
export const CURRENCIES = ["AED", "SAR", "QAR", "OMR", "KWD", "BHD", "USD", "GBP", "EUR", "INR"];

/** Spec §3: three bases, and they collapse thirteen pricing models into three. */
export const PRICING_BASES = ["unit", "hour", "visit"] as const;

export const BASIS_LABEL: Record<string, string> = {
  unit: "Unit",
  hour: "Hour",
  visit: "Visit",
};

/**
 * The Unit master depends on the basis (roles&response §4.3), mirroring
 * `UNITS_BY_BASIS` in src/domain/service-catalogue.ts. Change one and change
 * both. (`service-list` also serves the pair, for the one screen that has it
 * to hand — the labels below only exist here, so this copy stays.)
 */
export const UNITS_BY_BASIS: Record<string, readonly string[]> = {
  unit: ["sq_ft", "sq_m", "washroom", "room", "person", "site", "each"],
  hour: ["hour"],
  visit: ["per_visit"],
};

export const UNIT_LABEL: Record<string, string> = {
  sq_ft: "Sq ft",
  sq_m: "Sq m",
  washroom: "Washroom",
  room: "Room",
  person: "Person",
  site: "Site",
  each: "Each",
  hour: "Hour",
  per_visit: "Per visit",
};

/** `proposal.reference` frequencies; null on a row means "no default". */
export const FREQUENCIES = [
  "one_time",
  "daily",
  "weekly",
  "fortnightly",
  "monthly",
  "quarterly",
  "annual",
];

export const FREQUENCY_LABEL: Record<string, string> = {
  one_time: "One time",
  daily: "Daily",
  weekly: "Weekly",
  fortnightly: "Fortnightly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
};

// ── Types ────────────────────────────────────────────────────────────────────

export type RateCardRow = {
  id: string;
  /** The catalogue code this row prices (Settings › Services). */
  serviceCode: string | null;
  /** What the generated proposal line will read; the row's human label. */
  description: string | null;
  /** The join to the survey walk. Without one the row can never be auto-drafted. */
  estimationKey: string | null;
  pricingBasis: string;
  uom: string | null;
  /** MAJOR units. Divided by 100 in `readCard`, multiplied back on save. */
  price: number | null;
  defaultFrequency: string | null;
};

export type RateCard = {
  id: string;
  name: string;
  /** Cut from the 9-field header (spec §3) — carried so a save cannot drop it. */
  description: string | null;
  currency: string;
  /** Null means EVERY region. */
  region: string | null;
  /** Null means EVERY client. */
  clientAccountId: string | null;
  /** Higher wins a tie between two cards of equal specificity. */
  priority: number;
  status: CardStatus;
  /** `YYYY-MM-DD` — what DateField reads and writes. */
  effectiveFrom: string | null;
  effectiveTo: string | null;
  conditionScaleDirection: string | null;
  rows: RateCardRow[];
};

// ── Reading the wire ─────────────────────────────────────────────────────────

type Wire = Record<string, unknown>;

/** null, "", whitespace and the literal "none" all mean "not set". */
const unset = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  String(value).trim() === "" ||
  String(value).trim().toLowerCase() === "none";

const text = (value: unknown): string | null => (unset(value) ? null : String(value).trim());

const number = (value: unknown): number | null => {
  if (unset(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** ISO timestamps come back from the DB; DateField speaks `YYYY-MM-DD`. */
const datePart = (value: unknown): string | null => {
  const s = text(value);
  return s ? s.slice(0, 10) : null;
};

/** Minor → major. 10000 → 100. */
export const toMajor = (minor: number | null): number | null =>
  minor === null ? null : minor / 100;

/**
 * Major → minor, rounded. `2.30 * 100` is 229.99999999999997 in IEEE 754, and
 * a truncating cast would price the job at 2.29.
 */
export const toMinor = (major: number): number => Math.round(major * 100);

const readRow = (raw: Wire): RateCardRow => ({
  id: String(raw.id ?? ""),
  serviceCode: text(raw.serviceCode),
  description: text(raw.description),
  estimationKey: text(raw.estimationKey),
  pricingBasis: text(raw.pricingBasis) ?? "unit",
  uom: text(raw.uom),
  price: toMajor(number(raw.price)),
  defaultFrequency: text(raw.defaultFrequency),
});

const readCard = (raw: Wire): RateCard => {
  const status = (text(raw.status) ?? "draft").toLowerCase();
  return {
    id: String(raw.id ?? ""),
    name: text(raw.name) ?? "Untitled rate card",
    description: text(raw.description),
    currency: text(raw.currency) ?? "AED",
    region: text(raw.region),
    clientAccountId: text(raw.clientAccountId),
    priority: number(raw.priority) ?? 0,
    status: (CARD_STATUSES as readonly string[]).includes(status)
      ? (status as CardStatus)
      : "draft",
    effectiveFrom: datePart(raw.effectiveFrom),
    effectiveTo: datePart(raw.effectiveTo),
    conditionScaleDirection: text(raw.conditionScaleDirection),
    rows: Array.isArray(raw.rows) ? (raw.rows as Wire[]).map(readRow) : [],
  };
};

// ── Calls ────────────────────────────────────────────────────────────────────

/**
 * Every card with its rows. Booleans travel as the strings "true"/"false" —
 * handler params may only be string or number.
 */
export async function listRateCards(): Promise<{ data: RateCard[] | null; error: string | null }> {
  const { data, error } = await requestFrom<{ cards?: Wire[] } | Wire[]>(FN, "card-list", {
    includeRows: "true",
  });
  if (error) return { data: null, error };

  const cards = Array.isArray(data) ? data : (data?.cards ?? []);
  return { data: cards.map(readCard), error: null };
}

export type CardHeaderInput = {
  /** Omit to create. */
  cardId?: string;
  name: string;
  description: string;
  currency: string;
  /** "" clears the scope — which is what makes the card apply everywhere. */
  region: string;
  clientAccountId: string;
  priority: number;
  status: string;
  effectiveFrom: string;
  effectiveTo: string;
};

export const saveRateCard = ({ cardId, ...rest }: CardHeaderInput, actorEmail: string) =>
  requestFrom<Wire>(FN, "card-save", {
    payload: JSON.stringify({ ...rest, ...(cardId ? { rateCardId: cardId } : {}), actorEmail }),
  });

export type CardRowInput = {
  cardId: string;
  /** Omit to create. */
  rowId?: string;
  serviceCode: string;
  description: string;
  estimationKey: string;
  pricingBasis: string;
  uom: string;
  /** MAJOR units in, minor units on the wire — converted here, once. */
  price: number;
  defaultFrequency: string;
};

export const saveRateCardRow = ({ cardId, price, ...rest }: CardRowInput, actorEmail: string) =>
  requestFrom<Wire>(FN, "card-row-save", {
    payload: JSON.stringify({ ...rest, rateCardId: cardId, price: toMinor(price), actorEmail }),
  });

/**
 * Deactivation, not deletion — `loadCardRows` reads `is_active = 'true'`, so a
 * removed row stops pricing while the proposals that already used it keep
 * resolving. Flat args: both are plain ids with nothing to clear.
 */
export const removeRateCardRow = (cardId: string, rowId: string, actorEmail: string) =>
  requestFrom<Wire>(FN, "card-row-remove", { rateCardId: cardId, rowId, actorEmail });
