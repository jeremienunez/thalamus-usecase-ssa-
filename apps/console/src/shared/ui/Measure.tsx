import { clsx } from "clsx";
import type { FormattedValue } from "@/shared/types/units";

type Props = {
  value: FormattedValue;
  className?: string;
  unitClassName?: string;
};

/** `<value><dim unit>` — keeps the value crisp and the unit muted. */
export function Measure({ value, className, unitClassName }: Props) {
  const [v, u] = value;
  return (
    <span className={clsx("mono tabular-nums", className)}>
      {v}
      {u && (
        <span className={clsx("ml-0.5 text-dim", unitClassName)}>{u}</span>
      )}
    </span>
  );
}
