import { ReactNode, useId } from "react";
import { X } from "lucide-react";
import { clsx } from "clsx";
import { useUiStore } from "@/shared/ui/uiStore";
import { useDrawerA11y } from "@/hooks/useDrawerA11y";

type Props = {
  title: string;
  subtitle?: string;
  scope?: string | readonly string[];
  children: ReactNode;
};

export function Drawer({ title, subtitle, scope, children }: Props) {
  const drawerId = useUiStore((s) => s.drawerId);
  const close = useUiStore((s) => s.closeDrawer);
  const scopes = typeof scope === "string" ? [scope] : scope;
  const open =
    drawerId !== null &&
    (scopes === undefined || scopes.some((prefix) => drawerId.startsWith(prefix)));
  const titleId = useId();
  const closeRef = useDrawerA11y(open, close);

  return (
    <aside
      role="complementary"
      aria-hidden={!open}
      aria-labelledby={open ? titleId : undefined}
      // @ts-expect-error inert is a valid HTML attribute, React 19 will type it
      inert={!open ? "" : undefined}
      className={clsx(
        "absolute right-0 top-0 z-drawer h-full w-[min(440px,100vw)] border-l border-cyan/20 bg-elevated/95 shadow-pop backdrop-blur-xl transition-transform duration-med ease-palantir",
        open ? "translate-x-0" : "translate-x-full pointer-events-none",
      )}
    >
      <div className="flex h-12 items-center justify-between border-b border-hairline bg-panel/70 px-4">
        <div className="flex min-w-0 flex-col">
          <span id={titleId} className="label text-cyan">
            {title}
          </span>
          {subtitle && (
            <span className="mono text-caption text-numeric truncate">{subtitle}</span>
          )}
        </div>
        <button
          ref={closeRef}
          onClick={close}
          aria-label="Close drawer"
          className="flex h-7 w-7 items-center justify-center text-muted transition-colors duration-fast ease-palantir hover:text-primary cursor-pointer"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>
      <div className="h-[calc(100%-3rem)] overflow-y-auto bg-[linear-gradient(180deg,rgba(34,211,238,0.035),transparent_22rem)]">
        {children}
      </div>
    </aside>
  );
}

export function DrawerSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-hairline px-4 py-4">
      <div className="label mb-2 flex items-center gap-2 text-primary">
        <span className="h-1 w-1 bg-cyan/70" />
        {title}
      </div>
      {children}
    </section>
  );
}

export function KV({
  k,
  v,
  mono = false,
  color,
}: {
  k: string;
  v: ReactNode;
  mono?: boolean;
  color?: string;
}) {
  return (
    <div className="grid grid-cols-[112px_1fr] items-baseline gap-3 py-1 text-body">
      <span className="text-caption text-muted">{k}</span>
      <span
        className={mono ? "mono text-numeric" : "text-primary"}
        style={color ? { color } : undefined}
      >
        {v}
      </span>
    </div>
  );
}
