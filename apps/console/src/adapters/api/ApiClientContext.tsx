import { createContext, useContext, type ReactNode } from "react";
import type { ApiClient } from "./index";

const ApiClientContext = createContext<ApiClient | null>(null);

export function ApiClientProvider({
  value,
  children,
}: {
  value: ApiClient;
  children: ReactNode;
}) {
  return <ApiClientContext.Provider value={value}>{children}</ApiClientContext.Provider>;
}

export function useApiClient(): ApiClient {
  const v = useContext(ApiClientContext);
  if (!v) throw new Error("useApiClient must be used inside ApiClientProvider");
  return v;
}
