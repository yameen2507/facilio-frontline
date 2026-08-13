/**
 * Date and date-time fields — shadcn's Calendar in a Popover, replacing the
 * browser's native `date` and `datetime-local` controls.
 *
 * Why replace them: the native picker is OS chrome, not app UI. It ignores the
 * theme entirely, so on a dark screen it opens as a white panel, and its
 * layout, wording and behaviour differ per browser and platform. This renders
 * in the app's own tokens and looks the same everywhere.
 *
 * THE VALUE CONTRACT IS DELIBERATELY UNCHANGED: the same `YYYY-MM-DD` and
 * `YYYY-MM-DDTHH:mm` strings the native inputs produced. Call sites keep the
 * state they already had and no request payload changes shape.
 *
 * All parsing and formatting is local wall-clock, built from parts. Two traps
 * this avoids, both of which shift the date by a day for anyone west of UTC:
 * `new Date("2026-08-25")` parses as UTC midnight, and `toISOString()`
 * converts to UTC on the way out. Neither appears here.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Where a date-only pick lands when the field also carries a time. */
const DEFAULT_TIME = "09:00";

/** Quarter-hours, 00:00–23:45. Granularity for booking a site visit. */
const TIME_SLOTS: string[] = Array.from({ length: 24 * 4 }, (_, i) => {
  const h = Math.floor(i / 4);
  const m = (i % 4) * 15;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
});

const pad = (n: number): string => String(n).padStart(2, "0");

/** `YYYY-MM-DD…` → a Date at LOCAL midnight, or null if unparseable. */
function parseDatePart(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date → `YYYY-MM-DD`, read off the local calendar rather than the UTC one. */
function formatDatePart(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The `HH:mm` half of a `datetime-local` string, or "" when absent. */
function parseTimePart(value: string): string {
  const m = /T(\d{2}:\d{2})/.exec(value);
  return m ? m[1] : "";
}

/**
 * `value` moved by whole hours, still local wall-clock. Used to offer a default
 * end once a start is picked, so nobody walks the same calendar twice.
 *
 * Because these strings are fixed-width and zero-padded, callers can compare
 * two of them with `<` directly — no parsing needed to check end-after-start.
 */
export function plusHours(value: string, hours: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  d.setHours(d.getHours() + hours);
  return `${formatDatePart(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function displayDate(d: Date): string {
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

/** `HH:mm` rendered in the viewer's clock convention, 12h or 24h. */
function displayTime(time: string): string {
  const [h, min] = time.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(min)) return time;
  const d = new Date(2000, 0, 1, h, min);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

type FieldProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
};

function Trigger({
  id,
  label,
  empty,
  disabled,
  autoFocus,
  className,
}: {
  id?: string;
  label: string;
  empty: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
}) {
  return (
    <PopoverTrigger asChild>
      <Button
        id={id}
        type="button"
        variant="outline"
        disabled={disabled}
        autoFocus={autoFocus}
        className={cn(
          // Full width by default: these sit in forms beside inputs and selects,
          // and a control that sizes to its own text makes a stack of fields
          // ragged. Call sites override with a width class when they need one.
          "w-full min-w-0 justify-between font-normal",
          empty && "text-muted-foreground",
          className
        )}
      >
        {/* Truncates rather than widening: "Aug 26, 2026, 9:00 AM" does not fit
            a narrow grid column, and a button that grows drags its column with it. */}
        <span className="truncate">{label}</span>
        <CalendarIcon className="size-4 shrink-0 opacity-60" aria-hidden="true" />
      </Button>
    </PopoverTrigger>
  );
}

/**
 * A calendar day cell is a button inside a Dialog's focus trap. `modal={false}`
 * keeps the popover's outside-click from bubbling up and closing the dialog
 * that contains it — every current call site sits inside one.
 */
export function DateField({ id, value, onChange, disabled, autoFocus, className }: FieldProps) {
  const [open, setOpen] = useState(false);
  const selected = parseDatePart(value);

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <Trigger
        id={id}
        label={selected ? displayDate(selected) : "Pick a date"}
        empty={!selected}
        disabled={disabled}
        autoFocus={autoFocus}
        className={className}
      />
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selected ?? undefined}
          defaultMonth={selected ?? undefined}
          onSelect={(d) => {
            onChange(d ? formatDatePart(d) : "");
            setOpen(false);
          }}
        />
        <div className="flex justify-end border-t p-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!selected}
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            Clear
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Date and time in one control. The time lives in the popover beside the
 * calendar rather than as a second field, because the two halves are one
 * answer — "when does the visit start" — and splitting them invites a date
 * saved with a time nobody chose.
 */
export function DateTimeField({ id, value, onChange, disabled, autoFocus, className }: FieldProps) {
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = parseDatePart(value);
  const time = parseTimePart(value);
  const activeTime = time || DEFAULT_TIME;

  /**
   * A time already on the record that is not a quarter-hour still has to be
   * selectable, or opening the picker would silently round it.
   */
  const slots = useMemo(
    () =>
      TIME_SLOTS.includes(activeTime) ? TIME_SLOTS : [...TIME_SLOTS, activeTime].sort(),
    [activeTime]
  );

  // Open the column at the chosen time rather than at midnight.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({
      block: "center",
    });
  }, [open]);

  const commit = (date: Date | null, nextTime: string) => {
    if (!date) return onChange("");
    onChange(`${formatDatePart(date)}T${nextTime || DEFAULT_TIME}`);
  };

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <Trigger
        id={id}
        label={selected ? `${displayDate(selected)}, ${displayTime(time || DEFAULT_TIME)}` : "Pick a date and time"}
        empty={!selected}
        disabled={disabled}
        autoFocus={autoFocus}
        className={className}
      />
      <PopoverContent align="start" className="w-auto p-0">
        <div className="flex">
          <Calendar
            mode="single"
            selected={selected ?? undefined}
            defaultMonth={selected ?? undefined}
            onSelect={(d) => commit(d ?? null, time)}
          />
          {/* The time column is buttons in a scroller, NOT `<input type="time">`.
              A native time input opens the browser's own spinner — a white
              OS panel that ignores the theme, and whose picker indicator is an
              unstyleable glyph. That is the same thing the calendar replaced,
              so it has no business reappearing inside this popover. */}
          <div className="flex w-[7.5rem] flex-col border-l">
            <div className="text-muted-foreground border-b px-3 py-2 text-xs">Time</div>
            <div ref={listRef} className="flex flex-col gap-1 overflow-y-auto p-2 [max-height:15rem]">
              {slots.map((t) => (
                <Button
                  key={t}
                  type="button"
                  size="sm"
                  variant={t === activeTime && selected ? "default" : "ghost"}
                  data-active={t === activeTime ? "true" : undefined}
                  disabled={!selected}
                  className="shrink-0 justify-center font-normal tabular-nums"
                  onClick={() => commit(selected, t)}
                >
                  {displayTime(t)}
                </Button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end border-t p-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!selected}
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            Clear
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
