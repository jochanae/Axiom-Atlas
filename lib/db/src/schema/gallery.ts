import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable } from "./projects";

export const galleryImagesTable = pgTable("gallery_images", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  projectId: integer("project_id").references(() => projectsTable.id),
  objectPath: text("object_path").notNull(),
  label: text("label"),
  createdAt: timestamp("created_at").defaultNow(),
});
