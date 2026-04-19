import { useState } from "react";

type Props = {
  value: string[];
  onChange: (v: string[]) => void;
};

/** Tag-input: type a value, press Enter/comma to push it; × removes. */
export function StringArrayInput({ value, onChange }: Props) {
  const [pending, setPending] = useState("");

  function commit() {
    const trimmed = pending.trim();
    if (!trimmed) return;
    if (value.includes(trimmed)) {
      setPending("");
      return;
    }
    onChange([...value, trimmed]);
    setPending("");
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        {value.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 border border-cyan/50 bg-cyan/10 px-2 py-0.5 mono text-caption text-cyan"
          >
            {v}
            <button
              type="button"
              onClick={() => onChange(value.filter((x) => x !== v))}
              className="hover:text-hot cursor-pointer"
              aria-label={`Remove ${v}`}
            >
              ×
            </button>
          </span>
        ))}
        {value.length === 0 && <span className="label text-muted">empty</span>}
      </div>
      <input
        type="text"
        className="w-full bg-black/40 border border-hairline px-2 py-1 mono text-body text-primary focus:border-cyan focus:outline-none"
        value={pending}
        placeholder="type and press Enter to add…"
        onChange={(e) => setPending(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
      />
    </div>
  );
}
