/**
 * Shimmer placeholders.
 *
 * Two rules run through all of it, both taken from how shipped consoles do it:
 *
 * 1. **A skeleton reuses the real element's classes.** A fake row is a real
 *    `.lead-row` with bars inside, not a stack of grey boxes that approximate
 *    one. Grid, padding and dividers are then identical by construction, so
 *    nothing shifts when data lands. Bars are sized in `em` and inherit the font
 *    of the element they stand in, which is what makes the line boxes — and so
 *    the row height — match too.
 *
 * 2. **Only the data shimmers.** Chrome that is already known — the title, the
 *    sidebar, the tab strip — renders for real. Skeletonising what you already
 *    have makes a fast load look broken.
 *
 * Widths come from a fixed cycle, never `Math.random()`: a re-render mid-load
 * must not reshuffle the bars, and varied widths are what stop a block of rows
 * reading as a loading *pattern* rather than as content.
 */

import type { CSSProperties } from "react";
import { Card } from "./Card";

const WIDTHS = ["62%", "47%", "71%", "54%", "66%", "43%", "58%", "75%"];
const META_WIDTHS = ["84%", "68%", "77%", "59%", "88%", "64%", "72%", "56%"];

const pick = (list: string[], i: number) => list[i % list.length];

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/** One bar. Height tracks the surrounding font unless told otherwise. */
export const Bar = ({ width = "100%", style }: { width?: string; style?: CSSProperties }) => (
  <span className="shim" style={{ width, ...style }} />
);

/** A pill-shaped bar, for where a chip will be. */
export const Pill = ({ width = "68px" }: { width?: string }) => (
  <span className="shim shim-pill" style={{ width }} />
);

/** Paragraph-ish stack of body-sized lines. */
export const TextLines = ({ count = 3 }: { count?: number }) => (
  <div className="skel-lines">
    {range(count).map((i) => (
      <Bar key={i} width={pick(WIDTHS, i)} />
    ))}
  </div>
);

const SkeletonCard = ({ headWidth = "108px", lines = 3 }: { headWidth?: string; lines?: number }) => (
  <div className="card">
    <header>
      <h3>
        <Bar width={headWidth} />
      </h3>
    </header>
    <div className="in">
      <TextLines count={lines} />
    </div>
  </div>
);

/**
 * Inbox / account list rows. Mirrors the four-column `.lead-row` grid — main text
 * stack, status chip, score, trailing clock column.
 */
export const SkeletonRows = ({ count = 6 }: { count?: number }) => (
  <div aria-busy="true" aria-label="Loading rows">
    {range(count).map((i) => (
      <div className="lead-row skel" key={i} aria-hidden="true">
        <div>
          <div className="co">
            <Bar width={pick(WIDTHS, i)} />
          </div>
          <div className="meta">
            <Bar width={pick(META_WIDTHS, i)} />
          </div>
        </div>
        <div>
          <Pill width="72px" />
        </div>
        <div className="score">
          <Bar width="30px" />
          <small>
            <Bar width="44px" />
          </small>
        </div>
        <div>
          <Pill width="60px" />
          <div className="meta">
            <Bar width="52px" />
          </div>
        </div>
      </div>
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
      <div
        className="lead-row skel"
        style={{ gridTemplateColumns: "180px 1fr" }}
        key={i}
        aria-hidden="true"
      >
        <div>
          <div className="co">
            <Bar width="74%" />
          </div>
          <div className="meta">
            <Bar width="46%" />
          </div>
        </div>
        <div>
          <Pill width="96px" /> <Pill width={pick(["120px", "88px", "104px"], i)} />
        </div>
      </div>
    ))}
  </div>
);

/** Lead detail: action bar, lifecycle card, then the two-column split. */
export const LeadDetailSkeleton = () => (
  <div aria-busy="true" aria-label="Loading lead">
    <div className="bar" style={{ marginBottom: "var(--spacing-container-large)" }} aria-hidden="true">
      <Pill width="84px" />
      <Pill width="96px" />
      <Pill width="76px" />
    </div>

    <div className="card" style={{ marginBottom: "var(--spacing-container-large)" }} aria-hidden="true">
      <div className="in">
        <div className="steps">
          {range(5).map((i) => (
            <div className="step" key={i}>
              <i />
              <div>
                <Bar width="62px" />
                <span>
                  <Bar width="48px" />
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>

    <div className="split" aria-hidden="true">
      <div className="stack">
        <SkeletonCard lines={4} />
        <SkeletonCard lines={5} />
      </div>
      <div className="stack">
        <SkeletonCard lines={3} />
        <SkeletonCard lines={3} />
        <SkeletonCard lines={2} />
      </div>
    </div>
  </div>
);

/** One company: the same split, weighted the way the real page is. */
export const AccountDetailSkeleton = () => (
  <div aria-busy="true" aria-label="Loading account">
    <div className="bar" style={{ marginBottom: "var(--spacing-container-large)" }} aria-hidden="true">
      <Pill width="104px" />
    </div>
    <div className="split" aria-hidden="true">
      <div className="stack">
        <div className="card">
          <header>
            <h3>
              <Bar width="92px" />
            </h3>
          </header>
          <SkeletonRows count={3} />
        </div>
        <SkeletonCard lines={3} />
      </div>
      <div className="stack">
        <SkeletonCard lines={4} />
        <SkeletonCard lines={2} />
      </div>
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
    <div className="split" aria-hidden="true">
      <div className="card">
        <header>
          <h3>
            <Bar width="116px" />
          </h3>
        </header>
        <SimpleRows count={3} />
      </div>
      <SkeletonCard lines={5} />
    </div>
    <div style={{ marginTop: "var(--spacing-container-large)" }} aria-hidden="true">
      <SkeletonCard headWidth="132px" lines={6} />
    </div>
  </div>
);

/** Chat, before the greeting arrives: alternating bubble shapes. */
export const ChatSkeleton = () => (
  <div className="msgs skel-msgs" aria-busy="true" aria-label="Starting conversation">
    <div className="msg a" aria-hidden="true">
      <Bar width="180px" />
    </div>
    <div className="msg v" aria-hidden="true">
      <Bar width="120px" />
    </div>
    <div className="msg a" aria-hidden="true">
      <Bar width="210px" />
    </div>
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
      <div className="msgs skel-msgs" style={{ padding: 0, gap: "var(--spacing-container-medium)" }}>
        <div className="msg a" aria-hidden="true">
          <Bar width="150px" />
        </div>
        <div className="msg v" aria-hidden="true">
          <Bar width="104px" />
        </div>
        <div className="msg a" aria-hidden="true">
          <Bar width="172px" />
        </div>
      </div>
    </div>
  </Card>
);
