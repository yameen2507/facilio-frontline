/**
 * The form renderer — ONE implementation, used by both the builder's preview and
 * the surveyor's capture screen.
 *
 * That sharing is the point, not a convenience: a preview drawn by different
 * code is evidence of nothing. If the Admin previews a template and the surveyor
 * then sees a different form, the preview was worse than having none.
 *
 * The survey module imports this from the templates module deliberately. Modules
 * normally keep their own copy of a sibling's helper so they stay deletable, but
 * a *second* renderer would be the exact failure this file exists to prevent.
 */

import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Paperclip, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Question } from "../types/template";

/** One question's answer. An array only when `allowMultiple` is on. */
export type AnswerValue = string | string[];
export type Answers = Record<string, AnswerValue>;

export const isOn = (flag?: string | null): boolean => flag === "true";

/**
 * The 1–5 condition scale, ALWAYS rendered with its word.
 *
 * A bare number is the single most dangerous thing this UI could show. The FM
 * convention reads 5 as excellent; the cleaning-buildup convention reads 5 as
 * filthy. Both live in this product, C11 prices off this number, and a
 * mispriced semi-comprehensive contract is real money.
 *
 * These labels mirror `survey.condition_scale_labels` as seeded in
 * `functions/migrate/index.ts`. They are config, not captured data. When the
 * settings read path lands they must come from there instead — the direction
 * itself (decision D-e) is still awaiting a call.
 */
export const CONDITION_LABELS: Record<number, string> = {
  1: "Critical",
  2: "Poor",
  3: "Fair",
  4: "Good",
  5: "Excellent",
};

export function ConditionScale({
  value,
  onChange,
  disabled,
}: {
  value: number | null;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {[1, 2, 3, 4, 5].map((n) => {
        const active = value === n;
        return (
          <button
            key={n}
            type="button"
            disabled={disabled}
            onClick={() => onChange(n)}
            aria-pressed={active}
            className={cn(
              "flex min-w-20 flex-col items-center gap-0.5 rounded-md border px-3 py-2 transition-colors",
              "disabled:cursor-not-allowed disabled:opacity-50",
              active ? "border-primary bg-primary/10" : "hover:bg-accent"
            )}
          >
            <span className="text-base font-semibold tabular-nums">{n}</span>
            {/* Never the number alone — see the block comment above. */}
            <span className="text-muted-foreground text-[11px]">{CONDITION_LABELS[n]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Multi- and single-select share one control; only the toggle logic differs. */
function OptionPicker({
  options,
  value,
  multiple,
  onChange,
  disabled,
}: {
  options: string[];
  value: AnswerValue;
  multiple: boolean;
  onChange: (v: AnswerValue) => void;
  disabled?: boolean;
}) {
  const selected = Array.isArray(value) ? value : value ? [value] : [];

  const toggle = (opt: string) => {
    if (!multiple) {
      onChange(selected[0] === opt ? "" : opt);
      return;
    }
    onChange(selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt]);
  };

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = selected.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            disabled={disabled}
            onClick={() => toggle(opt)}
            aria-pressed={active}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              "disabled:cursor-not-allowed disabled:opacity-50",
              active ? "border-primary bg-primary/10" : "hover:bg-accent"
            )}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

export function QuestionField({
  question,
  value,
  onChange,
  disabled,
}: {
  question: Question;
  value?: AnswerValue;
  onChange: (v: AnswerValue) => void;
  disabled?: boolean;
}) {
  const v = value ?? (isOn(question.allowMultiple) ? [] : "");
  const text = Array.isArray(v) ? v.join(", ") : v;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <Label className="text-sm font-medium">
          {question.label || <span className="text-muted-foreground italic">Untitled question</span>}
          {isOn(question.isRequired) ? <span className="text-destructive ml-0.5">*</span> : null}
        </Label>
        {question.helpText ? (
          <span className="text-muted-foreground text-xs">{question.helpText}</span>
        ) : null}
      </div>

      {question.fieldType === "short_text" ? (
        <Input
          value={text}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type the answer"
        />
      ) : question.fieldType === "long_text" ? (
        <Textarea
          value={text}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          placeholder="Type the answer"
        />
      ) : question.fieldType === "options" ? (
        (question.options?.length ?? 0) >= 2 ? (
          <OptionPicker
            options={question.options ?? []}
            value={v}
            multiple={isOn(question.allowMultiple)}
            onChange={onChange}
            disabled={disabled}
          />
        ) : (
          <span className="text-muted-foreground text-xs italic">
            Needs at least two choices before it can be answered
          </span>
        )
      ) : (
        /* Attachment. The upload path runs through the platform file store and
           is not wired yet, so the control is present and DISABLED rather than
           pretending a file was taken. */
        <button
          type="button"
          disabled
          title="File upload is not connected yet"
          className="text-muted-foreground flex w-fit cursor-not-allowed items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm opacity-60"
        >
          <Paperclip className="size-4" />
          Add {isOn(question.allowMultiple) ? "files" : "a file"}
        </button>
      )}
    </div>
  );
}

/**
 * One repeat of a repeatable section: a named entry with its own answers and,
 * on the walk, its own condition score.
 *
 * This is the snagging interaction, and it is the reason the walk screen is
 * usable at all. The alternative — a pre-seeded grid of every space in the
 * building — is forty taps against a tree the surveyor may not have, and it is
 * where people abandon the tool on the second floor. Here they add only the
 * rooms they actually walked, name each one, answer, and move on.
 */
export type RepeatEntry = {
  id: string;
  label: string;
  answers: Answers;
  conditionScore: number | null;
};

export function RepeatEntryCard({
  entry,
  index,
  repeatLabel,
  questions,
  showCondition,
  onRename,
  onAnswer,
  onCondition,
  onRemove,
  disabled,
}: {
  entry: RepeatEntry;
  index: number;
  repeatLabel: string;
  questions: Question[];
  /** The walk scores condition per entry; a template preview does not. */
  showCondition?: boolean;
  onRename: (label: string) => void;
  onAnswer: (questionId: string, v: AnswerValue) => void;
  onCondition: (n: number) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-md border p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-52 flex-1 flex-col gap-1.5">
          <Label className="text-muted-foreground text-xs">
            {repeatLabel} {index + 1}
          </Label>
          <Input
            value={entry.label}
            disabled={disabled}
            onChange={(e) => onRename(e.target.value)}
            placeholder={`${repeatLabel} ${index + 1}`}
          />
        </div>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="text-muted-foreground hover:text-destructive flex items-center gap-1.5 rounded-md px-2 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Trash2 className="size-4" />
          Remove
        </button>
      </div>

      {showCondition ? (
        <div className="flex flex-col gap-2">
          <Label className="text-sm font-medium">Condition</Label>
          <ConditionScale value={entry.conditionScore} onChange={onCondition} disabled={disabled} />
        </div>
      ) : null}

      <QuestionList
        questions={questions}
        answers={entry.answers}
        onAnswer={onAnswer}
        disabled={disabled}
      />
    </div>
  );
}

/** A section's questions in sequence. `header` lets each caller frame it. */
export function QuestionList({
  questions,
  answers,
  onAnswer,
  disabled,
  header,
}: {
  questions: Question[];
  answers: Answers;
  onAnswer: (questionId: string, v: AnswerValue) => void;
  disabled?: boolean;
  header?: ReactNode;
}) {
  if (!questions.length) {
    return (
      <div className="text-muted-foreground py-3 text-sm italic">
        No questions in this section yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {header}
      {[...questions]
        .sort((a, b) => a.sequenceNo - b.sequenceNo)
        .map((q) => (
          <QuestionField
            key={q.id}
            question={q}
            value={answers[q.id]}
            onChange={(v) => onAnswer(q.id, v)}
            disabled={disabled}
          />
        ))}
    </div>
  );
}
