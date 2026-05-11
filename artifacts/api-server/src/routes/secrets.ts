import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { db, secretsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

const router: IRouter = Router();

function getKey(): Buffer {
  const secret = process.env.SESSION_SECRET ?? "axiom-atlas-default-key";
  return crypto.createHash("sha256").update(secret).digest();
}

function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

function decrypt(stored: string): string {
  const [ivHex, tagHex, ctHex] = stored.split(":");
  if (!ivHex || !tagHex || !ctHex) throw new Error("Malformed secret");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(tagHex, "hex");
  const ciphertext = Buffer.from(ctHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext).toString("utf8") + decipher.final("utf8");
}

function mask(label: string): string {
  if (label.length <= 4) return "••••••••";
  return label.slice(0, 4) + "••••••••";
}

const CreateSchema = z.object({
  projectId: z.number().int().positive().optional().nullable(),
  projectName: z.string().min(1).max(100).default("General"),
  label: z.string().min(1).max(120),
  value: z.string().min(1).max(4000),
});

router.get("/secrets", async (req, res): Promise<void> => {
  const userId = (req as any).authUser.id as number;
  const rows = await db
    .select()
    .from(secretsTable)
    .where(eq(secretsTable.userId, userId))
    .orderBy(desc(secretsTable.createdAt));

  const safe = rows.map(r => ({
    id: r.id,
    projectId: r.projectId,
    projectName: r.projectName,
    label: r.label,
    maskedValue: mask(r.label),
    createdAt: r.createdAt.toISOString(),
  }));
  res.json(safe);
});

router.post("/secrets", async (req, res): Promise<void> => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = (req as any).authUser.id as number;
  const { projectId, projectName, label, value } = parsed.data;
  const encryptedValue = encrypt(value);
  const [row] = await db.insert(secretsTable).values({
    userId,
    projectId: projectId ?? null,
    projectName,
    label,
    encryptedValue,
  }).returning();
  res.status(201).json({
    id: row.id,
    projectId: row.projectId,
    projectName: row.projectName,
    label: row.label,
    maskedValue: mask(row.label),
    createdAt: row.createdAt.toISOString(),
  });
});

router.get("/secrets/:id/reveal", async (req, res): Promise<void> => {
  const userId = (req as any).authUser.id as number;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db
    .select()
    .from(secretsTable)
    .where(and(eq(secretsTable.id, id), eq(secretsTable.userId, userId)));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  try {
    const value = decrypt(row.encryptedValue);
    res.json({ value });
  } catch {
    res.status(500).json({ error: "Failed to decrypt" });
  }
});

router.delete("/secrets/:id", async (req, res): Promise<void> => {
  const userId = (req as any).authUser.id as number;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(secretsTable).where(and(eq(secretsTable.id, id), eq(secretsTable.userId, userId)));
  res.status(204).end();
});

export default router;
