/**
 * The page shell: ONE bordered header band, and exactly ONE scroll region.
 * Every page (inbox, accounts, surveys, settings, detail views) renders
 * through this, so the header is designed here once.
 *
 *   ┌──────────────────────────────────────┐
 *   │ ‹ Title · subtext           actions  │  FIXED ─┐ one flat band,
 *   │ [tab][tab][tab]   ····· search/extra │  FIXED ─┘ one border under it
 *   ├──────────────────────────────────────┤
 *   │ ░░ body — the only thing that scrolls│
 *   └──────────────────────────────────────┘
 *
 * The shape is taken from how Linear, Stripe and Attio head their list pages
 * (checked against real screens on Mobbin, 2026-08): a SLIM title row — the
 * title alone names the page (no breadcrumb path spelling out the sidebar
 * section again), the subtext trails on the same line, actions sit right —
 * and ONE compact control row where pill tabs (ui/Tabs) sit left and
 * search/extras sit right. A SECOND-LEVEL page (a record under a list, a
 * builder under its gallery) leads with a back chevron instead: depth is a
 * control you use, not a path you read. Nothing stacks, and none of the
 * references decorate the band (flat bg, the border does the separating).
 *
 * Scrolling goes through OverlayScrollbar so the bar floats over the content
 * and the body width doesn't jump when a short page becomes a long one.
 */

import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { NAV_TOP } from "../../layout/sidebar/nav-config";
import OverlayScrollbar from "../../ui/OverlayScrollbar";

/**
 * The list this page sits UNDER, read off the same nav data the sidebar is
 * built from — so a record page carries its way back without every call site
 * restating it, and a route rename moves both at once. Answered only when the
 * path is DEEPER than the matched nav item ("/leads/123" under "/leads"):
 * a top-level page has the sidebar for navigation and needs no back control.
 */
function backOf(path: string): { label: string; to: string } | undefined {
  let best: { label: string; to: string } | undefined;
  for (const entry of NAV_TOP) {
    if (entry.type === "section" || entry.hidden) continue;
    if (!path.startsWith(entry.to)) continue;
    // Longest prefix wins, so "/surveys/new" never answers with a shorter
    // sibling route that happens to prefix it.
    if (!best || entry.to.length > best.to.length) {
      best = { label: entry.label, to: entry.to };
    }
  }
  // Settings never matches — it is pinned to the sidebar footer, not a lane —
  // and a path that IS its list ("/leads") has nowhere shallower to go.
  return best && best.to !== path ? best : undefined;
}

/**
 * The seat the search field sits in, on BOTH of its perches (the title row when
 * a page has no tabs, the control row when it does): how wide, and how tall.
 *
 * Owned here rather than at each call site for the same reason its position is:
 * three pages each writing their own is three chances to drift, and the shell
 * is what knows how much room the band has. Pages pass `w-full` and fill
 * whatever this grants. Full width on phones, where it takes its own line.
 *
 * The height is here because it DID drift — all three pages had shrunk the
 * field to `h-8`, four pixels under the row it sits in, so it floated short of
 * its own seat with 16px placeholder text crammed inside it. On a phone, where
 * the field gets a full line to itself, that read as a squashed box. `h-9` is
 * both the Input's own default and exactly ROW_HEIGHT, so the field now fills
 * its row rather than rattling around in it.
 *
 * The descendant selector outranks a class on the input itself, so this is the
 * last word on the matter and a call site can't quietly go back to h-8.
 */
const SEARCH_SEAT = "sm:w-80 lg:w-96 [&_input]:h-9";

/**
 * The height every header row reserves, whatever is (or isn't) sitting in it.
 *
 * The band used to measure itself from its contents, so the same header came
 * out a different height on every page: Leads carries two `size="sm"` buttons
 * (h-8, 32px), Accounts carries a search field (h-9, 36px), and a page with
 * neither collapsed to its text. Four pixels is small enough to look like a
 * rendering glitch and large enough to see the title jump when you move
 * between two lists.
 *
 * 36px because that is the TALLEST control the row can hold — the h-9 input and
 * the h-9 default Button. A shorter floor would put us back to measuring the
 * contents on any page that uses one. `min-h`, not `h`: a phone still wraps
 * actions or search onto a second line and the row has to grow for them.
 *
 * Both rows take it, so a tab strip and a search row are the same height too,
 * and it is one number rather than one per breakpoint — a header that changes
 * height at 640px is the same jump, just triggered by a resize instead of a
 * click.
 *
 * IT GOES ON A LINE, NEVER ON A BOX THAT WRAPS. `min-height` on a wrapping flex
 * container floors the whole stack of lines together, which leaves each
 * individual line free to collapse to its own contents — exactly the drift this
 * is here to stop. On the phone that showed up as the title sitting 8px higher
 * on Accounts (search wraps to line two, so line one is bare text) than on
 * Leads (two buttons hold line one open).
 *
 * With it on the lines, every list page's band comes out at 104px: 24 of
 * padding plus two 36px rows and the 8px between them, whether those rows are
 * title-then-tabs or title-then-search.
 */
const ROW_HEIGHT = "min-h-9";

export function PageShell({
  title,
  subtitle,
  count,
  actions,
  strip,
  search,
  fillBody = false,
  back: backOverride,
  onBack,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  /** The list's record count, shown beside the title ON PHONES ONLY — its
      desktop seat is the CountLine under the table, which is `sm:`-up now that
      the phone list bleeds full-width and has no footer to carry it. Leave it
      unset until the count is REAL: a zero during loading claims an empty
      list before anything has been fetched. */
  count?: number;
  actions?: ReactNode;
  /** Tabs or a filter bar — the LEFT side of the control row. */
  strip?: ReactNode;
  /** The search field. A named slot rather than part of `strip` so search is
      ALWAYS on the control row's right, on every page — its position is a
      shell decision, not something each page re-derives. */
  search?: ReactNode;
  /** Hands the body a definite height and NO scroller or padding — for a page
      that panels itself into independently scrolling columns (a fixed record
      rail beside a scrolling pane). The page then owns its own insets. */
  fillBody?: boolean;
  /** Overrides where the chevron points, for a page whose parent is a RECORD
      rather than a lane — the walk sits under its survey, not under the survey
      list, and `backOf` can only ever answer with a nav entry. Carries the
      label too, so the tooltip and aria-label name the real destination
      instead of a lane the chevron no longer goes to. */
  back?: { label: string; to: string };
  /** Intercepts the back chevron — for a page holding unsaved work that must
      ask before it lets go. The destination still comes from the nav data;
      the callee decides when to actually navigate there. */
  onBack?: () => void;
  children: ReactNode;
}) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const back = backOverride ?? backOf(pathname);

  /**
   * Whether there is somewhere IN THIS APP to go back to.
   *
   * React Router stamps an index into history state on every in-app navigation,
   * so a non-zero one means the user arrived here by clicking rather than by
   * pasting a link or opening a new tab. Without the check, "back" on a
   * deep-linked page would walk out of the app entirely.
   */
  const hasHistory =
    typeof window !== "undefined" &&
    typeof (window.history.state as { idx?: number } | null)?.idx === "number" &&
    ((window.history.state as { idx: number }).idx ?? 0) > 0;

  /**
   * Back means BACK — the page you came from, not the lane this one files
   * under. Arriving at a proposal from its deal and landing on the proposal
   * list is the app forgetting how you got here.
   *
   * The lane stays as the fallback, and stays as the link's href: with no
   * in-app history it is the only honest answer, and keeping it in `to` means
   * middle-click and "open in new tab" still work on a control that is
   * otherwise a real link.
   */
  const goBack = (e: ReactMouseEvent<HTMLAnchorElement>) => {
    // A modified click is the user asking for a new tab or window; taking it
    // over would break the one thing keeping this a link.
    if (!hasHistory || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(-1);
  };
  // With no tabs there is no control row to anchor: search joins the actions
  // on the title row's right instead of sitting alone on a second line.
  const searchInTitleRow = Boolean(search && !strip);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* px steps down on phones — six units of gutter is a tenth of the screen. */}
      {/* py-3, and the rows inside add NO outer padding of their own: the band
          breathes equally above the title and below whatever ends it — a title
          row alone, or the control row under it. */}
      <div className="shrink-0 border-b px-4 py-3 sm:px-6">
        {/* The title row. ROW_HEIGHT rides on the TITLE CLUSTER below, not on
            this wrapper: this box wraps, and a min-height on a wrapping flex
            container is a floor on the whole stack of lines, not on each one.
            So the first line still measured itself from its contents, and the
            title sat 8px higher on a page whose search dropped to a second line
            (Accounts) than on one whose buttons held the first line open
            (Leads) — the drift that was visible flipping between the two. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* flex-1, so this cluster IS the first line's height on every page —
              with actions beside it, with a wrapped search under it, or alone. */}
          <div className={`flex ${ROW_HEIGHT} min-w-0 flex-1 items-center gap-x-1.5`}>
            {/* No sidebar summons here any more: below `md` the navigation is
                the bottom tab bar, which is always on screen and needs no
                trigger. The back chevron below is the only thing left that can
                claim this gutter. */}
            {back && onBack ? (
              <button
                type="button"
                onClick={onBack}
                aria-label={`Back to ${back.label}`}
                title={`Back to ${back.label}`}
                className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors md:-ml-1.5"
              >
                <ChevronLeft className="size-4" />
              </button>
            ) : back ? (
              <Link
                to={back.to}
                onClick={goBack}
                aria-label={hasHistory ? "Back" : `Back to ${back.label}`}
                title={hasHistory ? "Back" : `Back to ${back.label}`}
                className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-7 shrink-0 items-center justify-center rounded-md transition-colors md:-ml-1.5"
              >
                <ChevronLeft className="size-4" />
              </Link>
            ) : null}
            {/* Baseline between title and subtext, centred against the chevron. */}
            <div className="flex min-w-0 items-baseline gap-x-2">
              <h1 className="truncate text-base leading-tight font-semibold tracking-tight">{title}</h1>
              {/* The phone seat of the record count (see the `count` prop).
                  A bare muted number, the same treatment the tab pills give
                  theirs — "Accounts 24" reads as a count, a repeated noun
                  ("24 accounts") reads as a second title. */}
              {count !== undefined ? (
                <span className="text-muted-foreground text-sm tabular-nums sm:hidden">{count}</span>
              ) : null}
              {subtitle ? (
                <p className="text-muted-foreground min-w-0 truncate text-sm max-sm:hidden">
                  <span aria-hidden="true" className="mr-2 opacity-40">·</span>
                  {subtitle}
                </p>
              ) : null}
            </div>
          </div>
          {/* A direct row item, not part of the actions cluster: on a phone it
              takes order-last + w-full, so the wrap drops it onto its own
              FULL-WIDTH line under the title — squeezed beside the title it was
              a sliver. On sm+ it sits on the right as before. */}
          {searchInTitleRow ? (
            <div className={`min-w-0 max-sm:order-last max-sm:w-full ${SEARCH_SEAT}`}>{search}</div>
          ) : null}
          {/* flex-wrap, not shrink-0: a detail page carries five actions, and on
              a phone they wrap under the title instead of forcing a scroll. */}
          {actions ? (
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
              {actions}
            </div>
          ) : null}
        </div>

        {/* The control row: pill tabs left, search pinned right, one compact
            line that wraps on phones — tabs above, search below at full width.
            Rendered only when there ARE tabs; a tab-less page's search lives
            in the title row above.

            The gap above it is `mt`, not `pt`. `min-height` is measured
            border-box, so a top PADDING would be spent out of ROW_HEIGHT rather
            than added to it, and the strip would come out 10px SHORTER than the
            title row instead of matching it. A margin sits outside the box and
            leaves the floor intact.

            mt-2, matching the title row's own gap-y-2: this row and a search
            wrapped under the title are the same second row of the same band, so
            a page with tabs and a page with search land on the same height. */}
        {strip ? (
          <div className={`flex ${ROW_HEIGHT} mt-2 min-w-0 flex-wrap items-center gap-x-6 gap-y-2`}>
            <div className="min-w-0 flex-1">{strip}</div>
            {search ? <div className={`ml-auto w-full ${SEARCH_SEAT}`}>{search}</div> : null}
          </div>
        ) : null}
      </div>

      {fillBody ? (
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      ) : (
        <OverlayScrollbar style={{ flex: 1 }}>
        {/* ONE inset on all four sides — the body is a box, so the gap under the
            band's border reads the same as the gap to the sidebar beside it. The
            band's own py-3 sits ABOVE that border and belongs to the header; it
            is not part of this box and does not get subtracted from the top.

            Every side is written out rather than using the `p-*` shorthand: the
            bottom has to add the iPhone home indicator when installed, so the
            last row scrolls clear of it instead of ending underneath, and a
            shorthand plus an override is one stylesheet-ordering change away
            from silently losing that.

            --safe-bottom, not env() directly, because on a phone the tab bar
            sits BELOW this scroller and already carries the indicator inset;
            the variable is that inset only when nothing below is holding it.
            See globals.css. */}
        <div className="min-w-0 px-4 pt-4 pb-[calc(--spacing(4)+var(--safe-bottom))] sm:px-6 sm:pt-6 sm:pb-[calc(--spacing(6)+var(--safe-bottom))]">
          {children}
        </div>
        </OverlayScrollbar>
      )}
    </div>
  );
}
