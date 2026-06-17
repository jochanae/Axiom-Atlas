import { assertEquals } from "https://deno.land/std@0.208.0/assert/assert_equals.ts";
import { assert } from "https://deno.land/std@0.208.0/assert/assert.ts";
import { validateCommitCard } from "../_shared/commitcard-guard.ts";

// ── Valid cards ──

Deno.test("valid card with all fields passes", () => {
  const result = validateCommitCard({
    decision_found: true,
    title: "Use Postgres for primary datastore",
    description: "Relational model fits the domain, team has SQL experience",
    summary: "Chose Postgres over MongoDB",
    severity: "committed",
    verb: "new",
    confidence: "high",
    v: 1,
  });
  assertEquals(result.valid, true);
  assertEquals(result.issues.length, 0);
});

Deno.test("valid card with minimal fields passes", () => {
  const result = validateCommitCard({
    title: "Switch to TanStack Router",
    summary: "Better type safety than React Router",
    severity: "committed",
    verb: "new",
  });
  assertEquals(result.valid, true);
});

// ── Auto-fill behavior ──

Deno.test("missing severity auto-fills to parked", () => {
  const result = validateCommitCard({
    title: "Add caching layer",
    summary: "Redis for session store",
  });
  assertEquals(result.valid, true);
  assertEquals(result.card.severity, "parked");
  assert(result.autoFilled.some(f => f.includes("severity")));
});

Deno.test("invalid severity auto-fills to parked", () => {
  const result = validateCommitCard({
    title: "Add caching layer",
    summary: "Redis for session store",
    severity: "urgent",
  });
  assertEquals(result.valid, true);
  assertEquals(result.card.severity, "parked");
});

Deno.test("missing verb auto-fills to note", () => {
  const result = validateCommitCard({
    title: "Document API schema",
    summary: "OpenAPI spec for all endpoints",
  });
  assertEquals(result.valid, true);
  assertEquals(result.card.verb, "note");
});

Deno.test("invalid verb auto-fills to note", () => {
  const result = validateCommitCard({
    title: "Document API schema",
    summary: "OpenAPI spec",
    verb: "yolo",
  });
  assertEquals(result.card.verb, "note");
});

Deno.test("missing title auto-fills from description", () => {
  const result = validateCommitCard({
    description: "We decided to use edge functions for all API routes",
    summary: "Edge functions for API",
    severity: "committed",
  });
  assertEquals(result.valid, true);
  assert(result.card.title!.length > 0);
  assert(result.autoFilled.some(f => f.includes("title")));
});

Deno.test("missing title auto-fills from summary when no description", () => {
  const result = validateCommitCard({
    summary: "Edge functions chosen for API layer",
    severity: "committed",
  });
  assertEquals(result.valid, true);
  assert(result.card.title!.includes("Edge functions"));
});

Deno.test("long title gets truncated", () => {
  const result = validateCommitCard({
    title: "A".repeat(120),
    summary: "test",
  });
  assertEquals(result.valid, true);
  assert(result.card.title!.length <= 80);
  assert(result.card.title!.endsWith("…"));
});

Deno.test("long summary gets truncated", () => {
  const result = validateCommitCard({
    title: "Valid title",
    summary: "B".repeat(500),
  });
  assertEquals(result.valid, true);
  assert(result.card.summary!.length <= 300);
});

Deno.test("schema version auto-fills to 1", () => {
  const result = validateCommitCard({
    title: "Valid title",
    summary: "Valid summary",
  });
  assertEquals(result.card.v, 1);
});

// ── Invalid cards ──

Deno.test("decision_found=false returns invalid", () => {
  const result = validateCommitCard({ decision_found: false });
  assertEquals(result.valid, false);
});

Deno.test("missing title with no description/summary is invalid", () => {
  const result = validateCommitCard({ severity: "committed" });
  assertEquals(result.valid, false);
});

Deno.test("garbage title 'untitled' with no backup is invalid", () => {
  const result = validateCommitCard({ title: "untitled" });
  assertEquals(result.valid, false);
});

Deno.test("garbage title 'test' with no backup is invalid", () => {
  const result = validateCommitCard({ title: "test" });
  assertEquals(result.valid, false);
});

Deno.test("garbage title 'decision' with no backup is invalid", () => {
  const result = validateCommitCard({ title: "decision" });
  assertEquals(result.valid, false);
});

Deno.test("garbage title BUT has summary is still valid (recoverable)", () => {
  const result = validateCommitCard({
    title: "test",
    summary: "Decided to use Supabase RLS for access control",
  });
  assertEquals(result.valid, true);
  assert(result.issues.some(i => i.includes("Garbage title")));
});

// ── Edge cases ──

Deno.test("empty object returns invalid", () => {
  const result = validateCommitCard({});
  assertEquals(result.valid, false);
});

Deno.test("touched as non-array gets normalized", () => {
  const result = validateCommitCard({
    title: "Valid title",
    summary: "Valid summary",
    touched: "not-an-array" as any,
  });
  assertEquals(result.valid, true);
  assertEquals(result.card.touched, []);
});

Deno.test("confidence normalization", () => {
  const result = validateCommitCard({
    title: "Valid title",
    summary: "Valid summary",
    confidence: "super-high",
  });
  assertEquals(result.card.confidence, "medium");
});

Deno.test("whitespace-only title is treated as missing", () => {
  const result = validateCommitCard({
    title: "   ",
    description: "Real description here",
  });
  assertEquals(result.valid, true);
  assert(result.autoFilled.some(f => f.includes("title")));
});
