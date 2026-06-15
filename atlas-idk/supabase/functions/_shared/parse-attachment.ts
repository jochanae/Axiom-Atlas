// parse-attachment.ts — Fetches an uploaded file by URL and turns it into
// model-ready context. Used by atlas-chat (and any other surface that
// accepts file attachments) to give Atlas actual "eyes" on user material.
//
// Strategy by MIME:
//   text/* | application/json | .md | .csv | .txt   → raw UTF-8 text
//   application/pdf                                  → extracted text (pdf-parse)
//   image/*                                          → return URL for vision input
//   anything else                                    → filename + size summary

export type Attachment = {
  name: string;
  url: string;
  type: string;
};

export type ParsedAttachment = {
  name: string;
  type: string;
  /** Plain text extracted from the file (truncated). null for images/binaries. */
  text: string | null;
  /** When the file is an image, surface its URL so Claude can see it directly. */
  imageUrl: string | null;
  /** Human-friendly note for binaries we can't parse. */
  note: string | null;
};

const MAX_TEXT_CHARS = 20_000; // ~5k tokens per file ceiling
const MAX_ZIP_BYTES = 25 * 1024 * 1024; // 25MB ceiling for archive ingestion
const MAX_ZIP_ENTRIES_LISTED = 200; // truncate huge trees in the summary

// ───────────────────────── ZIP central directory reader ─────────────────────────
// Pure-JS, edge-safe parser. Reads the End of Central Directory + Central Directory
// to enumerate entries (path, size, encrypted flag) WITHOUT decompressing payloads.
// This is enough to give Atlas a structural view of an uploaded archive.
type ZipEntry = { name: string; size: number; compressedSize: number; encrypted: boolean };
type ZipReadResult =
  | { ok: true; entries: ZipEntry[]; truncated: boolean; encryptedAny: boolean; nestedZips: string[] }
  | { ok: false; reason: "encrypted" | "not_zip" | "too_large" | "corrupt" };

function readZipCentralDirectory(buf: ArrayBuffer): ZipReadResult {
  if (buf.byteLength > MAX_ZIP_BYTES) return { ok: false, reason: "too_large" };
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  // Locate End of Central Directory (EOCD) signature 0x06054b50, scanning from the tail.
  const SIG_EOCD = 0x06054b50;
  let eocdOffset = -1;
  const maxScan = Math.min(buf.byteLength, 65557);
  for (let i = buf.byteLength - 22; i >= buf.byteLength - maxScan && i >= 0; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) return { ok: false, reason: "not_zip" };

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const cdSize = view.getUint32(eocdOffset + 12, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  if (cdOffset + cdSize > buf.byteLength) return { ok: false, reason: "corrupt" };

  const decoder = new TextDecoder("utf-8", { fatal: false });
  const SIG_CD = 0x02014b50;
  const entries: ZipEntry[] = [];
  let encryptedAny = false;
  const nestedZips: string[] = [];
  let p = cdOffset;
  let truncated = false;

  for (let i = 0; i < totalEntries && p < cdOffset + cdSize; i++) {
    if (view.getUint32(p, true) !== SIG_CD) return { ok: false, reason: "corrupt" };
    const gpFlag = view.getUint16(p + 8, true);
    const compressedSize = view.getUint32(p + 20, true);
    const uncompressedSize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const encrypted = (gpFlag & 0x0001) === 1;
    if (encrypted) encryptedAny = true;
    if (entries.length < MAX_ZIP_ENTRIES_LISTED) {
      entries.push({ name, size: uncompressedSize, compressedSize, encrypted });
    } else {
      truncated = true;
    }
    if (/\.(zip|tar|tgz|gz|rar|7z)$/i.test(name)) nestedZips.push(name);
    p += 46 + nameLen + extraLen + commentLen;
  }

  if (encryptedAny) return { ok: false, reason: "encrypted" };
  return { ok: true, entries, truncated, encryptedAny: false, nestedZips };
}

function isArchiveName(name: string, type?: string): boolean {
  if (/\.(zip)$/i.test(name)) return true;
  if (type && /zip/i.test(type)) return true;
  return false;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(2)}MB`;
}

function summarizeZipForModel(name: string, result: ZipReadResult): string {
  if (!result.ok) {
    switch (result.reason) {
      case "encrypted":
        return `Archive **${name}** is password-protected/encrypted. Atlas does not unlock archives — please re-upload an unencrypted version.`;
      case "too_large":
        return `Archive **${name}** exceeds the 25MB ingestion ceiling. Please upload a smaller archive or a subset of the project.`;
      case "not_zip":
        return `**${name}** doesn't look like a valid ZIP file (no end-of-central-directory record found).`;
      case "corrupt":
        return `Archive **${name}** appears corrupt — its central directory could not be parsed.`;
    }
  }

  // Build a top-level folder summary + truncated file listing.
  const topLevel = new Map<string, { files: number; bytes: number }>();
  for (const e of result.entries) {
    const head = e.name.split("/")[0] || "(root)";
    const cur = topLevel.get(head) ?? { files: 0, bytes: 0 };
    if (!e.name.endsWith("/")) cur.files += 1;
    cur.bytes += e.size;
    topLevel.set(head, cur);
  }
  const folderLines = [...topLevel.entries()]
    .sort((a, b) => b[1].bytes - a[1].bytes)
    .slice(0, 20)
    .map(([k, v]) => `  - \`${k}\` — ${v.files} file${v.files === 1 ? "" : "s"}, ${fmtBytes(v.bytes)}`);

  const fileLines = result.entries
    .filter((e) => !e.name.endsWith("/"))
    .slice(0, 60)
    .map((e) => `  - \`${e.name}\` (${fmtBytes(e.size)})`);

  const nested = result.nestedZips.length > 0
    ? `\n**Nested archives detected** (not unpacked further): ${result.nestedZips.slice(0, 8).map((n) => `\`${n}\``).join(", ")}`
    : "";

  const truncNote = result.truncated
    ? `\n_Listing truncated — archive contains more than ${MAX_ZIP_ENTRIES_LISTED} entries._`
    : "";

  return [
    `**Archive: ${name}** — ${result.entries.length} entries`,
    `Top-level folders:\n${folderLines.join("\n") || "  (none)"}`,
    `Files (first 60):\n${fileLines.join("\n") || "  (none)"}`,
    nested + truncNote,
  ].join("\n\n").trim();
}



function looksTextual(type: string, name: string): boolean {
  if (type.startsWith("text/")) return true;
  if (type === "application/json") return true;
  const lower = name.toLowerCase();
  return /\.(md|markdown|txt|csv|tsv|json|yaml|yml|log|xml|html?|js|ts|tsx|jsx|css|py|rb|go|rs|java|c|cc|cpp|h|hpp|sh)$/.test(lower);
}

function truncate(s: string): string {
  if (s.length <= MAX_TEXT_CHARS) return s;
  return s.slice(0, MAX_TEXT_CHARS) + `\n\n[... truncated, ${s.length - MAX_TEXT_CHARS} more chars]`;
}

async function parsePdf(buf: ArrayBuffer): Promise<string> {
  // Lightweight, edge-compatible PDF text extraction.
  // unpdf is pure-JS and works in Deno without native deps.
  try {
    const { extractText, getDocumentProxy } = await import("https://esm.sh/unpdf@0.12.1");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n\n") : String(text ?? "");
  } catch (err) {
    console.error("parse-attachment: pdf parse failed", err);
    return "";
  }
}

export async function parseAttachment(att: Attachment): Promise<ParsedAttachment> {
  const base: ParsedAttachment = {
    name: att.name,
    type: att.type,
    text: null,
    imageUrl: null,
    note: null,
  };

  // Images → hand the URL to the vision model instead of bytes.
  if (att.type.startsWith("image/")) {
    return { ...base, imageUrl: att.url };
  }

  try {
    const res = await fetch(att.url);
    if (!res.ok) {
      return { ...base, note: `Could not fetch (${res.status})` };
    }

    if (looksTextual(att.type, att.name)) {
      const text = await res.text();
      return { ...base, text: truncate(text) };
    }

    if (isArchiveName(att.name, att.type)) {
      const buf = await res.arrayBuffer();
      const result = readZipCentralDirectory(buf);
      const summary = summarizeZipForModel(att.name, result);
      return { ...base, text: summary };
    }

    if (att.type === "application/pdf" || att.name.toLowerCase().endsWith(".pdf")) {
      const buf = await res.arrayBuffer();
      const text = await parsePdf(buf);
      if (!text.trim()) {
        return { ...base, note: "PDF contained no extractable text (may be scanned images)." };
      }
      return { ...base, text: truncate(text) };
    }

    // Unknown binary — at least record presence + size.
    const size = res.headers.get("content-length");
    return {
      ...base,
      note: `Binary file (${att.type || "unknown type"}${size ? `, ${size} bytes` : ""}). Atlas can see the filename but not the contents.`,
    };
  } catch (err) {
    console.error("parse-attachment: fetch failed", att.name, err);
    return { ...base, note: "Failed to read this file." };
  }
}

export async function parseAttachments(atts: Attachment[]): Promise<ParsedAttachment[]> {
  if (!atts?.length) return [];
  return Promise.all(atts.map(parseAttachment));
}

/**
 * Render parsed attachments as a context block for the user message.
 * Returns null when nothing useful was extracted.
 */
export function renderAttachmentContext(parsed: ParsedAttachment[]): string | null {
  const textual = parsed.filter((p) => p.text || p.note);
  if (textual.length === 0) return null;

  const blocks = textual.map((p) => {
    const header = `### 📎 ${p.name}${p.type ? ` (${p.type})` : ""}`;
    if (p.text) {
      return `${header}\n\n\`\`\`\n${p.text}\n\`\`\``;
    }
    return `${header}\n\n_${p.note}_`;
  });

  return `\n\n---\n**Attached Source Material** — the operator shared these files for context:\n\n${blocks.join("\n\n")}\n---\n`;
}
