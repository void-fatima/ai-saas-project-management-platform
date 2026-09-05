export interface UserRecord {
  createdAt: Date;
  email: string;
  emailVerifiedAt: Date | null;
  id: string;
  name: string;
  passwordHash: string;
}

export interface PublicUser {
  createdAt: string;
  email: string;
  emailVerified: boolean;
  id: string;
  name: string;
}

export interface ActiveSessionRecord {
  expiresAt: Date;
  id: string;
  rotatedAt: Date;
  tokenHash: string;
  user: UserRecord;
}

export interface AuthContext {
  sessionId: string;
  user: PublicUser;
  userId: string;
}

export interface AuthenticatedRequest {
  auth?: AuthContext;
  headers: {
    cookie?: string;
  };
}

export interface HttpResponse {
  setHeader(name: string, value: string): void;
}
