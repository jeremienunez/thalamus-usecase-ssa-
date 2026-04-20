import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowRight, CheckCircle2, RotateCcw, Save } from "lucide-react";
import { clsx } from "clsx";
import { useDraft } from "@/hooks/useDraft";
import { useUiStore } from "@/shared/ui/uiStore";
import { Drawer, DrawerSection } from "@/shared/ui/Drawer";
import { usePatchRuntimeConfig, useResetRuntimeConfig, type DomainPayload } from "./runtime-config";
import {
  actionLabelLong,
  coerceAutonomyConfig,
  coerceBudgetConfig,
  coerceOverrides,
  detectGuardrailMode,
  domainEditorBody,
  domainEditorTitle,
  fmtUsd,
  formatPreviewValue,
  guardrailSummary,
  summarizeDomain,
} from "./config-domain.service";
import { DomainEditor } from "./DomainEditor";
import { PreviewRow, PreviewTile, TreeLine } from "./config-primitives";

export function DomainCard({
  domain,
  payload,
}: {
  domain: string;
  payload: DomainPayload;
}) {
  const patch = usePatchRuntimeConfig();
  const reset = useResetRuntimeConfig();
  const configFocus = useUiStore((state) => state.configFocus);
  const clearConfigFocus = useUiStore((state) => state.clearConfigFocus);
  const openDrawer = useUiStore((state) => state.openDrawer);
  const drawerId = useUiStore((state) => state.drawerId);
  const { draft, errors, setErrors, dirty, diff, setField, replace } = useDraft(payload.value);
  const [flashFocused, setFlashFocused] = useState(false);
  const drawerToken = `cfg:${domain}`;
  const drawerOpen = drawerId === drawerToken;
  const anotherConfigDrawerOpen =
    drawerId !== null && drawerId.startsWith("cfg:") && drawerId !== drawerToken;
  const isFocused = drawerOpen || flashFocused || configFocus?.domain === domain;
  const summary = useMemo(() => summarizeDomain(domain, draft, payload.hasOverrides), [
    domain,
    draft,
    payload.hasOverrides,
  ]);

  useEffect(() => {
    if (configFocus?.domain !== domain) return;
    const scrollId = window.setTimeout(() => {
      document.getElementById(`domain-${domain}`)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      setFlashFocused(true);
      openDrawer(drawerToken);
      clearConfigFocus();
    }, 0);
    const resetId = window.setTimeout(() => {
      setFlashFocused(false);
    }, 2_000);
    return () => {
      window.clearTimeout(scrollId);
      window.clearTimeout(resetId);
    };
  }, [clearConfigFocus, configFocus, domain, drawerToken, openDrawer]);

  function onSave() {
    patch.mutate(
      { domain, patch: diff },
      {
        onError: (error) => setErrors({ __root: (error as Error).message }),
        onSuccess: (response) => replace(response.value),
      },
    );
  }

  function onReset() {
    reset.mutate(domain, {
      onSuccess: (response) => replace(response.value),
    });
  }

  return (
    <>
      <section
        id={`domain-${domain}`}
        className={clsx(
          "scroll-mt-12 rounded-xl border bg-panel transition-[opacity,border-color,box-shadow] duration-med ease-palantir",
          isFocused ? "border-cyan/70 shadow-[0_0_0_1px_rgba(34,211,238,0.2)]" : "border-hairline",
          anotherConfigDrawerOpen && "opacity-50",
        )}
      >
        <header className="flex items-center justify-between border-b border-hairline px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span className="mono text-label text-primary">{domain}</span>
              {dirty ? (
                <span className="label flex items-center gap-1 text-cyan">
                  <Save size={12} strokeWidth={1.5} />
                  UNSAVED
                </span>
              ) : payload.hasOverrides ? (
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
            {summary.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {summary.map((item) => (
                  <span
                    key={item}
                    className="border border-hairline px-2 py-0.5 mono text-caption text-dim"
                  >
                    {item}
                  </span>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => openDrawer(drawerToken)}
            disabled={anotherConfigDrawerOpen}
            className={clsx(
              "flex items-center gap-1 border border-cyan/40 px-3 py-1.5 mono text-caption transition-colors duration-fast ease-palantir",
              anotherConfigDrawerOpen
                ? "cursor-not-allowed text-dim opacity-40"
                : "cursor-pointer text-cyan hover:bg-cyan hover:text-black",
            )}
            aria-label={`Edit ${domain}`}
          >
            {dirty ? "Resume draft" : "Open editor"}
            <ArrowRight size={12} strokeWidth={1.5} />
          </button>
        </header>

        <div className="grid gap-4 px-4 py-4 xl:grid-cols-[minmax(0,1fr)_minmax(240px,280px)]">
          <DomainReadout domain={domain} value={draft} payload={payload} />
          {!drawerOpen && (
            <aside className="rounded-xl border border-hairline bg-base/30 p-4">
              <div className="label text-cyan">EDIT FLOW</div>
              <div className="mt-2 text-body text-primary break-words">{domainEditorTitle(domain)}</div>
              <p className="mt-1 text-caption text-muted whitespace-normal break-words">
                {domainEditorBody(domain)}
              </p>
              <div className="mt-4 space-y-2">
                <TreeLine active label="review current posture" />
                <TreeLine active label="edit in drawer" />
                <TreeLine
                  active={dirty}
                  label={dirty ? "save or reset pending draft" : "changes apply only after save"}
                />
              </div>
            </aside>
          )}
        </div>
      </section>

      {drawerOpen && (
        <Drawer
          title="CONFIG DOMAIN"
          subtitle={`${domain} · ${
            dirty ? "unsaved draft" : payload.hasOverrides ? "override active" : "defaults active"
          }`}
        >
          <div className="sticky top-0 z-10 border-b border-hairline bg-elevated px-4 py-3">
            <div className="flex items-center justify-end gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onReset}
                  disabled={(!payload.hasOverrides && !dirty) || reset.isPending}
                  className={clsx(
                    "flex min-h-11 items-center gap-1 border border-hairline px-3 py-2 text-caption",
                    payload.hasOverrides || dirty
                      ? "text-muted hover:text-primary hover:border-primary cursor-pointer"
                      : "cursor-not-allowed opacity-40",
                  )}
                >
                  <RotateCcw size={12} strokeWidth={1.5} />
                  Reset
                </button>
                <button
                  type="button"
                  onClick={onSave}
                  disabled={!dirty || patch.isPending}
                  className={clsx(
                    "flex min-h-11 items-center gap-1 border px-3 py-2 text-caption",
                    dirty && !patch.isPending
                      ? "border-cyan text-cyan hover:bg-cyan hover:text-black cursor-pointer"
                      : "cursor-not-allowed border-hairline opacity-40",
                  )}
                >
                  <Save size={12} strokeWidth={1.5} />
                  {patch.isPending ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>

          {errors.__root && (
            <div className="border-b border-hot/40 bg-hot/10 px-4 py-2 text-caption text-hot">
              {errors.__root}
            </div>
          )}

          {summary.length > 0 && (
            <DrawerSection title="CURRENT POSTURE">
              <div className="flex flex-wrap gap-1">
                {summary.map((item) => (
                  <span
                    key={item}
                    className="border border-hairline px-2 py-0.5 mono text-caption text-dim"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </DrawerSection>
          )}

          <DomainEditor
            domain={domain}
            payload={payload}
            draft={draft}
            errors={errors}
            setField={setField}
          />
        </Drawer>
      )}
    </>
  );
}

function DomainReadout({
  domain,
  value,
  payload,
}: {
  domain: string;
  value: Record<string, unknown>;
  payload: DomainPayload;
}) {
  if (domain === "console.autonomy") {
    const cfg = coerceAutonomyConfig(value);
    const cadence = cfg.intervalSec === 90 ? "Watch" : cfg.intervalSec === 45 ? "Balanced" : cfg.intervalSec === 20 ? "Hot" : "Custom";
    const mode = detectGuardrailMode(cfg);
    return (
      <div className="grid gap-3 md:grid-cols-3">
        <PreviewTile title="Cadence" value={`${cfg.intervalSec}s`} detail={`${cadence} wake cycle`} />
        <PreviewTile
          title="Loop path"
          value={cfg.rotation.map(actionLabelLong).join(" → ")}
          detail={cfg.rotation.map(actionLabelLong).join(" → ")}
        />
        <PreviewTile
          title="Guardrails"
          value={guardrailSummary(cfg, mode)}
          detail={cfg.stopOnBudgetExhausted ? "halts when a cap is reached" : "tracks spend without stopping"}
        />
      </div>
    );
  }

  if (domain === "thalamus.budgets") {
    const cfg = coerceBudgetConfig(value);
    return (
      <div className="grid gap-3 md:grid-cols-3">
        {([
          ["simple", cfg.simple, "text-cold"],
          ["moderate", cfg.moderate, "text-cyan"],
          ["deep", cfg.deep, "text-amber"],
        ] as const).map(([level, row, tone]) => (
          <PreviewTile
            key={level}
            title={String(level).toUpperCase()}
            value={`${fmtUsd(row.maxCost)} · ${row.maxIterations} iter`}
            detail={`conf ${row.confidenceTarget.toFixed(2)} · cov ${row.coverageTarget.toFixed(2)} · findings ${row.minFindingsToStop}`}
            tone={tone}
          />
        ))}
      </div>
    );
  }

  if (domain === "thalamus.cortex") {
    const overrides = coerceOverrides(value.overrides);
    const active = Object.keys(overrides);
    return (
      <div className="grid gap-3 md:grid-cols-2">
        <PreviewTile
          title="Overrides"
          value={active.length === 0 ? "none" : `${active.length} active`}
          detail={active.length === 0 ? "shared defaults are active" : active.slice(0, 4).join(" · ")}
        />
        <PreviewTile
          title="Safe path"
          value="defaults → budgets → exception"
          detail="Use per-cortex overrides only when one lane is the clear outlier."
        />
      </div>
    );
  }

  const keys = Object.keys(payload.schema).slice(0, 6);
  return (
    <div className="rounded-xl border border-hairline bg-base/30 p-4">
      <div className="label text-dim">LIVE FIELDS</div>
      <div className="mt-3 space-y-2">
        {keys.map((key) => (
          <PreviewRow key={key} label={key} value={formatPreviewValue(value[key])} />
        ))}
        {Object.keys(payload.schema).length > keys.length && (
          <div className="mono text-caption text-dim">
            +{Object.keys(payload.schema).length - keys.length} more field
            {Object.keys(payload.schema).length - keys.length === 1 ? "" : "s"} in editor
          </div>
        )}
      </div>
    </div>
  );
}
