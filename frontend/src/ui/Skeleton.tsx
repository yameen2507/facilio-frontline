/**
 * Shimmer placeholders, on shadcn's Skeleton.
 *
 * Two rules run through all of it, both taken from how shipped consoles do it:
 *
 * 1. **A skeleton reuses the real element's structure.** A fake row is built on
 *    the same ROW_GRID as a real one, a fake card is the real Card with bars
 *    inside — grid, padding and dividers are identical by construction, so
 *    nothing shifts when data lands.
 * 2. **Bars are sized in `em`**, so a bar takes the line box of whatever text
 *    it stands in for.
 *
 * `bg-border` rather than Skeleton's default `bg-accent`: at 0.72em tall a bar
 * needs the stronger step or it reads as blank space, not as loading.
 */

import type { CSSProperties } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { MSGS, MSG_AGENT } from "./bubbles";
import { Card, Split } from "./Card";
import { ROW_GRID } from "./Row";

const WIDTHS = ["62%", "47%", "71%", "54%", "66%", "43%", "58%", "75%"];
const META_WIDTHS = ["84%", "68%", "77%", "59%", "88%", "64%", "72%", "56%"];

const pick = (list: string[], i: number) => list[i % list.length];

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/** One bar. Height tracks the surrounding font unless told otherwise. */
export const Bar = ({ width = "100%", style }: { width?: string; style?: CSSProperties }) => (
  <Skeleton
    className="bg-border inline-block h-[0.72em] min-h-2 rounded-sm align-middle"
    style={{ width, ...style }}
  />
);

/** A pill-shaped bar, for where a chip will be. */
export const Pill = ({ width = "68px" }: { width?: string }) => (
  <Skeleton className="bg-border inline-block h-[18px] rounded-full align-middle" style={{ width }} />
);

/** Paragraph-ish stack of body-sized lines. */
export const TextLines = ({ count = 3 }: { count?: number }) => (
  <div className="flex flex-col gap-3 text-sm">
    {range(count).map((i) => (
      <Bar key={i} width={pick(WIDTHS, i)} />
    ))}
  </div>
);

const SkeletonCard = ({ headWidth = "108px", lines = 3 }: { headWidth?: string; lines?: number }) => (
  <Card title={<Bar width={headWidth} />}>
    <TextLines count={lines} />
  </Card>
);

/** A placeholder row on the real row grid, minus the hover affordance. */
const SkelRow = ({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: CSSProperties;
}) => (
  <div className={cn(ROW_GRID, "cursor-default")} style={style} aria-hidden="true">
    {children}
  </div>
);

/**
 * Inbox / account list rows. Mirrors the four-column row grid — main text
 * stack, status chip, score, trailing clock column.
 */
export const SkeletonRows = ({ count = 6 }: { count?: number }) => (
  <div aria-busy="true" aria-label="Loading rows">
    {range(count).map((i) => (
      <SkelRow key={i}>
        <div>
          <div className="text-sm font-medium">
            <Bar width={pick(WIDTHS, i)} />
          </div>
          <div className="mt-px text-xs">
            <Bar width={pick(META_WIDTHS, i)} />
          </div>
        </div>
        <div>
          <Pill width="72px" />
        </div>
        <div className="text-base">
          <Bar width="30px" />
          <small className="block text-[10px]">
            <Bar width="44px" />
          </small>
        </div>
        <div>
          <Pill width="60px" />
          <div className="mt-px text-xs">
            <Bar width="52px" />
          </div>
        </div>
      </SkelRow>
    ))}
  </div>
);

/**
 * Rows for a two-column list. The coverage list on Settings overrides the row
 * grid, so the four-column version above would land its bars in the wrong places
 * and slide them sideways as the real content arrived.
 */
export const SimpleRows = ({ count = 3 }: { count?: number }) => (
  <div aria-busy="true" aria-label="Loading rows">
    {range(count).map((i) => (
      <SkelRow key={i} style={{ gridTemplateColumns: "180px 1fr" }}>
        <div>
          <div className="text-sm font-medium">
            <Bar width="74%" />
          </div>
          <div className="mt-px text-xs">
            <Bar width="46%" />
          </div>
        </div>
        <div>
          <Pill width="96px" /> <Pill width={pick(["120px", "88px", "104px"], i)} />
        </div>
      </SkelRow>
    ))}
  </div>
);

/**
 * Lead detail: mirrors the page's fixed-rail split (LeadDetail.tsx) — a flat
 * 352px record panel on the left, the stage path and tabbed pane on the right.
 * Rendered inside a fillBody shell, so it carries the page's own insets.
 */
export const LeadDetailSkeleton = () => (
  <div className="flex min-h-0 flex-1" aria-busy="true" aria-label="Loading lead">
    {/* The rail — hidden below 1080px, where the real page stacks it and the
        main pane's bars stand in well enough for one load. */}
    <div className="hidden w-[400px] shrink-0 border-r min-[1080px]:block" aria-hidden="true">
      <div className="px-6 py-4">
        <Skeleton className="bg-border size-10 rounded-lg" />
        <div className="mt-3 text-base">
          <Bar width="55%" />
        </div>
        <div className="mt-2 text-xs">
          <Bar width="80%" />
        </div>
        <div className="mt-3 flex gap-2">
          <Skeleton className="bg-border h-8 w-[124px] rounded-md" />
          <Skeleton className="bg-border h-8 w-9 rounded-md" />
        </div>
      </div>
      <div className="border-t px-6 py-4">
        <Bar width="64px" style={{ height: "10px" }} />
        <div className="mt-3">
          <TextLines count={5} />
        </div>
      </div>
      <div className="border-t px-6 py-4">
        <Bar width="104px" style={{ height: "10px" }} />
        <div className="mt-3">
          <TextLines count={3} />
        </div>
      </div>
      <div className="border-t px-6 py-4">
        <Bar width="80px" style={{ height: "10px" }} />
        <div className="mt-3">
          <TextLines count={2} />
        </div>
      </div>
    </div>

    <div className="min-w-0 flex-1 px-4 pt-4 sm:px-6 sm:pt-6" aria-hidden="true">
      <div className="mb-5">
        <Card pad={false}>
          {/* Mirrors the stage path's geometry (LifecycleSteps.tsx) — same
              heights and insets, minus the chevron clipping, which a grey
              block doesn't need to sell. overflow-hidden where the real bar
              scrolls: placeholder blocks have nothing to scroll to. */}
          <div className="overflow-hidden p-3 sm:p-4">
            <div className="flex w-full gap-[3px]">
              {range(5).map((i) => (
                <Skeleton key={i} className="bg-border h-11 min-w-28 flex-1 rounded-sm" />
              ))}
            </div>
          </div>
          <div className="flex items-center justify-end gap-4 border-t px-4 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <Bar width="42%" />
            </div>
            {/* Button-height blocks, not Pills: the real footer's height is
                set by its size="sm" buttons (h-8), and an 18px stand-in would
                grow the card when data lands. */}
            <Skeleton className="bg-border h-8 w-[72px] rounded-md" />
            <Skeleton className="bg-border h-8 w-[88px] rounded-md" />
          </div>
        </Card>
      </div>

      <div className="mb-4 flex gap-2">
        <Skeleton className="bg-border h-7 w-[104px] rounded-md" />
        <Skeleton className="bg-border h-7 w-[76px] rounded-md" />
      </div>
      {/* Flat, like the real panes — no wrapper card under the pills. */}
      <TextLines count={8} />
    </div>
  </div>
);

/**
 * One company: mirrors the page's fixed-rail split (AccountDetail.tsx) — a
 * flat record panel on the left, the tabbed pane on the right. Rendered
 * inside a fillBody shell, so it carries the page's own insets.
 */
export const AccountDetailSkeleton = () => (
  <div className="flex min-h-0 flex-1" aria-busy="true" aria-label="Loading account">
    {/* The rail — hidden below 1080px, where the real page stacks it and the
        main pane's bars stand in well enough for one load. */}
    <div className="hidden w-[400px] shrink-0 border-r min-[1080px]:block" aria-hidden="true">
      <div className="px-6 py-4">
        <Skeleton className="bg-border size-10 rounded-lg" />
        <div className="mt-3 text-base">
          <Bar width="55%" />
        </div>
        <div className="mt-2 text-xs">
          <Bar width="72%" />
        </div>
      </div>
      <div className="border-t px-6 py-4">
        <Bar width="72px" style={{ height: "10px" }} />
        <div className="mt-3">
          <TextLines count={5} />
        </div>
      </div>
      <div className="border-t px-6 py-4">
        <Bar width="68px" style={{ height: "10px" }} />
        <div className="mt-3">
          <TextLines count={2} />
        </div>
      </div>
    </div>

    <div className="min-w-0 flex-1 px-4 pt-4 sm:px-6 sm:pt-6" aria-hidden="true">
      {/* The tab pills, then the row list they open on. */}
      <div className="mb-4 flex gap-2">
        <Skeleton className="bg-border h-7 w-[96px] rounded-md" />
        <Skeleton className="bg-border h-7 w-[72px] rounded-md" />
        <Skeleton className="bg-border h-7 w-[84px] rounded-md" />
      </div>
      <Card pad={false}>
        <SkeletonRows count={4} />
      </Card>
    </div>
  </div>
);

/**
 * One template, hydrating: mirrors the preview sheet (TemplateBuilder.tsx,
 * `TemplatePreview`) — the rehearsal chip row, then a centred max-w-2xl card
 * whose dividers separate the title page from the sections.
 *
 * It stands in for BOTH landings, because `status` is not known until the fetch
 * answers: a published template opens AS this sheet, a draft opens in the
 * editor split. The sheet is the closer of the two — the editor's canvas is the
 * same stack of title block and section cards, just narrower — and it replaced
 * a four-column SkeletonRows that matched neither.
 *
 * No page insets of its own: unlike the two detail skeletons above, this
 * renders inside an ordinary PageShell body, which already carries them.
 */
export const TemplatePreviewSkeleton = () => (
  <div
    className="mx-auto flex w-full max-w-2xl flex-col gap-4"
    aria-busy="true"
    aria-label="Loading template"
  >
    {/* The chip row sits ABOVE the sheet in the real page — dropped here, the
        sheet's top edge would start a chip's height too high and jump down. */}
    <div className="flex flex-wrap items-center gap-2.5" aria-hidden="true">
      {/* 22px, not `Pill` — a Chip is Badge's text-xs line box plus py-0.5 and
          its border, and this chip is the tallest thing on the row, so an 18px
          stand-in would start the sheet 4px high and drop it on arrival. */}
      <Skeleton className="bg-border h-[22px] w-[148px] rounded-full" />
      <span className="text-xs">
        <Bar width="228px" />
      </span>
    </div>

    <div className="bg-card divide-y overflow-hidden rounded-xl border" aria-hidden="true">
      {/* The title page: name, description, the section/question count. */}
      <div className="px-5 py-5 sm:px-6">
        <div className="text-lg font-semibold">
          <Bar width="56%" />
        </div>
        <div className="mt-1 text-sm">
          <Bar width="78%" />
        </div>
        <div className="mt-2 text-xs">
          <Bar width="132px" />
        </div>
      </div>

      {[3, 2].map((questions, i) => (
        <div key={i} className="flex flex-col gap-4 px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-center gap-2.5">
            <Skeleton className="bg-border size-6 shrink-0 rounded-md" />
            <span className="text-sm font-medium">
              <Bar width={pick(["144px", "112px"], i)} />
            </span>
          </div>
          {/* One question = its label over its field. The field is an h-9
              block, not a Bar: the real Input sets the row's height, and an
              0.72em stand-in would grow the sheet when answers render. */}
          <div className="flex flex-col gap-5">
            {range(questions).map((q) => (
              <div key={q} className="flex flex-col gap-2">
                {/* leading-none, because the real question label is a `Label`
                    and that component sets it — normal text-sm leading would
                    make every question six pixels tall in the wrong direction. */}
                <div className="text-sm leading-none font-medium">
                  <Bar width={pick(WIDTHS, i + q)} />
                </div>
                <Skeleton className="bg-border h-9 w-full rounded-md" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  </div>
);

/**
 * Settings. This surface previously showed nothing at all while it loaded — it
 * awaited the request and then rendered — so this is a new state, not a
 * replacement for a spinner.
 */
export const SettingsSkeleton = () => (
  <div aria-busy="true" aria-label="Loading settings">
    <div aria-hidden="true">
      <Split>
        <Card title={<Bar width="116px" />} pad={false}>
          <SimpleRows count={3} />
        </Card>
        <SkeletonCard lines={5} />
      </Split>
    </div>
    <div className="mt-5" aria-hidden="true">
      <SkeletonCard headWidth="132px" lines={6} />
    </div>
  </div>
);

/** A bubble shaped like the agent's, in placeholder grey on either side. */
const SkelBubble = ({ width, right = false }: { width: string; right?: boolean }) => (
  <div className={cn(MSG_AGENT, right && "self-end rounded-bl-xl rounded-br-sm")} aria-hidden="true">
    <Bar width={width} />
  </div>
);

/** Chat, before the greeting arrives: alternating bubble shapes. */
export const ChatSkeleton = () => (
  <div className={MSGS} aria-busy="true" aria-label="Starting conversation">
    <SkelBubble width="180px" />
    <SkelBubble width="120px" right />
    <SkelBubble width="210px" />
  </div>
);

/**
 * The website conversation on lead detail. It is a second request, so the tab
 * body holds this instead of collapsing and then lurching when the transcript
 * lands. Body-only — the detail page's tabbed card owns the chrome.
 */
export const TranscriptSkeleton = () => (
  <div aria-busy="true" aria-label="Loading conversation">
    <div className={cn(MSGS, "p-0")}>
      <SkelBubble width="150px" />
      <SkelBubble width="104px" right />
      <SkelBubble width="172px" />
    </div>
  </div>
);
