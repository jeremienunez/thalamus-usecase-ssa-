import { createContext, useContext, type ReactNode } from "react";
import { makeGoldBumpTexture, makeHaloTexture, makeSolarPanelTexture } from "./textures";
import { getCompanyColor, regimeColor, pcColor } from "./palette";

export interface RendererAdapter {
  makeGoldBumpTexture: typeof makeGoldBumpTexture;
  makeHaloTexture: typeof makeHaloTexture;
  makeSolarPanelTexture: typeof makeSolarPanelTexture;
  getCompanyColor: typeof getCompanyColor;
  regimeColor: typeof regimeColor;
  pcColor: typeof pcColor;
}

export const defaultRendererAdapter: RendererAdapter = {
  makeGoldBumpTexture,
  makeHaloTexture,
  makeSolarPanelTexture,
  getCompanyColor,
  regimeColor,
  pcColor,
};

const RendererContext = createContext<RendererAdapter | null>(null);

export function RendererProvider({
  value,
  children,
}: {
  value: RendererAdapter;
  children: ReactNode;
}) {
  return <RendererContext.Provider value={value}>{children}</RendererContext.Provider>;
}

export function useRenderer(): RendererAdapter {
  const v = useContext(RendererContext);
  if (!v) throw new Error("useRenderer must be used inside RendererProvider");
  return v;
}
