// apps/console-api/src/services/llm-transport.adapter.ts
//
// Concrete binding of the console-api `LlmTransportFactory` port to the
// thalamus `createLlmTransportWithMode` factory. Kept in a separate file so
// that domain services (classifier, chat-reply, summariser) can depend on
// the port without pulling a thalamus import, and tests can substitute a
// stub factory without touching global module mocks.
import { createLlmTransportWithMode } from "@interview/thalamus";
import type { LlmTransportFactory } from "./llm-transport.port";

export const thalamusLlmTransportFactory: LlmTransportFactory = {
  create: (systemPrompt) => createLlmTransportWithMode(systemPrompt),
};
