import { createHash, randomBytes } from 'node:crypto';
import type { AdminRepository } from '../db/admin.js';
import { hashPassword, verifyPassword } from './password.js';

export const SESSION_COOKIE = 'eco_admin';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Sliding expiry is only written back once this much time has passed, to avoid a DB write per request. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;
export const MIN_PASSWORD_LENGTH = 8;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export interface Session {
  token: string;
  expiresAt: Date;
}

export interface SessionCheck {
  valid: boolean;
  /** Set when the expiry was extended and the cookie should be re-issued. */
  renewed?: Session;
}

export class AdminAuth {
  constructor(
    private readonly repo: AdminRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  isConfigured(): boolean {
    return this.repo.passwordHash() !== null;
  }

  /** Sets the first password and starts a session. Returns null if a password already exists. */
  async setup(password: string): Promise<Session | null> {
    const hash = await hashPassword(password);
    if (!this.repo.createPassword(hash, this.now())) return null;
    return this.createSession();
  }

  /** Returns a new session, or null for a wrong password (or no password set). */
  async login(password: string): Promise<Session | null> {
    const stored = this.repo.passwordHash();
    if (!stored || !(await verifyPassword(password, stored))) return null;
    return this.createSession();
  }

  logout(token: string | undefined): void {
    if (token) this.repo.deleteSession(hashToken(token));
  }

  checkSession(token: string | undefined): SessionCheck {
    if (!token) return { valid: false };
    const tokenHash = hashToken(token);
    const session = this.repo.findSession(tokenHash);
    const now = this.now();
    if (!session) return { valid: false };
    if (new Date(session.expiresAt) <= now) {
      this.repo.deleteSession(tokenHash);
      return { valid: false };
    }
    if (now.getTime() - new Date(session.lastSeenAt).getTime() < TOUCH_INTERVAL_MS) return { valid: true };
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    this.repo.touchSession(tokenHash, now, expiresAt);
    return { valid: true, renewed: { token, expiresAt } };
  }

  /** Changes the password and signs out every other session. Returns false if `current` is wrong. */
  async changePassword(current: string, next: string, keepToken: string): Promise<boolean> {
    const stored = this.repo.passwordHash();
    if (!stored || !(await verifyPassword(current, stored))) return false;
    this.repo.updatePassword(await hashPassword(next), this.now());
    this.repo.deleteOtherSessions(hashToken(keepToken));
    return true;
  }

  pruneExpiredSessions(): number {
    return this.repo.deleteExpiredSessions(this.now());
  }

  private createSession(): Session {
    const token = randomBytes(32).toString('base64url');
    const now = this.now();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    this.repo.insertSession(hashToken(token), now, expiresAt);
    return { token, expiresAt };
  }
}
