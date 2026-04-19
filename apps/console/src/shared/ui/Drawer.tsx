import { ReactNode, useId } from "react";
import { X } from "lucide-react";
import { clsx } from "clsx";
import { useUiStore } from "@/shared/ui/uiStore";
import { useDrawerA11y } from "@/hooks/useDrawerA11y";

type Props = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

export function Drawer({ title, subtitle, children }: Props) {
  const drawerId = useUiStore((s) => s.drawerId);
  const close = useUiStore((s) => s.closeDrawer);
  const open = drawerId !== null;
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
        "absolute right-0 top-0 z-drawer h-full w-[420px] border-l border-hairline bg-elevated shadow-elevated transition-transform duration-med ease-palantir",
        open ? "translate-x-0" : "translate-x-full pointer-events-none",
      )}
    >
      <div className="flex h-12 items-center justify-between border-b border-hairline px-4">
        <div className="flex min-w-0 flex-col">
          <span id={titleId} className="label">
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
      <div className="h-[calc(100%-3rem)] overflow-y-auto">{children}</div>
    </aside>
  );
}

export function DrawerSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-hairline px-4 py-4">
      <div className="label mb-2">{title}</div>
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
