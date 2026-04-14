import { pgTable, bigserial, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  role: text("role").notNull().default("user"),
  tier: text("tier").notNull().default("free"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof user.$inferSelect;
