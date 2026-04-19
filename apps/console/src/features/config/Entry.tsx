import { RotateCcw, Save, AlertCircle, CheckCircle2 } from "lucide-react";
import { clsx } from "clsx";
import { useDraft } from "@/hooks/useDraft";
import {
  useRuntimeConfigList,
  usePatchRuntimeConfig,
  useResetRuntimeConfig,
  MODEL_PRESETS,
  MODEL_FIELD_SUPPORT_MAP,
  type DomainPayload,
} from "@/features/config/runtime-config";
import { FieldRow } from "./FieldRow";

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
  const patch = usePatchRuntimeConfig();
  const reset = useResetRuntimeConfig();
  const { draft, errors, setErrors, dirty, diff, setField, replace } = useDraft(
    payload.value,
  );

  function onSave() {
    patch.mutate(
      { domain, patch: diff },
      {
        onError: (err) => setErrors({ __root: (err as Error).message }),
        onSuccess: (resp) => replace(resp.value),
      },
    );
  }

  function onReset() {
    reset.mutate(domain, {
      onSuccess: (resp) => replace(resp.value),
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
                setField("model", v);
                setField("provider", p.provider);
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

