/**
 * S2 — paste the client's site list straight out of their spreadsheet.
 *
 * WHY THIS IS P1 AND NOT A NICE-TO-HAVE: the RFP arrives as an attachment, and
 * *"they send attachments, they send spreadsheets, they send PDFs… square
 * footages"*. Five people read those bundles by hand today. §3's adoption test is
 * that this must be faster than reading the sheet — if it is slower, none of the
 * rest of the module matters.
 *
 * IT IS ALSO THE DOCTRINE-MANDATED MANUAL PATH (§6 #2, C8). The AI ingest (C37)
 * will eventually propose the same tree from the same document, but the manual
 * path has to work with AI switched off entirely, and it has to exist FIRST —
 * otherwise the only way to get data in is the thing we have not built.
 *
 * NOTHING IS PARSED CLEVERLY ON PURPOSE. It splits on tabs or commas, takes the
 * first column as the name, and shows you exactly what it understood before
 * anything is written. A parser that guesses which column is the area is a parser
 * that silently prices a building off a postcode.
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createLocation, listLocations, updateLocation } from "../api/prospects-util";
import type { OwnerScope } from "./ActionDialogs";
import { childTypesOf, TYPE_LABEL, type LocationType, type ProspectLocation } from "../types/prospect";

/**
 * Where a pasted column can go. `IGNORE` is a real, selectable choice — X-9 was
 * that unmapped columns vanished in silence, and the fix is not to force a
 * mapping but to make the discard VISIBLE and deliberate.
 */
const IGNORE = "__ignore__";

const COLUMN_TARGETS: Array<{ value: string; label: string }> = [
  { value: "name", label: "Name" },
  { value: "code", label: "Client's reference" },
  { value: "street", label: "Address" },
  { value: "city", label: "City" },
  { value: "state", label: "State / province" },
  { value: "zip", label: "Postcode" },
  { value: "country", label: "Country" },
  { value: "area", label: "Area (sq ft)" },
  { value: "no_of_floors", label: "Floors" },
  { value: "room_count", label: "Rooms" },
  { value: "restroom_count", label: "Restrooms" },
  { value: IGNORE, label: "Ignore this column" },
];

/** Numeric targets, so a column of prose is not offered as an area. */
const NUMERIC_TARGETS = new Set(["area", "no_of_floors", "room_count", "restroom_count"]);

type ParsedRow = {
  key: number;
  /** EVERY cell the user pasted, in order. Nothing is discarded at parse time. */
  cells: string[];
  take: boolean;
};

/**
 * Tabs first, then commas.
 *
 * A copy out of Excel is tab-separated, which is the case worth optimising; the
 * comma fallback covers a CSV pasted as text. A line with neither is one column,
 * which is the phone-call case and perfectly valid — a name alone is enough.
 *
 * X-9: this used to keep `cells[0..2]` and throw the rest away, so a pasted
 * `name,ref,city,4500` silently lost the 4,500 — and area is the number that
 * prices the job. Every cell is kept now and the MAPPING decides what happens
 * to it.
 */
function parse(text: string): ParsedRow[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => ({
      key: i,
      cells: (line.includes("\t") ? line.split("\t") : line.split(",")).map((c) => c.trim()),
      take: true,
    }))
    .filter((r) => (r.cells[0] ?? "") !== "");
}

/**
 * First guess at what each column is, corrected by the user before anything is
 * written. Column 1 is the name because a name is the one thing every paste has;
 * after that a column of numbers is far more likely to be an area than a city.
 */
function guessMapping(rows: ParsedRow[]): string[] {
  const width = Math.max(0, ...rows.map((r) => r.cells.length));
  const order = ["name", "code", "city", "street", "state", "zip"];
  let next = 0;
  return Array.from({ length: width }, (_, col) => {
    if (col === 0) return "name";
    const values = rows.map((r) => (r.cells[col] ?? "").trim()).filter(Boolean);
    const numeric =
      values.length > 0 && values.every((v) => Number.isFinite(Number(v.replace(/,/g, ""))));
    if (numeric) return "area";
    next += 1;
    return order[next] ?? IGNORE;
  });
}

/** Name + code + city, the §5.4 match. Case and spacing are not a difference. */
const dupeKey = (name: string, code: string, city: string) =>
  [name, code, city].map((v) => v.trim().toLowerCase()).join("|");

export function PasteFromRfpDialog({
  open,
  onOpenChange,
  owner,
  parent,
  actor,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  owner: OwnerScope;
  /** Null means the pasted rows land as sites at the top level. */
  parent: ProspectLocation | null;
  actor: string;
  onDone: () => void;
}) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  /** One target per pasted column, guessed then corrected by the user (X-9). */
  const [mapping, setMapping] = useState<string[]>([]);
  /** Every name+code+city already in this pursuit, for the duplicate check. */
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [type, setType] = useState<LocationType>(parent ? "space" : "site");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Per-row outcomes, so a partial failure names WHICH rows did not land. */
  const [failed, setFailed] = useState<Array<{ name: string; message: string }>>([]);
  const [written, setWritten] = useState(0);

  useEffect(() => {
    if (!open) return;
    setText("");
    setRows([]);
    setMapping([]);
    setType(parent ? "space" : "site");
    setError(null);
    setFailed([]);
    setWritten(0);
  }, [open, parent]);

  /**
   * The portfolio as it stands, read when the dialog opens so a pasted row can
   * be checked against it. Deal-scoped, because that is the set a duplicate
   * would actually collide with.
   */
  useEffect(() => {
    if (!open) return;
    let live = true;
    listLocations(owner, true).then(({ data }) => {
      if (!live) return;
      setExisting(
        new Set((data?.locations ?? []).map((l) => dupeKey(l.name, l.code ?? "", l.city ?? "")))
      );
    });
    return () => {
      live = false;
    };
  }, [open, owner.leadId, owner.accountId, owner.dealId]);

  /** What a row would become, given the current mapping. */
  const valuesFor = useCallback(
    (row: ParsedRow) => {
      const out: Record<string, string> = {};
      row.cells.forEach((cell, col) => {
        const target = mapping[col];
        if (!target || target === IGNORE || !cell) return;
        out[target] = cell;
      });
      return out;
    },
    [mapping]
  );

  /**
   * X-10 — duplicates are FLAGGED, never blocked. Martha may genuinely have two
   * Downtown branches, and a system that refuses to record the second one is
   * wrong more often than it is helpful. Flagged rows arrive unchecked, so the
   * default is safe and the override is one click.
   */
  const duplicates = useMemo(() => {
    const seen = new Map<string, number>();
    const flags = new Map<number, "existing" | "pasted">();
    for (const row of rows) {
      const v = valuesFor(row);
      const key = dupeKey(v.name ?? "", v.code ?? "", v.city ?? "");
      if (existing.has(key)) flags.set(row.key, "existing");
      else if (seen.has(key)) flags.set(row.key, "pasted");
      seen.set(key, row.key);
    }
    return flags;
  }, [rows, valuesFor, existing]);

  const taking = useMemo(() => rows.filter((r) => r.take), [rows]);

  /** Columns the user has chosen to drop — named on screen, never silent. */
  const ignoredColumns = mapping
    .map((target, col) => (target === IGNORE ? col + 1 : 0))
    .filter(Boolean);

  const preview = () => {
    const parsed = parse(text);
    const guessed = guessMapping(parsed);
    setMapping(guessed);
    // A row that already exists starts UNCHECKED. Computed here rather than in
    // render so the user can override it and have the override stick.
    const seen = new Set<string>();
    setRows(
      parsed.map((r) => {
        const v: Record<string, string> = {};
        r.cells.forEach((cell, col) => {
          const t = guessed[col];
          if (t && t !== IGNORE && cell) v[t] = cell;
        });
        const key = dupeKey(v.name ?? "", v.code ?? "", v.city ?? "");
        const dupe = existing.has(key) || seen.has(key);
        seen.add(key);
        return { ...r, take: !dupe };
      })
    );
    setFailed([]);
    setWritten(0);
  };

  const patch = (key: number, next: Partial<ParsedRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...next } : r)));

  /**
   * Written one at a time, and that is deliberate.
   *
   * There is no bulk-create handler and there should not be a fake one: without
   * transactions, a half-finished batch is the expected case, so what matters is
   * that the user learns exactly which rows landed. A single call that reported
   * "12 of 40 failed" with no names would be worse than 40 calls that each say so.
   */
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!taking.length || busy) return;
    setBusy(true);
    setError(null);
    setFailed([]);

    const problems: Array<{ name: string; message: string }> = [];
    let ok = 0;

    for (const row of taking) {
      const v = valuesFor(row);
      const name = v.name ?? "";
      if (!name) continue;

      // Identity and address go on the create; the measured columns cannot,
      // because `create` does not set priced attributes — they go through the
      // ledger so the RFP's number is recorded AS the RFP's number and a later
      // survey disagreeing becomes a conflict rather than an overwrite (§6.3).
      const { data, error: err } = await createLocation(owner.dealId ?? "", type, name, actor, {
        ...(owner.leadId ? { leadId: owner.leadId } : {}),
        ...(owner.accountId ? { accountId: owner.accountId } : {}),
        ...(parent ? { parentId: parent.id } : {}),
        // The rows came out of the client's document, and that is the whole point
        // of recording provenance: the RFP and the surveyor will disagree later,
        // and you need to know which is which (C25).
        provenance: "rfp",
        ...(v.code ? { code: v.code } : {}),
        ...(v.street ? { street: v.street } : {}),
        ...(v.city ? { city: v.city } : {}),
        ...(v.state ? { state: v.state } : {}),
        ...(v.zip ? { zip: v.zip } : {}),
        ...(v.country ? { country: v.country } : {}),
      });
      if (err) {
        problems.push({ name, message: err });
        continue;
      }

      const measured = Object.fromEntries(
        Object.entries(v).filter(([k]) => NUMERIC_TARGETS.has(k))
      );
      if (data?.location && Object.keys(measured).length) {
        const { error: mErr } = await updateLocation(data.location.id, measured, actor, "rfp");
        // The property EXISTS either way — a failed measurement is a partial
        // success, and saying "failed" would send someone hunting for a row that
        // is already there.
        if (mErr) problems.push({ name, message: `saved, but its measurements did not: ${mErr}` });
      }
      ok += 1;
    }

    setBusy(false);
    setWritten(ok);
    setFailed(problems);

    if (!problems.length) {
      onOpenChange(false);
      onDone();
      return;
    }
    // Something landed, so the tree behind is stale even though the dialog stays
    // open for the user to read what did not.
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submit} className="flex min-w-0 flex-col gap-5">
          <DialogHeader>
            <DialogTitle>Paste the site list</DialogTitle>
            <DialogDescription>
              Copy the rows out of the client&rsquo;s spreadsheet and paste them here. One property
              per line: name first, then their reference, then the city. Nothing is written until
              you have seen what was understood.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pr-text">Pasted rows</Label>
            <Textarea
              id="pr-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              className="font-mono text-xs"
              placeholder={"Al Bayt Grill — Downtown\tBLD-01\tDubai\nAl Bayt Grill — Marina\tBLD-02\tDubai"}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" size="sm" onClick={preview} disabled={!text.trim()}>
                Read the rows
              </Button>
              <span className="text-muted-foreground text-xs">
                Tab or comma separated. A name on its own is fine.
              </span>
            </div>
          </div>

          {rows.length ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pr-type">Add these as</Label>
                <Select value={type} onValueChange={(v) => setType(v as LocationType)}>
                  <SelectTrigger id="pr-type" className="w-full sm:w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {/* One source of truth for the level rules — hardcoding them
                        here is how the picker drifted from the five-level model. */}
                    {(parent ? childTypesOf(parent.type) : (["site"] as LocationType[])).map((t) => (
                      <SelectItem key={t} value={t}>
                        {TYPE_LABEL[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* THE HEADER-GUESS ROW (§5.4). The pasted sheet is somebody
                  else's and its column order is not a contract, so every column
                  gets a target the user can correct before anything is written.
                  Guessing and showing the guess beats both asking nothing (which
                  is how the area got dropped) and asking everything. */}
              <div className="flex flex-col gap-1.5">
                <Label>What each column is</Label>
                <div className="flex flex-wrap gap-2">
                  {mapping.map((target, col) => (
                    <div key={col} className="flex flex-col gap-1">
                      <span className="text-muted-foreground text-[10px] tracking-[0.06em] uppercase">
                        Column {col + 1}
                      </span>
                      <Select
                        value={target}
                        onValueChange={(v) =>
                          setMapping((m) => m.map((t, i) => (i === col ? v : t)))
                        }
                      >
                        <SelectTrigger className="h-8 w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {COLUMN_TARGETS.map((t) => (
                            <SelectItem key={t.value} value={t.value}>
                              {t.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
                {ignoredColumns.length ? (
                  /* X-9 — a dropped column is SAID. It used to vanish, and the
                     one that vanished was usually the area. */
                  <span className="text-muted-foreground text-xs">
                    {ignoredColumns.length === 1
                      ? `Column ${ignoredColumns[0]} will be ignored.`
                      : `Columns ${ignoredColumns.join(", ")} will be ignored.`}{" "}
                    Nothing in them is saved.
                  </span>
                ) : null}
              </div>

              {/* The preview. Editable, because the pasted sheet is somebody
                  else's and its column order is not a contract. */}
              <div className="max-h-72 overflow-y-auto rounded-md border">
                {rows.map((r) => (
                  <div
                    key={r.key}
                    className="flex flex-wrap items-center gap-2 border-b px-3 py-2 last:border-b-0"
                  >
                    <Checkbox
                      checked={r.take}
                      onCheckedChange={(v) => patch(r.key, { take: v === true })}
                      aria-label={`Include ${r.cells[0] ?? "row"}`}
                    />

                    {r.cells.map((cell, col) => (
                      <Input
                        key={col}
                        value={cell}
                        onChange={(e) =>
                          patch(r.key, {
                            cells: r.cells.map((c, i) => (i === col ? e.target.value : c)),
                          })
                        }
                        className={
                          mapping[col] === IGNORE
                            ? "text-muted-foreground h-8 w-28 text-xs line-through"
                            : col === 0
                              ? "h-8 min-w-40 flex-1"
                              : "h-8 w-32"
                        }
                        aria-label={
                          COLUMN_TARGETS.find((t) => t.value === mapping[col])?.label ??
                          `Column ${col + 1}`
                        }
                      />
                    ))}

                    {/* X-10 — said, not enforced. Two Downtown branches are a
                        real thing; a system that refuses the second is wrong
                        more often than it helps. */}
                    {duplicates.get(r.key) ? (
                      <span className="text-muted-foreground shrink-0 rounded border px-1.5 py-0.5 text-xs">
                        {duplicates.get(r.key) === "existing"
                          ? "looks like one already here"
                          : "looks like a duplicate above"}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {error ? <span className="text-destructive text-sm">{error}</span> : null}

          {failed.length ? (
            <div className="flex flex-col gap-1">
              <span className="text-sm">
                {written} added. {failed.length} did not:
              </span>
              {failed.map((f) => (
                <span key={f.name} className="text-destructive text-xs">
                  {f.name} — {f.message}
                </span>
              ))}
            </div>
          ) : null}

          <DialogFooter>
            {rows.length && !taking.length ? (
              <span className="text-muted-foreground mr-auto self-center text-xs">
                Tick at least one row
              </span>
            ) : null}
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {failed.length ? "Close" : "Cancel"}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!taking.length || busy}>
              {busy
                ? `Adding ${taking.length}…`
                : taking.length
                  ? `Add ${taking.length}`
                  : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
