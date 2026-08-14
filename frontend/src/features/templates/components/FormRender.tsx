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
import { UNIT_LABEL, type Question, type Unit } from "../types/template";

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
  labels,
}: {
  value: number | null;
  onChange: (n: number) => void;
  disabled?: boolean;
  /** The org's own words from `survey.condition_scale_labels`; the constant is the fallback. */
  labels?: Record<string | number, string> | null;
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
            <span className="text-muted-foreground text-[11px]">
              {labels?.[n] ?? CONDITION_LABELS[n]}
            </span>
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

/** A file already attached to a question, however the caller stores it. */
export type QuestionAttachment = { id: string; name: string; url?: string | null };

/**
 * What a capture surface plugs in to make attachment questions real. The
 * builder's preview passes nothing and gets the disabled control — a preview
 * that pretended to take files would be rehearsing the wrong thing.
 */
export type AttachmentHandlers = {
  list: (questionId: string) => QuestionAttachment[];
  add: (questionId: string, files: FileList) => void;
  remove?: (questionId: string, attachmentId: string) => void;
};

export function QuestionField({
  question,
  value,
  onChange,
  disabled,
  attachments,
}: {
  question: Question;
  value?: AnswerValue;
  onChange: (v: AnswerValue) => void;
  disabled?: boolean;
  attachments?: AttachmentHandlers;
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
      ) : question.fieldType === "number" ? (
        /* The unit sits INSIDE the field, not beside the label: the surveyor is
           typing a quantity and needs to see what it is measured in at the
           moment of typing. `inputMode="decimal"` gets the numeric keypad on a
           phone, which is where the walk happens. */
        <div className="relative">
          <Input
            type="text"
            inputMode="decimal"
            value={text}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            placeholder="0"
            className={question.unit ? "pr-16" : undefined}
          />
          {question.unit ? (
            <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs">
              {UNIT_LABEL[question.unit as Unit] ?? question.unit}
            </span>
          ) : null}
        </div>
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
      ) : attachments ? (
        <AttachmentField question={question} attachments={attachments} disabled={disabled} />
      ) : (
        /* Attachment with no handlers — the builder's preview. The control is
           present and DISABLED rather than pretending a file was taken. */
        <button
          type="button"
          disabled
          title="Files are taken on the walk, not in the preview"
          className="text-muted-foreground flex w-fit cursor-not-allowed items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm opacity-60"
        >
          <Paperclip className="size-4" />
          Add {isOn(question.allowMultiple) ? "files" : "a file"}
        </button>
      )}
    </div>
  );
}

/** The live attachment control: existing files as chips, plus the picker. */
function AttachmentField({
  question,
  attachments,
  disabled,
}: {
  question: Question;
  attachments: AttachmentHandlers;
  disabled?: boolean;
}) {
  const files = attachments.list(question.id);
  const multiple = isOn(question.allowMultiple);
  const inputId = `attach-${question.id}`;

  return (
    <div className="flex flex-col gap-2">
      {files.length ? (
        <div className="flex flex-wrap gap-2">
          {files.map((f) =>
            f.url ? (
              <span key={f.id} className="relative">
                <img
                  src={f.url}
                  alt={f.name}
                  className="size-16 rounded-md border object-cover"
                />
                {attachments.remove && !disabled ? (
                  <button
                    type="button"
                    onClick={() => attachments.remove?.(question.id, f.id)}
                    aria-label={`Remove ${f.name}`}
                    className="bg-background absolute -top-1.5 -right-1.5 rounded-full border p-0.5"
                  >
                    <Trash2 className="size-3" />
                  </button>
                ) : null}
              </span>
            ) : (
              <span
                key={f.id}
                className="bg-muted/40 flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
              >
                <Paperclip className="size-3" />
                {f.name}
                {attachments.remove && !disabled ? (
                  <button
                    type="button"
                    onClick={() => attachments.remove?.(question.id, f.id)}
                    aria-label={`Remove ${f.name}`}
                  >
                    <Trash2 className="size-3" />
                  </button>
                ) : null}
              </span>
            )
          )}
        </div>
      ) : null}

      <div>
        <input
          id={inputId}
          type="file"
          multiple={multiple}
          disabled={disabled}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) attachments.add(question.id, e.target.files);
            e.target.value = ""; // the same file picked twice must fire twice
          }}
        />
        <label
          htmlFor={inputId}
          className={cn(
            "flex w-fit cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm",
            "hover:bg-accent",
            disabled && "cursor-not-allowed opacity-60"
          )}
        >
          <Paperclip className="size-4" />
          Add {multiple ? "files" : files.length ? "another file" : "a file"}
        </label>
      </div>
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
  attachments,
  footer,
  conditionLabels,
}: {
  entry: RepeatEntry;
  index: number;
  repeatLabel: string;
  questions: Question[];
  /** The per-entry condition scale — scored for real on the walk, rehearsed
      in the builder's preview. */
  showCondition?: boolean;
  onRename: (label: string) => void;
  onAnswer: (questionId: string, v: AnswerValue) => void;
  onCondition: (n: number) => void;
  onRemove: () => void;
  disabled?: boolean;
  attachments?: AttachmentHandlers;
  /** The walk hangs the entry's photo strip here; the preview hangs nothing. */
  footer?: ReactNode;
  conditionLabels?: Record<string | number, string> | null;
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
          <ConditionScale
            value={entry.conditionScore}
            onChange={onCondition}
            disabled={disabled}
            labels={conditionLabels}
          />
        </div>
      ) : null}

      <QuestionList
        questions={questions}
        answers={entry.answers}
        onAnswer={onAnswer}
        disabled={disabled}
        attachments={attachments}
      />

      {footer}
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
  attachments,
}: {
  questions: Question[];
  answers: Answers;
  onAnswer: (questionId: string, v: AnswerValue) => void;
  disabled?: boolean;
  header?: ReactNode;
  attachments?: AttachmentHandlers;
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
            attachments={attachments}
          />
        ))}
    </div>
  );
}
