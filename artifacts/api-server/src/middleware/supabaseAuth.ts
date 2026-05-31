import { createRemoteJWKSet, jwtVerify } from "jose";

const SUPABASE_URL = process.env.SUPABASE_URL ?? 
  "https://lmrpnsjckljdwqudtelk.supabase.co";

const JWKS = createRemoteJWKSet(
  new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`)
);

export async function supabaseAuth(
  req: any, 
  res: any, 
  next: any
) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") 
      ? header.slice(7) 
      : null;
    
    if (!token) {
      return res.status(401).json({ 
        error: "missing_token" 
      });
    }

    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `${SUPABASE_URL}/auth/v1`,
    });

    req.supabaseUser = {
      supabaseId: payload.sub,
      email: payload.email,
    };
    next();
  } catch (err) {
    return res.status(401).json({ 
      error: "invalid_token", 
      detail: String(err) 
    });
  }
}
