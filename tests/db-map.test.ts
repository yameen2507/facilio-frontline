/**
 * The row mapper, and specifically the `_obj` / `_arr` batching used to collapse
 * a multi-result-set read into one `query()` call.
 *
 * This is the one piece of shared/db.ts that runs without a database, and it is
 * the riskiest part of the batching change: if nested keys stop being camelised
 * or a nested `score` stays a string, the UI silently renders "—" and score
 * thresholds shift, with no error anywhere.
 */

import { describe, expect, it } from "vitest";
import { mapRow } from "../src/shared/row-map";

describe("mapRow — flat columns", () => {
  it("camelises snake_case and coerces known numerics", () => {
    expect(mapRow({ company_name: "Al Manzil", score: "88", estimated_value: "12000.00" })).toEqual({
      companyName: "Al Manzil",
      score: 88,
      estimatedValue: 12000,
    });
  });

  it("leaves a text column that merely looks numeric alone", () => {
    // A Facilio id is text and must survive as text.
    expect(mapRow({ facilio_asset_id: "42" })).toEqual({ facilioAssetId: "42" });
  });

  it("parses data_json into `data` and *_json into its stem", () => {
    expect(mapRow({ data_json: '{"a":1}', meta_json: '{"b":2}' })).toEqual({
      data: { a: 1 },
      meta: { b: 2 },
    });
  });

  it("strips a select alias prefix", () => {
    expect(mapRow({ "l.company_name": "X" })).toEqual({ companyName: "X" });
  });
});

describe("mapRow — batched _obj sub-results", () => {
  it("camelises keys nested inside the json blob", () => {
    const row = mapRow({
      lead_obj: '{"id":"a1","company_name":"Al Manzil","site_city":"Dubai","owner_email":null}',
    });
    expect(row.lead).toEqual({
      id: "a1",
      companyName: "Al Manzil",
      siteCity: "Dubai",
      ownerEmail: null,
    });
  });

  it("coerces a nested numeric whether it arrives as string or number", () => {
    // row_to_json emits `numeric` as a JSON number; the flat wire format sends a
    // string. Both must land as a number, because scoreBand and the UI's
    // `score >= 75` thresholds depend on it.
    const asNumber = mapRow({ lead_obj: '{"score":88,"estimated_value":12000.5}' }).lead as Record<
      string,
      unknown
    >;
    const asString = mapRow({ lead_obj: '{"score":"88","estimated_value":"12000.50"}' })
      .lead as Record<string, unknown>;

    expect(asNumber).toEqual({ score: 88, estimatedValue: 12000.5 });
    expect(asString).toEqual({ score: 88, estimatedValue: 12000.5 });
    expect(typeof asString.score).toBe("number");
  });

  it("parses a *_json column nested inside the blob", () => {
    // fl_lead_analysis stores understanding_json as text, so inside row_to_json
    // it arrives as a JSON *string* that still needs parsing.
    const row = mapRow({
      analysis_obj: '{"version":2,"understanding_json":"{\\"missingInfo\\":[\\"roof access\\"]}"}',
    });
    expect(row.analysis).toEqual({
      version: 2,
      understanding: { missingInfo: ["roof access"] },
    });
  });

  it("yields null when the subquery matched nothing", () => {
    expect(mapRow({ analysis_obj: null }).analysis).toBeNull();
  });

  it("accepts an already-parsed object, since the driver may parse json itself", () => {
    expect(mapRow({ lead_obj: { company_name: "X" } }).lead).toEqual({ companyName: "X" });
  });
});

describe("mapRow — batched _arr sub-results", () => {
  it("maps every element of the array", () => {
    const row = mapRow({
      assignments_arr: '[{"to_user":"a@b.c","from_user":null},{"to_user":"d@e.f","from_user":"a@b.c"}]',
    });
    expect(row.assignments).toEqual([
      { toUser: "a@b.c", fromUser: null },
      { toUser: "d@e.f", fromUser: "a@b.c" },
    ]);
  });

  it("yields [] rather than null for an empty aggregate", () => {
    expect(mapRow({ timeline_arr: "[]" }).timeline).toEqual([]);
    expect(mapRow({ timeline_arr: null }).timeline).toEqual([]);
  });

  it("parses meta_json inside each timeline entry", () => {
    const row = mapRow({
      timeline_arr: '[{"kind":"converted","meta_json":"{\\"dealRefNo\\":\\"DEAL-0006\\"}","occurred_at":"2026-08-13T09:11:39.041Z"}]',
    });
    expect(row.timeline).toEqual([
      { kind: "converted", meta: { dealRefNo: "DEAL-0006" }, occurredAt: "2026-08-13T09:11:39.041Z" },
    ]);
  });

  it("handles nesting more than one level deep", () => {
    const row = mapRow({ lead_arr: '[{"site_city":"Dubai","nested":{"deep_key":1}}]' });
    expect(row.lead).toEqual([{ siteCity: "Dubai", nested: { deepKey: 1 } }]);
  });
});
