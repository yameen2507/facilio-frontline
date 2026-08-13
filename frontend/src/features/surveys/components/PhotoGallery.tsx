/**
 * Photo rendering shared by the walk (capture) and the detail page (review).
 *
 * A photo has two lives: just-taken, where the browser still holds the bytes
 * (local object URL), and previously saved, where only the file-store id
 * exists and the bytes come back through `vibe.downloadFile` — once, then
 * cached for the session. The cache is module-level ON PURPOSE: the walk
 * uploads a shot, saves, and the detail page then shows it without a second
 * download.
 */

import { useEffect, useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import { vibe } from "../../../lib/vibe";
import { when } from "../../../lib/format";
import type { WalkPhoto } from "../types/survey";

/** Object URLs by file-store id, for every photo this session has bytes for. */
export const urlCache = new Map<number, string>();

export function PhotoThumb({
  photo,
  onRemove,
  size = 16,
}: {
  photo: { id: string; name: string; url?: string | null; vibeFileId: number };
  onRemove?: () => void;
  /** Tailwind size unit — 16 on the walk strip, 24 in the review gallery. */
  size?: 16 | 24;
}) {
  const [url, setUrl] = useState<string | null>(photo.url ?? urlCache.get(photo.vibeFileId) ?? null);
  const fetched = useRef(false);

  useEffect(() => {
    if (url || fetched.current) return;
    fetched.current = true;
    vibe
      .downloadFile(photo.vibeFileId)
      .then((blob) => {
        const objectUrl = URL.createObjectURL(blob);
        urlCache.set(photo.vibeFileId, objectUrl);
        setUrl(objectUrl);
      })
      .catch(() => undefined); // falls through to the name chip
  }, [url, photo.vibeFileId]);

  if (!url) {
    return (
      <span className="bg-muted/40 flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs">
        <Paperclip className="size-3" />
        {photo.name}
      </span>
    );
  }

  return (
    <span className="relative">
      <img
        src={url}
        alt={photo.name}
        className={`${size === 24 ? "size-24" : "size-16"} rounded-md border object-cover`}
      />
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${photo.name}`}
          className="bg-background absolute -top-1.5 -right-1.5 rounded-full border px-1 text-xs leading-4"
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

/**
 * The review gallery: every photo with what it evidences and when it was
 * taken. The label comes from the room (entry) it hangs off, then the caption
 * (an attachment question's wording), then the raw entity type — always
 * SOMETHING, because an unlabelled photo is not evidence of anything.
 */
export function PhotoGallery({
  photos,
  entryLabels,
}: {
  photos: WalkPhoto[];
  entryLabels: { id: string; entryLabel: string }[];
}) {
  const labelByEntity = new Map(entryLabels.map((e) => [e.id, e.entryLabel]));

  return (
    <div className="flex flex-wrap gap-4 p-4">
      {photos.map((p) => (
        <figure key={p.id} className="flex w-24 flex-col gap-1">
          <PhotoThumb
            photo={{ id: p.id, name: p.fileName ?? "photo", vibeFileId: p.vibeFileId }}
            size={24}
          />
          <figcaption className="text-muted-foreground text-xs">
            <span className="text-foreground block truncate font-medium">
              {labelByEntity.get(p.entityId) ?? p.caption ?? p.entityType.replace(/_/g, " ")}
            </span>
            {p.caption && labelByEntity.has(p.entityId) ? (
              <span className="block truncate">{p.caption}</span>
            ) : null}
            {p.data?.capturedAt ? <span className="block">{when(p.data.capturedAt)}</span> : null}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
