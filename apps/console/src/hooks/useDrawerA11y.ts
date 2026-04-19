import { useEffect, useRef } from "react";

/**
 * A11y plumbing shared by side-panel drawers:
 *  - Escape closes
 *  - Focus moves to the close button when opened
 *  - Focus returns to whatever was focused before opening
 *
 * Returns a ref to attach to the close button. Chrome + styling stay
 * per-feature; this hook only owns keyboard + focus concerns.
 */
export function useDrawerA11y(open: boolean, onClose: () => void) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    returnFocusRef.current = prev;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (returnFocusRef.current && document.contains(returnFocusRef.current)) {
        returnFocusRef.current.focus();
      }
    };
  }, [open, onClose]);

  return closeRef;
}
