/**
 * Icons — lucide, behind the same name-keyed API the app already used.
 *
 * This replaced `<fc-icon>` from `@facilio/icons`, which fetched every glyph
 * from icons.facilio.com at render time: a wrong name 403'd and rendered
 * nothing silently, the CDN had no index to browse, and the set was missing
 * whole concepts (no sun/moon/monitor, no back-arrow), which forced hand-drawn
 * inline SVGs. lucide is the set shadcn components are sized around, ships in
 * the bundle (no CDN, no CSP question), and a wrong name here fails the
 * typecheck instead of the render.
 *
 * The string-keyed map stays — call sites say `glyph="refresh"` — so swapping
 * the icon set was one file, which is the reason the map existed.
 */

import {
  ArrowLeft,
  Building2,
  ChevronDown,
  Inbox,
  LogOut,
  MessageSquare,
  Monitor,
  Moon,
  PanelLeft,
  Phone,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Sun,
  type LucideIcon,
} from "lucide-react";

const GLYPHS = {
  inbox: Inbox,
  building: Building2,
  sliders: SlidersHorizontal,
  chat: MessageSquare,
  panelLeft: PanelLeft,
  logOut: LogOut,
  phone: Phone,
  plus: Plus,
  refresh: RefreshCw,
  sun: Sun,
  moon: Moon,
  monitor: Monitor,
  chevronDown: ChevronDown,
  arrowLeft: ArrowLeft,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof GLYPHS;

export function Icon({ name, size = 15 }: { name: IconName; size?: number }) {
  const Glyph = GLYPHS[name];
  return <Glyph size={size} className="shrink-0" aria-hidden="true" />;
}
