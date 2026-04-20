import type { ReactNode } from "react";
import { ReplContext } from "./ReplContext";
import { useReplRuntime } from "./useReplRuntime";

export function ReplProvider({ children }: { children: ReactNode }) {
  const value = useReplRuntime();
  return <ReplContext.Provider value={value}>{children}</ReplContext.Provider>;
}
