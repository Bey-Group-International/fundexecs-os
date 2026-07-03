import jwt from "jsonwebtoken";

export interface AuthResult {
  userId: string;
  displayName: string;
}

export class AuthService {
  private readonly supabaseUrl: string;
  private readonly serviceRoleKey: string;
  private readonly jwtSecret: string;

  constructor(supabaseUrl: string, serviceRoleKey: string, jwtSecret?: string) {
    this.supabaseUrl = supabaseUrl;
    this.serviceRoleKey = serviceRoleKey;
    // Supabase signs session JWTs with HS256 using the project's JWT secret.
    // Verifying the signature is the only thing that makes this gateway safe:
    // without it any forged `{sub, user_metadata}` payload grants a real-time
    // audio/video seat under any identity in any room.
    this.jwtSecret = jwtSecret ?? process.env.SUPABASE_JWT_SECRET ?? "";
  }

  async validateToken(token: string): Promise<AuthResult> {
    if (!this.jwtSecret) {
      // Fail closed: an unconfigured secret must never fall back to "decode and
      // trust". Set SUPABASE_JWT_SECRET (Supabase → Project Settings → API →
      // JWT Secret) on the gateway service.
      throw new Error("Auth misconfigured: SUPABASE_JWT_SECRET is not set");
    }

    let payload: Record<string, unknown>;
    try {
      // verify (NOT decode): checks the HS256 signature and the `exp` claim,
      // rejecting forged or expired tokens.
      const verified = jwt.verify(token, this.jwtSecret, {
        algorithms: ["HS256"],
      });
      if (!verified || typeof verified !== "object") {
        throw new Error("Invalid token payload");
      }
      payload = verified as Record<string, unknown>;
    } catch (err) {
      throw new Error(`Auth failed: ${String(err)}`);
    }

    const userId = payload["sub"];
    if (typeof userId !== "string" || !userId) {
      throw new Error("Missing sub claim");
    }

    // Extract display name from verified metadata.
    const userMetadata = payload["user_metadata"];
    let displayName = "Guest";
    if (userMetadata && typeof userMetadata === "object") {
      const meta = userMetadata as Record<string, unknown>;
      if (typeof meta["full_name"] === "string") {
        displayName = meta["full_name"];
      } else if (typeof meta["name"] === "string") {
        displayName = meta["name"];
      }
    }

    // Fall back to email if no name.
    if (displayName === "Guest") {
      const email = payload["email"];
      if (typeof email === "string") {
        displayName = email.split("@")[0] ?? "Guest";
      }
    }

    return { userId, displayName };
  }
}
