/**
 * Filter tabs.
 *
 * Rendered into the page shell's fixed strip, not into the scrolling body, so
 * they stay visible while rows move under them.
 */

export type Tab<Id extends string> = { id: Id; label: string; count?: number };

export function Tabs<Id extends string>({
  items,
  active,
  onChange,
}: {
  items: Tab<Id>[];
  active: Id;
  onChange: (id: Id) => void;
}) {
  return (
    <div className="tabs">
      {items.map((t) => (
        <button
          type="button"
          key={t.id}
          className={t.id === active ? "on" : ""}
          onClick={() => onChange(t.id)}
          aria-pressed={t.id === active}
        >
          {t.label}
          <span className="n">{t.count ?? 0}</span>
        </button>
      ))}
    </div>
  );
}
