import { ModelSelect } from "./ModelSelect";
import { StringArrayInput } from "./StringArrayInput";
import { JsonTextarea } from "./JsonTextarea";

const INPUT_CLASS =
  "w-full bg-black/40 border border-hairline px-2 py-1 mono text-body text-primary focus:border-cyan focus:outline-none";

type Props = {
  kind: string;
  choices: readonly string[] | null;
  fieldName: string;
  value: unknown;
  onChange: (v: unknown) => void;
};

/**
 * Dispatcher: routes a runtime-config field to the right input widget based
 * on its declared kind (primitive, enum, array, json, or the special
 * `model` override).
 */
export function FieldInput({ kind, choices, fieldName, value, onChange }: Props) {
  if (fieldName === "model") {
    return (
      <ModelSelect
        value={typeof value === "string" ? value : ""}
        onChange={onChange}
      />
    );
  }

  if (choices) {
    return (
      <select
        className={INPUT_CLASS}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
      >
        {choices.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    );
  }

  switch (kind) {
    case "string":
      return (
        <input
          type="text"
          className={INPUT_CLASS}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "number":
      return (
        <input
          type="number"
          className={INPUT_CLASS}
          value={typeof value === "number" ? value : 0}
          onChange={(e) => onChange(Number(e.target.value))}
          step={fieldName.includes("Pct") ? 0.05 : undefined}
        />
      );
    case "boolean":
      return (
        <label className="flex cursor-pointer items-center gap-2 text-body">
          <input
            type="checkbox"
            className="accent-cyan"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className="mono text-caption text-muted">
            {value === true ? "true" : "false"}
          </span>
        </label>
      );
    case "string[]":
      return (
        <StringArrayInput
          value={Array.isArray(value) ? (value as string[]) : []}
          onChange={onChange}
        />
      );
    case "json":
      return <JsonTextarea value={value} onChange={onChange} />;
    default:
      return (
        <div className="mono text-caption text-muted">
          unsupported kind: {kind}
        </div>
      );
  }
}
