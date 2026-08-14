/**
 * The surveys raised against this lead's deal — a deal takes as many surveys
 * as the job needs (re-walks, extra buildings), so this is a LIST with the
 * raise action always present, not a single slot.
 *
 * Presentational: the page owns the fetch, because the survey count also
 * feeds the tab label and the enquiry banner, and three consumers of one
 * request means the request lives above all three.
 */

import { ClipboardList } from "lucide-react";
import { Link } from "react-router-dom";
import { LinkButton } from "../../../ui/Button";
import { Chip, type Tone } from "../../../ui/Chip";
import { onDay } from "../../../lib/format";
import type { DealSurvey } from "../types/lead";

/**
 * This module's own copy of the survey status colouring (the vocabulary
 * belongs to the surveys module; features do not import each other's
 * internals). An unknown status renders neutral rather than breaking.
 */
const STATUS_TONE: Record<string, Tone> = {
  draft: "neutral",
  scheduled: "blue",
  assigned: "blue",
  in_progress: "orange",
  pending_review: "orange",
  completed: "green",
  cancelled: "red",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "draft",
  scheduled: "scheduled",
  assigned: "assigned",
  in_progress: "in progress",
  pending_review: "pending review",
  completed: "completed",
  cancelled: "cancelled",
};

export function SurveysPane({
  dealId,
  surveys,
  error,
}: {
  dealId: string;
  surveys: DealSurvey[] | null;
  error: string | null;
}) {
  if (error) {
    return <div className="py-2 text-sm text-red-600 dark:text-red-400">{error}</div>;
  }

  const raise = (
    <LinkButton small to={`/surveys?new=${dealId}`} glyph="plus">
      Raise survey
    </LinkButton>
  );

  if (!surveys) {
    return <div className="text-muted-foreground py-2 text-sm">Loading surveys…</div>;
  }

  if (!surveys.length) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <span className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-full">
          <ClipboardList className="size-4.5" aria-hidden="true" />
        </span>
        <div>
          <div className="text-sm font-medium">No surveys yet</div>
          <div className="text-muted-foreground mt-0.5 text-xs">
            A survey walks the site so the quote is built on what is actually there.
          </div>
        </div>
        {raise}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1 flex items-center">
        <span className="text-muted-foreground text-xs">
          {surveys.length} on this deal
        </span>
        <span className="flex-1" aria-hidden="true" />
        {raise}
      </div>
      <ul className="list-none">
        {surveys.map((s) => (
          <li key={s.id} className="flex gap-2.5 border-b border-dashed py-2.5 last:border-b-0 last:pb-0">
            <span className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full">
              <ClipboardList className="size-3.5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <Link
                  to={`/surveys/${s.id}`}
                  className="truncate text-sm font-medium underline-offset-4 hover:underline"
                >
                  {s.title || s.templateName || s.refNo}
                </Link>
                <span className="flex-1" aria-hidden="true" />
                <Chip tone={STATUS_TONE[s.status] ?? "neutral"} dot>
                  {STATUS_LABEL[s.status] ?? s.status}
                </Chip>
              </div>
              <div className="text-muted-foreground mt-0.5 text-xs">
                <span className="font-mono">{s.refNo}</span>
                {s.targetCompletionDate ? ` · target ${onDay(s.targetCompletionDate)}` : ""}
                {s.createdAt ? ` · raised ${onDay(s.createdAt)}` : ""}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
