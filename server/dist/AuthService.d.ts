export interface AuthResult {
    userId: string;
    displayName: string;
}
export declare class AuthService {
    private readonly supabaseUrl;
    private readonly serviceRoleKey;
    constructor(supabaseUrl: string, serviceRoleKey: string);
    validateToken(token: string): Promise<AuthResult>;
}
