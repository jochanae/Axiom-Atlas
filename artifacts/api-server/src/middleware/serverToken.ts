import type { Request, Response, NextFunction } from "express";

const SERVER_TOKEN = process.env.RAILWAY_API_TOKEN;

export function serverTokenAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!SERVER_TOKEN) {
    res.status(503).json({ error: "Server-to-server auth not configured" });
    return;
  }
  const header = req.headers["x-railway-token"];
  if (!header || header !== SERVER_TOKEN) {
    res.status(401).json({ error: "Invalid server token" });
    return;
  }
  next();
}
