import { clsx } from "clsx";
import {
  fieldKindOf,
  fieldChoices,
  type FieldSpec,
} from "@/features/config/runtime-config";
import { FieldInput } from "./FieldInput";

type Props = {
  keyName: string;
  spec: FieldSpec;
  value: unknown;
  defaultValue: unknown;
  onChange: (v: unknown) => void;
  error?: string;
  unsupported?: boolean;
  unsupportedReason?: string;
};

/** One labelled form row: key + kind badge on the left, input mid, status chip right. */
export function FieldRow({
  keyName,
  spec,
  value,
  defaultValue,
  onChange,
  error,
  unsupported,
  unsupportedReason,
}: Props) {
  const kind = fieldKindOf(spec);
  const choices = fieldChoices(spec);
  const isDefault = JSON.stringify(value) === JSON.stringify(defaultValue);
  const kindLabel = choices && kind === "string" ? "enum" : kind;

  return (
    <div
      className={clsx("px-4 py-3", unsupported && "opacity-40")}
      title={unsupportedReason}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mono text-body text-primary break-words" title={keyName}>
            {keyName}
          </div>
          <div className="label text-muted">
            {kindLabel}
            {unsupported && <span className="ml-1 text-amber">· N/A</span>}
          </div>
        </div>
        {!isDefault && (
          <span className="shrink-0 pt-1 text-right label text-cyan">
            MODIFIED
          </span>
        )}
      </div>

      <div className="mt-3 min-w-0">
        <FieldInput
          kind={kind}
          choices={choices}
          fieldName={keyName}
          value={value}
          onChange={onChange}
        />
        {error && <div className="mt-1 text-caption text-hot">{error}</div>}
        {unsupportedReason && (
          <div className="mt-1 text-caption text-muted">{unsupportedReason}</div>
        )}
      </div>
    </div>
  );
}
