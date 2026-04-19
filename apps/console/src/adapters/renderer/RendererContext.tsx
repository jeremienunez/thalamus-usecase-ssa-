import { createContext, useContext, type ReactNode } from "react";
import { makeGoldBumpTexture, makeHaloTexture, makeSolarPanelTexture } from "./textures";
import { getCompanyColor, regimeColor, ringColor, pcColor } from "./palette";
import {
  buildFullRingsGeometry,
  buildTailsGeometry,
  clearRingCache,
} from "./orbit-geometry";

export interface RendererAdapter {
  makeGoldBumpTexture: typeof makeGoldBumpTexture;
  makeHaloTexture: typeof makeHaloTexture;
  makeSolarPanelTexture: typeof makeSolarPanelTexture;
  getCompanyColor: typeof getCompanyColor;
  regimeColor: typeof regimeColor;
  ringColor: typeof ringColor;
  pcColor: typeof pcColor;
  buildFullRingsGeometry: typeof buildFullRingsGeometry;
  buildTailsGeometry: typeof buildTailsGeometry;
  clearRingCache: typeof clearRingCache;
}

export const defaultRendererAdapter: RendererAdapter = {
  makeGoldBumpTexture,
  makeHaloTexture,
  makeSolarPanelTexture,
  getCompanyColor,
  regimeColor,
  ringColor,
  pcColor,
  buildFullRingsGeometry,
  buildTailsGeometry,
  clearRingCache,
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
