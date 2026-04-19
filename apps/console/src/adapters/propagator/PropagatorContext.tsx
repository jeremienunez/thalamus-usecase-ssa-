import { createContext, useContext, type ReactNode } from "react";
import { propagateSgp4, satellitePosition, satellitePositionAt, orbitRing } from "./sgp4";

export interface PropagatorAdapter {
  propagateSgp4: typeof propagateSgp4;
  satellitePosition: typeof satellitePosition;
  satellitePositionAt: typeof satellitePositionAt;
  orbitRing: typeof orbitRing;
}

export const defaultPropagatorAdapter: PropagatorAdapter = {
  propagateSgp4,
  satellitePosition,
  satellitePositionAt,
  orbitRing,
};

const PropagatorContext = createContext<PropagatorAdapter | null>(null);

export function PropagatorProvider({
  value,
  children,
}: {
  value: PropagatorAdapter;
  children: ReactNode;
}) {
  return <PropagatorContext.Provider value={value}>{children}</PropagatorContext.Provider>;
}

export function usePropagator(): PropagatorAdapter {
  const v = useContext(PropagatorContext);
  if (!v) throw new Error("usePropagator must be used inside PropagatorProvider");
  return v;
}
