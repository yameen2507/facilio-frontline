/**
 * The widget's presentation config — published to the server, not saved per
 * browser. Both wrappers are LIVE; the old localStorage seam is closed.
 *
 * | handler      | args                          | returns          |
 * | ------------ | ----------------------------- | ---------------- |
 * | `widget-get` | —                             | `{ config }`     |
 * | `widget-put` | payload: partial WidgetConfig | `{ config }` saved |
 *
 * The put goes through the `payload` envelope, and that is not a style choice:
 * clearing a field means sending `""`, and a blank flat field is dropped
 * upstream as an unresolved connection-action template — the clear would
 * silently never happen.
 *
 * Everything in this shape ships to the visitor's browser (the intake agent
 * runs client-side, so even `guidance` travels with the page). No secrets.
 */

import { request, type Result } from "../../../lib/request";

export type WidgetConfig = {
  /** Shown in the widget header. */
  companyName: string;
  /** The line under the company name. */
  tagline: string;
  /** A small data-URL image; empty shows the company initial instead. */
  logo: string;
  /** One of the preset swatches; empty follows the console theme's primary. */
  accent: string;
  /** First agent message; empty falls back to the server's greeting. */
  greeting: string;
  /** Operator instructions the intake agent is handed on every turn. */
  guidance: string;
};

/** Mirrors the server's defaults so a skeleton and an error state can still
    render a widget-shaped preview before/without a successful read. */
export const WIDGET_DEFAULTS: WidgetConfig = {
  companyName: "Frontline",
  tagline: "Kitchen extract & ductwork cleaning",
  logo: "",
  accent: "",
  greeting: "",
  guidance: "",
};

/** The swatch row. Eight, all deep enough to carry white text — the accent
    fills the visitor bubble and the send button, which set text to white. */
export const ACCENT_PRESETS = [
  { name: "Blue", value: "#2563eb" },
  { name: "Indigo", value: "#4f46e5" },
  { name: "Purple", value: "#9333ea" },
  { name: "Rose", value: "#db2777" },
  { name: "Red", value: "#dc2626" },
  { name: "Orange", value: "#ea580c" },
  { name: "Green", value: "#16a34a" },
  { name: "Teal", value: "#0d9488" },
] as const;

export const getWidgetConfig = (): Promise<Result<{ config: WidgetConfig }>> =>
  request<{ config: WidgetConfig }>("widget-get");

export const putWidgetConfig = (config: WidgetConfig): Promise<Result<{ config: WidgetConfig }>> =>
  request<{ config: WidgetConfig }>("widget-put", { payload: JSON.stringify(config) });
