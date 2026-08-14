/**
 * The proposal document: template sections, token merge, and the snapshot.
 * Pure — no db, no fetch, no platform imports.
 *
 * A template is AN ORDERED LIST OF SECTIONS, not an uploaded file. Two kinds:
 *
 *   system — rendered by a function from proposal data (the pricing table, the
 *            optional-services block, the exclusions, the acceptance panel)
 *   text   — written by a human, with {{tokens}} merged in
 *
 * TOKENS ARE MERGED BY A FUNCTION, NEVER BY A MODEL. A model that paraphrases a
 * price has produced a different commercial offer. On this platform a function
 * could not call a model even if we wanted it to, which makes the doctrine a
 * guarantee rather than a policy.
 *
 * THE LOAD-BEARING RULE: the template is SNAPSHOTTED onto the proposal at first
 * render. An admin editing the cover letter on Friday must not change a
 * proposal that went to a client on Thursday, and a frozen revision has to
 * reproduce byte-identically or the audit claim is false. Same problem, and the
 * same solution, as the survey question snapshot.
 */

export type SectionType = "system" | "text";

/** The system sections this build knows how to render. */
export type SystemSectionKey =
  | "site_summary"
  | "pricing_table"
  | "optional_services"
  | "exclusions"
  | "acceptance";

export const SYSTEM_SECTION_KEYS: readonly SystemSectionKey[] = [
  "site_summary",
  "pricing_table",
  "optional_services",
  "exclusions",
  "acceptance",
];

export function isSystemSectionKey(value: unknown): value is SystemSectionKey {
  return typeof value === "string" && (SYSTEM_SECTION_KEYS as readonly string[]).includes(value);
}

export interface TemplateSection {
  type: SectionType;
  /** For system sections, one of SYSTEM_SECTION_KEYS. For text, a stable slug. */
  key: string;
  title: string;
  /** Markdown with {{tokens}}. Empty for system sections. */
  body?: string;
}

export interface ProposalTemplate {
  id?: string | null;
  name: string;
  sections: TemplateSection[];
}

// --- tokens ---------------------------------------------------------------------

/**
 * Every token a text section may use. Deliberately a CLOSED LIST: an unknown
 * token is a typo, and a typo that silently renders as empty is how a client
 * receives a proposal addressed to nobody.
 */
export const TOKENS = [
  "client_name",
  "site_name",
  "proposal_number",
  "revision_no",
  "proposal_date",
  "valid_until",
  "one_time_total",
  "recurring_total",
  "recurring_period",
  "currency",
  "prepared_by",
  "payment_terms",
  "contract_type",
  "threshold_amount",
] as const;

export type TokenName = (typeof TOKENS)[number];

export type TokenValues = Partial<Record<TokenName, string>>;

const TOKEN_PATTERN = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

export interface MergeResult {
  text: string;
  /** Tokens that appeared in the body but are not in the closed list. */
  unknown: string[];
  /** Known tokens with no value for this proposal. */
  missing: string[];
}

/**
 * Replace every {{token}} with its value.
 *
 * An unknown token is left VISIBLE in the output rather than blanked. A human
 * proof-reading the document will notice `{{clietn_name}}`; they will never
 * notice an empty space where a name should be.
 */
export function mergeTokens(body: string, values: TokenValues): MergeResult {
  const unknown: string[] = [];
  const missing: string[] = [];

  const text = String(body ?? "").replace(TOKEN_PATTERN, (whole, raw: string) => {
    const name = raw.toLowerCase() as TokenName;

    if (!(TOKENS as readonly string[]).includes(name)) {
      if (!unknown.includes(raw)) unknown.push(raw);
      return whole;
    }

    const value = values[name];
    if (value === undefined || value === null || value === "") {
      if (!missing.includes(name)) missing.push(name);
      return "—";
    }

    return value;
  });

  return { text, unknown, missing };
}

/** Which tokens a body uses — for the builder's "available here" hint. */
export function tokensUsed(body: string): string[] {
  const found: string[] = [];
  for (const match of String(body ?? "").matchAll(TOKEN_PATTERN)) {
    const name = match[1].toLowerCase();
    if (!found.includes(name)) found.push(name);
  }
  return found;
}

// --- the snapshot ------------------------------------------------------------------

export interface RenderLine {
  description: string;
  qty: number;
  uom: string | null;
  frequency: string | null;
  /** Minor units. */
  appliedPrice: number | null;
  lineTotal: number | null;
  isOptional: boolean;
}

export interface RenderInput {
  template: ProposalTemplate;
  tokens: TokenValues;
  lines: readonly RenderLine[];
  /** From the frozen survey payload's `qualifications[]`. */
  exclusions: readonly string[];
  siteSummary: readonly { name: string; detail: string }[];
}

export interface RenderedSection {
  type: SectionType;
  key: string;
  title: string;
  /** Merged markdown for text sections; empty for system sections. */
  body: string;
  /** Structured payload for system sections; null for text. */
  data: unknown;
}

export interface RenderedDocument {
  templateId: string | null;
  templateName: string;
  sections: RenderedSection[];
  /** Everything the renderer could not resolve — shown, never swallowed. */
  warnings: string[];
  /** Stamped so a reader can tell which snapshot they are looking at. */
  renderedAt: string;
}

/**
 * Build the document snapshot. The result is what gets written to
 * `document_json` on first render and read forever after — so it must contain
 * everything needed to reproduce the page, and must not contain a reference to
 * anything that can later change.
 */
export function renderDocument(input: RenderInput, renderedAt: string): RenderedDocument {
  const warnings: string[] = [];
  const sections: RenderedSection[] = [];

  const committed = input.lines.filter((l) => !l.isOptional);
  const optional = input.lines.filter((l) => l.isOptional);

  for (const section of input.template.sections) {
    if (section.type === "text") {
      const merged = mergeTokens(section.body ?? "", input.tokens);
      for (const token of merged.unknown) {
        warnings.push(`section "${section.title}" uses {{${token}}}, which is not a token`);
      }
      for (const token of merged.missing) {
        warnings.push(`section "${section.title}" wants {{${token}}}, which this proposal has no value for`);
      }
      sections.push({ type: "text", key: section.key, title: section.title, body: merged.text, data: null });
      continue;
    }

    switch (section.key) {
      case "pricing_table":
        sections.push({
          type: "system",
          key: section.key,
          title: section.title,
          body: "",
          data: { lines: committed },
        });
        if (!committed.length) warnings.push("the pricing table has no lines");
        break;

      case "optional_services":
        // A separate block AFTER the pricing table, with its own subtotal,
        // clearly outside the total. The upsell is shown, never added.
        sections.push({
          type: "system",
          key: section.key,
          title: section.title,
          body: "",
          data: { lines: optional },
        });
        break;

      case "exclusions":
        sections.push({
          type: "system",
          key: section.key,
          title: section.title,
          body: "",
          data: { items: input.exclusions },
        });
        break;

      case "site_summary":
        sections.push({
          type: "system",
          key: section.key,
          title: section.title,
          body: "",
          data: { items: input.siteSummary },
        });
        break;

      case "acceptance":
        sections.push({
          type: "system",
          key: section.key,
          title: section.title,
          body: "",
          // Acceptance is recorded in-app: there is no public unauthenticated
          // page on this platform, so this block is a printed signature panel,
          // not a link. Saying so is more honest than shipping a dead URL.
          data: { mode: "in_app" },
        });
        break;

      default:
        warnings.push(`unknown system section "${section.key}" was skipped`);
    }
  }

  return {
    templateId: input.template.id ?? null,
    templateName: input.template.name,
    sections,
    warnings,
    renderedAt,
  };
}

// --- the seeded template ---------------------------------------------------------------

/**
 * P1 ships ONE template. "Add a template from this screen" is real, and it is a
 * later sentence. The prose here is deliberately plain: it is a starting point
 * an estimator edits, not finished marketing copy.
 */
export const DEFAULT_TEMPLATE: ProposalTemplate = {
  name: "Standard soft services proposal",
  sections: [
    {
      type: "text",
      key: "cover_letter",
      title: "Cover letter",
      body: [
        "Dear {{client_name}},",
        "",
        "Thank you for the opportunity to propose our services at {{site_name}}.",
        "This proposal follows our site walk and reflects what we observed there,",
        "rather than a generic scope.",
        "",
        "It is valid until {{valid_until}}.",
        "",
        "{{prepared_by}}",
      ].join("\n"),
    },
    {
      type: "system",
      key: "site_summary",
      title: "What we surveyed",
    },
    {
      type: "text",
      key: "what_we_will_do",
      title: "What we will do",
      body: [
        "The scope below is priced on a {{contract_type}} basis.",
        "Where a service recurs, the price shown is the {{recurring_period}} charge.",
      ].join("\n"),
    },
    {
      type: "system",
      key: "pricing_table",
      title: "Pricing",
    },
    {
      type: "system",
      key: "optional_services",
      title: "Optional services",
    },
    {
      type: "system",
      key: "exclusions",
      title: "Exclusions",
    },
    {
      type: "text",
      key: "terms",
      title: "Terms",
      body: [
        "Payment terms: {{payment_terms}}.",
        "",
        "Prices are held until {{valid_until}}. This proposal is {{proposal_number}} v{{revision_no}},",
        "issued {{proposal_date}}. Any earlier version is superseded.",
      ].join("\n"),
    },
    {
      type: "system",
      key: "acceptance",
      title: "Acceptance",
    },
  ],
};
