import { clsx } from "clsx";
import type { ReactNode } from "react";

export function GuideCard(props: {
  eyebrow: string;
  title: string;
  body: string;
  meta: string;
}) {
  return (
    <div className="rounded-xl border border-hairline bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01))] p-4">
      <div className="mono text-caption text-cyan">{props.eyebrow}</div>
      <div className="mt-2 text-body text-primary">{props.title}</div>
      <p className="mt-1 text-caption text-muted">{props.body}</p>
      <div className="mt-4 mono text-caption text-dim">{props.meta}</div>
    </div>
  );
}

export function PreviewTile({
  title,
  value,
  detail,
  tone = "text-primary",
}: {
  title: string;
  value: string;
  detail: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-hairline bg-base/30 p-4">
      <div className="label text-dim">{title}</div>
      <div className={clsx("mt-2 mono text-body", tone)}>{value}</div>
      <div className="mt-1 text-caption text-muted">{detail}</div>
    </div>
  );
}

export function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 border-b border-hairline/50 pb-2 last:border-0 last:pb-0">
      <span className="text-caption text-muted">{label}</span>
      <span className="mono text-caption text-primary">{value}</span>
    </div>
  );
}

export function DecisionStep(props: {
  index: number;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-hairline bg-base/30 p-4">
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center border border-cyan/40 bg-cyan/10 mono text-caption text-cyan">
          {props.index}
        </div>
        <div>
          <h3 className="text-body text-primary">{props.title}</h3>
          <p className="text-caption text-muted">{props.description}</p>
        </div>
      </div>
      {props.children}
    </section>
  );
}

export function DecisionCard(props: {
  selected: boolean;
  label: string;
  description: string;
  meta?: string;
  accent?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={clsx(
        "rounded-xl border p-3 text-left transition-colors duration-fast ease-palantir cursor-pointer",
        props.selected
          ? "border-cyan bg-cyan/10"
          : "border-hairline bg-base/30 hover:border-cyan/50 hover:bg-base/50",
      )}
    >
      <div className={clsx("mono text-caption", props.accent ?? "text-primary")}>
        {props.label}
      </div>
      <div className="mt-1 text-caption text-muted">{props.description}</div>
      {props.meta && <div className="mt-3 mono text-caption text-dim">{props.meta}</div>}
    </button>
  );
}

export function DecisionSidebar(props: {
  eyebrow: string;
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <aside className="rounded-xl border border-hairline bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.08),transparent_55%)] p-4">
      <div className="label text-cyan">{props.eyebrow}</div>
      <h3 className="mt-2 text-body text-primary">{props.title}</h3>
      <p className="mt-1 text-caption text-muted">{props.body}</p>
      <div className="mt-4 space-y-2">{props.children}</div>
    </aside>
  );
}

export function TreeLine(props: { active?: boolean; label: string }) {
  return (
    <div className="flex items-start gap-2">
      <span
        className={clsx(
          "mt-1 h-2 w-2 shrink-0 rounded-full",
          props.active ? "bg-cyan" : "bg-hairline",
        )}
      />
      <span
        className={clsx(
          "mono text-caption whitespace-normal break-words",
          props.active ? "text-primary" : "text-dim",
        )}
      >
        {props.label}
      </span>
    </div>
  );
}

export function NumberField(props: {
  id: string;
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <div className="flex items-center justify-between gap-2">
        <span className="mono text-caption text-primary">{props.label}</span>
        <span className="mono text-caption text-dim">{props.value}</span>
      </div>
      <div className="mt-1 text-caption text-muted">{props.hint}</div>
      <input
        id={props.id}
        aria-label={props.label}
        type="number"
        className="mt-2 w-full border border-hairline bg-black/40 px-3 py-2 mono text-body text-primary focus:border-cyan focus:outline-none"
        value={props.value}
        min={props.min}
        max={props.max}
        step={props.step}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function RangeField(props: {
  id: string;
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <div className="flex items-center justify-between gap-2">
        <span className="mono text-caption text-primary">{props.label}</span>
        <span className="mono text-caption text-dim">{props.value.toFixed(2)}</span>
      </div>
      <div className="mt-1 text-caption text-muted">{props.hint}</div>
      <input
        id={props.id}
        aria-label={props.label}
        type="range"
        className="mt-2 w-full accent-cyan"
        value={props.value}
        min={props.min}
        max={props.max}
        step={props.step}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function ToggleCard(props: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex h-full cursor-pointer flex-col justify-between rounded-xl border border-hairline bg-base/30 p-4">
      <div>
        <div className="mono text-caption text-primary">{props.label}</div>
        <div className="mt-1 text-caption text-muted">{props.description}</div>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <input
          type="checkbox"
          className="accent-cyan"
          checked={props.checked}
          onChange={(e) => props.onChange(e.target.checked)}
        />
        <span className="mono text-caption text-dim">{props.checked ? "enabled" : "disabled"}</span>
      </div>
    </label>
  );
}
