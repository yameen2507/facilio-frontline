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
import { Card, Split, Stack } from "./Card";
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

/** Lead detail: action bar, lifecycle card, then the two-column split. */
export const LeadDetailSkeleton = () => (
  <div aria-busy="true" aria-label="Loading lead">
    <div className="mb-5 flex flex-wrap items-center gap-2" aria-hidden="true">
      <Pill width="84px" />
      <Pill width="96px" />
      <Pill width="76px" />
    </div>

    <div className="mb-5" aria-hidden="true">
      <Card>
        {/* Mirrors the lifecycle stepper's geometry (LifecycleSteps.tsx). */}
        <div className="flex flex-wrap gap-2">
          {range(5).map((i) => (
            <div className="flex min-w-32 flex-1 items-center gap-2.5" key={i}>
              <Skeleton className="bg-border size-[11px] shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 text-xs">
                <Bar width="62px" />
                <div>
                  <Bar width="48px" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>

    <div aria-hidden="true">
      <Split>
        <Stack>
          <SkeletonCard lines={4} />
          <SkeletonCard lines={5} />
        </Stack>
        <Stack>
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
          <SkeletonCard lines={2} />
        </Stack>
      </Split>
    </div>
  </div>
);

/** One company: the same split, weighted the way the real page is. */
export const AccountDetailSkeleton = () => (
  <div aria-busy="true" aria-label="Loading account">
    <div className="mb-5 flex flex-wrap items-center gap-2" aria-hidden="true">
      <Pill width="104px" />
    </div>
    <div aria-hidden="true">
      <Split>
        <Stack>
          <Card title={<Bar width="92px" />} pad={false}>
            <SkeletonRows count={3} />
          </Card>
          <SkeletonCard lines={3} />
        </Stack>
        <Stack>
          <SkeletonCard lines={4} />
          <SkeletonCard lines={2} />
        </Stack>
      </Split>
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
 * The website-conversation card on lead detail. It is a second request, so the
 * slot holds this instead of collapsing and then shoving the column down when the
 * transcript lands.
 */
export const TranscriptSkeleton = () => (
  <Card>
    <div aria-busy="true" aria-label="Loading conversation">
      <div className={cn(MSGS, "p-0")}>
        <SkelBubble width="150px" />
        <SkelBubble width="104px" right />
        <SkelBubble width="172px" />
      </div>
    </div>
  </Card>
);
