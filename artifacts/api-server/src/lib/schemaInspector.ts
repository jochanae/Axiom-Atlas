import { Pool } from "pg";

export type ColumnInfo = {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
};

export type TableSchema = {
  tableName: string;
  columns: ColumnInfo[];
};

export type SchemaInspectionResult = {
  tables: TableSchema[];
  summary: string;
  tableCount: number;
  error?: string;
};

function isSafePostgresUrl(url: string): boolean {
  return /^postg?r?e?s(ql)?:\/\//i.test(url);
}

function needsSsl(url: string): boolean {
  return (
    url.includes("neon.tech") ||
    url.includes("supabase.com") ||
    url.includes("supabase.co") ||
    url.includes("render.com") ||
    url.includes("railway.app") ||
    url.includes("sslmode=require")
  );
}

export async function inspectSchema(
  connectionString: string,
): Promise<SchemaInspectionResult> {
  if (!isSafePostgresUrl(connectionString)) {
    return {
      tables: [],
      summary: "",
      tableCount: 0,
      error: "Only PostgreSQL connection strings are supported.",
    };
  }

  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 8000,
    ssl: needsSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
    max: 1,
  });

  try {
    const client = await pool.connect();
    try {
      const tablesResult = await client.query<{ table_name: string }>(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `);

      const tableNames = tablesResult.rows.map((r) => r.table_name);

      if (tableNames.length === 0) {
        return {
          tables: [],
          summary: "No tables found in the public schema.",
          tableCount: 0,
        };
      }

      const columnsResult = await client.query<{
        table_name: string;
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }>(
        `
        SELECT
          table_name,
          column_name,
          data_type,
          is_nullable,
          column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ANY($1)
        ORDER BY table_name, ordinal_position
      `,
        [tableNames],
      );

      const tableMap = new Map<string, TableSchema>();
      for (const name of tableNames) {
        tableMap.set(name, { tableName: name, columns: [] });
      }
      for (const row of columnsResult.rows) {
        tableMap.get(row.table_name)?.columns.push({
          name: row.column_name,
          type: row.data_type,
          nullable: row.is_nullable === "YES",
          defaultValue: row.column_default,
        });
      }

      const tables = [...tableMap.values()];

      const summary = tables
        .map((t) => {
          const cols = t.columns
            .map(
              (c) =>
                `${c.name}:${c.type}${c.nullable ? "" : "!"}${c.defaultValue !== null ? `=${c.defaultValue.slice(0, 30)}` : ""}`,
            )
            .join(", ");
          return `${t.tableName}(${cols})`;
        })
        .join("\n");

      return { tables, summary, tableCount: tables.length };
    } finally {
      client.release();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      tables: [],
      summary: "",
      tableCount: 0,
      error: `Schema inspection failed: ${msg}`,
    };
  } finally {
    await pool.end().catch(() => {});
  }
}

export function formatSchemaForPrompt(result: SchemaInspectionResult): string {
  if (result.error) {
    return `Database connection attempted but failed: ${result.error}`;
  }
  if (result.tableCount === 0) {
    return "Connected to database. No tables found in public schema.";
  }
  return `${result.tableCount} tables found:\n${result.summary}`;
}
