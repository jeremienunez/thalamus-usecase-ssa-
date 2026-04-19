import { MODEL_PRESETS } from "@/features/config/runtime-config";

const INPUT_CLASS =
  "w-full bg-black/40 border border-hairline px-2 py-1 mono text-body text-primary focus:border-cyan focus:outline-none";

type Props = {
  value: string;
  onChange: (v: string) => void;
};

/** Provider-grouped model dropdown + free-form fallback for custom ids. */
export function ModelSelect({ value, onChange }: Props) {
  const isPreset = MODEL_PRESETS.some((p) => p.value === value);

  const byProvider = MODEL_PRESETS.reduce<Record<string, typeof MODEL_PRESETS>>(
    (acc, p) => {
      (acc[p.provider] ??= []).push(p);
      return acc;
    },
    {},
  );

  return (
    <div className="space-y-1">
      <select
        className={INPUT_CLASS}
        value={isPreset ? value : "__custom"}
        onChange={(e) => {
          if (e.target.value !== "__custom") onChange(e.target.value);
        }}
      >
        {Object.entries(byProvider).map(([provider, presets]) => (
          <optgroup key={provider} label={provider.toUpperCase()}>
            {presets.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </optgroup>
        ))}
        <option value="__custom">— custom (type below) —</option>
      </select>
      {!isPreset && (
        <input
          type="text"
          className={INPUT_CLASS}
          value={value}
          placeholder="custom model id"
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
