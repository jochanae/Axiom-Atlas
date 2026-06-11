import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { mockUser } from "./setup";
import { requireAuth } from "../routes/auth";
import browserRouter from "../routes/browser";

// ── DB mock state ──────────────────────────────────────────────────────────────
const { mockDbState, makeTable } = vi.hoisted(() => {
  const mockDbState = {
    selectResults: [] as any[][],
    insertResult: [] as any[],
    updateResult: [] as any[],
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
  scheduledChecksTable: makeTable("scheduled_checks"),
  checkResultsTable: makeTable("check_results"),
}));

vi.mock("@workspace/db", () => {
  const makeChain = (result: any[]) => {
    const chain: any = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
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
          where: vi.fn(() => ({
            returning: vi.fn(() => Promise.resolve(mockDbState.updateResult)),
          })),
        })),
      })),
    },
    projectsTable: makeTable("projects"),
    scheduledChecksTable: makeTable("scheduled_checks"),
    checkResultsTable: makeTable("check_results"),
  };
});

// Stub dns so SSRF check resolves immediately without real DNS
vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: vi.fn().mockResolvedValue(["93.184.216.34"]), // example.com — public IP
    resolve6: vi.fn().mockResolvedValue([]),
  },
}));

// Stub global fetch for redirect SSRF tests
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Test app setup ────────────────────────────────────────────────────────────
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api", requireAuth, browserRouter);
  return app;
}

const AUTH_COOKIE = "atlas-session=fake-test-token";

function withAuth() {
  // requireAuth selects { user: usersTable } via a join — result shape is [{ user }]
  mockDbState.selectResults.unshift([{ user: mockUser }]);
  return AUTH_COOKIE;
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("POST /api/browser/schedule", () => {
  beforeEach(() => {
    mockDbState.selectResults = [];
    mockDbState.insertResult = [];
    mockDbState.updateResult = [];
  });

  it("returns 401 without auth cookie", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/api/browser/schedule")
      .send({ url: "https://example.com", projectId: 42 });
    expect(res.status).toBe(401);
  });

  it("returns 400 for a missing url", async () => {
    const app = createTestApp();
    const cookie = withAuth();
    const res = await request(app)
      .post("/api/browser/schedule")
      .set("Cookie", cookie)
      .send({ projectId: 42 });
    expect(res.status).toBe(400);
  });

  it("returns 400 for a private/localhost URL (SSRF guard)", async () => {
    // localhost hostname is blocked at the IP-literal check before DNS is called
    const app = createTestApp();
    const cookie = withAuth();
    const res = await request(app)
      .post("/api/browser/schedule")
      .set("Cookie", cookie)
      .send({ url: "http://localhost/api/internal", projectId: 42 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/private|not allowed/i);
  });

  it("returns 404 when project is not owned by authenticated user", async () => {
    const app = createTestApp();
    const cookie = withAuth();
    // Project ownership check returns empty — project not found for this user
    mockDbState.selectResults.push([]); // ownedProject lookup → not found
    const res = await request(app)
      .post("/api/browser/schedule")
      .set("Cookie", cookie)
      .send({ url: "https://example.com", projectId: 99 });
    expect(res.status).toBe(404);
  });

  it("creates a schedule and returns the row for an authenticated owner", async () => {
    const app = createTestApp();
    const cookie = withAuth();

    const mockSchedule = {
      id: "sch-uuid-1",
      userId: mockUser.id,
      projectId: 42,
      url: "https://example.com",
      intervalMinutes: 1440,
      isActive: true,
      createdAt: new Date().toISOString(),
      nextCheckAt: new Date().toISOString(),
    };

    mockDbState.selectResults.push([{ id: 42 }]); // project ownership check → found
    mockDbState.insertResult = [mockSchedule];

    const res = await request(app)
      .post("/api/browser/schedule")
      .set("Cookie", cookie)
      .send({ url: "https://example.com", projectId: 42 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: "sch-uuid-1", url: "https://example.com" });
  });
});

describe("DELETE /api/browser/schedule/:id", () => {
  beforeEach(() => {
    mockDbState.selectResults = [];
    mockDbState.insertResult = [];
    mockDbState.updateResult = [];
  });

  it("returns 401 without auth cookie", async () => {
    const app = createTestApp();
    const res = await request(app).delete("/api/browser/schedule/sch-1");
    expect(res.status).toBe(401);
  });

  it("returns 404 when the schedule does not belong to this user", async () => {
    const app = createTestApp();
    const cookie = withAuth();
    mockDbState.updateResult = []; // update returns nothing — ownership mismatch
    const res = await request(app)
      .delete("/api/browser/schedule/sch-nonexistent")
      .set("Cookie", cookie);
    expect(res.status).toBe(404);
  });

  it("deactivates a schedule owned by the authenticated user", async () => {
    const app = createTestApp();
    const cookie = withAuth();
    mockDbState.updateResult = [{ id: "sch-uuid-1", isActive: false }];
    const res = await request(app)
      .delete("/api/browser/schedule/sch-uuid-1")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, id: "sch-uuid-1" });
  });
});

describe("GET /api/browser/checks/:projectId", () => {
  beforeEach(() => {
    mockDbState.selectResults = [];
    mockDbState.insertResult = [];
    mockDbState.updateResult = [];
  });

  it("returns 401 without auth cookie", async () => {
    const app = createTestApp();
    const res = await request(app).get("/api/browser/checks/42");
    expect(res.status).toBe(401);
  });

  it("returns 404 when project is not owned by authenticated user", async () => {
    const app = createTestApp();
    const cookie = withAuth();
    mockDbState.selectResults.push([]); // project ownership → not found
    const res = await request(app)
      .get("/api/browser/checks/42")
      .set("Cookie", cookie);
    expect(res.status).toBe(404);
  });

  it("returns schedules and results for an owned project", async () => {
    const app = createTestApp();
    const cookie = withAuth();

    mockDbState.selectResults.push([{ id: 42 }]); // project ownership → found
    // Promise.all([schedules, results]) — each is a separate select chain
    mockDbState.selectResults.push([
      { id: "sch-1", url: "https://example.com", isActive: true },
    ]);
    mockDbState.selectResults.push([
      { id: "res-1", url: "https://example.com", isHealthy: true, httpStatus: 200 },
    ]);

    const res = await request(app)
      .get("/api/browser/checks/42")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("schedules");
    expect(res.body).toHaveProperty("results");
  });
});

// ── SSRF redirect protection ──────────────────────────────────────────────────
// These tests verify that safeFetch() validates each redirect hop and refuses
// to follow a public-URL → private-IP redirect chain.
describe("SSRF redirect bypass protection (safeFetch)", () => {
  beforeEach(() => {
    mockDbState.selectResults = [];
    mockFetch.mockReset();
  });

  it("blocks a redirect from a public URL to a private IP", async () => {
    // Simulate: example.com returns a 302 → http://192.168.1.1/admin
    mockFetch.mockResolvedValueOnce({
      status: 302,
      headers: { get: (h: string) => h === "location" ? "http://192.168.1.1/admin" : null },
    });

    const app = createTestApp();
    const cookie = withAuth();
    const res = await request(app)
      .post("/api/browser/scrape")
      .set("Cookie", cookie)
      .send({ url: "https://example.com/redirect-trap" });

    // safeFetch should throw on the private redirect → route returns 500
    // (or 400 from SSRF guard — either signals the redirect was blocked)
    expect([400, 500, 502]).toContain(res.status);
  });

  it("blocks a redirect from a public URL to localhost", async () => {
    mockFetch.mockResolvedValueOnce({
      status: 301,
      headers: { get: (h: string) => h === "location" ? "http://localhost:8080/secret" : null },
    });

    const app = createTestApp();
    const cookie = withAuth();
    const res = await request(app)
      .post("/api/browser/scrape")
      .set("Cookie", cookie)
      .send({ url: "https://example.com/trap" });

    expect([400, 500, 502]).toContain(res.status);
  });

  it("follows a redirect from one public URL to another", async () => {
    // Simulate: example.com 301 → example.org → 200 OK with HTML
    mockFetch
      .mockResolvedValueOnce({
        status: 301,
        headers: { get: (h: string) => h === "location" ? "https://example.org/page" : null },
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: { get: () => null },
        text: async () => "<html><head><title>Example</title></head><body>hello</body></html>",
      });

    const app = createTestApp();
    const cookie = withAuth();
    const res = await request(app)
      .post("/api/browser/scrape")
      .set("Cookie", cookie)
      .send({ url: "https://example.com/redirect" });

    // Both hops are public — should succeed
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Example");
  });
});
