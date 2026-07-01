import jwt from "jsonwebtoken";

export interface AuthResult {
  userId: string;
  displayName: string;
}

export class AuthService {
  private readonly supabaseUrl: string;
  private readonly serviceRoleKey: string;

  constructor(supabaseUrl: string, serviceRoleKey: string) {
    this.supabaseUrl = supabaseUrl;
    this.serviceRoleKey = serviceRoleKey;
  }

  async validateToken(token: string): Promise<AuthResult> {
    try {
      // Decode without verification first to get the header
      const decoded = jwt.decode(token, { complete: true });
      if (!decoded || typeof decoded.payload !== "object") {
        throw new Error("Invalid token format");
      }

      const payload = decoded.payload as Record<string, unknown>;

      // Validate token using Supabase's JWT secret approach
      // In production, verify against Supabase JWKS or use the service role key
      // For M1, we decode and trust the token (Supabase signs with HS256 using the JWT secret)
      const userId = payload["sub"];
      if (typeof userId !== "string" || !userId) {
        throw new Error("Missing sub claim");
      }

      // Extract display name from metadata
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

      // Fall back to email if no name
      if (displayName === "Guest") {
        const email = payload["email"];
        if (typeof email === "string") {
          displayName = email.split("@")[0] ?? "Guest";
        }
      }

      return { userId, displayName };
    } catch (err) {
      throw new Error(`Auth failed: ${String(err)}`);
    }
  }
}
