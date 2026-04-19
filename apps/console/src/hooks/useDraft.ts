import { useMemo, useState } from "react";

/**
 * Generic draft/dirty/errors/diff state for an object-shaped form. Dirtiness
 * and diff are computed via `JSON.stringify` per-key so callers can mutate
 * deeply-nested values without hand-rolling equality.
 *
 * Usage:
 *   const { draft, errors, setErrors, dirty, diff, setField, replace, reset }
 *     = useDraft(payload.value);
 *   // onSave: patch.mutate({ ..., patch: diff }, { onSuccess: (r) => replace(r.value) });
 */
export function useDraft<T extends Record<string, unknown>>(initial: T) {
  const [draft, setDraft] = useState<T>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const dirty = useMemo(() => {
    for (const k of Object.keys(initial)) {
      if (JSON.stringify(draft[k]) !== JSON.stringify(initial[k])) return true;
    }
    return false;
  }, [draft, initial]);

  const diff = useMemo(() => {
    const d: Record<string, unknown> = {};
    for (const k of Object.keys(initial)) {
      if (JSON.stringify(draft[k]) !== JSON.stringify(initial[k])) {
        d[k] = draft[k];
      }
    }
    return d;
  }, [draft, initial]);

  function setField(key: string, value: unknown) {
    setDraft((d) => ({ ...d, [key]: value }));
    if (errors[key]) {
      setErrors((e) => {
        const next = { ...e };
        delete next[key];
        return next;
      });
    }
  }

  /** Replace the whole draft (e.g. after a successful server sync). */
  function replace(next: T) {
    setDraft(next);
    setErrors({});
  }

  /** Reset the draft back to the initial value. */
  function reset() {
    setDraft(initial);
    setErrors({});
  }

  return { draft, errors, setErrors, dirty, diff, setField, replace, reset };
}
