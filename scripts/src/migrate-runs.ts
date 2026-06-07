import { db, sessionsTable, chatMessagesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const startMarker = "FILE_EDIT_START";
const endMarker = "FILE_EDIT_END";
const contentMarker = "FILE_EDIT_CONTENT";

function extractFileEdits(content: string) {
  const edits: { path: string; language: string }[] = [];
  let searchFrom = 0;
  while (true) {
    const s = content.indexOf(startMarker, searchFrom);
    if (s === -1) break;
    const e = content.indexOf(endMarker, s + startMarker.length);
    if (e === -1) break;
    const block = content.slice(s + startMarker.length, e);
    const ci = block.indexOf(contentMarker);
    if (ci !== -1) {
      const header = block.slice(0, ci).trim();
      let path = "", language = "typescript";
      for (const line of header.split("\n")) {
        const idx = line.indexOf(":");
        if (idx === -1) continue;
        const key = line.slice(0, idx).trim();
        const val = line.slice(idx + 1).trim();
        if (key === "path") path = val;
        if (key === "language") language = val;
      }
      if (path) edits.push({ path, language });
    }
    searchFrom = e + endMarker.length;
  }
  return edits;
}

async function main() {
  const messages = await db
    .select({ sessionId: chatMessagesTable.sessionId, content: chatMessagesTable.content })
    .from(chatMessagesTable)
    .where(eq(chatMessagesTable.role, "assistant"));

  const sessionEdits = new Map<number, { path: string; language: string }[]>();
  let totalEdits = 0;

  for (const m of messages) {
    if (!m.sessionId) continue;
    const edits = extractFileEdits(m.content);
    if (edits.length > 0) {
      const existing = sessionEdits.get(m.sessionId) ?? [];
      sessionEdits.set(m.sessionId, [...existing, ...edits]);
      totalEdits += edits.length;
    }
  }

  console.log(`Found ${totalEdits} file edits across ${sessionEdits.size} sessions`);

  let updated = 0;
  for (const [sessionId, edits] of sessionEdits) {
    await db
      .update(sessionsTable)
      .set({
        runArtifacts: edits.map(e => ({ type: "file_edit", path: e.path, language: e.language })),
        runStatus: "completed",
      })
      .where(eq(sessionsTable.id, sessionId));
    updated++;
  }

  console.log(`Updated ${updated} sessions.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
