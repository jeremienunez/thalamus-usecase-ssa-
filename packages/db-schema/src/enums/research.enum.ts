import { pgEnum } from "drizzle-orm/pg-core";
import {
  ResearchCortex,
  ResearchFindingType,
  ResearchStatus,
  ResearchUrgency,
  ResearchEntityType,
  ResearchRelation,
  ResearchCycleTrigger,
  ResearchCycleStatus,
} from "@interview/shared";

/**
 * pgEnum definitions derived from the TypeScript enums declared in @interview/shared.
 *
 * Single source of values: shared TS enum → `Object.values()` → pgEnum tuple → `CREATE TYPE` SQL.
 *
 * Column inferred type is `string` (widened) rather than the nominal TS enum.
 * Rationale: the extracted thalamus/sweep code mixes enum members, string literals,
 * and `as string` casts at assignment sites — narrowing would force code rewrites.
 * DB-side integrity is enforced by the pgEnum itself; TS stays permissive.
 */

const asTuple = (values: readonly string[]): [string, ...string[]] =>
  values as [string, ...string[]];

export const cortexEnum = pgEnum(
  "cortex",
  asTuple(Object.values(ResearchCortex)),
);

export const findingTypeEnum = pgEnum(
  "finding_type",
  asTuple(Object.values(ResearchFindingType)),
);

export const findingStatusEnum = pgEnum(
  "finding_status",
  asTuple(Object.values(ResearchStatus)),
);

export const urgencyEnum = pgEnum(
  "urgency",
  asTuple(Object.values(ResearchUrgency)),
);

export const entityTypeEnum = pgEnum(
  "entity_type",
  asTuple(Object.values(ResearchEntityType)),
);

export const relationEnum = pgEnum(
  "relation",
  asTuple(Object.values(ResearchRelation)),
);

export const cycleTriggerEnum = pgEnum(
  "cycle_trigger",
  asTuple(Object.values(ResearchCycleTrigger)),
);

export const cycleStatusEnum = pgEnum(
  "cycle_status",
  asTuple(Object.values(ResearchCycleStatus)),
);
