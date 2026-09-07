import { useEffect, useMemo, useRef, useState } from "react";

export type PickerItem = {
  id: string;
  title: string;
  subtitle?: string;
  testId?: string;
};

export function PickerMenu({
  label,
  items,
  onSelect,
  onClose,
}: {
  label: string;
  items: PickerItem[];
  onSelect: (item: PickerItem) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    function onDoc(e: MouseEvent) {
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return items;
    return items.filter((it) => `${it.title} ${it.subtitle || ""}`.toLowerCase().includes(n));
  }, [items, q]);

  return (
    <div className="picker" ref={box} role="listbox" aria-label={label} data-testid="composer-picker">
      <input
        ref={input}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Search ${label.toLowerCase()}`}
        aria-label={`Search ${label}`}
      />
      <div className="picker-list">
        {filtered.length === 0 && <div className="picker-empty">No matches.</div>}
        {filtered.map((it) => (
          <button
            key={it.id}
            type="button"
            role="option"
            className="picker-item"
            data-testid={it.testId || `picker-item-${it.id}`}
            onClick={() => onSelect(it)}
          >
            <span>{it.title}</span>
            {it.subtitle && <small>{it.subtitle}</small>}
          </button>
        ))}
      </div>
    </div>
  );
}
