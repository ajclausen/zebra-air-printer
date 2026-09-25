import type { DatabaseSync } from 'node:sqlite';

export interface SessionRow {
  tokenHash: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

/** Admin password hash (single row) and hashed session tokens. */
export class AdminRepository {
  constructor(private readonly db: DatabaseSync) {}

  passwordHash(): string | null {
    const row = this.db.prepare('SELECT password_hash FROM admin WHERE id = 1').get() as
      | { password_hash: string }
      | undefined;
    return row?.password_hash ?? null;
  }

  /** Inserts the first password; returns false if one already exists. */
  createPassword(hash: string, at: Date): boolean {
    const result = this.db
      .prepare('INSERT OR IGNORE INTO admin (id, password_hash, updated_at) VALUES (1, ?, ?)')
      .run(hash, at.toISOString());
    return result.changes > 0;
  }

  updatePassword(hash: string, at: Date): void {
    this.db.prepare('UPDATE admin SET password_hash = ?, updated_at = ? WHERE id = 1').run(hash, at.toISOString());
  }

  insertSession(tokenHash: string, at: Date, expiresAt: Date): void {
    this.db
      .prepare('INSERT INTO sessions (token_hash, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(tokenHash, at.toISOString(), at.toISOString(), expiresAt.toISOString());
  }

  findSession(tokenHash: string): SessionRow | null {
    const row = this.db
      .prepare('SELECT token_hash, created_at, last_seen_at, expires_at FROM sessions WHERE token_hash = ?')
      .get(tokenHash) as
      | { token_hash: string; created_at: string; last_seen_at: string; expires_at: string }
      | undefined;
    return row
      ? { tokenHash: row.token_hash, createdAt: row.created_at, lastSeenAt: row.last_seen_at, expiresAt: row.expires_at }
      : null;
  }

  touchSession(tokenHash: string, at: Date, expiresAt: Date): void {
    this.db
      .prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?')
      .run(at.toISOString(), expiresAt.toISOString(), tokenHash);
  }

  deleteSession(tokenHash: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  deleteOtherSessions(keepTokenHash: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash <> ?').run(keepTokenHash);
  }

  deleteExpiredSessions(at: Date): number {
    return Number(this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(at.toISOString()).changes);
  }
}
