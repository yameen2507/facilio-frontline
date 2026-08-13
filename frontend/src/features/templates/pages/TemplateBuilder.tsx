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
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowDown, ArrowLeft, ArrowUp, Eye, Plus, Trash2 } from "lucide-react";
import { useActor } from "../../../app/auth";
import { PageShell } from "../../../app/shell/PageShell";
import { Card, Stack } from "../../../ui/Card";
import { Chip } from "../../../ui/Chip";
import { Empty, ErrorState } from "../../../ui/States";
import { SkeletonRows } from "../../../ui/Skeleton";
import { Button } from "@/components/ui/button";
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
import { Separator } from "@/components/ui/separator";
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
  publishBlockers,
  type FieldType,
  type Question,
  type Section,
  type TemplateStatus,
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

export function TemplateBuilder() {
  const navigate = useNavigate();
  const actor = useActor();
  /** Present on /templates/:id — the builder hydrates from it. Absent on /new. */
  const { id } = useParams();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sections, setSections] = useState<Section[]>([]);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState<"draft" | "publish" | null>(null);
  /** The server's answer, VERBATIM — never reworded here. */
  const [serverError, setServerError] = useState<string | null>(null);

  const [hydrating, setHydrating] = useState(Boolean(id));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<TemplateStatus>("draft");
  const [versionNo, setVersionNo] = useState(1);
  const [cloning, setCloning] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!id) return;
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
        setLoadError(error ?? "template not found");
        return;
      }
      setName(data.template.name);
      setDescription(data.template.description ?? "");
      setSections(data.sections);
      setStatus(data.template.status);
      setVersionNo(data.template.versionNo);
      // Frozen content opens AS its preview — that IS the detail view.
      if (data.template.status !== "draft") setPreview(true);
    });

    return () => {
      live = false;
    };
  }, [id, reloadKey]);

  /** Published and archived content is frozen — the builder shows, never edits. */
  const readOnly = Boolean(id) && status !== "draft";

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

  const blockers = useMemo(() => {
    const list = publishBlockers(sections);
    if (!name.trim()) list.unshift("Give the template a name");
    return list;
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

    const body = {
      ...(id ? { templateId: id } : {}),
      name: name.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      publish,
      sections: [...sections]
        .sort((a, b) => a.sequenceNo - b.sequenceNo)
        .map<ImportSectionBody>((s) => {
          const repeatable = isOn(s.isRepeatable);
          return {
            name: s.name.trim(),
            isRepeatable: repeatable,
            ...(repeatable ? { repeatLabel: s.repeatLabel?.trim() || "Room" } : {}),
            createsPortfolioNode: repeatable && isOn(s.createsPortfolioNode),
            questions: [...s.questions]
              .sort((a, b) => a.sequenceNo - b.sequenceNo)
              .map((q) => ({
                label: q.label.trim(),
                fieldType: q.fieldType,
                ...(q.fieldType === "options" ? { options: q.options ?? [] } : {}),
                allowMultiple: isOn(q.allowMultiple),
                isRequired: isOn(q.isRequired),
                ...(q.estimationKey?.trim()
                  ? { estimationKey: q.estimationKey.trim(), feedsEstimation: true }
                  : {}),
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

  if (hydrating) {
    return (
      <PageShell title="Template" subtitle="Loading…">
        <Card pad={false}>
          <SkeletonRows count={4} />
        </Card>
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
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => navigate("/templates")}>
              <ArrowLeft className="size-4" />
              Templates
            </Button>
            <Button onClick={clone} disabled={cloning}>
              {cloning ? "Cloning…" : "Clone to new draft"}
            </Button>
          </div>
        }
      >
        <Stack>
          <TemplatePreview name={name} sections={sections} />
          {serverError ? (
            <Card>
              <p className="text-destructive text-sm">{serverError}</p>
            </Card>
          ) : null}
        </Stack>
      </PageShell>
    );
  }

  return (
    <PageShell
      title={id ? name || "Edit template" : "New template"}
      subtitle={
        id
          ? `Draft v${versionNo} — saving rewrites this draft in place`
          : "Drafting locally — nothing is kept until you save or publish"
      }
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setPreview((p) => !p)} disabled={!sections.length}>
            <Eye className="size-4" />
            {preview ? "Back to editing" : "Preview"}
          </Button>
          <Button
            variant="outline"
            onClick={() => save(false)}
            disabled={!name.trim() || saving !== null}
            title={name.trim() ? undefined : "Give the template a name first"}
          >
            {saving === "draft" ? "Saving…" : "Save draft"}
          </Button>
          {/* Disabled-until-valid, with the reasons rendered beneath — a dead
              button with no explanation is the main cost of this pattern. */}
          <Button
            onClick={() => save(true)}
            disabled={blockers.length > 0 || saving !== null}
            title={blockers[0]}
          >
            {saving === "publish" ? "Publishing…" : "Publish"}
          </Button>
        </div>
      }
    >
      <Stack>
        {preview ? (
          <TemplatePreview name={name} sections={sections} />
        ) : (
          <>
            <Card title="Template">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="tpl-name">Name</Label>
                  <Input
                    id="tpl-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Soft services condition survey"
                    className="max-w-md"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="tpl-desc">What this template is for</Label>
                  <Textarea
                    id="tpl-desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                    className="max-w-md"
                  />
                </div>
              </div>
            </Card>

            {sections.map((section, i) => (
              <SectionEditor
                key={section.id}
                section={section}
                index={i}
                total={sections.length}
                onPatch={(patch) => patchSection(section.id, patch)}
                onRemove={() => removeSection(section.id)}
                onMove={(delta) => moveSection(i, delta)}
                onAddQuestion={() => addQuestion(section.id)}
                onPatchQuestion={(qid, patch) => patchQuestion(section.id, qid, patch)}
                onRemoveQuestion={(qid) => removeQuestion(section.id, qid)}
                onMoveQuestion={(qi, delta) => moveQuestion(section.id, qi, delta)}
              />
            ))}

            {sections.length ? (
              <div>
                <Button variant="outline" onClick={addSection}>
                  <Plus className="size-4" />
                  Add section
                </Button>
              </div>
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

            {blockers.length ? (
              <Card title="Before this can be published">
                <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-4 text-sm">
                  {blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
                {serverError ? <SaveError message={serverError} /> : null}
              </Card>
            ) : (
              <Card title="Ready to publish">
                <p className="text-muted-foreground text-sm">
                  Every publish guard passes. Publishing saves the template and makes it available
                  when a survey is scheduled — after that its content is frozen, and changes mean a
                  new version.
                </p>
                {serverError ? <SaveError message={serverError} /> : null}
              </Card>
            )}
          </>
        )}

        <div>
          <Button variant="ghost" onClick={() => navigate("/templates")}>
            Back to templates
          </Button>
        </div>
      </Stack>
    </PageShell>
  );
}

/** The backend's message, verbatim, in the card the user is already reading. */
const SaveError = ({ message }: { message: string }) => (
  <p className="text-destructive mt-3 text-sm">{message}</p>
);

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
    <Card
      title={`Section ${section.sequenceNo}`}
      meta={
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move section up">
            <ArrowUp className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
            aria-label="Move section down"
          >
            <ArrowDown className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onRemove} aria-label="Delete section">
            <Trash2 className="size-4" />
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>Section name</Label>
          <Input
            value={section.name}
            onChange={(e) => onPatch({ name: e.target.value })}
            placeholder="Floor care"
            className="max-w-md"
          />
        </div>

        {/* The snagging pattern. One checkbox is the whole feature, and it is
            what removes the 40-taps-against-a-pre-seeded-grid problem. */}
        <div className="bg-muted/40 flex flex-col gap-3 rounded-md p-3">
          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={repeatable}
              onChange={(e) => onPatch({ isRepeatable: e.target.checked ? "true" : "false" })}
              className="mt-0.5 size-4"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Repeatable</span>
              <span className="text-muted-foreground text-xs">
                The surveyor adds this section again per room, names each one, and answers it. Only
                the rooms actually walked get an entry.
              </span>
            </span>
          </label>

          {repeatable ? (
            <div className="flex flex-wrap items-end gap-4 pl-6.5">
              <div className="flex flex-col gap-1.5">
                <Label>Button noun</Label>
                <Input
                  value={section.repeatLabel ?? ""}
                  onChange={(e) => onPatch({ repeatLabel: e.target.value })}
                  placeholder="Room"
                  className="w-40"
                />
                <span className="text-muted-foreground text-xs">
                  Shows as “+ Add another {section.repeatLabel || "Room"}”
                </span>
              </div>

              <label className="flex items-start gap-2.5 pb-1">
                <input
                  type="checkbox"
                  checked={isOn(section.createsPortfolioNode)}
                  onChange={(e) =>
                    onPatch({ createsPortfolioNode: e.target.checked ? "true" : "false" })
                  }
                  className="mt-0.5 size-4"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">Each entry creates a space</span>
                  <span className="text-muted-foreground text-xs">
                    The prospect portfolio gets built as a by-product of answering questions.
                  </span>
                </span>
              </label>
            </div>
          ) : null}
        </div>

        <Separator />

        <div className="flex flex-col gap-5">
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

          <div>
            <Button variant="outline" size="sm" onClick={onAddQuestion}>
              <Plus className="size-4" />
              Add question
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ── Question editor ──────────────────────────────────────────────────────────

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
  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-60 flex-1 flex-col gap-1.5">
          <Label>Question</Label>
          <Input
            value={question.label}
            onChange={(e) => onPatch({ label: e.target.value })}
            placeholder="What is the floor finish?"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Type</Label>
          <Select
            value={question.fieldType}
            onValueChange={(v) => onPatch({ fieldType: v as FieldType })}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FIELD_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {FIELD_TYPE_LABEL[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move question up">
            <ArrowUp className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
            aria-label="Move question down"
          >
            <ArrowDown className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onRemove} aria-label="Delete question">
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {question.fieldType === "options" ? (
        <div className="flex flex-col gap-1.5">
          <Label>Choices, one per line</Label>
          <Textarea
            rows={3}
            value={(question.options ?? []).join("\n")}
            onChange={(e) =>
              onPatch({ options: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })
            }
            placeholder={"Carpet\nVinyl\nPolished concrete"}
          />
          {(question.options?.length ?? 0) < 2 ? (
            <span className="text-muted-foreground text-xs">
              Needs at least two — this blocks publishing.
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-5">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isOn(question.isRequired)}
            onChange={(e) => onPatch({ isRequired: e.target.checked ? "true" : "false" })}
            className="size-4"
          />
          Required
        </label>

        {question.fieldType === "options" || question.fieldType === "attachment" ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isOn(question.allowMultiple)}
              onChange={(e) => onPatch({ allowMultiple: e.target.checked ? "true" : "false" })}
              className="size-4"
            />
            {question.fieldType === "options" ? "Allow multiple choices" : "Allow multiple files"}
          </label>
        ) : null}

        <div className="flex items-center gap-2">
          <Label className="text-muted-foreground text-xs">Estimation key</Label>
          <Input
            value={question.estimationKey ?? ""}
            onChange={(e) =>
              onPatch({
                estimationKey: e.target.value,
                feedsEstimation: e.target.value ? "true" : "false",
              })
            }
            placeholder="total_sqft"
            className="h-8 w-40 text-xs"
          />
        </div>
      </div>

      {/* The handoff contract in one line: pricing reads the key, never the wording. */}
      {question.estimationKey ? (
        <span className="text-muted-foreground text-xs">
          The estimator reads this answer as{" "}
          <code className="text-xs">{question.estimationKey}</code>, so rewording the question
          later will not break pricing.
        </span>
      ) : null}
    </div>
  );
}

// ── Preview ──────────────────────────────────────────────────────────────────

/**
 * Renders exactly what the surveyor will see, through the same components as the
 * capture screen. Answers typed here are thrown away — this is a rehearsal of
 * the form, not a capture against a survey.
 */
function TemplatePreview({ name, sections }: { name: string; sections: Section[] }) {
  const [answers, setAnswers] = useState<Answers>({});
  /** Repeat entries per section id — the "+ Add another Room" flow, rehearsed. */
  const [entries, setEntries] = useState<Record<string, RepeatEntry[]>>({});

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
    <>
      <Card title="Preview">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">{name || "Untitled template"}</span>
          <Chip tone="blue">as the surveyor sees it</Chip>
          <span className="text-muted-foreground text-xs">
            Answers here are not kept — this is the form, not a survey.
          </span>
        </div>
      </Card>

      {[...sections]
        .sort((a, b) => a.sequenceNo - b.sequenceNo)
        .map((section) => {
          const repeatable = isOn(section.isRepeatable);
          const label = section.repeatLabel || "Entry";
          const list = entries[section.id] ?? [];

          return (
            <Card
              key={section.id}
              title={section.name || `Section ${section.sequenceNo}`}
              meta={repeatable ? `repeats per ${label.toLowerCase()}` : undefined}
            >
              {repeatable ? (
                <div className="flex flex-col gap-4">
                  {list.map((entry, i) => (
                    <RepeatEntryCard
                      key={entry.id}
                      entry={entry}
                      index={i}
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
            </Card>
          );
        })}
    </>
  );
}
