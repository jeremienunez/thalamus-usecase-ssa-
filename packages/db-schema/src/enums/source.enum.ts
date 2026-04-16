import { pgEnum } from "drizzle-orm/pg-core";
import { SourceKind } from "@interview/shared";

/**
 * Source kind pgEnum — tuple derived from the TS enum declared in
 * [@interview/shared/enum/source.enum](../../../shared/src/enum/source.enum.ts).
 *
 * Single source of values: TS enum → `Object.values()` → pgEnum tuple.
 * Stays in sync with live DB by construction; prelude DDL lives at
 * [migrations/0000_enums_prelude.sql](../../migrations/0000_enums_prelude.sql).
 */

const asTuple = (values: readonly string[]): [string, ...string[]] =>
  values as [string, ...string[]];

export const sourceKindEnum = pgEnum(
  "source_kind",
  asTuple(Object.values(SourceKind)),
);
export type SourceKindValue = (typeof sourceKindEnum.enumValues)[number];
