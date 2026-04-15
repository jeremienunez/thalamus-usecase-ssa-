import { create } from "zustand";

type UiState = {
  railCollapsed: boolean;
  toggleRail: () => void;
  drawerId: string | null;
  openDrawer: (id: string) => void;
  closeDrawer: () => void;
};

export const useUiStore = create<UiState>((set) => ({
  railCollapsed: false,
  toggleRail: () => set((s) => ({ railCollapsed: !s.railCollapsed })),
  drawerId: null,
  openDrawer: (id) => set({ drawerId: id }),
  closeDrawer: () => set({ drawerId: null }),
}));
