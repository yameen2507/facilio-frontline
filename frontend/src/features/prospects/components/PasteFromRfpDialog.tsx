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

import { useEffect, useMemo, useState, type FormEvent } from "react";
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
import { createLocation } from "../api/prospects-util";
import { TYPE_LABEL, type LocationType, type ProspectLocation } from "../types/prospect";

type ParsedRow = {
  key: number;
  name: string;
  code: string;
  city: string;
  take: boolean;
};

/**
 * Tabs first, then commas.
 *
 * A copy out of Excel is tab-separated, which is the case worth optimising; the
 * comma fallback covers a CSV pasted as text. A line with neither is one column,
 * which is the phone-call case and perfectly valid — a name alone is enough.
 */
function parse(text: string): ParsedRow[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      const cells = (line.includes("\t") ? line.split("\t") : line.split(",")).map((c) => c.trim());
      return {
        key: i,
        name: cells[0] ?? "",
        code: cells[1] ?? "",
        city: cells[2] ?? "",
        take: Boolean(cells[0]),
      };
    })
    .filter((r) => r.name !== "");
}

export function PasteFromRfpDialog({
  open,
  onOpenChange,
  dealId,
  parent,
  actor,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealId: string;
  /** Null means the pasted rows land as sites at the top level. */
  parent: ProspectLocation | null;
  actor: string;
  onDone: () => void;
}) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
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
    setType(parent ? "space" : "site");
    setError(null);
    setFailed([]);
    setWritten(0);
  }, [open, parent]);

  const taking = useMemo(() => rows.filter((r) => r.take), [rows]);

  const preview = () => {
    setRows(parse(text));
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
      const { error: err } = await createLocation(dealId, type, row.name, actor, {
        ...(parent ? { parentId: parent.id } : {}),
        // The rows came out of the client's document, and that is the whole point
        // of recording provenance: the RFP and the surveyor will disagree later,
        // and you need to know which is which (C25).
        provenance: "rfp",
        ...(row.code ? { code: row.code } : {}),
        ...(row.city ? { city: row.city } : {}),
      });
      if (err) problems.push({ name: row.name, message: err });
      else ok += 1;
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
                    {(parent
                      ? parent.type === "site"
                        ? (["building", "space"] as LocationType[])
                        : (["space"] as LocationType[])
                      : (["site"] as LocationType[])
                    ).map((t) => (
                      <SelectItem key={t} value={t}>
                        {TYPE_LABEL[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                      aria-label={`Include ${r.name}`}
                    />
                    <Input
                      value={r.name}
                      onChange={(e) => patch(r.key, { name: e.target.value })}
                      className="h-8 min-w-40 flex-1"
                      aria-label="Name"
                    />
                    <Input
                      value={r.code}
                      onChange={(e) => patch(r.key, { code: e.target.value })}
                      className="h-8 w-28 font-mono text-xs"
                      placeholder="ref"
                      aria-label="Client reference"
                    />
                    <Input
                      value={r.city}
                      onChange={(e) => patch(r.key, { city: e.target.value })}
                      className="h-8 w-32"
                      placeholder="city"
                      aria-label="City"
                    />
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
