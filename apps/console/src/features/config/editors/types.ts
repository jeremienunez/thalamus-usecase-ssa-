import type { DomainPayload } from "@interview/shared/config";

export type DomainEditorProps = {
  domain: string;
  payload: DomainPayload;
  draft: Record<string, unknown>;
  errors: Record<string, string>;
  setField: (key: string, value: unknown) => void;
};

export type DomainEditorLeafProps = Omit<DomainEditorProps, "domain">;
