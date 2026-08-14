/**
 * The form builder.
 *
 * EDITS ARE LOCAL UNTIL SAVED — deliberately. The builder drafts the whole
 * template in memory and hands it over in ONE `template-import` call (Save
 * draft or Publish), not as per-keystroke handler calls: a round trip costs
 * ~1.1s of fixed platform overhead, and a 30-question template saved row by
 * row is the §6.2 adoption-risk math at the desk. The cost of the trade is
 * stated in the header: close the tab before saving and the draft is gone.
 *
 * The per-row api-utils (`section-save`, `question-save`, …) are for the
 * edit-an-existing-draft surface to come, which starts from persisted rows.
 *
 * REORDER IS A SEQUENCE REWRITE, never an array shuffle in a blob — that is how
 * the server does it, and matching it here keeps the two honest about each other.
 *
 * LAYOUT (checked against Typeform, Jira Forms and Hotjar builders on Mobbin,
 * 2026-08): the editor is a two-column split — the canvas of section cards on
 * the left, and a sticky rail on the right carrying the outline (numbered,
 * click-to-jump) and the publish checklist. The checklist replaces the old
 * blockers card that sat BELOW the last section, where the person adding
 * question 30 could not see it. Preview swaps the whole split for a single
 * centred sheet, because the surveyor's phone has no rail either.
 */

import { useMemo, useRef, useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlignLeft,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Circle,
  Eye,
  Hash,
  ListChecks,
  MoveRight,
  Paperclip,
  PencilLine,
  Plus,
  Repeat2,
  Trash2,
  Type,
  X,
  type LucideIcon,
} from "lucide-react";
import { useActor } from "../../../app/auth";
import { PageShell } from "../../../app/shell/PageShell";
import { plural } from "../../../lib/format";
import { Card } from "../../../ui/Card";
import { Chip } from "../../../ui/Chip";
import { Empty, ErrorState } from "../../../ui/States";
import { TemplatePreviewSkeleton } from "../../../ui/Skeleton";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  QuestionList,
  RepeatEntryCard,
  isOn,
  type Answers,
  type AnswerValue,
  type RepeatEntry,
} from "../components/FormRender";
import { cloneTemplate, getTemplate, importTemplate, type ImportSectionBody } from "../api/templates-util";
import {
  FIELD_TYPES,
  FIELD_TYPE_LABEL,
  UNITS,
  UNIT_LABEL,
  isEstimable,
  publishBlockers,
  type FieldType,
  type Question,
  type Section,
  type TemplateStatus,
  type Unit,
} from "../types/template";

/** Session ids only — the server issues real uuids when a template is saved. */
let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

const newQuestion = (sectionId: string, sequenceNo: number): Question => ({
  id: nextId("q"),
  sectionId,
  label: "",
  fieldType: "short_text",
  options: [],
  allowMultiple: "false",
  sequenceNo,
  isRequired: "false",
  estimationKey: "",
});

const newSection = (sequenceNo: number): Section => ({
  id: nextId("s"),
  templateId: "draft",
  name: "",
  sequenceNo,
  levelBinding: "per_survey",
  isRepeatable: "false",
  repeatLabel: "Room",
  createsPortfolioNode: "false",
  questions: [],
});

/** Moves one item and rewrites every `sequenceNo` — never a bare array swap. */
function resequence<T extends { sequenceNo: number }>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next.map((item, i) => ({ ...item, sequenceNo: i + 1 }));
}

/**
 * A choice row is allowed to sit blank WHILE the admin types the next one, so
 * the raw state may hold "" entries. Everything that judges or ships the
 * question — the checklist, the save body, the preview — reads through this
 * instead, so a half-typed row never blocks publishing on a technicality or
 * reaches the server.
 */
const optionsOf = (q: Question): string[] =>
  (q.options ?? []).map((s) => s.trim()).filter(Boolean);

/** The blank builder, serialized once — the dirty check compares against this on /new. */
const EMPTY_SNAPSHOT = JSON.stringify({ name: "", description: "", sections: [] as Section[] });

/** One glyph per field type, so the picker reads at a glance before the word does. */
const FIELD_TYPE_ICON: Record<FieldType, LucideIcon> = {
  short_text: Type,
  long_text: AlignLeft,
  number: Hash,
  options: ListChecks,
  attachment: Paperclip,
};

/**
 * Inputs that read as text until touched — the question IS its own label, so a
 * boxed input inside a bordered card was a frame inside a frame. Hover and
 * focus paint a soft fill so editability stays discoverable.
 */
const GHOST_INPUT =
  "rounded-md border-0 bg-transparent px-1.5 shadow-none transition-colors " +
  // A thin ring stays for keyboard focus — the fill tint alone is too faint
  // to be the only indicator.
  "hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-1 focus-visible:ring-ring/40 " +
  "dark:bg-transparent dark:hover:bg-muted/50 dark:focus-visible:bg-muted/50";

export function TemplateBuilder() {
  const navigate = useNavigate();
  const actor = useActor();
  /** Present on /templates/:id — the builder hydrates from it. Absent on /new. */
  const { id } = useParams();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sections, setSections] = useState<Section[]>([]);
  /** Not edited here — hydrated and passed back so a save never resets it to
      the server's "General" default. `template-import` REPLACES the row. */
  const [category, setCategory] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState<"draft" | "publish" | null>(null);
  /** The server's answer, VERBATIM — never reworded here. */
  const [serverError, setServerError] = useState<string | null>(null);
  /** The section a delete is waiting on — snapshot, not just an id, so the
      dialog copy can name what it is about to remove. */
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    name: string;
    questionCount: number;
  } | null>(null);

  const [hydrating, setHydrating] = useState(Boolean(id));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<TemplateStatus>("draft");
  const [versionNo, setVersionNo] = useState(1);
  const [cloning, setCloning] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  /** What the draft looked like when it arrived (or the blank slate on /new).
      Anything else is unsaved work the leave guards below protect. */
  const [baseline, setBaseline] = useState(EMPTY_SNAPSHOT);
  const dirty = JSON.stringify({ name, description, sections }) !== baseline;
  const [confirmLeave, setConfirmLeave] = useState(false);

  useEffect(() => {
    if (!id) {
      // /new after /templates/:id reuses this same element (same route
      // position), so the previous template's state must be scrubbed or the
      // blank builder opens pre-filled and saving duplicates it.
      setName("");
      setDescription("");
      setSections([]);
      setCategory(null);
      setStatus("draft");
      setVersionNo(1);
      setPreview(false);
      setServerError(null);
      setLoadError(null);
      setHydrating(false);
      setBaseline(EMPTY_SNAPSHOT);
      return;
    }
    // Reset before fetching — this component serves /templates/a and
    // /templates/b in turn, and stale sections must never flash between them.
    let live = true;
    setHydrating(true);
    setLoadError(null);
    setServerError(null);

    getTemplate(id).then(({ data, error }) => {
      if (!live) return;
      setHydrating(false);
      if (error || !data) {
        setLoadError(error ?? "Template not found");
        return;
      }
      setName(data.template.name);
      setDescription(data.template.description ?? "");
      setSections(data.sections);
      setCategory(data.template.category ?? null);
      setStatus(data.template.status);
      setVersionNo(data.template.versionNo);
      setBaseline(
        JSON.stringify({
          name: data.template.name,
          description: data.template.description ?? "",
          sections: data.sections,
        })
      );
      // Frozen content opens AS its preview — that IS the detail view. Derived
      // rather than only ever set true: cloning re-hydrates this same instance
      // with a fresh draft, which must land back in the editor.
      setPreview(data.template.status !== "draft");
    });

    return () => {
      live = false;
    };
  }, [id, reloadKey]);

  /** Published and archived content is frozen — the builder shows, never edits. */
  const readOnly = Boolean(id) && status !== "draft";

  // The tab-close half of the header's stated trade ("close the tab before
  // saving and the draft is gone") — the browser at least asks first.
  useEffect(() => {
    if (!dirty || readOnly) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, readOnly]);

  const clone = async () => {
    if (!id || cloning) return;
    setCloning(true);
    setServerError(null);
    const { data, error } = await cloneTemplate(id);
    setCloning(false);
    if (error || !data) {
      setServerError(error ?? "The clone did not land");
      return;
    }
    navigate(`/templates/${data.template.id}`);
  };

  /**
   * What even a DRAFT save requires — the server validates these before its
   * first insert and throws (`src/modules/form.ts`, `template-import`), so
   * letting Save draft fire without them trades a disabled button for a
   * guaranteed error banner.
   */
  const draftBlockers = useMemo(() => {
    const list: string[] = [];
    if (!name.trim()) list.push("Give the template a name");
    const unnamed = sections.filter((s) => !s.name.trim()).length;
    if (unnamed) list.push(`${plural(unnamed, "section needs", "sections need")} a name`);
    const unlabelled = sections.flatMap((s) => s.questions).filter((q) => !q.label.trim()).length;
    if (unlabelled) list.push(`${plural(unlabelled, "question needs", "questions need")} wording`);
    return list;
  }, [name, sections]);

  /** Publish asks for everything a draft does, plus the publish-only guards —
      judged on the CLEANED choices, the same list the save ships. */
  const blockers = useMemo(() => {
    const cleaned = sections.map((s) => ({
      ...s,
      questions: s.questions.map((q) =>
        q.fieldType === "options" ? { ...q, options: optionsOf(q) } : q
      ),
    }));
    return [...draftBlockers, ...publishBlockers(cleaned)];
  }, [draftBlockers, sections]);

  /**
   * The same guards as `blockers`, but as pass/fail rows the rail can render
   * as a checklist — a static list that ticks off as the draft grows tells the
   * admin what "publishable" means before they hit the wall, where the
   * blockers-only card could not.
   */
  const checks = useMemo(() => {
    const totalQuestions = sections.reduce((n, s) => n + s.questions.length, 0);
    const unnamed = sections.filter((s) => !s.name.trim()).length;
    const unlabelled = sections.flatMap((s) => s.questions).filter((q) => !q.label.trim()).length;
    const thin = sections
      .flatMap((s) => s.questions)
      .filter((q) => q.fieldType === "options" && optionsOf(q).length < 2).length;
    return [
      { ok: Boolean(name.trim()), label: "Has a name" },
      { ok: sections.length > 0, label: "Has at least one section" },
      {
        ok: unnamed === 0,
        label: unnamed
          ? `${plural(unnamed, "section needs", "sections need")} a name`
          : "Every section is named",
      },
      { ok: totalQuestions > 0, label: "Has at least one question" },
      {
        ok: unlabelled === 0,
        label: unlabelled
          ? `${plural(unlabelled, "question needs", "questions need")} wording`
          : "Every question is written out",
      },
      {
        ok: thin === 0,
        label: thin
          ? `${plural(thin, "options question needs", "options questions need")} at least two choices`
          : "Every options question offers at least two choices",
      },
    ];
  }, [name, sections]);

  /**
   * The whole tree, one `template-import` call. Publish and Save draft are the
   * same request — the server saves either way and reports why it did not
   * publish rather than throwing, so a guard drift between this page's copy of
   * `publishBlockers` and the server's never loses the user's work.
   */
  const save = async (publish: boolean) => {
    setSaving(publish ? "publish" : "draft");
    setServerError(null);

    // Fields the builder does not edit — category, levelBinding, helpText,
    // unit, repeat bounds — ride along verbatim: `template-import` REPLACES
    // the tree, so anything left out of the body is anything erased.
    const body = {
      ...(id ? { templateId: id } : {}),
      name: name.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(category ? { category } : {}),
      publish,
      sections: [...sections]
        .sort((a, b) => a.sequenceNo - b.sequenceNo)
        .map<ImportSectionBody>((s) => {
          const repeatable = isOn(s.isRepeatable);
          return {
            name: s.name.trim(),
            ...(s.description?.trim() ? { description: s.description.trim() } : {}),
            ...(s.levelBinding ? { levelBinding: s.levelBinding } : {}),
            isRepeatable: repeatable,
            ...(repeatable ? { repeatLabel: s.repeatLabel?.trim() || "Room" } : {}),
            ...(s.minRepeats != null ? { minRepeats: s.minRepeats } : {}),
            ...(s.maxRepeats != null ? { maxRepeats: s.maxRepeats } : {}),
            createsPortfolioNode: repeatable && isOn(s.createsPortfolioNode),
            questions: [...s.questions]
              .sort((a, b) => a.sequenceNo - b.sequenceNo)
              .map((q) => ({
                label: q.label.trim(),
                ...(q.helpText?.trim() ? { helpText: q.helpText.trim() } : {}),
                fieldType: q.fieldType,
                // Cleaned, not raw — a blank choice row is editor scaffolding,
                // not template content.
                ...(q.fieldType === "options" ? { options: optionsOf(q) } : {}),
                allowMultiple: isOn(q.allowMultiple),
                isRequired: isOn(q.isRequired),
                // F-02: the server derives the key (number always prices;
                // options when opted in). Only an Advanced OVERRIDE travels.
                feedsEstimation:
                  q.fieldType === "number" ||
                  isOn(q.feedsEstimation) ||
                  Boolean(q.estimationKey?.trim()),
                ...(q.estimationKey?.trim() ? { estimationKey: q.estimationKey.trim() } : {}),
                ...(q.unit?.trim() ? { unit: q.unit.trim() } : {}),
              })),
          };
        }),
    };

    const { data, error } = await importTemplate(body, actor);
    setSaving(null);

    if (error || !data) {
      setServerError(error ?? "The save did not reach the server");
      return;
    }
    if (publish && !data.published) {
      setServerError(`Saved as a draft, not published: ${data.publishBlockers.join("; ")}`);
      return;
    }
    navigate("/templates");
  };

  // ── Section mutations ──────────────────────────────────────────────────────

  const addSection = () => setSections((s) => [...s, newSection(s.length + 1)]);

  const patchSection = (id: string, patch: Partial<Section>) =>
    setSections((s) => s.map((sec) => (sec.id === id ? { ...sec, ...patch } : sec)));

  /** Deleting a section takes its questions with it, exactly as the server does. */
  const removeSection = (id: string) =>
    setSections((s) => s.filter((sec) => sec.id !== id).map((sec, i) => ({ ...sec, sequenceNo: i + 1 })));

  /** An untouched section deletes instantly; one holding typed work asks first —
      there is no undo in a draft that only exists in memory. */
  const requestRemoveSection = (section: Section) => {
    if (!section.name.trim() && !section.questions.length) {
      removeSection(section.id);
      return;
    }
    setPendingDelete({
      id: section.id,
      name: section.name.trim() || `Section ${section.sequenceNo}`,
      questionCount: section.questions.length,
    });
  };

  const moveSection = (index: number, delta: number) =>
    setSections((s) => resequence(s, index, index + delta));

  // ── Question mutations ─────────────────────────────────────────────────────

  const addQuestion = (sectionId: string) =>
    patchSectionQuestions(sectionId, (qs) => [...qs, newQuestion(sectionId, qs.length + 1)]);

  const patchQuestion = (sectionId: string, questionId: string, patch: Partial<Question>) =>
    patchSectionQuestions(sectionId, (qs) =>
      qs.map((q) => (q.id === questionId ? { ...q, ...patch } : q))
    );

  const removeQuestion = (sectionId: string, questionId: string) =>
    patchSectionQuestions(sectionId, (qs) =>
      qs.filter((q) => q.id !== questionId).map((q, i) => ({ ...q, sequenceNo: i + 1 }))
    );

  const moveQuestion = (sectionId: string, index: number, delta: number) =>
    patchSectionQuestions(sectionId, (qs) => resequence(qs, index, index + delta));

  function patchSectionQuestions(sectionId: string, fn: (qs: Question[]) => Question[]) {
    setSections((s) => s.map((sec) => (sec.id === sectionId ? { ...sec, questions: fn(sec.questions) } : sec)));
  }

  /** Outline click. The smooth scroll steps aside for prefers-reduced-motion. */
  const jumpTo = (sectionId: string) => {
    document.getElementById(`builder-sec-${sectionId}`)?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start",
    });
  };

  if (hydrating) {
    return (
      <PageShell title="Template" subtitle="Loading…">
        <TemplatePreviewSkeleton />
      </PageShell>
    );
  }

  if (loadError) {
    return (
      <PageShell title="Template">
        <Card pad={false}>
          <ErrorState message={loadError} onRetry={() => setReloadKey((k) => k + 1)} />
        </Card>
      </PageShell>
    );
  }

  // The frozen states ARE their preview — same components as the capture
  // screen, which is why this needs no separate detail page.
  if (readOnly) {
    return (
      <PageShell
        title={name}
        subtitle={`v${versionNo} · ${status} — content is frozen; clone it to make changes`}
        // No wrapping div — the shell's action slot wraps its items, and a rigid
        // row overflows a phone. The back chevron already leads to /templates.
        actions={
          <Button size="sm" onClick={clone} disabled={cloning}>
            {cloning ? "Cloning…" : "Clone to new draft"}
          </Button>
        }
      >
        <div className="flex flex-col gap-5">
          {/* Above the sheet — a clone failure must not paint below the fold
              of a long published template. */}
          {serverError ? <SaveError message={serverError} /> : null}
          <TemplatePreview name={name} description={description} sections={sections} />
        </div>
      </PageShell>
    );
  }

  /** Leaving with typed work asks first; a clean builder just goes. */
  const leave = () => (dirty ? setConfirmLeave(true) : navigate("/templates"));

  return (
    <PageShell
      title={id ? name || "Edit template" : "New template"}
      subtitle={
        id
          ? `Draft v${versionNo} — saving rewrites this draft in place`
          : "Drafting locally — nothing is kept until you save or publish"
      }
      // The chevron is the ONLY in-page way back (no footer button doubling
      // it), so the unsaved-work guard rides on it.
      onBack={leave}
      // Loose buttons so the shell's action slot can wrap them on a phone.
      actions={
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPreview((p) => !p)}
            disabled={!sections.length}
            title={sections.length ? undefined : "Add a section first"}
          >
            {preview ? <PencilLine className="size-4" /> : <Eye className="size-4" />}
            {preview ? "Back to editing" : "Preview"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => save(false)}
            disabled={draftBlockers.length > 0 || saving !== null}
            title={draftBlockers[0]}
          >
            {saving === "draft" ? "Saving…" : "Save draft"}
          </Button>
          {/* Disabled-until-valid, with the reasons always on screen in the
              rail's checklist — a dead button with no explanation is the main
              cost of this pattern. */}
          <Button
            size="sm"
            onClick={() => save(true)}
            disabled={blockers.length > 0 || saving !== null}
            title={blockers[0]}
          >
            {saving === "publish" ? "Publishing…" : "Publish"}
          </Button>
        </>
      }
    >
      {preview ? (
        <TemplatePreview name={name} description={description} sections={sections} />
      ) : (
        <div className="grid grid-cols-1 items-start gap-5 min-[1080px]:grid-cols-[minmax(0,1fr)_300px]">
          {/* ── The canvas ─────────────────────────────────────────────── */}
          <div className="flex min-w-0 flex-col gap-5">
            {serverError ? <SaveError message={serverError} /> : null}

            {/* The editor's title page, shaped like the preview sheet's: the
                name IS the heading, not a boxed field adrift in a wide card —
                labelled inputs at half the card's width left the other half
                reading as dead space. */}
            <div className="bg-card flex flex-col gap-0.5 rounded-xl border px-5 py-4 sm:px-6 sm:py-5">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Untitled template"
                aria-label="Template name"
                className={cn(GHOST_INPUT, "-mx-1.5 h-11 font-semibold text-lg md:text-xl")}
              />
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="What this template is for — schedulers read this when picking one"
                aria-label="What this template is for"
                className={cn(GHOST_INPUT, "-mx-1.5 min-h-0 resize-none text-sm")}
              />
            </div>

            {sections.map((section, i) => (
              <SectionEditor
                key={section.id}
                section={section}
                index={i}
                total={sections.length}
                onPatch={(patch) => patchSection(section.id, patch)}
                onRemove={() => requestRemoveSection(section)}
                onMove={(delta) => moveSection(i, delta)}
                onAddQuestion={() => addQuestion(section.id)}
                onPatchQuestion={(qid, patch) => patchQuestion(section.id, qid, patch)}
                onRemoveQuestion={(qid) => removeQuestion(section.id, qid)}
                onMoveQuestion={(qi, delta) => moveQuestion(section.id, qi, delta)}
              />
            ))}

            {sections.length ? (
              /* Dashed and full width — an insertion point, not another card. */
              <button
                type="button"
                onClick={addSection}
                className="text-muted-foreground hover:border-ring/50 hover:bg-accent/40 hover:text-foreground flex items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-4 text-sm font-medium transition-colors"
              >
                <Plus className="size-4" />
                Add section
              </button>
            ) : (
              <Card pad={false}>
                <Empty
                  title="No sections yet"
                  body="A section groups questions that belong together — General site info, Floor care, Access and safety. Mark one repeatable and the surveyor can add it again per room."
                  action={
                    <Button onClick={addSection}>
                      <Plus className="size-4" />
                      Add the first section
                    </Button>
                  }
                />
              </Card>
            )}

          </div>

          {/* ── The rail: outline + publish checklist, sticky beside the
                 canvas so both stay in reach at question 30 ─────────────── */}
          {/* top matches the body's own inset, so the pinned rail keeps the
              same gutter under the header band that the canvas started with. */}
          <div className="flex min-w-0 flex-col gap-5 min-[1080px]:sticky min-[1080px]:top-6">
            <Card
              title="Outline"
              meta={sections.length ? plural(sections.length, "section", "sections") : undefined}
              pad={false}
            >
              {sections.length ? (
                /* Capped and self-scrolling: a 20-section outline must not push
                   the checklist below the viewport of a pinned rail. */
                <nav className="flex max-h-80 flex-col overflow-y-auto py-1" aria-label="Template outline">
                  {sections.map((s, i) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => jumpTo(s.id)}
                      className="hover:bg-accent flex items-center gap-2.5 px-4 py-2 text-left text-sm transition-colors"
                    >
                      <span className="bg-background text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded border text-[11px] font-semibold tabular-nums">
                        {i + 1}
                      </span>
                      <span className={cn("min-w-0 flex-1 truncate", !s.name.trim() && "text-muted-foreground italic")}>
                        {s.name.trim() || "Untitled section"}
                      </span>
                      {isOn(s.isRepeatable) ? (
                        <Repeat2 className="text-muted-foreground size-3.5 shrink-0" aria-label="Repeatable" />
                      ) : null}
                      <span className="text-muted-foreground text-xs tabular-nums">{s.questions.length}</span>
                    </button>
                  ))}
                </nav>
              ) : (
                <p className="text-muted-foreground px-4 py-3 text-sm">
                  Sections appear here as you add them.
                </p>
              )}
            </Card>

            <Card
              title="Publish checklist"
              meta={blockers.length ? `${blockers.length} to go` : <Chip tone="green">ready</Chip>}
            >
              <div className="flex flex-col gap-2.5">
                {checks.map((c) => (
                  <div key={c.label} className="flex items-start gap-2 text-sm">
                    {c.ok ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-600 dark:text-green-500" aria-hidden="true" />
                    ) : (
                      <Circle className="text-muted-foreground/40 mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    )}
                    {/* Done rows recede; the ones still owed keep full ink. */}
                    <span className={c.ok ? "text-muted-foreground" : undefined}>{c.label}</span>
                  </div>
                ))}
              </div>
              <p className="text-muted-foreground mt-4 border-t pt-3 text-xs">
                Publishing makes the template available when a survey is scheduled. Its content
                freezes then — later changes mean a new version.
              </p>
            </Card>
          </div>
        </div>
      )}

      <DeleteSectionDialog
        record={pendingDelete}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) removeSection(pendingDelete.id);
          setPendingDelete(null);
        }}
      />

      {/* Static copy, so visibility may derive straight from the flag. */}
      <Dialog open={confirmLeave} onOpenChange={(open) => (open ? undefined : setConfirmLeave(false))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave without saving?</DialogTitle>
            <DialogDescription>
              This draft only exists in this tab. Leaving now drops the unsaved sections and
              questions — Save draft keeps them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmLeave(false)}>
              Keep editing
            </Button>
            <Button variant="destructive" onClick={() => navigate("/templates")}>
              Discard and leave
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

/** The backend's message, verbatim, on a banner the eye meets before the form. */
const SaveError = ({ message }: { message: string }) => (
  <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border px-4 py-3 text-sm">
    {message}
  </div>
);

/**
 * Named consequence, not "are you sure?" — the dialog says what leaves the
 * draft. The copy latches the last real record so the close animation is not
 * spent naming a section that state has already forgotten.
 */
function DeleteSectionDialog({
  record,
  onCancel,
  onConfirm,
}: {
  record: { id: string; name: string; questionCount: number } | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const last = useRef(record);
  if (record) last.current = record;
  const r = last.current;

  return (
    <Dialog open={record !== null} onOpenChange={(open) => (open ? undefined : onCancel())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{r?.name}”?</DialogTitle>
          <DialogDescription>
            {r?.questionCount
              ? `The section and its ${plural(r.questionCount, "question", "questions")} come out of the draft together. `
              : "The section comes out of the draft. "}
            There is no undo — a draft only keeps what has been saved.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Keep it
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Delete section
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Section editor ───────────────────────────────────────────────────────────

function SectionEditor({
  section,
  index,
  total,
  onPatch,
  onRemove,
  onMove,
  onAddQuestion,
  onPatchQuestion,
  onRemoveQuestion,
  onMoveQuestion,
}: {
  section: Section;
  index: number;
  total: number;
  onPatch: (patch: Partial<Section>) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
  onAddQuestion: () => void;
  onPatchQuestion: (questionId: string, patch: Partial<Question>) => void;
  onRemoveQuestion: (questionId: string) => void;
  onMoveQuestion: (index: number, delta: number) => void;
}) {
  const repeatable = isOn(section.isRepeatable);

  return (
    // The id is the outline's jump target; scroll-mt keeps the header band
    // from landing flush against the scrollport edge.
    <section
      id={`builder-sec-${section.id}`}
      className="bg-card scroll-mt-2 overflow-hidden rounded-xl border"
    >
      {/* Header band: the number badge names the position, the name lives HERE
          rather than as a labelled field below — the outline, the preview and
          this card then all lead with the same thing. */}
      <header className="bg-muted/30 flex items-center gap-2.5 border-b px-3 py-2.5 sm:px-4">
        <span className="bg-background flex size-7 shrink-0 items-center justify-center rounded-lg border text-sm font-semibold tabular-nums">
          {section.sequenceNo}
        </span>
        <Input
          value={section.name}
          onChange={(e) => onPatch({ name: e.target.value })}
          placeholder="Section name — e.g. Floor care"
          aria-label={`Section ${section.sequenceNo} name`}
          className={cn(GHOST_INPUT, "h-8 min-w-0 flex-1 text-sm font-medium")}
        />
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums max-sm:hidden">
          {plural(section.questions.length, "question", "questions")}
        </span>
        <div className="flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground size-7"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            aria-label="Move section up"
          >
            <ArrowUp className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground size-7"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
            aria-label="Move section down"
          >
            <ArrowDown className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive size-7"
            onClick={onRemove}
            aria-label="Delete section"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </header>

      <div className="flex flex-col gap-4 p-3 sm:p-4">
        {/* The snagging pattern. One checkbox is the whole feature, and it is
            what removes the 40-taps-against-a-pre-seeded-grid problem. */}
        <div className="bg-muted/40 flex flex-col rounded-lg p-3">
          <div className="flex items-start gap-2.5">
            <Checkbox
              id={`rep-${section.id}`}
              checked={repeatable}
              onCheckedChange={(v) => onPatch({ isRepeatable: v === true ? "true" : "false" })}
              className="mt-0.5"
            />
            <div className="flex flex-col gap-0.5">
              <Label htmlFor={`rep-${section.id}`} className="gap-2">
                <Repeat2 className="text-muted-foreground size-3.5" aria-hidden="true" />
                Repeatable
              </Label>
              <span className="text-muted-foreground text-xs">
                The surveyor adds this section again per room, names each one, and answers it. Only
                the rooms actually walked get an entry.
              </span>
            </div>
          </div>

          {repeatable ? (
            /* The two follow-up settings hang off the checkbox on a thread
               rail, stacked — side by side their baselines never agreed. */
            <div className="mt-3 ml-2 flex flex-col gap-4 border-l-2 pl-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`rep-label-${section.id}`}>Each entry is a…</Label>
                <div className="flex flex-wrap items-center gap-2.5">
                  <Input
                    id={`rep-label-${section.id}`}
                    value={section.repeatLabel ?? ""}
                    onChange={(e) => onPatch({ repeatLabel: e.target.value })}
                    placeholder="Room"
                    className="h-8 w-36"
                  />
                  <MoveRight className="text-muted-foreground/60 size-4 shrink-0" aria-hidden="true" />
                  {/* The actual button, rendered dead — a live preview of what
                      the word becomes, not a caption restating it. */}
                  <span
                    aria-hidden="true"
                    className="bg-background text-muted-foreground pointer-events-none flex h-8 w-fit items-center gap-1.5 rounded-md border px-3 text-sm shadow-xs select-none"
                  >
                    <Plus className="size-3.5" />
                    Add another {section.repeatLabel?.trim() || "Room"}
                  </span>
                </div>
                <span className="text-muted-foreground text-xs">
                  The button the surveyor taps on the walk.
                </span>
              </div>

              <div className="flex items-start gap-2.5">
                <Checkbox
                  id={`space-${section.id}`}
                  checked={isOn(section.createsPortfolioNode)}
                  onCheckedChange={(v) =>
                    onPatch({ createsPortfolioNode: v === true ? "true" : "false" })
                  }
                  className="mt-0.5"
                />
                <div className="flex flex-col gap-0.5">
                  <Label htmlFor={`space-${section.id}`}>Each entry creates a space</Label>
                  <span className="text-muted-foreground text-xs">
                    The prospect portfolio gets built as a by-product of answering questions.
                  </span>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {section.questions.map((q, qi) => (
          <QuestionEditor
            key={q.id}
            question={q}
            index={qi}
            total={section.questions.length}
            onPatch={(patch) => onPatchQuestion(q.id, patch)}
            onRemove={() => onRemoveQuestion(q.id)}
            onMove={(delta) => onMoveQuestion(qi, delta)}
          />
        ))}

        <button
          type="button"
          onClick={onAddQuestion}
          className="text-muted-foreground hover:border-ring/50 hover:bg-accent/40 hover:text-foreground flex items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-sm font-medium transition-colors"
        >
          <Plus className="size-4" />
          Add question
        </button>
      </div>
    </section>
  );
}

// ── Question editor ──────────────────────────────────────────────────────────

/**
 * Four types is a segmented control, not a dropdown: every choice stays
 * visible with its glyph, and switching type is one click instead of
 * open-scan-pick. The day the type list outgrows a row is the day this
 * reverts to a Select.
 */
function FieldTypePicker({
  value,
  onChange,
}: {
  value: FieldType;
  onChange: (t: FieldType) => void;
}) {
  return (
    <div className="bg-muted/40 flex w-fit max-w-full flex-wrap gap-0.5 rounded-lg border p-0.5">
      {FIELD_TYPES.map((t) => {
        const Icon = FIELD_TYPE_ICON[t];
        const active = t === value;
        return (
          <button
            key={t}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(t)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
              // ring, not border — a border on the active pill would change
              // its size and nudge the row a pixel on every switch.
              active
                ? "bg-background text-foreground ring-border shadow-xs ring-1"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {FIELD_TYPE_LABEL[t]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The unit a Number answer is measured in. A fixed list rather than a text
 * field: the whole reason Number exists is that "4,500 sq ft" and "4500sqft"
 * priced differently, and a free-text unit would put that ambiguity straight
 * back. No default — an unchosen unit is a publish blocker the author must see,
 * not a guess we make for them.
 */
function UnitPicker({
  value,
  onChange,
}: {
  value: string | null | undefined;
  onChange: (u: Unit) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Label className="text-muted-foreground text-xs">
        Unit <span className="text-destructive">*</span>
      </Label>
      <div className="bg-muted/40 flex w-fit max-w-full flex-wrap gap-0.5 rounded-lg border p-0.5">
        {UNITS.map((u) => {
          const active = u === value;
          return (
            <button
              key={u}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(u)}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "bg-background text-foreground ring-border shadow-xs ring-1"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {UNIT_LABEL[u]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * One row per choice, replacing the one-per-line textarea — each choice gets
 * its own remove control, Enter appends the next row, and the leading glyph
 * mirrors what the surveyor will tap: a circle for pick-one, a square once
 * "Allow multiple choices" is on.
 */
function OptionsEditor({
  question,
  onPatch,
}: {
  question: Question;
  onPatch: (patch: Partial<Question>) => void;
}) {
  const options = question.options ?? [];
  const multiple = isOn(question.allowMultiple);
  const filled = optionsOf(question).length;

  /* Focus moves imperatively, never via autoFocus: an autoFocus predicate
     derived from data refires when the whole editor remounts (Preview and
     back), stealing focus and scrolling the page to whichever question
     happened to end on a blank row. */
  const rowsRef = useRef<HTMLDivElement>(null);
  const prevLen = useRef(options.length);
  useEffect(() => {
    if (options.length > prevLen.current) {
      const inputs = rowsRef.current?.querySelectorAll<HTMLInputElement>("input");
      inputs?.[inputs.length - 1]?.focus();
    }
    prevLen.current = options.length;
  }, [options.length]);

  const setAt = (i: number, v: string) =>
    onPatch({ options: options.map((o, j) => (j === i ? v : o)) });
  const removeAt = (i: number) => onPatch({ options: options.filter((_, j) => j !== i) });
  const add = () => onPatch({ options: [...options, ""] });
  const focusRow = (i: number) =>
    rowsRef.current?.querySelectorAll<HTMLInputElement>("input")[i]?.focus();

  return (
    <div ref={rowsRef} className="flex flex-col gap-1.5">
      <Label className="text-muted-foreground text-xs">Choices</Label>
      {options.map((opt, i) => (
        <div key={i} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={cn(
              "border-muted-foreground/40 size-3.5 shrink-0 border",
              multiple ? "rounded-[4px]" : "rounded-full"
            )}
          />
          <Input
            value={opt}
            onChange={(e) => setAt(i, e.target.value)}
            // Enter rolls into the next choice — appending a row on the last
            // one (the effect above lands the caret there), advancing otherwise.
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (i === options.length - 1) add();
                else focusRow(i + 1);
              }
            }}
            placeholder={["Carpet", "Vinyl", "Polished concrete"][i] ?? `Choice ${i + 1}`}
            aria-label={`Choice ${i + 1}`}
            className="h-8 max-w-sm text-sm"
          />
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground size-7 shrink-0"
            onClick={() => removeAt(i)}
            aria-label={`Remove choice ${i + 1}`}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" className="text-muted-foreground w-fit" onClick={add}>
          <Plus className="size-3.5" />
          Add a choice
        </Button>
        {filled < 2 ? (
          <span className="text-muted-foreground text-xs">
            Needs at least two — this blocks publishing.
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * F-02's derivation, mirrored from src/domain/form-template.ts
 * `deriveEstimationKey` — that copy decides; this one only PREVIEWS what the
 * server will store, so the Advanced line never shows a key the save would
 * then silently change. Keep the two in step.
 */
function deriveKeyPreview(label: string, unit?: string | null): string {
  const slug = label
    .toLowerCase()
    .replace(/\b(what|is|the|are|of|a|an|in|for|to|how|many|much|please|their|there)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .split("_")
    .slice(0, 5)
    .join("_");
  const u = (unit ?? "").trim().toLowerCase();
  if (!slug) return u ? `question_${u}` : "question";
  return u && !slug.includes(u) ? `${slug}_${u}` : slug;
}

function QuestionEditor({
  question,
  index,
  total,
  onPatch,
  onRemove,
  onMove,
}: {
  question: Question;
  index: number;
  total: number;
  onPatch: (patch: Partial<Question>) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
}) {
  /** The F-02 Advanced toggle — the derived key is a fact to read, the
      override behind it is the exception. Opens itself when an override
      already exists, so an edited key is never hidden from its editor. */
  const [advanced, setAdvanced] = useState(Boolean(question.estimationKey?.trim()));
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3.5">
      <div className="flex items-center gap-2">
        <span className="bg-muted text-muted-foreground flex h-5 min-w-7 shrink-0 items-center justify-center rounded px-1 text-[11px] font-semibold tabular-nums select-none">
          Q{index + 1}
        </span>
        <Input
          value={question.label}
          onChange={(e) => onPatch({ label: e.target.value })}
          placeholder="Type the question — e.g. What is the floor finish?"
          aria-label={`Question ${index + 1}`}
          className={cn(GHOST_INPUT, "h-8 min-w-0 flex-1 text-sm font-medium")}
        />
        <div className="flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground size-7"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            aria-label="Move question up"
          >
            <ArrowUp className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground size-7"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
            aria-label="Move question down"
          >
            <ArrowDown className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive size-7"
            onClick={onRemove}
            aria-label="Delete question"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {/*
        Switching type clears what the new type cannot hold. Leaving a stale
        estimation key on free text is exactly the F-02 shape — a question that
        looks priced and silently is not — and a stale unit on a non-number
        would publish a unit nothing reads.
      */}
      <FieldTypePicker
        value={question.fieldType}
        onChange={(t) =>
          onPatch({
            fieldType: t,
            ...(t === "number" ? {} : { unit: null }),
            ...(isEstimable(t) ? {} : { estimationKey: "", feedsEstimation: "false" }),
          })
        }
      />

      {question.fieldType === "options" ? (
        <OptionsEditor question={question} onPatch={onPatch} />
      ) : null}

      {question.fieldType === "number" ? (
        <UnitPicker value={question.unit} onChange={(u) => onPatch({ unit: u })} />
      ) : null}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-3">
        <div className="flex items-center gap-2">
          <Checkbox
            id={`req-${question.id}`}
            checked={isOn(question.isRequired)}
            onCheckedChange={(v) => onPatch({ isRequired: v === true ? "true" : "false" })}
          />
          <Label htmlFor={`req-${question.id}`}>Required</Label>
        </div>

        {question.fieldType === "options" || question.fieldType === "attachment" ? (
          <div className="flex items-center gap-2">
            <Checkbox
              id={`multi-${question.id}`}
              checked={isOn(question.allowMultiple)}
              onCheckedChange={(v) => onPatch({ allowMultiple: v === true ? "true" : "false" })}
            />
            <Label htmlFor={`multi-${question.id}`}>
              {question.fieldType === "options" ? "Allow multiple choices" : "Allow multiple files"}
            </Label>
          </div>
        ) : null}

        <span className="min-w-4 flex-1" />

        {/* F-02: no key box. A Number question prices by construction; an
            Options question opts in here. The key itself is derived and lives
            under Advanced below. */}
        {question.fieldType === "options" ? (
          <div className="flex items-center gap-2">
            <Checkbox
              id={`feeds-${question.id}`}
              checked={isOn(question.feedsEstimation) || Boolean(question.estimationKey?.trim())}
              onCheckedChange={(v) =>
                onPatch(
                  v === true
                    ? { feedsEstimation: "true" }
                    : { feedsEstimation: "false", estimationKey: "" }
                )
              }
            />
            <Label htmlFor={`feeds-${question.id}`}>Feeds pricing</Label>
          </div>
        ) : null}
      </div>

      {/* The handoff contract in one line: pricing reads the KEY, never the
          wording — derived from the question and unit (F-02, as ruled), so
          naming drift is gone and rewording only re-keys if the author never
          overrode it. Advanced is where the override lives. */}
      {isEstimable(question.fieldType) &&
      (question.fieldType === "number" ||
        isOn(question.feedsEstimation) ||
        Boolean(question.estimationKey?.trim())) ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
            The estimator reads this answer as{" "}
            <code className="text-xs">
              {question.estimationKey?.trim() ||
                deriveKeyPreview(question.label, question.unit)}
            </code>
            <button
              type="button"
              className="hover:text-foreground underline underline-offset-2"
              onClick={() => setAdvanced((a) => !a)}
            >
              {advanced ? "Hide advanced" : "Advanced"}
            </button>
          </span>
          {advanced ? (
            <div className="flex items-center gap-2">
              <Label className="text-muted-foreground text-xs">Key override</Label>
              <Input
                value={question.estimationKey ?? ""}
                onChange={(e) => onPatch({ estimationKey: e.target.value })}
                placeholder={deriveKeyPreview(question.label, question.unit)}
                className="h-8 w-48 font-mono text-xs"
              />
              <span className="text-muted-foreground text-xs">
                Blank = derived. Rate cards match on this key.
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {/*
        A key that survived from before the type changed. The publish guard
        already blocks it; this says so at the question rather than making the
        author hunt for which one the blocker meant.
      */}
      {question.estimationKey && !isEstimable(question.fieldType) ? (
        <span className="text-destructive text-xs">
          <code className="text-xs">{question.estimationKey}</code> cannot be priced on a{" "}
          {FIELD_TYPE_LABEL[question.fieldType].toLowerCase()} answer — switch this question to
          Number or Options, or clear the key.
        </span>
      ) : null}
    </div>
  );
}

// ── Preview ──────────────────────────────────────────────────────────────────

/**
 * Renders exactly what the surveyor will see, through the same components as
 * the capture screen. Answers typed here are thrown away — this is a rehearsal
 * of the form, not a capture against a survey.
 *
 * One centred sheet rather than a stack of admin cards: the surveyor meets the
 * template as one continuous form on a phone, and the preview should carry
 * that shape — title page first, then the sections in walking order.
 */
function TemplatePreview({
  name,
  description,
  sections,
}: {
  name: string;
  description?: string;
  sections: Section[];
}) {
  const [answers, setAnswers] = useState<Answers>({});
  /** Repeat entries per section id — the "+ Add another Room" flow, rehearsed. */
  const [entries, setEntries] = useState<Record<string, RepeatEntry[]>>({});

  /* Walking order, with half-typed blank choices dropped at this boundary so
     the shared renderer — which also serves the walk, where data arrives
     clean — never needs to know the builder allows them. */
  const ordered = useMemo(
    () =>
      [...sections]
        .sort((a, b) => a.sequenceNo - b.sequenceNo)
        .map((s) => ({
          ...s,
          questions: s.questions.map((q) =>
            q.fieldType === "options" ? { ...q, options: optionsOf(q) } : q
          ),
        })),
    [sections]
  );
  const totalQuestions = ordered.reduce((n, s) => n + s.questions.length, 0);

  const onAnswer = (questionId: string, v: AnswerValue) =>
    setAnswers((a) => ({ ...a, [questionId]: v }));

  const addEntry = (section: Section) =>
    setEntries((e) => {
      const list = e[section.id] ?? [];
      return {
        ...e,
        [section.id]: [
          ...list,
          {
            id: nextId("e"),
            label: `${section.repeatLabel || "Entry"} ${list.length + 1}`,
            answers: {},
            conditionScore: null,
          },
        ],
      };
    });

  const patchEntry = (sectionId: string, entryId: string, patch: Partial<RepeatEntry>) =>
    setEntries((e) => ({
      ...e,
      [sectionId]: (e[sectionId] ?? []).map((en) => (en.id === entryId ? { ...en, ...patch } : en)),
    }));

  const removeEntry = (sectionId: string, entryId: string) =>
    setEntries((e) => ({
      ...e,
      [sectionId]: (e[sectionId] ?? []).filter((en) => en.id !== entryId),
    }));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <Chip tone="blue">as the surveyor sees it</Chip>
        <span className="text-muted-foreground text-xs">
          Answers typed here are a rehearsal — nothing is kept.
        </span>
      </div>

      <div className="bg-card divide-y overflow-hidden rounded-xl border">
        {/* The title page. */}
        <div className="px-5 py-5 sm:px-6">
          <h2 className={cn("text-lg font-semibold", !name.trim() && "text-muted-foreground italic")}>
            {name.trim() || "Untitled template"}
          </h2>
          {description?.trim() ? (
            <p className="text-muted-foreground mt-1 text-sm">{description}</p>
          ) : null}
          <p className="text-muted-foreground mt-2 text-xs">
            {plural(ordered.length, "section", "sections")} ·{" "}
            {plural(totalQuestions, "question", "questions")}
          </p>
        </div>

        {ordered.length ? (
          ordered.map((section, i) => {
            const repeatable = isOn(section.isRepeatable);
            const label = section.repeatLabel || "Entry";
            const list = entries[section.id] ?? [];

            return (
              <div key={section.id} className="flex flex-col gap-4 px-5 py-5 sm:px-6">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold tabular-nums">
                    {i + 1}
                  </span>
                  <span className={cn("text-sm font-medium", !section.name.trim() && "text-muted-foreground italic")}>
                    {section.name.trim() || `Section ${section.sequenceNo}`}
                  </span>
                  {repeatable ? (
                    <span className="text-muted-foreground flex items-center gap-1 text-xs">
                      <Repeat2 className="size-3.5" aria-hidden="true" />
                      repeats per {label.toLowerCase()}
                    </span>
                  ) : null}
                </div>

                {repeatable ? (
                  <div className="flex flex-col gap-4">
                    {list.map((entry, ei) => (
                      <RepeatEntryCard
                        key={entry.id}
                        entry={entry}
                        index={ei}
                        repeatLabel={label}
                        questions={section.questions}
                        showCondition
                        onRename={(v) => patchEntry(section.id, entry.id, { label: v })}
                        onAnswer={(qid, v) =>
                          patchEntry(section.id, entry.id, {
                            answers: { ...entry.answers, [qid]: v },
                          })
                        }
                        onCondition={(n) => patchEntry(section.id, entry.id, { conditionScore: n })}
                        onRemove={() => removeEntry(section.id, entry.id)}
                      />
                    ))}

                    {list.length ? null : (
                      <span className="text-muted-foreground text-sm">
                        Nothing added yet. On the walk the surveyor adds only the{" "}
                        {label.toLowerCase()}s they actually enter.
                      </span>
                    )}

                    <div>
                      <Button variant="outline" size="sm" onClick={() => addEntry(section)}>
                        <Plus className="size-4" />
                        Add another {label}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <QuestionList questions={section.questions} answers={answers} onAnswer={onAnswer} />
                )}
              </div>
            );
          })
        ) : (
          <Empty
            tight
            title="Nothing to rehearse yet"
            body="Add a section and a question, and the surveyor's form appears here."
          />
        )}
      </div>
    </div>
  );
}
