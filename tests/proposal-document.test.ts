import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEMPLATE,
  isSystemSectionKey,
  mergeTokens,
  renderDocument,
  SYSTEM_SECTION_KEYS,
  TOKENS,
  tokensUsed,
  type ProposalTemplate,
  type RenderInput,
  type RenderLine,
  type TokenValues,
} from "../src/domain/proposal-document";

const RENDERED_AT = "2026-08-14T09:00:00Z";

/** The character a missing token renders as — an em dash, not a hyphen. */
const EM_DASH = "—";

const VALUES: TokenValues = {
  client_name: "Acme Facilities",
  site_name: "Marina Tower",
  proposal_number: "PRO-0042",
  revision_no: "2",
  proposal_date: "14 Aug 2026",
  valid_until: "13 Sep 2026",
  prepared_by: "Mithun R",
  payment_terms: "30 days from invoice",
  contract_type: "fixed price",
  recurring_period: "monthly",
  one_time_total: "AED 20,000",
  recurring_total: "AED 10,000",
  currency: "AED",
  threshold_amount: "AED 5,000",
};

const renderLine = (over: Partial<RenderLine> = {}): RenderLine => ({
  description: "Daily cleaning",
  qty: 1,
  uom: "month",
  frequency: "monthly",
  appliedPrice: 10_000,
  lineTotal: 10_000,
  isOptional: false,
  ...over,
});

const input = (over: Partial<RenderInput> = {}): RenderInput => ({
  template: { id: "tpl-1", name: "Standard", sections: [] },
  tokens: VALUES,
  lines: [renderLine()],
  exclusions: [],
  siteSummary: [],
  ...over,
});

describe("mergeTokens — merged by a function, never by a model", () => {
  it("replaces a known token with its value", () => {
    const result = mergeTokens("Dear {{client_name}}, about {{site_name}}.", VALUES);
    expect(result.text).toBe("Dear Acme Facilities, about Marina Tower.");
    expect(result.unknown).toEqual([]);
    expect(result.missing).toEqual([]);
  });

  it("replaces every occurrence, not only the first", () => {
    const result = mergeTokens("{{valid_until}} … held until {{valid_until}}", VALUES);
    expect(result.text).toBe("13 Sep 2026 … held until 13 Sep 2026");
  });

  it("renders a known token with no value as an em dash, and reports it", () => {
    // The value is genuinely absent for this proposal — not a mistake in the
    // template — so the document reads cleanly and the gap is reported to the
    // person about to send it.
    const result = mergeTokens("Prepared by {{prepared_by}}.", { client_name: "Acme" });
    expect(result.text).toBe(`Prepared by ${EM_DASH}.`);
    expect(result.missing).toEqual(["prepared_by"]);
    expect(result.unknown).toEqual([]);
  });

  it("treats an empty string as no value at all", () => {
    const result = mergeTokens("{{site_name}}", { site_name: "" });
    expect(result.text).toBe(EM_DASH);
    expect(result.missing).toEqual(["site_name"]);
  });

  it("leaves an unknown token VISIBLE in the output, and reports it", () => {
    // A proof-reader will notice `{{clietn_name}}`. Nobody has ever noticed an
    // empty space where a name should have been.
    const result = mergeTokens("Dear {{clietn_name}},", VALUES);
    expect(result.text).toBe("Dear {{clietn_name}},");
    expect(result.unknown).toEqual(["clietn_name"]);
    expect(result.missing).toEqual([]);
  });

  it("keeps an unknown token exactly as it was written, spacing and all", () => {
    // What comes back is what the author typed, so they can find it by search.
    const result = mergeTokens("Dear {{ Clietn_Name }},", VALUES);
    expect(result.text).toBe("Dear {{ Clietn_Name }},");
    expect(result.unknown).toEqual(["Clietn_Name"]);
  });

  it("tolerates whitespace inside the braces", () => {
    expect(mergeTokens("{{ client_name }}", VALUES).text).toBe("Acme Facilities");
    expect(mergeTokens("{{client_name }}", VALUES).text).toBe("Acme Facilities");
    expect(mergeTokens("{{  site_name  }}", VALUES).text).toBe("Marina Tower");
  });

  it("matches a token whatever its case", () => {
    expect(mergeTokens("{{CLIENT_NAME}}", VALUES).text).toBe("Acme Facilities");
    expect(mergeTokens("{{ Client_Name }}", VALUES).text).toBe("Acme Facilities");
    expect(mergeTokens("{{Prepared_By}}", {}).missing).toEqual(["prepared_by"]);
  });

  it("reports each token once however often it appears", () => {
    const result = mergeTokens("{{nope}} {{nope}} {{currency}} {{currency}}", {});
    expect(result.unknown).toEqual(["nope"]);
    expect(result.missing).toEqual(["currency"]);
  });

  it("leaves body text with no tokens completely alone", () => {
    const body = "We will attend site weekly. Braces { like this } are not tokens.";
    const result = mergeTokens(body, VALUES);
    expect(result.text).toBe(body);
    expect(result.unknown).toEqual([]);
    expect(result.missing).toEqual([]);
  });

  it("survives an empty or absent body", () => {
    expect(mergeTokens("", VALUES).text).toBe("");
    expect(mergeTokens(undefined as unknown as string, VALUES).text).toBe("");
  });
});

describe("tokensUsed — the builder's 'available here' hint", () => {
  it("lists each token once, in the order it appears, lower-cased", () => {
    const used = tokensUsed("{{Site_Name}} then {{client_name}} then {{site_name}} again");
    expect(used).toEqual(["site_name", "client_name"]);
  });

  it("lists unknown tokens too, because that is how a typo becomes visible", () => {
    expect(tokensUsed("{{clietn_name}}")).toEqual(["clietn_name"]);
  });

  it("returns nothing for a body with no tokens", () => {
    expect(tokensUsed("Plain prose.")).toEqual([]);
    expect(tokensUsed("")).toEqual([]);
  });
});

describe("renderDocument — the snapshot that must reproduce", () => {
  const template: ProposalTemplate = {
    id: "tpl-1",
    name: "Standard soft services proposal",
    sections: [
      { type: "text", key: "cover_letter", title: "Cover letter", body: "Dear {{client_name}}," },
      { type: "system", key: "site_summary", title: "What we surveyed" },
      { type: "system", key: "pricing_table", title: "Pricing" },
      { type: "system", key: "optional_services", title: "Optional services" },
      { type: "system", key: "exclusions", title: "Exclusions" },
      { type: "text", key: "terms", title: "Terms", body: "Payment terms: {{payment_terms}}." },
      { type: "system", key: "acceptance", title: "Acceptance" },
    ],
  };

  const committed = renderLine({ description: "Daily cleaning" });
  const optional = renderLine({ description: "Deep clean", isOptional: true, lineTotal: 50_000 });

  const doc = renderDocument(
    input({
      template,
      lines: [committed, optional],
      exclusions: ["Consumables", "Out-of-hours call-outs"],
      siteSummary: [{ name: "Floors", detail: "42" }],
    }),
    RENDERED_AT
  );

  it("emits every section in template order", () => {
    expect(doc.sections.map((s) => s.key)).toEqual([
      "cover_letter",
      "site_summary",
      "pricing_table",
      "optional_services",
      "exclusions",
      "terms",
      "acceptance",
    ]);
  });

  it("stamps the template and the moment, so a reader knows which snapshot this is", () => {
    expect(doc.templateId).toBe("tpl-1");
    expect(doc.templateName).toBe("Standard soft services proposal");
    expect(doc.renderedAt).toBe(RENDERED_AT);
  });

  it("gives text sections a merged body and no data", () => {
    const cover = doc.sections[0];
    expect(cover.type).toBe("text");
    expect(cover.body).toBe("Dear Acme Facilities,");
    expect(cover.data).toBeNull();
  });

  it("gives system sections structured data and no body", () => {
    for (const section of doc.sections.filter((s) => s.type === "system")) {
      expect(section.body, section.key).toBe("");
      expect(section.data, section.key).not.toBeNull();
    }
    expect(doc.sections.find((s) => s.key === "exclusions")?.data).toEqual({
      items: ["Consumables", "Out-of-hours call-outs"],
    });
    expect(doc.sections.find((s) => s.key === "site_summary")?.data).toEqual({
      items: [{ name: "Floors", detail: "42" }],
    });
    // Acceptance is a printed signature panel, not a link: there is no public
    // unauthenticated page on this platform, and a dead URL would be a lie.
    expect(doc.sections.find((s) => s.key === "acceptance")?.data).toEqual({ mode: "in_app" });
  });

  it("puts committed lines in the pricing table and optional lines only in the optional block", () => {
    // The upsell is shown, never added. A line appearing in both is a line the
    // client could reasonably claim is inside the price.
    const pricing = doc.sections.find((s) => s.key === "pricing_table")?.data as { lines: RenderLine[] };
    const upsell = doc.sections.find((s) => s.key === "optional_services")?.data as { lines: RenderLine[] };

    expect(pricing.lines).toEqual([committed]);
    expect(upsell.lines).toEqual([optional]);
    expect(pricing.lines).not.toContain(optional);
    expect(upsell.lines).not.toContain(committed);
  });

  it("says nothing is wrong when nothing is", () => {
    expect(doc.warnings).toEqual([]);
  });
});

describe("renderDocument — what it refuses to swallow", () => {
  it("skips an unknown system section with a warning rather than crashing", () => {
    // A template row from a future build, or a typo'd key. Dropping the section
    // silently would remove a block from the client's document with no trace.
    const template: ProposalTemplate = {
      id: null,
      name: "Odd one",
      sections: [
        { type: "system", key: "pricing_table", title: "Pricing" },
        { type: "system", key: "signature_block", title: "Signature" },
        { type: "system", key: "acceptance", title: "Acceptance" },
      ],
    };

    const doc = renderDocument(input({ template }), RENDERED_AT);
    expect(doc.sections.map((s) => s.key)).toEqual(["pricing_table", "acceptance"]);
    expect(doc.sections).toHaveLength(template.sections.length - 1);
    expect(doc.warnings).toContain('unknown system section "signature_block" was skipped');
    expect(doc.templateId).toBeNull();
  });

  it("warns when a text section uses a token that is not a token", () => {
    const template: ProposalTemplate = {
      id: null,
      name: "Typo",
      sections: [{ type: "text", key: "cover_letter", title: "Cover letter", body: "Dear {{clietn_name}}," }],
    };
    const doc = renderDocument(input({ template }), RENDERED_AT);
    expect(doc.warnings).toContain('section "Cover letter" uses {{clietn_name}}, which is not a token');
    // …and the typo is still on the page for the proof-reader to see.
    expect(doc.sections[0].body).toBe("Dear {{clietn_name}},");
  });

  it("warns when a known token has no value for this proposal", () => {
    const template: ProposalTemplate = {
      id: null,
      name: "Gap",
      sections: [{ type: "text", key: "terms", title: "Terms", body: "Payment terms: {{payment_terms}}." }],
    };
    const doc = renderDocument(input({ template, tokens: {} }), RENDERED_AT);
    expect(doc.warnings).toContain(
      'section "Terms" wants {{payment_terms}}, which this proposal has no value for'
    );
    expect(doc.sections[0].body).toBe(`Payment terms: ${EM_DASH}.`);
  });

  it("warns about a proposal with nothing to charge for", () => {
    // Every line optional is a document with an empty price — worth saying out
    // loud before it reaches a client.
    const template: ProposalTemplate = {
      id: null,
      name: "Upsell only",
      sections: [
        { type: "system", key: "pricing_table", title: "Pricing" },
        { type: "system", key: "optional_services", title: "Optional services" },
      ],
    };
    const doc = renderDocument(
      input({ template, lines: [renderLine({ isOptional: true })] }),
      RENDERED_AT
    );
    expect(doc.warnings).toContain("the pricing table has no lines");
    expect((doc.sections[1].data as { lines: RenderLine[] }).lines).toHaveLength(1);
  });

  it("renders an empty template as an empty document rather than throwing", () => {
    const doc = renderDocument(input(), RENDERED_AT);
    expect(doc.sections).toEqual([]);
    expect(doc.warnings).toEqual([]);
  });
});

describe("DEFAULT_TEMPLATE — the one template P1 actually ships", () => {
  it("uses only tokens from the closed list", () => {
    // A typo'd token in the shipped template prints to every client until
    // somebody notices. Walk it rather than eyeballing it.
    const used = DEFAULT_TEMPLATE.sections
      .filter((s) => s.type === "text")
      .flatMap((s) => tokensUsed(s.body ?? ""));

    // Guard against the assertion passing because it found nothing to check.
    expect(used.length).toBeGreaterThan(0);
    for (const token of used) {
      expect(TOKENS as readonly string[], `{{${token}}}`).toContain(token);
    }
  });

  it("uses only system section keys this build knows how to render", () => {
    // Same class of failure by the other door: an unrecognised key drops a
    // whole block out of the client's document.
    const systemKeys = DEFAULT_TEMPLATE.sections.filter((s) => s.type === "system").map((s) => s.key);
    expect(systemKeys.length).toBeGreaterThan(0);
    for (const key of systemKeys) {
      expect(isSystemSectionKey(key), key).toBe(true);
    }
  });

  it("gives every text section a body and every system section none", () => {
    for (const section of DEFAULT_TEMPLATE.sections) {
      expect(section.title.length, section.key).toBeGreaterThan(0);
      if (section.type === "text") expect((section.body ?? "").length, section.key).toBeGreaterThan(0);
      else expect(section.body ?? "", section.key).toBe("");
    }
  });

  it("renders end to end with no warnings when every value is present", () => {
    const doc = renderDocument(
      input({
        template: DEFAULT_TEMPLATE,
        lines: [renderLine(), renderLine({ description: "Deep clean", isOptional: true })],
        exclusions: ["Consumables"],
        siteSummary: [{ name: "Floors", detail: "42" }],
      }),
      RENDERED_AT
    );
    expect(doc.warnings).toEqual([]);
    expect(doc.sections).toHaveLength(DEFAULT_TEMPLATE.sections.length);
    // Nothing left unmerged on a document about to go to a client.
    for (const section of doc.sections) expect(section.body).not.toContain("{{");
  });

  it("prints its own version and date, so nobody argues later about which one was signed", () => {
    const terms = DEFAULT_TEMPLATE.sections.find((s) => s.key === "terms");
    expect(tokensUsed(terms?.body ?? "")).toEqual(
      expect.arrayContaining(["proposal_number", "revision_no", "proposal_date"])
    );
  });
});

describe("the closed lists themselves", () => {
  it("recognises exactly the five system section keys", () => {
    expect(SYSTEM_SECTION_KEYS).toHaveLength(5);
    expect(SYSTEM_SECTION_KEYS.every(isSystemSectionKey)).toBe(true);
    expect(isSystemSectionKey("signature_block")).toBe(false);
    expect(isSystemSectionKey(null)).toBe(false);
  });

  it("keeps every token lower_snake_case, because the merge pattern only matches that", () => {
    for (const token of TOKENS) expect(token, token).toMatch(/^[a-z0-9_]+$/);
  });
});
