import { Drawer, DrawerSection, KV } from "@/shared/ui/Drawer";
import { Measure } from "@/shared/ui/Measure";
import { useUiStore } from "@/shared/ui/uiStore";
import { clsx } from "clsx";
import {
  fmtAltitudeKm,
  fmtDeg,
  fmtPc,
  fmtPcCompact,
} from "@/shared/types/units";
import type { ConjunctionDTO, SatelliteDTO } from "@/shared/types";

export function OpsDrawer({
  satellite,
  conjunctions,
}: {
  satellite: SatelliteDTO | null;
  conjunctions: ConjunctionDTO[];
}) {
  const drawerId = useUiStore((s) => s.drawerId);
  if (!drawerId || !satellite) {
    return <Drawer title="SATELLITE" subtitle="select a node">{null}</Drawer>;
  }

  return (
    <Drawer title="SATELLITE" subtitle={`${satellite.name} · NORAD ${satellite.noradId}`}>
      <DrawerSection title="IDENTITY">
        <KV k="Name" v={satellite.name} />
        <KV k="NORAD" v={satellite.noradId} mono />
        <KV k="Operator" v={satellite.operator} />
        <KV k="Country" v={satellite.country} mono />
        <KV
          k="Mass"
          v={
            <span className="mono tabular-nums">
              {satellite.massKg.toLocaleString(undefined, {
                maximumFractionDigits: 0,
              })}
              <span className="ml-1 text-dim">kg</span>
            </span>
          }
        />
        <KV
          k="Declared"
          v={
            <span
              className={clsx(
                "mono text-caption",
                satellite.classificationTier === "restricted"
                  ? "text-amber"
                  : satellite.classificationTier === "sensitive"
                    ? "text-cyan"
                    : "text-cold",
              )}
            >
              {satellite.classificationTier === "restricted"
                ? "UNDISCLOSED"
                : satellite.classificationTier === "sensitive"
                  ? "LIMITED"
                  : "OPEN"}
            </span>
          }
        />
      </DrawerSection>

      <DrawerSection title="ORBITAL ELEMENTS">
        <KV k="Regime" v={<span className="mono text-cyan">{satellite.regime}</span>} />
        <KV k="SMA" v={<Measure value={fmtAltitudeKm(satellite.semiMajorAxisKm)} />} />
        <KV k="Altitude" v={<Measure value={fmtAltitudeKm(satellite.semiMajorAxisKm - 6371)} />} />
        <KV k="Inc" v={<Measure value={fmtDeg(satellite.inclinationDeg)} />} />
        <KV k="Ecc" v={<span className="mono tabular-nums">{satellite.eccentricity.toFixed(4)}</span>} />
        <KV k="RAAN" v={<Measure value={fmtDeg(satellite.raanDeg)} />} />
        <KV k="Arg ω" v={<Measure value={fmtDeg(satellite.argPerigeeDeg)} />} />
        <KV k="Mean anom" v={<Measure value={fmtDeg(satellite.meanAnomalyDeg)} />} />
        <KV
          k="Mean motion"
          v={
            <span className="mono tabular-nums">
              {satellite.meanMotionRevPerDay.toFixed(4)}
              <span className="ml-1 text-dim">rev/day</span>
            </span>
          }
        />
        <KV k="Epoch" v={satellite.epoch.slice(0, 19) + "Z"} mono />
      </DrawerSection>

      {satellite.tleLine1 && satellite.tleLine2 && (
        <DrawerSection title="TLE">
          <pre className="mono overflow-x-auto whitespace-pre text-nano text-numeric leading-tight">
            {satellite.tleLine1}
            {"\n"}
            {satellite.tleLine2}
          </pre>
        </DrawerSection>
      )}

      <DrawerSection title={`CONJUNCTIONS (${conjunctions.length})`}>
        {conjunctions.length === 0 && (
          <div className="text-caption text-dim">No active events for this asset.</div>
        )}
        {conjunctions.slice(0, 8).map((c) => (
          <div
            key={c.id}
            className="grid grid-cols-[1fr_auto] items-baseline gap-2 border-b border-hairline py-1 last:border-0"
          >
            <span className="truncate text-caption text-numeric">
              {c.primaryId === satellite.id ? c.secondaryName : c.primaryName}
            </span>
            <span
              className={clsx(
                "mono text-caption tabular-nums",
                c.probabilityOfCollision >= 1e-4
                  ? "text-hot"
                  : c.probabilityOfCollision >= 1e-6
                    ? "text-amber"
                    : "text-muted",
              )}
            >
              Pc <span className="text-dim">{fmtPc(c.probabilityOfCollision)[0]}</span>
            </span>
          </div>
        ))}
      </DrawerSection>

      {typeof satellite.opacityScore === "number" && satellite.opacityScore > 0 && (
        <DrawerSection title="PUBLIC DATA GAPS">
          <KV
            k="Gap index"
            v={
              <span
                className={clsx(
                  "mono text-caption",
                  satellite.opacityScore >= 0.9
                    ? "text-amber"
                    : satellite.opacityScore >= 0.7
                      ? "text-cyan"
                      : "text-cold",
                )}
              >
                {satellite.opacityScore.toFixed(2)}
              </span>
            }
          />
          {satellite.opacityDeficitReasons?.map((reason, i) => (
            <div
              key={i}
              className="flex items-baseline gap-2 border-l-2 border-cyan/30 pl-2 py-0.5 text-caption text-numeric"
            >
              <span className="text-cyan/70">·</span>
              <span>{reason}</span>
            </div>
          ))}
          <div className="mt-1 text-label text-dim">
            public-source evidence · reviewer validates before promotion
          </div>
        </DrawerSection>
      )}

      <DrawerSection title="PROVENANCE">
        <div className="flex gap-2">
          <span className="inline-flex h-5 items-center border border-osint/50 bg-osint/10 px-2 text-label text-osint">
            OSINT
          </span>
          {conjunctions.some((c) => c.covarianceQuality === "HIGH") && (
            <span className="inline-flex h-5 items-center border border-field/50 bg-field/10 px-2 text-label text-field">
              σHIGH
            </span>
          )}
        </div>
      </DrawerSection>
    </Drawer>
  );
}
