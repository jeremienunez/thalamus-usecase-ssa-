import { useState, useMemo } from "react";
import { RotateCcw, Save, AlertCircle, CheckCircle2 } from "lucide-react";
import { clsx } from "clsx";
import {
  useRuntimeConfigList,
  usePatchRuntimeConfig,
  useResetRuntimeConfig,
  fieldKindOf,
  fieldChoices,
  MODEL_PRESETS,
  MODEL_FIELD_SUPPORT_MAP,
  type DomainPayload,
  type FieldSpec,
} from "@/lib/runtime-config";

export function ConfigEntry() {
  const { data, isLoading, error } = useRuntimeConfigList();

  if (isLoading) {
    return (
      <div className="p-6 text-muted">Loading runtime config…</div>
    );
  }
  if (error) {
    return (
      <div className="p-6 text-hot">
        Error: {(error as Error).message}
      </div>
    );
  }
  if (!data) return null;

  // Group by package namespace (thalamus.* / sim.* / sweep.*)
  const grouped = Object.entries(data.domains).reduce<
    Record<string, Array<[string, DomainPayload]>>
  >((acc, [domain, payload]) => {
    const ns = domain.split(".")[0] ?? "other";
    (acc[ns] ??= []).push([domain, payload]);
    return acc;
  }, {});
  const nsOrder = ["thalamus", "sim", "sweep"];
  const orderedNs = [
    ...nsOrder.filter((ns) => grouped[ns]),
    ...Object.keys(grouped).filter((ns) => !nsOrder.includes(ns)).sort(),
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl p-6 space-y-8">
        <div>
          <h1 className="text-xl font-semibold text-primary">
            Runtime configuration
          </h1>
          <p className="mt-1 text-caption text-muted">
            Single polymorphic endpoint (<code className="mono">/api/config/runtime/:domain</code>).
            Changes apply immediately — kernel reads fresh on every call, no redeploy.
          </p>
        </div>

        {orderedNs.map((ns) => (
          <section key={ns} className="space-y-3">
            <h2 className="label text-primary border-b border-hairline pb-1">
              {ns.toUpperCase()}
            </h2>
            {grouped[ns]!
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([domain, payload]) => (
                <DomainCard
                  key={domain}
                  domain={domain}
                  payload={payload}
                />
              ))}
          </section>
        ))}
      </div>
    </div>
  );
}

function DomainCard({
  domain,
  payload,
}: {
  domain: string;
  payload: DomainPayload;
}) {
  const [draft, setDraft] = useState<Record<string, unknown>>(payload.value);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const patch = usePatchRuntimeConfig();
  const reset = useResetRuntimeConfig();

  const dirty = useMemo(() => {
    for (const k of Object.keys(payload.schema)) {
      if (
        JSON.stringify(draft[k]) !== JSON.stringify(payload.value[k])
      ) {
        return true;
      }
    }
    return false;
  }, [draft, payload.schema, payload.value]);

  function setField(key: string, value: unknown) {
    setDraft({ ...draft, [key]: value });
    if (errors[key]) {
      const next = { ...errors };
      delete next[key];
      setErrors(next);
    }
  }

  function onSave() {
    const diff: Record<string, unknown> = {};
    for (const k of Object.keys(payload.schema)) {
      if (
        JSON.stringify(draft[k]) !== JSON.stringify(payload.value[k])
      ) {
        diff[k] = draft[k];
      }
    }
    patch.mutate(
      { domain, patch: diff },
      {
        onError: (err) => {
          setErrors({ __root: (err as Error).message });
        },
        onSuccess: (resp) => {
          setDraft(resp.value);
          setErrors({});
        },
      },
    );
  }

  function onReset() {
    reset.mutate(domain, {
      onSuccess: (resp) => {
        setDraft(resp.value);
        setErrors({});
      },
    });
  }

  return (
    <section
      id={`domain-${domain}`}
      className="scroll-mt-12 border border-hairline bg-panel"
    >
      <header className="flex items-center justify-between border-b border-hairline px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="mono text-label text-primary">{domain}</span>
          {payload.hasOverrides ? (
            <span className="label flex items-center gap-1 text-amber">
              <AlertCircle size={12} strokeWidth={1.5} />
              OVERRIDE ACTIVE
            </span>
          ) : (
            <span className="label flex items-center gap-1 text-muted">
              <CheckCircle2 size={12} strokeWidth={1.5} />
              DEFAULTS
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onReset}
            disabled={!payload.hasOverrides || reset.isPending}
            className={clsx(
              "flex items-center gap-1 border border-hairline px-2 py-1 text-caption",
              payload.hasOverrides
                ? "text-muted hover:text-primary hover:border-primary cursor-pointer"
                : "cursor-not-allowed opacity-40",
            )}
          >
            <RotateCcw size={12} strokeWidth={1.5} />
            Reset
          </button>
          <button
            onClick={onSave}
            disabled={!dirty || patch.isPending}
            className={clsx(
              "flex items-center gap-1 border px-2 py-1 text-caption",
              dirty && !patch.isPending
                ? "border-cyan text-cyan hover:bg-cyan hover:text-black cursor-pointer"
                : "cursor-not-allowed border-hairline opacity-40",
            )}
          >
            <Save size={12} strokeWidth={1.5} />
            {patch.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      {errors.__root && (
        <div className="border-b border-hot/40 bg-hot/10 px-4 py-2 text-caption text-hot">
          {errors.__root}
        </div>
      )}

      <div className="divide-y divide-hairline/50">
        {Object.entries(payload.schema).map(([key, spec]) => {
          const selectedModel =
            typeof draft.model === "string" ? draft.model : "";
          const preset = MODEL_PRESETS.find((p) => p.value === selectedModel);
          const supportKey = MODEL_FIELD_SUPPORT_MAP[key];
          const unsupported =
            preset && supportKey ? preset.supports[supportKey] !== true : false;
          // Selecting a known model auto-syncs the provider field when both
          // fields exist in the same domain (e.g. thalamus.planner). Prevents
          // the "MiniMax-M2.7 sent to Kimi" footgun.
          const handleChange = (v: unknown) => {
            if (key === "model" && typeof v === "string") {
              const p = MODEL_PRESETS.find((x) => x.value === v);
              if (p && "provider" in payload.schema) {
                setDraft({ ...draft, model: v, provider: p.provider });
                return;
              }
            }
            setField(key, v);
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
                unsupported
                  ? `Ignored by ${preset?.label ?? selectedModel}`
                  : undefined
              }
            />
          );
        })}
      </div>
    </section>
  );
}

function FieldRow({
  keyName,
  spec,
  value,
  defaultValue,
  onChange,
  error,
  unsupported,
  unsupportedReason,
}: {
  keyName: string;
  spec: FieldSpec;
  value: unknown;
  defaultValue: unknown;
  onChange: (v: unknown) => void;
  error?: string;
  unsupported?: boolean;
  unsupportedReason?: string;
}) {
  const kind = fieldKindOf(spec);
  const choices = fieldChoices(spec);
  const isDefault =
    JSON.stringify(value) === JSON.stringify(defaultValue);

  return (
    <div
      className={clsx(
        "grid grid-cols-[240px_1fr_90px] items-start gap-4 px-4 py-3",
        unsupported && "opacity-40",
      )}
      title={unsupportedReason}
    >
      <div className="min-w-0 pt-1">
        <div className="mono text-body text-primary truncate" title={keyName}>
          {keyName}
        </div>
        <div className="label text-muted">
          {choices ? "enum" : kind}
          {unsupported && <span className="ml-1 text-amber">· N/A</span>}
        </div>
      </div>
      <div className="min-w-0">
        <FieldInput
          kind={kind}
          choices={choices}
          fieldName={keyName}
          value={value}
          onChange={onChange}
        />
        {error && (
          <div className="mt-1 text-caption text-hot">{error}</div>
        )}
        {unsupportedReason && (
          <div className="mt-1 text-caption text-muted">
            {unsupportedReason}
          </div>
        )}
      </div>
      <div className="pt-1 text-right">
        <span
          className={clsx(
            "label",
            isDefault ? "text-muted" : "text-cyan",
          )}
        >
          {isDefault ? "DEFAULT" : "MODIFIED"}
        </span>
      </div>
    </div>
  );
}

function FieldInput({
  kind,
  choices,
  fieldName,
  value,
  onChange,
}: {
  kind: string;
  choices: readonly string[] | null;
  fieldName: string;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const baseInputClass =
    "w-full bg-black/40 border border-hairline px-2 py-1 mono text-body text-primary focus:border-cyan focus:outline-none";

  // Model dropdown with rich labels (overrides generic choices)
  if (fieldName === "model") {
    return (
      <ModelSelect
        value={typeof value === "string" ? value : ""}
        onChange={onChange}
      />
    );
  }

  // Generic enum (provider, etc.)
  if (choices) {
    return (
      <select
        className={baseInputClass}
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
          className={baseInputClass}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "number":
      return (
        <input
          type="number"
          className={baseInputClass}
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
      return (
        <JsonTextarea
          value={value}
          onChange={onChange}
        />
      );
    default:
      return (
        <div className="mono text-caption text-muted">
          unsupported kind: {kind}
        </div>
      );
  }
}

function ModelSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const baseInputClass =
    "w-full bg-black/40 border border-hairline px-2 py-1 mono text-body text-primary focus:border-cyan focus:outline-none";
  const isPreset = MODEL_PRESETS.some((p) => p.value === value);

  // Group by provider
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
        className={baseInputClass}
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
          className={baseInputClass}
          value={value}
          placeholder="custom model id"
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

function StringArrayInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
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
        {value.length === 0 && (
          <span className="label text-muted">empty</span>
        )}
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

function JsonTextarea({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const [raw, setRaw] = useState(() => JSON.stringify(value, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);

  function commit(text: string) {
    try {
      const parsed = text.trim() === "" ? {} : JSON.parse(text);
      setParseError(null);
      onChange(parsed);
    } catch (err) {
      setParseError((err as Error).message);
    }
  }

  return (
    <div className="space-y-1">
      <textarea
        className="w-full min-h-[100px] bg-black/40 border border-hairline px-2 py-1 mono text-caption text-primary focus:border-cyan focus:outline-none resize-y"
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
          commit(e.target.value);
        }}
      />
      {parseError && (
        <div className="text-caption text-hot">
          JSON: {parseError}
        </div>
      )}
    </div>
  );
}
