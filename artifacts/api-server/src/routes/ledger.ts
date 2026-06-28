import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();

function userId(req: any): number {
  return (req as any).authUser.id as number;
}

// ── Assets ────────────────────────────────────────────────────────────────────

router.get("/ledger/assets", async (req, res): Promise<void> => {
  try {
    const uid = userId(req);
    const result = await db.execute(sql`
      SELECT id, name, category, value_cents, notes, created_at, updated_at
      FROM ledger_assets
      WHERE user_id = ${uid}
      ORDER BY created_at DESC
    `);
    res.json((result as any).rows ?? result);
  } catch {
    res.status(500).json({ error: "Failed to list assets" });
  }
});

router.post("/ledger/assets", async (req, res): Promise<void> => {
  try {
    const uid = userId(req);
    const { name, category = "Other", valueCents = 0, notes = null } = req.body as {
      name?: string; category?: string; valueCents?: number; notes?: string | null;
    };
    if (!name) { res.status(400).json({ error: "name is required" }); return; }
    const result = await db.execute(sql`
      INSERT INTO ledger_assets (user_id, name, category, value_cents, notes)
      VALUES (${uid}, ${name}, ${category}, ${valueCents}, ${notes})
      RETURNING id, name, category, value_cents, notes, created_at, updated_at
    `);
    const rows = (result as any).rows ?? result;
    const asset = rows[0] as { id: number; name: string; value_cents: number };
    await db.execute(sql`
      INSERT INTO ledger_transactions (user_id, asset_id, action, amount_cents, note)
      VALUES (${uid}, ${asset.id}, 'acquired', ${asset.value_cents}, ${`Added ${asset.name}`})
    `);
    res.status(201).json(asset);
  } catch {
    res.status(500).json({ error: "Failed to create asset" });
  }
});

router.patch("/ledger/assets/:id", async (req, res): Promise<void> => {
  try {
    const uid = userId(req);
    const assetId = Number(req.params["id"]);
    if (!assetId) { res.status(400).json({ error: "Invalid id" }); return; }
    const { name, category, valueCents, notes } = req.body as {
      name?: string; category?: string; valueCents?: number; notes?: string | null;
    };
    const current = await db.execute(sql`
      SELECT id, value_cents FROM ledger_assets WHERE id = ${assetId} AND user_id = ${uid}
    `);
    const cur = ((current as any).rows ?? current)[0] as { id: number; value_cents: number } | undefined;
    if (!cur) { res.status(404).json({ error: "Asset not found" }); return; }

    const result = await db.execute(sql`
      UPDATE ledger_assets SET
        name        = COALESCE(${name ?? null}, name),
        category    = COALESCE(${category ?? null}, category),
        value_cents = COALESCE(${valueCents ?? null}, value_cents),
        notes       = COALESCE(${notes !== undefined ? notes : null}, notes),
        updated_at  = now()
      WHERE id = ${assetId} AND user_id = ${uid}
      RETURNING id, name, category, value_cents, notes, created_at, updated_at
    `);
    const updated = ((result as any).rows ?? result)[0] as { value_cents: number; name: string } | undefined;
    if (updated && valueCents !== undefined && valueCents !== cur.value_cents) {
      const delta = valueCents - cur.value_cents;
      await db.execute(sql`
        INSERT INTO ledger_transactions (user_id, asset_id, action, amount_cents, note)
        VALUES (${uid}, ${assetId}, ${delta >= 0 ? 'appreciated' : 'depreciated'}, ${Math.abs(delta)}, ${`Revalued ${updated.name}`})
      `);
    }
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to update asset" });
  }
});

router.delete("/ledger/assets/:id", async (req, res): Promise<void> => {
  try {
    const uid = userId(req);
    const assetId = Number(req.params["id"]);
    if (!assetId) { res.status(400).json({ error: "Invalid id" }); return; }
    const asset = await db.execute(sql`
      SELECT name, value_cents FROM ledger_assets WHERE id = ${assetId} AND user_id = ${uid}
    `);
    const a = ((asset as any).rows ?? asset)[0] as { name: string; value_cents: number } | undefined;
    if (!a) { res.status(404).json({ error: "Asset not found" }); return; }
    await db.execute(sql`
      INSERT INTO ledger_transactions (user_id, asset_id, action, amount_cents, note)
      VALUES (${uid}, ${assetId}, 'divested', ${a.value_cents}, ${`Removed ${a.name}`})
    `);
    await db.execute(sql`DELETE FROM ledger_assets WHERE id = ${assetId} AND user_id = ${uid}`);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to delete asset" });
  }
});

// ── Transactions ──────────────────────────────────────────────────────────────

router.get("/ledger/transactions", async (req, res): Promise<void> => {
  try {
    const uid = userId(req);
    const limit = Math.min(Number(req.query["limit"] ?? 50), 200);
    const result = await db.execute(sql`
      SELECT t.id, t.asset_id, t.action, t.amount_cents, t.note, t.created_at,
             a.name AS asset_name, a.category AS asset_category
      FROM ledger_transactions t
      LEFT JOIN ledger_assets a ON a.id = t.asset_id
      WHERE t.user_id = ${uid}
      ORDER BY t.created_at DESC
      LIMIT ${limit}
    `);
    res.json((result as any).rows ?? result);
  } catch {
    res.status(500).json({ error: "Failed to list transactions" });
  }
});

router.post("/ledger/transactions", async (req, res): Promise<void> => {
  try {
    const uid = userId(req);
    const { assetId = null, action, amountCents = 0, note = null } = req.body as {
      assetId?: number | null; action?: string; amountCents?: number; note?: string | null;
    };
    if (!action) { res.status(400).json({ error: "action is required" }); return; }
    const result = await db.execute(sql`
      INSERT INTO ledger_transactions (user_id, asset_id, action, amount_cents, note)
      VALUES (${uid}, ${assetId}, ${action}, ${amountCents}, ${note})
      RETURNING id, asset_id, action, amount_cents, note, created_at
    `);
    res.status(201).json(((result as any).rows ?? result)[0]);
  } catch {
    res.status(500).json({ error: "Failed to log transaction" });
  }
});

// ── Summary (dashboard card + sparkline) ──────────────────────────────────────

router.get("/ledger/summary", async (req, res): Promise<void> => {
  try {
    const uid = userId(req);

    const [breakdown, totalResult, sparkline] = await Promise.all([
      db.execute(sql`
        SELECT category, COUNT(*)::int AS count, SUM(value_cents)::bigint AS total_cents
        FROM ledger_assets
        WHERE user_id = ${uid}
        GROUP BY category
        ORDER BY total_cents DESC
      `),
      db.execute(sql`
        SELECT COALESCE(SUM(value_cents), 0)::bigint AS total_cents, COUNT(*)::int AS asset_count
        FROM ledger_assets
        WHERE user_id = ${uid}
      `),
      db.execute(sql`
        SELECT
          date_trunc('hour', created_at) AS hour,
          SUM(CASE WHEN action IN ('acquired','appreciated') THEN amount_cents ELSE -amount_cents END)::bigint AS delta_cents
        FROM ledger_transactions
        WHERE user_id = ${uid}
          AND created_at >= now() - INTERVAL '24 hours'
        GROUP BY hour
        ORDER BY hour ASC
      `),
    ]);

    const totalRow = (((totalResult as any).rows ?? totalResult)[0] ?? { total_cents: 0, asset_count: 0 }) as {
      total_cents: number | string; asset_count: number;
    };

    res.json({
      totalCents:  Number(totalRow.total_cents),
      assetCount:  totalRow.asset_count,
      byCategory:  (breakdown as any).rows ?? breakdown,
      sparkline:   (sparkline as any).rows ?? sparkline,
    });
  } catch {
    res.status(500).json({ error: "Failed to compute summary" });
  }
});

export default router;
