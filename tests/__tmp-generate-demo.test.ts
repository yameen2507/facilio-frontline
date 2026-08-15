import { it } from "vitest";
import { draftLinesFromHandoff } from "../src/domain/pricing";

it("demo", () => {
  const payload = {
    survey: { contract_intent: "recurring", not_visited_pct: 12 },
    portfolio: [
      { node_id: "n1", type: "space", name: "Main kitchen",
        observation: { condition_score: 5, condition_scale_direction: "1_is_worst" } },
      { node_id: "n2", type: "space", name: "Prep room",
        observation: { condition_score: 2, condition_scale_direction: "1_is_worst" } },
    ],
    estimation_values: [
      { estimation_key: "canopy_count",  value: "6",   scope_node_id: "n1" },
      { estimation_key: "canopy_count",  value: "2",   scope_node_id: "n2" },
      { estimation_key: "duct_length_m", value: "180", scope_node_id: "n1" },
      { estimation_key: "grease_trap",   value: "1",   scope_node_id: "n1" },
      { estimation_key: "canopy_count",  value: "",    scope_node_id: null  },
      { estimation_key: "duct_length_m", value: "~4,500 approx", scope_node_id: null },
    ],
    recommendations: [{ title: "Replace damaged filters", urgency: "high" }],
  };

  const card = [
    { estimationKey: "canopy_count", description: "Canopy deep clean", serviceCode: "KEC",
      uom: "each", price: 45000, minCharge: null, defaultFrequency: "quarterly" as const,
      conditionMultipliers: { "1": 1, "2": 1.1, "3": 1.25, "4": 1.5, "5": 1.8 },
      conditionScaleDirection: "1_is_worst" as const },
    { estimationKey: "duct_length_m", description: "Ductwork cleaning", serviceCode: "DUCT",
      uom: "metre", price: 3500, minCharge: 150000, defaultFrequency: "quarterly" as const },
  ];

  const r = draftLinesFromHandoff(payload as never, card as never);

  console.log("\n=== LINES DRAFTED ===");
  for (const l of r.lines) {
    console.log(
      `  ${l.description}\n` +
      `     service ${l.serviceCode}  qty ${l.qty} ${l.uom}  freq ${l.frequency}` +
      `  card ${(l.cardPrice! / 100).toFixed(2)}` +
      `  score ${l.conditionScore ?? "-"} x${l.conditionMultiplier}` +
      `  per-visit ${l.perOccurrence != null ? (l.perOccurrence / 100).toFixed(2) : "-"}` +
      `  monthly ${l.monthlyEquivalent != null ? (l.monthlyEquivalent / 100).toFixed(2) : "-"}` +
      `${l.isOptional ? "  [OPTIONAL]" : ""}`
    );
  }
  console.log("\n=== NOT PRICED ===");
  for (const u of r.unpriced) console.log(`  ${u.label ?? u.estimationKey}: ${u.reason}`);
  console.log("\n=== WARNINGS ===");
  for (const w of r.warnings) console.log(`  ${w}`);
  console.log();
});
