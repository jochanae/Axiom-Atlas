import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { mockUser, mockProject, createTestApp } from "./setup";

// ── DB mock state (hoisted so vi.mock factories can reference it) ─────────────
const { mockDbState, makeTable } = vi.hoisted(() => {
  const mockDbState = {
    selectResults: [] as any[][],
    insertResult: [] as any[],
  };

  const makeTable = (name: string) =>
    new Proxy({} as Record<string, unknown>, {
      get: (_t, prop) => ({ tableName: name, name: String(prop) }),
    });

  return { mockDbState, makeTable };
});

vi.mock("@workspace/db/schema", () => ({
  usersTable: makeTable("users"),
  userSessionsTable: makeTable("user_sessions"),
  projectsTable: makeTable("projects"),
  sessionsTable: makeTable("sessions"),
  entriesTable: makeTable("entries"),
  chatMessagesTable: makeTable("chat_messages"),
  thoughtsTable: makeTable("thoughts"),
  vaultTable: makeTable("vault"),
}));

vi.mock("@workspace/db", () => {
  const makeChain = (result: any[]) => {
    const chain: any = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => Promise.resolve(result),
      limit: () => Promise.resolve(result),
      then: (onFulfilled: any, onRejected: any) =>
        Promise.resolve(result).then(onFulfilled, onRejected),
    };
    return chain;
  };

  return {
    db: {
      select: vi.fn(() => makeChain(mockDbState.selectResults.shift() ?? [])),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve(mockDbState.insertResult)),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([])),
        })),
      })),
    },
    projectsTable: makeTable("projects"),
    sessionsTable: makeTable("sessions"),
    entriesTable: makeTable("entries"),
    chatMessagesTable: makeTable("chat_messages"),
    thoughtsTable: makeTable("thoughts"),
    vaultTable: makeTable("vault"),
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const AUTH_COOKIE = "atlas-session=fake-test-token";

/** Prime the DB mock to return mockUser for the session lookup, and return the
 *  cookie header string to send with the request. */
function withAuth(user: Omit<typeof mockUser, "subscriptionTier"> & { subscriptionTier: string } = mockUser) {
  mockDbState.selectResults.unshift([{ user }]);
  return AUTH_COOKIE;
}

beforeEach(() => {
  mockDbState.selectResults = [];
  mockDbState.insertResult = [];
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/projects", () => {
  it("returns 401 when no session cookie is present", async () => {
    const res = await request(createTestApp()).get("/api/projects");
    expect(res.status).toBe(401);
  });

  it("returns 200 and an array when authenticated", async () => {
    const cookie = withAuth();
    mockDbState.selectResults.push([]); // empty project list
    const res = await request(createTestApp())
      .get("/api/projects")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe("POST /api/projects", () => {
  it("returns 401 when no session cookie is present", async () => {
    const res = await request(createTestApp())
      .post("/api/projects")
      .send({ name: "My Project" });
    expect(res.status).toBe(401);
  });

  it("returns 400 when name is missing", async () => {
    const cookie = withAuth();
    const res = await request(createTestApp())
      .post("/api/projects")
      .set("Cookie", cookie)
      .send({});
    expect(res.status).toBe(400);
  });

  it("returns 201 and the new project when authenticated with valid body", async () => {
    const cookie = withAuth();
    mockDbState.selectResults.push([{ count: 0 }]); // free tier count check
    mockDbState.insertResult = [mockProject]; // route will call .toISOString() on the Date fields
    const res = await request(createTestApp())
      .post("/api/projects")
      .set("Cookie", cookie)
      .send({ name: "My Project" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "My Project" });
  });

  it("returns 402 when free-tier project limit is reached", async () => {
    const freeUser = { ...mockUser, subscriptionTier: "free" as const };
    const cookie = withAuth(freeUser);
    mockDbState.selectResults.push([{ count: 1 }]); // limit already hit
    const res = await request(createTestApp())
      .post("/api/projects")
      .set("Cookie", cookie)
      .send({ name: "Second Project" });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe("PROJECT_LIMIT_REACHED");
  });
});

describe("GET /api/projects/:id", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(createTestApp()).get("/api/projects/1");
    expect(res.status).toBe(401);
  });

  it("returns 400 when id is not a number", async () => {
    const cookie = withAuth();
    const res = await request(createTestApp())
      .get("/api/projects/not-a-number")
      .set("Cookie", cookie);
    expect(res.status).toBe(400);
  });

  it("returns 404 when project does not exist", async () => {
    const cookie = withAuth();
    mockDbState.selectResults.push([]); // empty result → not found
    const res = await request(createTestApp())
      .get("/api/projects/999")
      .set("Cookie", cookie);
    expect(res.status).toBe(404);
  });
});
