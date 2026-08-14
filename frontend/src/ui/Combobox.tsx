/**
 * THE searchable lookup (D-35): one component for every reference field —
 * users, deals, sites, templates, accounts, services. A plain Select stops
 * being a choice at about a dozen rows; this stays one at a thousand.
 *
 * Options are data, not children: every call site has a list of records and a
 * selected id, so the API takes exactly that and the component owns the
 * popover, the search, the empty state and the keyboard handling. Search
 * matches on the label AND the meta line (an email finds a user shown by
 * name), via cmdk's value string — which is why `value` passed to CommandItem
 * is "label meta id", not the bare id.
 *
 * `footer` exists for the one legitimate extra row a picker sometimes needs —
 * "Add a new property…" — WITHOUT letting call sites re-invent the option row.
 */

import { useMemo, useState, type ReactNode } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type ComboboxOption = {
  id: string;
  /** The main line, and what the trigger shows when selected. */
  label: string;
  /** Quieter second line — role · team, city, version. Also searchable. */
  meta?: string | null;
  /** Small right-aligned addendum on the row — "in Facilio", "v3". */
  badge?: string | null;
  disabled?: boolean;
};

export function Combobox({
  id,
  options,
  value,
  onChange,
  placeholder = "Pick one",
  searchPlaceholder = "Search…",
  emptyText = "Nothing matches.",
  disabled,
  loading,
  footer,
  className,
}: {
  id?: string;
  options: ComboboxOption[];
  value: string | null;
  onChange: (id: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  loading?: boolean;
  /** Rendered under the list, outside the filter — e.g. an "Add new…" row. */
  footer?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  const selected = useMemo(
    () => options.find((o) => o.id === value) ?? null,
    [options, value]
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* A button styled as a field, not a field: the input lives INSIDE the
            popover, so the closed control never pretends to be typeable. */}
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || loading}
          className={cn(
            "w-full justify-between font-normal",
            !selected && "text-muted-foreground",
            className
          )}
        >
          <span className="truncate">
            {loading ? "Loading…" : selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent width="trigger" align="start" className="p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.id}
                  // Label + meta + id so search hits all three; cmdk filters on
                  // this string, onSelect gets it back — hence the id lookup.
                  value={`${o.label} ${o.meta ?? ""} ${o.id}`}
                  disabled={o.disabled}
                  onSelect={() => {
                    onChange(o.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn("size-4", o.id === value ? "opacity-100" : "opacity-0")}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{o.label}</span>
                    {o.meta ? (
                      <span className="text-muted-foreground truncate text-xs">{o.meta}</span>
                    ) : null}
                  </span>
                  {o.badge ? (
                    <span className="text-muted-foreground ml-auto text-xs">{o.badge}</span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {footer}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
