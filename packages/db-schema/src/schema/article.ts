import { pgTable, bigserial, bigint, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { user } from "./user";

export const article = pgTable("article", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  status: text("status").notNull(),
  content: text("content"),
  metadata: jsonb("metadata"),
  authorId: bigint("author_id", { mode: "bigint" }).references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Article = typeof article.$inferSelect;
export type NewArticle = typeof article.$inferInsert;
