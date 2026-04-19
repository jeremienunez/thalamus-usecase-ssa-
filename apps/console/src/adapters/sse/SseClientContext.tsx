import { createContext, useContext, type ReactNode } from "react";
import type { SseClient } from "./client";

const SseClientContext = createContext<SseClient | null>(null);

export function SseClientProvider({
  value,
  children,
}: {
  value: SseClient;
  children: ReactNode;
}) {
  return <SseClientContext.Provider value={value}>{children}</SseClientContext.Provider>;
}

export function useSseClient(): SseClient {
  const v = useContext(SseClientContext);
  if (!v) throw new Error("useSseClient must be used inside SseClientProvider");
  return v;
}
