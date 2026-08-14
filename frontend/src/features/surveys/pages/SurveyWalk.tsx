/**
 * The walk — the surveyor's capture screen, live against `survey.walk` and
 * `survey.capture`.
 *
 * EDITS ACCUMULATE LOCALLY AND SAVE AS ONE BATCH. A room is ~5 answers plus a
 * condition score plus photos; sent one at a time that is ~1.1s each and the
 * surveyor abandons the tool on the second floor (§6.2). So typing costs
 * nothing, and "Save progress" sends everything pending in ONE `capture` call
 * whose ids are client-generated — a retry after a dropped connection
 * completes the save instead of duplicating it.
 *
 * PHOTOS upload their BYTES immediately (`vibe.uploadFile`, so a shot is off
 * the phone the moment it is taken) but their evidence ROW lands with the
 * batch, carrying the device's capturedAt, the geotag when the browser grants
 * one, and the caption of the question that asked for it. Every photo in an
 * entry hangs off that entry (`section_entry`), which is also what satisfies
 * the photo-below-condition rule the server enforces.
 *
 * This screen renders through the SAME components as the builder's preview
 * (FormRender) — that identity is the product promise, not a convenience.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Camera, Plus } from "lucide-react";
import { useActor } from "../../../app/auth";
import { PageShell } from "../../../app/shell/PageShell";
import { vibe } from "../../../lib/vibe";
import { Card, Stack } from "../../../ui/Card";
import { SkeletonRows } from "../../../ui/Skeleton";
import { Empty, ErrorState } from "../../../ui/States";
import { Button } from "@/components/ui/button";
import {
  isOn,
  QuestionList,
  RepeatEntryCard,
  type AnswerValue,
  type Answers,
  type AttachmentHandlers,
  type RepeatEntry,
} from "../../templates/components/FormRender";
import type { Question } from "../../templates/types/template";
import { capture, getWalk } from "../api/surveys-util";
import { PhotoThumb, urlCache } from "../components/PhotoGallery";
import { SurveyStatusChip, VisitStatusChip } from "../components/SurveyChips";
import type { WalkPhoto, WalkQuestion, WalkSection, WalkState } from "../types/survey";

/** Fallback while the walk loads — the real threshold rides in walk.settings. */
const PHOTO_BELOW_FALLBACK = 2;

const uid = () => crypto.randomUUID();

/** Question instances rendered through the shared renderer, which wants `sectionId`. */
const asQuestion = (q: WalkQuestion): Question => ({
  ...q,
  sectionId: q.sectionInstanceId,
  fieldType: q.fieldType as Question["fieldType"],
  options: q.options ?? [],
});

/**
 * Which column an answer belongs in. A `number` question writes `value_number`,
 * which is what the handoff's `value_type` is computed from and what the
 * estimator prices — that is the whole point of C31.
 *
 * Two deliberate fallbacks, both §6 #2 (never block on a missing field, record
 * best-available and flag it):
 *
 *  - **Blank** sends neither column, so nothing was captured. It must NOT send
 *    `valueNumber: 0` — a zero quantity prices as a real service costing
 *    nothing, which is worse than an honest gap.
 *  - **Unparseable** ("about 4.5k") falls back to `value_text` rather than
 *    being dropped. The estimator then reports that the key cannot be priced,
 *    which is true, instead of the answer vanishing between the walk and the
 *    quote.
 */
function answerValueFields(
  value: AnswerValue,
  fieldType: string | undefined
): { valueJson?: string[]; valueText?: string; valueNumber?: number } {
  if (Array.isArray(value)) return { valueJson: value };
  if (fieldType !== "number") return { valueText: value };

  const trimmed = value.trim();
  if (!trimmed) return {};

  // Strip grouping commas only — a stray unit or word still fails, on purpose.
  const parsed = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(parsed) ? { valueNumber: parsed } : { valueText: value };
}

type PendingEntry = { id: string; sectionInstanceId: string; entryLabel: string };
type PendingAnswer = {
  id: string;
  questionInstanceId: string;
  sectionEntryId: string | null;
  value: AnswerValue;
};
type PendingPhoto = {
  id: string;
  entityType: "section_entry" | "survey_visit";
  entityId: string;
  vibeFileId: number;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  caption: string | null;
  capturedAt: string;
  localUrl: string;
  /** Set when an attachment QUESTION took it, so its control can list it. */
  questionId?: string;
};

export function SurveyWalk() {
  const navigate = useNavigate();
  const { id } = useParams();
  const actor = useActor();

  const [walk, setWalk] = useState<WalkState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [pendingEntries, setPendingEntries] = useState<PendingEntry[]>([]);
  const [pendingAnswers, setPendingAnswers] = useState<Record<string, PendingAnswer>>({});
  const [pendingConditions, setPendingConditions] = useState<Record<string, { id: string; score: number }>>({});
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [uploading, setUploading] = useState(0);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let live = true;
    getWalk(id).then(({ data, error: err }) => {
      if (!live) return;
      setLoaded(true);
      setError(err);
      if (data) setWalk(data);
    });
    return () => {
      live = false;
    };
  }, [id, reloadKey]);

  // ── Server state, indexed ──────────────────────────────────────────────────
  const answerKey = (questionId: string, entryId: string | null) => `${questionId}|${entryId ?? "flat"}`;

  const serverAnswers = useMemo(() => {
    const map = new Map<string, AnswerValue>();
    // Answers arrive ordered by answered_at; later rows overwrite — append-only
    // storage, latest-wins reads.
    for (const a of walk?.answers ?? []) {
      const value: AnswerValue = Array.isArray(a.valueJson)
        ? (a.valueJson as string[])
        : (a.valueText ?? "");
      map.set(answerKey(a.questionInstanceId, a.sectionEntryId ?? null), value);
    }
    return map;
  }, [walk]);

  const serverConditions = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of walk?.observations ?? []) {
      if (o.sectionEntryId && o.conditionScore != null) map.set(o.sectionEntryId, o.conditionScore);
    }
    return map;
  }, [walk]);

  const serverPhotosByEntity = useMemo(() => {
    const map = new Map<string, WalkPhoto[]>();
    for (const p of walk?.photos ?? []) {
      const list = map.get(p.entityId) ?? [];
      list.push(p);
      map.set(p.entityId, list);
    }
    return map;
  }, [walk]);

  const questionLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of walk?.sections ?? []) for (const q of s.questions) map.set(q.id, q.label);
    return map;
  }, [walk]);

  /** Which answers belong in `value_number` rather than `value_text` (C31). */
  const questionTypeById = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of walk?.sections ?? []) for (const q of s.questions) map.set(q.id, q.fieldType);
    return map;
  }, [walk]);

  // ── Merged views ───────────────────────────────────────────────────────────
  const answersFor = (entryId: string | null, questions: WalkQuestion[]): Answers => {
    const out: Answers = {};
    for (const q of questions) {
      const key = answerKey(q.id, entryId);
      const pending = pendingAnswers[key];
      const value = pending ? pending.value : serverAnswers.get(key);
      if (value !== undefined) out[q.id] = value;
    }
    return out;
  };

  const conditionFor = (entryId: string): number | null =>
    pendingConditions[entryId]?.score ?? serverConditions.get(entryId) ?? null;

  const photosFor = (entityId: string): { id: string; name: string; url?: string | null; vibeFileId: number; questionId?: string }[] => [
    ...(serverPhotosByEntity.get(entityId) ?? []).map((p) => ({
      id: p.id,
      name: p.fileName ?? "photo",
      url: urlCache.get(p.vibeFileId) ?? null,
      vibeFileId: p.vibeFileId,
      questionId: undefined as string | undefined,
    })),
    ...pendingPhotos
      .filter((p) => p.entityId === entityId)
      .map((p) => ({ id: p.id, name: p.fileName, url: p.localUrl, vibeFileId: p.vibeFileId, questionId: p.questionId })),
  ];

  const dirtyCount =
    pendingEntries.length +
    Object.keys(pendingAnswers).length +
    Object.keys(pendingConditions).length +
    pendingPhotos.length;

  // ── Mutations (local until Save) ───────────────────────────────────────────
  const survey = walk?.survey;
  const visit = walk?.visit;
  const photoBelow = walk?.settings?.requirePhotoBelowCondition ?? PHOTO_BELOW_FALLBACK;
  const conditionLabels = walk?.settings?.conditionScaleLabels ?? null;
  const capturable = survey?.status === "assigned" || survey?.status === "in_progress";
  const editable = Boolean(capturable && visit && (visit.status === "planned" || visit.status === "in_progress"));

  const addEntry = (section: WalkSection) =>
    setPendingEntries((list) => [
      ...list,
      { id: uid(), sectionInstanceId: section.id, entryLabel: "" },
    ]);

  const removeEntry = (entryId: string) => {
    if (!pendingEntries.some((e) => e.id === entryId)) {
      setSaveError("A saved room stays on the record — removing one arrives with the review slice.");
      return;
    }
    setPendingEntries((list) => list.filter((e) => e.id !== entryId));
    setPendingAnswers((map) => {
      const next = { ...map };
      for (const key of Object.keys(next)) if (next[key].sectionEntryId === entryId) delete next[key];
      return next;
    });
    setPendingConditions(({ [entryId]: _drop, ...rest }) => rest);
    setPendingPhotos((list) => list.filter((p) => p.entityId !== entryId));
  };

  const setAnswer = (questionId: string, entryId: string | null, value: AnswerValue) =>
    setPendingAnswers((map) => {
      const key = answerKey(questionId, entryId);
      return {
        ...map,
        [key]: {
          id: map[key]?.id ?? uid(),
          questionInstanceId: questionId,
          sectionEntryId: entryId,
          value,
        },
      };
    });

  const setCondition = (entryId: string, score: number) =>
    setPendingConditions((map) => ({
      ...map,
      [entryId]: { id: map[entryId]?.id ?? uid(), score },
    }));

  const addPhotos = (
    entityType: PendingPhoto["entityType"],
    entityId: string,
    files: FileList,
    questionId?: string
  ) => {
    for (const file of Array.from(files)) {
      setUploading((n) => n + 1);
      vibe
        .uploadFile(file)
        .then((stored) => {
          const localUrl = URL.createObjectURL(file);
          urlCache.set(stored.fileId, localUrl);
          setPendingPhotos((list) => [
            ...list,
            {
              id: uid(),
              entityType,
              entityId,
              vibeFileId: stored.fileId,
              fileName: file.name || stored.fileName,
              contentType: file.type || "application/octet-stream",
              sizeBytes: file.size,
              caption: questionId ? (questionLabelById.get(questionId) ?? null) : null,
              capturedAt: new Date().toISOString(),
              localUrl,
              questionId,
            },
          ]);
        })
        .catch((e) => setSaveError(`photo upload failed: ${String((e as Error)?.message ?? e)}`))
        .finally(() => setUploading((n) => n - 1));
    }
  };

  const removePendingPhoto = (photoId: string) => {
    const photo = pendingPhotos.find((p) => p.id === photoId);
    if (!photo) return; // saved photos are evidence; they do not come off here
    setPendingPhotos((list) => list.filter((p) => p.id !== photoId));
    vibe.deleteFile(photo.vibeFileId).catch(() => undefined); // best-effort tidy-up
  };

  /** The attachment-question plumbing for one entity context. */
  const attachmentsFor = (
    entityType: PendingPhoto["entityType"],
    entityId: string
  ): AttachmentHandlers => ({
    list: (questionId) =>
      photosFor(entityId).filter(
        (p) =>
          p.questionId === questionId ||
          // Saved rows carry the question's label as their caption.
          (p.questionId === undefined &&
            (serverPhotosByEntity.get(entityId) ?? []).some(
              (sp) => sp.id === p.id && sp.caption === questionLabelById.get(questionId)
            ))
      ),
    add: (questionId, files) => addPhotos(entityType, entityId, files, questionId),
    remove: (_questionId, photoId) => removePendingPhoto(photoId),
  });

  // ── Save — everything pending, one round trip ──────────────────────────────
  const save = async () => {
    if (!id || !visit || saving) return;
    setSaveError(null);

    // The photo rule, checked before the round trip. The server re-checks.
    const merged = mergedEntries(walk, pendingEntries);
    const blocked = merged.filter((e) => {
      const score = conditionFor(e.id);
      return score != null && score <= photoBelow && photosFor(e.id).length === 0;
    });
    if (blocked.length) {
      setSaveError(
        `A condition of ${photoBelow} or below needs a photo: ${blocked
          .map((e) => `"${e.entryLabel || "unnamed"}"`)
          .join(", ")}`
      );
      return;
    }
    if (pendingEntries.some((e) => !e.entryLabel.trim())) {
      setSaveError("Every added room needs a name before saving.");
      return;
    }

    setSaving(true);
    const geo = await bestEffortGeo();

    const { data, error: err } = await capture(id, visit.id, actor, {
      entries: pendingEntries.map((e) => ({
        id: e.id,
        sectionInstanceId: e.sectionInstanceId,
        entryLabel: e.entryLabel.trim(),
      })),
      answers: Object.values(pendingAnswers).map((a) => ({
        id: a.id,
        questionInstanceId: a.questionInstanceId,
        sectionEntryId: a.sectionEntryId,
        ...answerValueFields(a.value, questionTypeById.get(a.questionInstanceId)),
      })),
      observations: Object.entries(pendingConditions).map(([entryId, c]) => ({
        id: c.id,
        sectionEntryId: entryId,
        conditionScore: c.score,
        ...geo,
      })),
      photos: pendingPhotos.map((p) => ({
        id: p.id,
        entityType: p.entityType,
        entityId: p.entityId,
        vibeFileId: p.vibeFileId,
        fileName: p.fileName,
        contentType: p.contentType,
        sizeBytes: p.sizeBytes,
        caption: p.caption,
        capturedAt: p.capturedAt,
        ...geo,
      })),
    });

    setSaving(false);
    if (err || !data) {
      setSaveError(err ?? "The save did not reach the server");
      return;
    }

    setWalk(data);
    setPendingEntries([]);
    setPendingAnswers({});
    setPendingConditions({});
    setPendingPhotos([]);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <PageShell
      title={survey ? `Walk — ${survey.refNo}` : "Walk"}
      subtitle={
        survey
          ? `${survey.title ?? "Untitled survey"}${visit ? ` · ${visit.visitNumber}` : ""}`
          : "Loading…"
      }
      // The chevron goes to THIS walk's survey, not to the survey list — which
      // is what retires the "← Survey" button that used to sit in the actions.
      // Two controls pointing backwards, one of them a full-width labelled
      // button, was the header saying "go back" twice.
      back={{ label: survey?.refNo ?? "the survey", to: `/surveys/${id}` }}
      // Loose items so the shell's action slot can wrap them on a phone.
      //
      // BOTH chips name their object. A survey and its visit are different
      // records with overlapping vocabularies, and unlabelled they came out as
      // "Scheduled" beside "Planned" — two blue pills, near-synonyms, reading
      // as one fact printed twice. The survey's state is why capture may be
      // read-only; the visit's is the trip the surveyor is standing in.
      actions={
        <>
          {survey ? <SurveyStatusChip status={survey.status} of="Survey" /> : null}
          {visit ? <VisitStatusChip status={visit.status} of="Visit" /> : null}
        </>
      }
    >
      <Stack>
        {!loaded ? (
          <Card pad={false}>
            <SkeletonRows count={4} />
          </Card>
        ) : error ? (
          <Card pad={false}>
            <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
          </Card>
        ) : !walk || !survey ? null : !visit ? (
          <Card pad={false}>
            <Empty
              title="No visit to walk"
              body="Schedule a visit from the survey page first — the walk records captures against a specific appointment."
              action={
                <Button variant="outline" onClick={() => navigate(`/surveys/${id}`)}>
                  Open the survey
                </Button>
              }
            />
          </Card>
        ) : (
          <>
            {!capturable ? (
              <Card>
                <p className="text-muted-foreground text-sm">
                  This survey is <strong>{survey.status}</strong> — capture opens once a team is
                  assigned and a lead is set, and closes at review. Everything below is read-only.
                </p>
              </Card>
            ) : null}

            {[...walk.sections]
              .sort((a, b) => a.sequenceNo - b.sequenceNo)
              .map((section) => (
                <WalkSectionCard
                  key={section.id}
                  section={section}
                  walk={walk}
                  pendingEntries={pendingEntries}
                  editable={editable}
                  answersFor={answersFor}
                  conditionFor={conditionFor}
                  photosFor={photosFor}
                  attachmentsFor={attachmentsFor}
                  onAddEntry={() => addEntry(section)}
                  onRenameEntry={(entryId, label) =>
                    setPendingEntries((list) =>
                      list.map((e) => (e.id === entryId ? { ...e, entryLabel: label } : e))
                    )
                  }
                  onRemoveEntry={removeEntry}
                  onAnswer={setAnswer}
                  onCondition={setCondition}
                  onAddPhotos={addPhotos}
                  onRemovePhoto={removePendingPhoto}
                  visitId={visit.id}
                  photoBelow={photoBelow}
                  conditionLabels={conditionLabels}
                />
              ))}
          </>
        )}
      </Stack>

      {/* The pill is viewport-fixed, so it has to step over both things that
          own the bottom edge: the phone tab bar (--bottom-nav, 0 above `md`)
          and, on a PWA install, the iPhone home indicator under it. This is the
          page a technician works on a phone all day — the save control landing
          behind the navigation is the one that would actually cost work. */}
      {editable ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--bottom-nav)+env(safe-area-inset-bottom,0px)+--spacing(4))] z-40 flex justify-center px-4">
          {/* Wraps rather than overflows: a long save error beside the button is
              wider than a phone, and a pill that runs off both edges hides the
              message it exists to deliver. */}
          <div className="bg-background pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-1.5 rounded-2xl border px-4 py-2 shadow-lg sm:rounded-full">
            {saveError ? (
              <span className="text-destructive min-w-0 text-xs">{saveError}</span>
            ) : (
              <span className="text-muted-foreground text-sm">
                {uploading
                  ? `Uploading ${uploading} photo${uploading === 1 ? "" : "s"}…`
                  : dirtyCount
                    ? `${dirtyCount} unsaved change${dirtyCount === 1 ? "" : "s"}`
                    : "All saved"}
              </span>
            )}
            <Button size="sm" onClick={save} disabled={!dirtyCount || saving || uploading > 0}>
              {saving ? "Saving…" : "Save progress"}
            </Button>
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}

/** Server entries + locally added ones, as one list per section. */
function mergedEntries(
  walk: WalkState | null,
  pending: PendingEntry[]
): { id: string; sectionInstanceId: string; entryLabel: string; isPending: boolean }[] {
  return [
    ...(walk?.entries ?? []).map((e) => ({
      id: e.id,
      sectionInstanceId: e.sectionInstanceId,
      entryLabel: e.entryLabel,
      isPending: false,
    })),
    ...pending.map((e) => ({ ...e, isPending: true })),
  ];
}

// ── One section of the walk ───────────────────────────────────────────────────

function WalkSectionCard({
  section,
  walk,
  pendingEntries,
  editable,
  answersFor,
  conditionFor,
  photosFor,
  attachmentsFor,
  onAddEntry,
  onRenameEntry,
  onRemoveEntry,
  onAnswer,
  onCondition,
  onAddPhotos,
  onRemovePhoto,
  visitId,
  photoBelow,
  conditionLabels,
}: {
  section: WalkSection;
  walk: WalkState;
  pendingEntries: PendingEntry[];
  editable: boolean;
  answersFor: (entryId: string | null, questions: WalkQuestion[]) => Answers;
  conditionFor: (entryId: string) => number | null;
  photosFor: (entityId: string) => { id: string; name: string; url?: string | null; vibeFileId: number }[];
  attachmentsFor: (entityType: "section_entry" | "survey_visit", entityId: string) => AttachmentHandlers;
  onAddEntry: () => void;
  onRenameEntry: (entryId: string, label: string) => void;
  onRemoveEntry: (entryId: string) => void;
  onAnswer: (questionId: string, entryId: string | null, v: AnswerValue) => void;
  onCondition: (entryId: string, n: number) => void;
  onAddPhotos: (
    entityType: "section_entry" | "survey_visit",
    entityId: string,
    files: FileList
  ) => void;
  onRemovePhoto: (photoId: string) => void;
  visitId: string;
  photoBelow: number;
  conditionLabels: Record<string, string> | null;
}) {
  const repeatable = isOn(section.isRepeatable);
  const label = section.repeatLabel || "Entry";
  const questions = section.questions.map(asQuestion);

  if (!repeatable) {
    return (
      <Card title={section.name} meta={section.description ?? undefined}>
        <QuestionList
          questions={questions}
          answers={answersFor(null, section.questions)}
          onAnswer={(qid, v) => onAnswer(qid, null, v)}
          disabled={!editable}
          attachments={attachmentsFor("survey_visit", visitId)}
        />
      </Card>
    );
  }

  const entries = mergedEntries(walk, pendingEntries).filter(
    (e) => e.sectionInstanceId === section.id
  );

  return (
    <Card
      title={section.name}
      meta={`repeats per ${label.toLowerCase()}${isOn(section.createsPortfolioNode) ? " · each one becomes a space" : ""}`}
    >
      <div className="flex flex-col gap-4">
        {entries.map((entry, i) => {
          const asRepeat: RepeatEntry = {
            id: entry.id,
            label: entry.entryLabel,
            answers: answersFor(entry.id, section.questions),
            conditionScore: conditionFor(entry.id),
          };
          return (
            <RepeatEntryCard
              key={entry.id}
              entry={asRepeat}
              index={i}
              repeatLabel={label}
              questions={questions}
              showCondition
              disabled={!editable}
              onRename={(v) => (entry.isPending ? onRenameEntry(entry.id, v) : undefined)}
              onAnswer={(qid, v) => onAnswer(qid, entry.id, v)}
              onCondition={(n) => onCondition(entry.id, n)}
              onRemove={() => onRemoveEntry(entry.id)}
              attachments={attachmentsFor("section_entry", entry.id)}
              conditionLabels={conditionLabels}
              footer={
                <PhotoStrip
                  photos={photosFor(entry.id)}
                  editable={editable}
                  lowCondition={(conditionFor(entry.id) ?? 6) <= photoBelow}
                  onAdd={(files) => onAddPhotos("section_entry", entry.id, files)}
                  onRemove={onRemovePhoto}
                  inputId={`entry-photos-${entry.id}`}
                />
              }
            />
          );
        })}

        {entries.length === 0 ? (
          <span className="text-muted-foreground text-sm">
            Nothing walked yet — add only the {label.toLowerCase()}s you actually enter.
          </span>
        ) : null}

        {editable ? (
          <div>
            <Button variant="outline" size="sm" onClick={onAddEntry}>
              <Plus className="size-4" />
              Add another {label}
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

// ── The photo strip — one per entry ───────────────────────────────────────────

function PhotoStrip({
  photos,
  editable,
  lowCondition,
  onAdd,
  onRemove,
  inputId,
}: {
  photos: { id: string; name: string; url?: string | null; vibeFileId: number }[];
  editable: boolean;
  /** When the entry scored at or below the threshold, the strip says why it matters. */
  lowCondition: boolean;
  onAdd: (files: FileList) => void;
  onRemove: (photoId: string) => void;
  inputId: string;
}) {
  return (
    <div className="bg-muted/30 flex flex-col gap-2 rounded-md p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Photos</span>
        {lowCondition && !photos.length ? (
          <span className="text-destructive text-xs">
            this condition needs photo evidence before it can be saved
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {photos.map((p) => (
          <PhotoThumb key={p.id} photo={p} onRemove={editable ? () => onRemove(p.id) : undefined} />
        ))}

        {editable ? (
          <>
            <input
              id={inputId}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) onAdd(e.target.files);
                e.target.value = "";
              }}
            />
            <label
              htmlFor={inputId}
              className="hover:bg-accent flex size-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed"
            >
              <Camera className="size-5" />
              <span className="text-[10px]">Add</span>
            </label>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** One position fix, three seconds, or nothing — geotag capture is best-effort. */
function bestEffortGeo(): Promise<{ geoLat?: number; geoLng?: number; geoAccuracyM?: number }> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve({});
    const timer = setTimeout(() => resolve({}), 3000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        resolve({
          geoLat: pos.coords.latitude,
          geoLng: pos.coords.longitude,
          geoAccuracyM: Math.round(pos.coords.accuracy),
        });
      },
      () => {
        clearTimeout(timer);
        resolve({});
      },
      { timeout: 2500, maximumAge: 60000 }
    );
  });
}
