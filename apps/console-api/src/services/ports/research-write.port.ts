// apps/console-api/src/services/ports/research-write.port.ts
import type {
  FindingInsertInput,
  EdgeInsertInput,
} from "../../types/finding.types";

export interface CyclesPort {
  getOrCreate(): Promise<bigint>;
}

export interface FindingsWritePort {
  insert(input: FindingInsertInput): Promise<bigint>;
}

export interface EdgesWritePort {
  insert(input: EdgeInsertInput): Promise<void>;
}
