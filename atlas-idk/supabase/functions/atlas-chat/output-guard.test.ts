import { assertEquals } from "https://deno.land/std@0.208.0/assert/assert_equals.ts";
import { assert } from "https://deno.land/std@0.208.0/assert/assert.ts";
import { validateOutput, type ValidationResult } from "../_shared/output-guard.ts";

// ══════════════════════════════════════════════════════════════
// SNAPSHOT FIXTURES — deterministic input/output pairs.
// Run `deno test --filter snapshot` to verify behavior stability.
// ══════════════════════════════════════════════════════════════

type Fixture = {
  name: string;
  input: string;
  mode: "THINK" | "BUILD" | "DECIDE";
  expectValid: boolean;
  expectViolation?: string;
};

const FIXTURES: Fixture[] = [
  // ── BUILD: valid ──
  {
    name: "BUILD/valid/clean-component",
    mode: "BUILD",
    expectValid: true,
    input: "Here's the login component:\n\n```tsx\nexport function Login() {\n  const [email, setEmail] = useState('');\n  return (\n    <form onSubmit={handleSubmit}>\n      <input value={email} onChange={e => setEmail(e.target.value)} />\n      <button type=\"submit\">Sign in</button>\n    </form>\n  );\n}\n```",
  },
  {
    name: "BUILD/valid/short-code-snippet",
    mode: "BUILD",
    expectValid: true,
    input: "Add this to your config:\n\n```ts\nexport const config = { port: 3000, host: 'localhost' };\n```",
  },
  {
    name: "BUILD/valid/explanation-with-code",
    mode: "BUILD",
    expectValid: true,
    input: "Two things to wire up. First, the route handler:\n\n```ts\napp.get('/api/users', async (req, res) => {\n  const users = await db.query('SELECT * FROM users');\n  res.json(users);\n});\n```\n\nSecond, add the middleware for auth checks.",
  },

  // ── BUILD: invalid ──
  {
    name: "BUILD/invalid/todo-placeholder",
    mode: "BUILD",
    expectValid: false,
    expectViolation: "placeholder_in_code",
    input: "```ts\nfunction processPayment(amount: number) {\n  // TODO: implement payment processing\n  return null;\n}\n```",
  },
  {
    name: "BUILD/invalid/ellipsis-placeholder",
    mode: "BUILD",
    expectValid: false,
    expectViolation: "placeholder_in_code",
    input: "```ts\nfunction handler() {\n  // ...\n}\n```",
  },
  {
    name: "BUILD/invalid/insert-here-placeholder",
    mode: "BUILD",
    expectValid: false,
    expectViolation: "placeholder_in_code",
    input: "```ts\nconst API_KEY = '[insert your api key here]';\n```",
  },
  {
    name: "BUILD/invalid/fixme-placeholder",
    mode: "BUILD",
    expectValid: false,
    expectViolation: "placeholder_in_code",
    input: "```ts\n// FIXME: broken validation\nconst isValid = true;\n```",
  },
  {
    name: "BUILD/invalid/lorem-ipsum",
    mode: "BUILD",
    expectValid: false,
    expectViolation: "placeholder_in_code",
    input: "```html\n<div class=\"hero\">\n  <p>Lorem ipsum dolor sit amet</p>\n</div>\n```",
  },
  {
    name: "BUILD/invalid/your-api-key",
    mode: "BUILD",
    expectValid: false,
    expectViolation: "placeholder_in_code",
    input: "```ts\nconst client = new Client({ apiKey: 'your-api-key' });\n```",
  },
  {
    name: "BUILD/invalid/capability-denial-cant-write",
    mode: "BUILD",
    expectValid: false,
    expectViolation: "capability_denial",
    input: "I cannot write code for you, but here's a general outline of what you need to do to build a login page with proper authentication.",
  },
  {
    name: "BUILD/invalid/capability-denial-just-ai",
    mode: "BUILD",
    expectValid: false,
    expectViolation: "capability_denial",
    input: "I'm just an AI and cannot generate production code, but I can explain the concepts behind authentication and how sessions work.",
  },
  {
    name: "BUILD/invalid/capability-denial-llm",
    mode: "BUILD",
    expectValid: false,
    expectViolation: "capability_denial",
    input: "As a large language model, I can help you think through the architecture but let me provide a high-level overview instead of actual implementation.",
  },
  {
    name: "BUILD/invalid/outline-filler",
    mode: "BUILD",
    expectValid: false,
    expectViolation: "capability_denial",
    input: "Here's a general outline of what you'd need to do to build this feature. First you would set up the database, then create the API endpoints, and finally wire up the frontend.",
  },
  {
    name: "BUILD/invalid/rambling-no-artifact",
    mode: "BUILD",
    expectValid: false,
    expectViolation: "build_without_artifact",
    input: Array(850).fill("word").join(" "),
  },

  // ── THINK: valid ──
  {
    name: "THINK/valid/exploratory",
    mode: "THINK",
    expectValid: true,
    input: "Two directions here. You could use a monorepo with shared packages, or keep them as separate repos with a shared npm package. The monorepo is faster to iterate on but harder to deploy independently.",
  },
  {
    name: "THINK/valid/short-question",
    mode: "THINK",
    expectValid: true,
    input: "What's the primary use case for this API? That drives the auth model.",
  },

  // ── THINK: invalid ──
  {
    name: "THINK/invalid/rambling",
    mode: "THINK",
    expectValid: false,
    expectViolation: "think_rambling",
    input: Array(850).fill("thought").join(" "),
  },
  {
    name: "THINK/invalid/empty-response",
    mode: "THINK",
    expectValid: false,
    expectViolation: "empty_response",
    input: "Ok",
  },
  {
    name: "THINK/invalid/single-word",
    mode: "THINK",
    expectValid: false,
    expectViolation: "empty_response",
    input: "Sure",
  },

  // ── DECIDE: valid ──
  {
    name: "DECIDE/valid/tradeoffs-and-recommendation",
    mode: "DECIDE",
    expectValid: true,
    input: "Two options here. Option A uses server-side rendering — pro: better SEO, con: more complexity. Option B is a static SPA — simpler but weaker on SEO. I'd recommend Option A given your audience is search-dependent.",
  },
  {
    name: "DECIDE/valid/short-recommendation",
    mode: "DECIDE",
    expectValid: true,
    input: "Go with Postgres. It fits your relational data model and you already know SQL.",
  },
  {
    name: "DECIDE/valid/versus-comparison",
    mode: "DECIDE",
    expectValid: true,
    input: "React vs Vue for this project: React has a bigger ecosystem and more hiring options. Vue is lighter and faster to prototype. For a team of two shipping fast, I'd lean toward Vue.",
  },

  // ── DECIDE: invalid ──
  {
    name: "DECIDE/invalid/capability-denial",
    mode: "DECIDE",
    expectValid: false,
    expectViolation: "capability_denial",
    input: "I cannot write code for this decision, but here is a general overview of the considerations you should think about.",
  },
  {
    name: "DECIDE/invalid/no-tradeoffs",
    mode: "DECIDE",
    expectValid: false,
    expectViolation: "decide_no_tradeoffs",
    input: Array(20).fill("There are many factors at play here and we need to look at the full picture carefully before moving forward.").join(" "),
  },
  {
    name: "DECIDE/invalid/rambling",
    mode: "DECIDE",
    expectValid: false,
    expectViolation: "decide_rambling",
    input: "Here are your " + Array(850).fill("option").join(" "),
  },
];

// Run each fixture as a named test
for (const f of FIXTURES) {
  Deno.test(`[snapshot] ${f.name}`, () => {
    const result = validateOutput(f.input, f.mode);
    assertEquals(result.valid, f.expectValid, `Expected valid=${f.expectValid} but got ${result.valid} (violation: ${result.violation})`);
    if (f.expectViolation) {
      assertEquals(result.violation, f.expectViolation, `Expected violation="${f.expectViolation}" but got "${result.violation}"`);
    }
  });
}

// ══════════════════════════════════════════════════════════════
// EDGE CASE HARDENING
// ══════════════════════════════════════════════════════════════

Deno.test("[edge] empty string returns valid for all modes", () => {
  for (const mode of ["THINK", "BUILD", "DECIDE"] as const) {
    const result = validateOutput("", mode);
    assertEquals(result.valid, true, `Empty string should be valid for ${mode}`);
  }
});

Deno.test("[edge] 'Done.' always valid regardless of mode", () => {
  for (const mode of ["THINK", "BUILD", "DECIDE"] as const) {
    const result = validateOutput("Done.", mode);
    assertEquals(result.valid, true, `'Done.' should be valid for ${mode}`);
  }
});

Deno.test("[edge] whitespace-only treated as empty", () => {
  const result = validateOutput("   \n\n  \t  ", "BUILD");
  assertEquals(result.valid, true);
});

Deno.test("[edge] correction prompt is always present on failure", () => {
  for (const f of FIXTURES.filter(f => !f.expectValid)) {
    const result = validateOutput(f.input, f.mode);
    assert(result.correction !== undefined && result.correction.length > 0, `Missing correction for ${f.name}`);
  }
});

Deno.test("[edge] TODO in prose (not code block) does NOT trigger placeholder check in BUILD", () => {
  const text = "The TODO for next sprint is to add caching. Here's the implementation:\n\n```ts\nconst cache = new Map<string, unknown>();\nexport function getCache(key: string) { return cache.get(key); }\n```";
  const result = validateOutput(text, "BUILD");
  assertEquals(result.valid, true);
});

Deno.test("[edge] placeholder keyword in variable name inside code is caught", () => {
  const text = "```ts\nconst placeholder_text = 'hello';\n```";
  const result = validateOutput(text, "BUILD");
  assertEquals(result.valid, false);
  assertEquals(result.violation, "placeholder_in_code");
});

Deno.test("[edge] code block with ONLY a comment is not placeholder if no pattern matches", () => {
  const text = "```ts\n// This sets up the database connection\nconst db = new Database('mydb');\n```";
  const result = validateOutput(text, "BUILD");
  assertEquals(result.valid, true);
});

Deno.test("[edge] mixed case denial 'I Can't Write Code'", () => {
  const text = "I Can't Write Code for your specific environment, but the general pattern is straightforward.";
  const result = validateOutput(text, "BUILD");
  assertEquals(result.valid, false);
  assertEquals(result.violation, "capability_denial");
});

Deno.test("[edge] denial pattern embedded mid-sentence", () => {
  const text = "While I am not able to generate the exact files you need, I can describe the architecture.";
  const result = validateOutput(text, "BUILD");
  assertEquals(result.valid, false);
  assertEquals(result.violation, "capability_denial");
});

Deno.test("[edge] DECIDE with 'advantage' keyword passes tradeoff check", () => {
  const text = "The main advantage of this approach is speed. You trade off some type safety for faster iteration.";
  const result = validateOutput(text, "DECIDE");
  assertEquals(result.valid, true);
});

Deno.test("[edge] DECIDE short response without keywords still valid if under 100 chars", () => {
  const text = "Yes, go ahead with that.";
  const result = validateOutput(text, "DECIDE");
  assertEquals(result.valid, true);
});

Deno.test("[edge] THINK exactly at 800-word boundary", () => {
  const words = Array(800).fill("word").join(" ");
  const result = validateOutput(words, "THINK");
  assertEquals(result.valid, true);
});

Deno.test("[edge] THINK at 801 words triggers rambling", () => {
  const words = Array(801).fill("word").join(" ");
  const result = validateOutput(words, "THINK");
  assertEquals(result.valid, false);
  assertEquals(result.violation, "think_rambling");
});

Deno.test("[edge] BUILD with 800 words but has code block is valid", () => {
  const prose = Array(800).fill("word").join(" ");
  const text = `${prose}\n\n\`\`\`ts\nconsole.log('done');\n\`\`\``;
  const result = validateOutput(text, "BUILD");
  assertEquals(result.valid, true);
});

Deno.test("[edge] multiple code blocks — only one has placeholder", () => {
  const text = "```ts\nconst a = 1;\n```\n\nAnd also:\n\n```ts\n// TODO: finish this\nconst b = 2;\n```";
  const result = validateOutput(text, "BUILD");
  assertEquals(result.valid, false);
  assertEquals(result.violation, "placeholder_in_code");
});

Deno.test("[edge] unicode content doesn't crash", () => {
  const text = "这是一个测试。使用 emoji 🚀 和特殊字符 ñ ü ö.";
  const result = validateOutput(text, "THINK");
  assertEquals(result.valid, true);
});

Deno.test("[edge] very long single line doesn't crash", () => {
  const text = "a".repeat(50000);
  const result = validateOutput(text, "BUILD");
  // Should not crash — may or may not be valid depending on word count
  assert(typeof result.valid === "boolean");
});

Deno.test("[edge] nested code fences handled correctly", () => {
  const text = "````md\n```ts\nconst x = 1;\n```\n````";
  const result = validateOutput(text, "BUILD");
  assertEquals(result.valid, true);
});
