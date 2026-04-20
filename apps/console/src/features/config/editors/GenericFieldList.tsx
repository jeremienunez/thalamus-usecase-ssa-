import {
  MODEL_FIELD_SUPPORT_MAP,
  MODEL_PRESETS,
} from "@interview/shared/config";
import { FieldRow } from "../FieldRow";
import type { DomainEditorLeafProps } from "./types";

export function GenericFieldList({
  payload,
  draft,
  errors,
  setField,
}: DomainEditorLeafProps) {
  return (
    <div className="divide-y divide-hairline/50">
      {Object.entries(payload.schema).map(([key, spec]) => {
        const selectedModel = typeof draft.model === "string" ? draft.model : "";
        const preset = MODEL_PRESETS.find((item) => item.value === selectedModel);
        const supportKey = MODEL_FIELD_SUPPORT_MAP[key as keyof typeof MODEL_FIELD_SUPPORT_MAP];
        const unsupported = preset && supportKey ? preset.supports[supportKey] !== true : false;
        const handleChange = (value: unknown) => {
          if (key === "model" && typeof value === "string") {
            const nextPreset = MODEL_PRESETS.find((item) => item.value === value);
            if (nextPreset && "provider" in payload.schema) {
              setField("model", value);
              setField("provider", nextPreset.provider);
              return;
            }
          }
          setField(key, value);
        };
        return (
          <FieldRow
            key={key}
            keyName={key}
            spec={spec}
            value={draft[key]}
            defaultValue={payload.defaults[key]}
            onChange={handleChange}
            error={errors[key]}
            unsupported={unsupported}
            unsupportedReason={
              unsupported ? `Ignored by ${preset?.label ?? selectedModel}` : undefined
            }
          />
        );
      })}
    </div>
  );
}
