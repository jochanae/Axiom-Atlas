import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const atlasSelfMapTable = pgTable("atlas_self_map", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  mapJson: text("map_json").notNull(),
  fileCount: integer("file_count").notNull(),
});

export const insertAtlasSelfMapSchema = createInsertSchema(atlasSelfMapTable).omit({ id: true, createdAt: true });
export type InsertAtlasSelfMap = z.infer<typeof insertAtlasSelfMapSchema>;
export type AtlasSelfMap = typeof atlasSelfMapTable.$inferSelect;
