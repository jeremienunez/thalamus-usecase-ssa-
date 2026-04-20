import { useState } from "react";

type Props = {
  value: string[];
  choices?: readonly string[] | null;
  onChange: (v: string[]) => void;
};

/** Tag-input: type a value, press Enter/comma to push it; × removes. */
export function StringArrayInput({ value, choices, onChange }: Props) {
  const [pending, setPending] = useState("");

  function addValue(next: string) {
    const trimmed = next.trim();
    if (!trimmed) return;
    if (value.includes(trimmed)) {
      return;
    }
    onChange([...value, trimmed]);
  }

  function commit() {
    const trimmed = pending.trim();
    if (!trimmed) return;
    addValue(trimmed);
    setPending("");
  }

  const suggestions = (choices ?? []).filter((choice) => !value.includes(choice));

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
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {suggestions.map((choice) => (
            <button
              key={choice}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                addValue(choice);
                setPending("");
              }}
              className="border border-hairline px-2 py-0.5 mono text-caption text-muted transition-colors duration-fast ease-palantir hover:border-cyan hover:text-cyan cursor-pointer"
            >
              + {choice}
            </button>
          ))}
        </div>
      )}
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
