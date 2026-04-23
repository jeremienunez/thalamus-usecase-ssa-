import { Drawer, DrawerSection, KV } from "@/shared/ui/Drawer";
import { Measure } from "@/shared/ui/Measure";
import { useUiStore } from "@/shared/ui/uiStore";
import { clsx } from "clsx";
import {
  fmtAltitudeKm,
  fmtDeg,
  fmtPc,
  fmtRangeKm,
  fmtPcCompact,
  fmtPct,
  fmtVelocity,
} from "@/shared/types/units";
import type {
  ConjunctionDto,
  PayloadDto,
  SatelliteDto,
  TelemetryDto,
} from "@/dto/http";
import { useSatellitePayloadsQuery } from "@/usecases/useSatellitePayloadsQuery";

export function OpsDrawer({
  satellite,
  conjunctions,
  selectedConjunctionId = null,
}: {
  satellite: SatelliteDto | null;
  conjunctions: ConjunctionDto[];
  selectedConjunctionId?: number | null;
}) {
  const drawerId = useUiStore((s) => s.drawerId);
  const { data: payloadsData } = useSatellitePayloadsQuery(
    satellite?.id ?? null,
  );
  if (!drawerId || !satellite) {
    return <Drawer title="SATELLITE" subtitle="select a node">{null}</Drawer>;
  }
  const payloads = payloadsData?.items ?? [];
  const orderedConjunctions = [...conjunctions].sort((a, b) => {
    if (a.id === selectedConjunctionId) return -1;
    if (b.id === selectedConjunctionId) return 1;
    return b.probabilityOfCollision - a.probabilityOfCollision;
  });

  return (
    <Drawer title="SATELLITE" subtitle={`${satellite.name} · NORAD ${satellite.noradId}`}>
      {(satellite.photoUrl || satellite.shortDescription) && (
        <DrawerSection title="BRIEF">
          {satellite.photoUrl && (
            <img
              src={satellite.photoUrl}
              alt={satellite.name}
              className="mb-2 h-32 w-full border border-hairline object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          )}
          {satellite.shortDescription && (
            <p className="text-caption text-numeric leading-snug">
              {satellite.shortDescription}
            </p>
          )}
        </DrawerSection>
      )}

      <DrawerSection title="IDENTITY">
        <KV k="Name" v={satellite.name} />
        <KV k="NORAD" v={satellite.noradId} mono />
        <KV k="Operator" v={satellite.operator} />
        <KV k="Country" v={satellite.country} mono />
        {satellite.objectClass && (
          <KV
            k="Class"
            v={<span className="mono text-caption uppercase">{satellite.objectClass}</span>}
          />
        )}
        {satellite.platformClass && (
          <KV
            k="Platform"
            v={<span className="mono text-caption uppercase">{satellite.platformClass}</span>}
          />
        )}
        {satellite.busName && (
          <KV
            k="Bus"
            v={
              <span className="mono text-caption">
                {satellite.busName}
                {satellite.busGeneration && (
                  <span className="ml-1 text-dim">· {satellite.busGeneration}</span>
                )}
              </span>
            }
          />
        )}
        {typeof satellite.launchYear === "number" && (
          <KV
            k="Launched"
            v={<span className="mono tabular-nums">{satellite.launchYear}</span>}
          />
        )}
        <KV
          k="Mass"
          v={
            <span className="mono tabular-nums">
              {typeof satellite.massKg === "number"
                ? (
                    <>
                      {satellite.massKg.toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })}
                      <span className="ml-1 text-dim">kg</span>
                    </>
                  )
                : "NON COMMUNIQUE"}
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

      {satellite.telemetry && hasAnyTelemetry(satellite.telemetry) && (
        <DrawerSection title="HEALTH · 14D">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <HealthCell label="POWER" value={fmtWatts(satellite.telemetry.powerDraw)} />
            <HealthCell label="THERMAL" value={fmtThermal(satellite.telemetry.thermalMargin)} />
            <HealthCell label="POINTING" value={fmtNumber(satellite.telemetry.pointingAccuracy, "°", 3)} />
            <HealthCell label="SLEW" value={fmtNumber(satellite.telemetry.attitudeRate, "°/s", 2)} />
            <HealthCell label="LINK" value={fmtNumber(satellite.telemetry.linkBudget, "dBW", 1)} />
            <HealthCell label="DATA" value={fmtNumber(satellite.telemetry.dataRate, "Mbps", 1)} />
            <HealthCell label="DUTY" value={fmtRatioPct(satellite.telemetry.payloadDuty)} />
            <HealthCell label="ECLIPSE" value={fmtRatioPct(satellite.telemetry.eclipseRatio)} />
            <HealthCell label="SOLAR" value={fmtRatioPct(satellite.telemetry.solarArrayHealth)} />
            <HealthCell label="BATT DOD" value={fmtRatioPct(satellite.telemetry.batteryDepthOfDischarge)} />
            <HealthCell label="PROP" value={fmtRatioPct(satellite.telemetry.propellantRemaining)} />
            <HealthCell label="RAD DOSE" value={fmtNumber(satellite.telemetry.radiationDose, "krad", 1)} />
            <HealthCell label="DEBRIS PROX" value={fmtNumber(satellite.telemetry.debrisProximity, "", 2)} />
            <HealthCell label="MISSION AGE" value={fmtNumber(satellite.telemetry.missionAge, "y", 1)} />
          </div>
        </DrawerSection>
      )}

      {payloads.length > 0 && (
        <DrawerSection title={`PAYLOADS · ${payloads.length}`}>
          <div className="flex flex-col">
            {payloads.map((p) => (
              <PayloadRow key={p.id} payload={p} />
            ))}
          </div>
        </DrawerSection>
      )}

      {(satellite.tleLine1 && satellite.tleLine2) ||
      satellite.lastTleIngestedAt ? (
        <DrawerSection title="TLE">
          {satellite.lastTleIngestedAt && (
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="mono text-nano uppercase tracking-widest text-muted">
                AGE
              </span>
              <span className="mono text-caption tabular-nums text-primary">
                {fmtTleAge(satellite.lastTleIngestedAt)}
                {typeof satellite.meanMotionDrift === "number" && (
                  <span className="ml-2 text-dim">
                    Δmm {fmtSignedFixed(satellite.meanMotionDrift, 4)}
                  </span>
                )}
              </span>
            </div>
          )}
          {satellite.tleLine1 && satellite.tleLine2 && (
            <pre className="mono overflow-x-auto whitespace-pre text-nano text-numeric leading-tight">
              {satellite.tleLine1}
              {"\n"}
              {satellite.tleLine2}
            </pre>
          )}
        </DrawerSection>
      ) : null}

      <DrawerSection title={`CONJUNCTIONS (${conjunctions.length})`}>
        {conjunctions.length === 0 && (
          <div className="text-caption text-dim">No active events for this asset.</div>
        )}
        {orderedConjunctions.slice(0, 8).map((c) => (
          <div
            key={c.id}
            className={clsx(
              "grid grid-cols-[1fr_auto] gap-2 border-b border-hairline py-1 last:border-0",
              c.id === selectedConjunctionId && "bg-elevated-2/60",
            )}
          >
            <div className="min-w-0">
              <div className="truncate text-caption text-numeric">
                {c.primaryId === satellite.id ? c.secondaryName : c.primaryName}
              </div>
              <div className="mono flex items-center gap-2 text-nano text-dim tabular-nums">
                <Measure value={fmtRangeKm(c.minRangeKm)} className="text-nano" />
                <span className="text-hairline-hot">·</span>
                <Measure value={fmtVelocity(c.relativeVelocityKmps)} className="text-nano" />
              </div>
            </div>
            <div
              className={clsx(
                "mono flex flex-col items-end text-caption tabular-nums",
                c.probabilityOfCollision >= 1e-4
                  ? "text-hot"
                  : c.probabilityOfCollision >= 1e-6
                    ? "text-amber"
                    : "text-muted",
              )}
            >
              <span>
                Pc <span className="text-dim">{fmtPc(c.probabilityOfCollision)[0]}</span>
              </span>
              <span className="text-nano text-dim">{c.epoch.slice(0, 16)}Z</span>
            </div>
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

function hasAnyTelemetry(t: TelemetryDto): boolean {
  return Object.values(t).some((v) => typeof v === "number" && Number.isFinite(v));
}

function HealthCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-hairline py-0.5">
      <span className="mono text-nano uppercase tracking-widest text-muted">{label}</span>
      <span className="mono text-caption tabular-nums text-primary">{value}</span>
    </div>
  );
}

function PayloadRow({ payload }: { payload: PayloadDto }) {
  const budget: string[] = [];
  if (typeof payload.massKg === "number") {
    budget.push(`${payload.massKg.toFixed(0)} kg`);
  }
  if (typeof payload.powerW === "number") {
    budget.push(`${payload.powerW.toFixed(0)} W`);
  }
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-hairline py-1 last:border-0">
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-caption text-primary">{payload.name}</span>
        {payload.role && (
          <span className="mono text-nano uppercase tracking-widest text-dim">
            {payload.role}
          </span>
        )}
      </div>
      {budget.length > 0 && (
        <span className="mono flex-shrink-0 text-nano tabular-nums text-muted">
          {budget.join(" · ")}
        </span>
      )}
    </div>
  );
}

const DASH = "—";

function fmtNumber(v: number | null, unit: string, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return DASH;
  return unit ? `${v.toFixed(digits)} ${unit}` : v.toFixed(digits);
}

function fmtWatts(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return DASH;
  if (v >= 1000) return `${(v / 1000).toFixed(1)} kW`;
  return `${Math.round(v)} W`;
}

function fmtThermal(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return DASH;
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)} °C`;
}

function fmtRatioPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return DASH;
  const [val, unit] = fmtPct(v, true);
  return unit ? `${val} ${unit}` : val;
}

function fmtTleAge(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return DASH;
  const diffMin = Math.max(0, (Date.now() - t) / 60000);
  if (diffMin < 60) return `${Math.round(diffMin)} min ago`;
  const diffH = diffMin / 60;
  if (diffH < 48) return `${diffH.toFixed(1)} h ago`;
  const diffD = diffH / 24;
  return `${diffD.toFixed(1)} d ago`;
}

function fmtSignedFixed(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return DASH;
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}`;
}
