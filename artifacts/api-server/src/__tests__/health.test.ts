import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import express from "express";

vi.mock("@workspace/db", () => ({
  db: {
    execute: vi.fn(() => Promise.resolve([{ "?column?": 1 }])),
  },
}));

import healthRouter from "../routes/health";

const app = express();
app.use("/api", healthRouter);

describe("GET /api/healthz", () => {
  it("returns 200", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(200);
  });

  it("returns { status: 'ok' }", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.body).toEqual({ status: "ok" });
  });

  it("responds with JSON", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });
});
