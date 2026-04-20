import { clsx } from "clsx";
import { useUiStore } from "@/shared/ui/uiStore";
import { useRuntimeConfigList, type DomainPayload } from "./runtime-config";
import { compareDomains } from "./config-domain.service";
import { GuideCard } from "./config-primitives";
import { DomainCard } from "./DomainCard";

export function ConfigEntry() {
  const { data, isLoading, error } = useRuntimeConfigList();
  const drawerId = useUiStore((state) => state.drawerId);
  const configDrawerOpen = drawerId !== null && drawerId.startsWith("cfg:");

  if (isLoading) {
    return <div className="p-6 text-muted">Loading runtime config…</div>;
  }
  if (error) {
    return <div className="p-6 text-hot">Error: {(error as Error).message}</div>;
  }
  if (!data) return null;

  const grouped = Object.entries(data.domains).reduce<Record<string, Array<[string, DomainPayload]>>>(
    (acc, [domain, payload]) => {
      const ns = domain.split(".")[0] ?? "other";
      (acc[ns] ??= []).push([domain, payload]);
      return acc;
    },
    {},
  );
  const nsOrder = ["console", "thalamus", "sim", "sweep"];
  const orderedNs = [
    ...nsOrder.filter((ns) => grouped[ns]),
    ...Object.keys(grouped).filter((ns) => !nsOrder.includes(ns)).sort(),
  ];
  const totalDomains = Object.keys(data.domains).length;
  const liveOverrides = Object.values(data.domains).filter((domain) => domain.hasOverrides).length;

  return (
    <div className="h-full overflow-y-auto">
      <div
        className={clsx(
          "mx-auto max-w-6xl p-6 space-y-8 transition-[padding] duration-med ease-palantir",
          configDrawerOpen && "xl:pr-[452px]",
        )}
      >
        <div>
          <h1 className="text-xl font-semibold text-primary">Runtime configuration</h1>
          <p className="mt-1 text-caption text-muted">
            Adjust autonomy cadence, research budgets, and advanced overrides for the live stack.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <GuideCard
            eyebrow="01"
            title="Pick the operating path"
            body="Use the guided cards for autonomy and budget posture first. They’re the safe levers."
            meta={`${totalDomains} live domains`}
          />
          <GuideCard
            eyebrow="02"
            title="Tune hard limits"
            body="Cadence, spend ceilings, and research depth should stay legible in the guided cards."
            meta={`${liveOverrides} override${liveOverrides === 1 ? "" : "s"} active`}
          />
          <GuideCard
            eyebrow="03"
            title="Use raw overrides last"
            body="Per-cortex advanced overrides remain available, but only as an escape hatch after the guided controls."
            meta="decision tree first"
          />
        </div>

        {orderedNs.map((ns) => (
          <section key={ns} className="space-y-3">
            <h2 className="label text-primary border-b border-hairline pb-1">{ns.toUpperCase()}</h2>
            {grouped[ns]!
              .sort(([a], [b]) => compareDomains(a, b))
              .map(([domain, payload]) => (
                <DomainCard key={domain} domain={domain} payload={payload} />
              ))}
          </section>
        ))}
      </div>
    </div>
  );
}
