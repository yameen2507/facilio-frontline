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

import { useState } from "react";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Where a date-only pick lands when the field also carries a time. */
const DEFAULT_TIME = "09:00";

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
        className={cn("justify-between font-normal", empty && "text-muted-foreground", className)}
      >
        {label}
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
        className={cn("w-[13rem]", className)}
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
  const selected = parseDatePart(value);
  const time = parseTimePart(value);

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
        className={cn("w-[16rem]", className)}
      />
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selected ?? undefined}
          defaultMonth={selected ?? undefined}
          onSelect={(d) => commit(d ?? null, time)}
        />
        <div className="flex items-center gap-2 border-t p-3">
          <Label htmlFor={`${id ?? "dt"}-time`} className="text-muted-foreground text-xs">
            Time
          </Label>
          <Input
            id={`${id ?? "dt"}-time`}
            type="time"
            value={time || DEFAULT_TIME}
            disabled={!selected}
            onChange={(e) => commit(selected, e.target.value)}
            className="h-8 w-[7.5rem]"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto"
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
