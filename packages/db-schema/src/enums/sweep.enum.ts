import { pgEnum } from "drizzle-orm/pg-core";
import {
  SweepCategory,
  SweepSeverity,
  SweepResolutionStatus,
} from "@interview/shared";

/**
 * Sweep pgEnums — tuples derived from the TS enums declared in
 * [@interview/shared/enum/sweep.enum](../../../shared/src/enum/sweep.enum.ts).
 *
 * Single source of values: TS enum → `Object.values()` → pgEnum tuple.
 * Stays in sync with live DB by construction.
 */

const asTuple = (values: readonly string[]): [string, ...string[]] =>
  values as [string, ...string[]];

export const sweepCategoryEnum = pgEnum(
  "sweep_category",
  asTuple(Object.values(SweepCategory)),
);
export type SweepCategoryValue = (typeof sweepCategoryEnum.enumValues)[number];

export const sweepSeverityEnum = pgEnum(
  "sweep_severity",
  asTuple(Object.values(SweepSeverity)),
);
export type SweepSeverityValue = (typeof sweepSeverityEnum.enumValues)[number];

export const sweepResolutionStatusEnum = pgEnum(
  "sweep_resolution_status",
  asTuple(Object.values(SweepResolutionStatus)),
);
export type SweepResolutionStatusValue =
  (typeof sweepResolutionStatusEnum.enumValues)[number];
