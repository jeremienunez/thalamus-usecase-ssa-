import { create } from "zustand";

/**
 * Cross-feature UI state:
 * - rail collapse (shell-level chrome)
 * - drawer selection (single drawer at a time across all modes — navigation
 *   is tied to feature via the ID prefix, e.g. `f:…`, `sat:…`, `op:…`).
 *
 * Scoped to `shared/ui` because consumers span every feature. When a feature
 * needs state local to itself only, it should use `useReducer` or a private
 * store in `features/<name>/state.ts` — never extend this file.
 */
type UiState = {
  railCollapsed: boolean;
  toggleRail: () => void;
  drawerId: string | null;
  openDrawer: (id: string) => void;
  closeDrawer: () => void;
  autonomyFeedOpen: boolean;
  setAutonomyFeedOpen: (open: boolean) => void;
  toggleAutonomyFeed: () => void;
  configFocus: { domain: string; nonce: number } | null;
  focusConfigDomain: (domain: string) => void;
  clearConfigFocus: () => void;
};

export const useUiStore = create<UiState>((set) => ({
  railCollapsed: false,
  toggleRail: () => set((s) => ({ railCollapsed: !s.railCollapsed })),
  drawerId: null,
  openDrawer: (id) => set({ drawerId: id }),
  closeDrawer: () => set({ drawerId: null }),
  autonomyFeedOpen: false,
  setAutonomyFeedOpen: (open) => set({ autonomyFeedOpen: open }),
  toggleAutonomyFeed: () =>
    set((s) => ({ autonomyFeedOpen: !s.autonomyFeedOpen })),
  configFocus: null,
  focusConfigDomain: (domain) =>
    set(() => ({
      configFocus: { domain, nonce: Date.now() },
    })),
  clearConfigFocus: () => set({ configFocus: null }),
}));
