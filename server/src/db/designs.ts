import type { DatabaseSync } from 'node:sqlite';
import type { Design, DesignInput, DesignKind, DesignSummary, DesignVariable, Orientation } from '@eco/shared';
import { newId } from '../ids.js';

interface DesignRow {
  id: string;
  name: string;
  kind: DesignKind;
  category: string | null;
  orientation: Orientation;
  thumbnail: string | null;
  variables: string;
  document?: string;
  created_at: string;
  updated_at: string;
  last_printed_at: string | null;
  print_count: number;
  deleted_at: string | null;
}

export interface DesignQuery {
  kind?: DesignKind;
  /** Case-insensitive substring match on name or category. */
  q?: string;
  category?: string;
  /** When true, soft-deleted designs are included. */
  includeDeleted?: boolean;
}

const SUMMARY_COLUMNS =
  'id, name, kind, category, orientation, thumbnail, variables, created_at, updated_at, last_printed_at, print_count, deleted_at';

function toSummary(row: DesignRow): DesignSummary {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    category: row.category,
    orientation: row.orientation,
    thumbnail: row.thumbnail,
    variables: JSON.parse(row.variables) as DesignVariable[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastPrintedAt: row.last_printed_at,
    printCount: row.print_count,
    deletedAt: row.deleted_at,
  };
}

function toDesign(row: DesignRow): Design {
  return { ...toSummary(row), document: JSON.parse(row.document ?? 'null') as unknown };
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export class DesignRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(query: DesignQuery = {}): DesignSummary[] {
    const where: string[] = [];
    const params: Record<string, string> = {};
    if (!query.includeDeleted) where.push('deleted_at IS NULL');
    if (query.kind) {
      where.push('kind = :kind');
      params.kind = query.kind;
    }
    if (query.category) {
      where.push('category = :category');
      params.category = query.category;
    }
    if (query.q) {
      where.push("(name LIKE :q ESCAPE '\\' OR category LIKE :q ESCAPE '\\')");
      params.q = `%${escapeLike(query.q)}%`;
    }
    const sql = `SELECT ${SUMMARY_COLUMNS} FROM designs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC, id`;
    return (this.db.prepare(sql).all(params) as unknown as DesignRow[]).map(toSummary);
  }

  get(id: string): Design | null {
    const row = this.db.prepare('SELECT * FROM designs WHERE id = ?').get(id) as DesignRow | undefined;
    return row ? toDesign(row) : null;
  }

  exists(id: string): boolean {
    return this.db.prepare('SELECT 1 FROM designs WHERE id = ?').get(id) !== undefined;
  }

  create(input: DesignInput): Design {
    const id = newId();
    const at = this.now().toISOString();
    this.db
      .prepare(
        `INSERT INTO designs (id, name, kind, category, orientation, thumbnail, variables, document, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.kind,
        input.category ?? null,
        input.orientation,
        input.thumbnail ?? null,
        JSON.stringify(input.variables ?? []),
        JSON.stringify(input.document ?? null),
        at,
        at,
      );
    return this.get(id)!;
  }

  update(id: string, input: DesignInput): Design | null {
    const result = this.db
      .prepare(
        `UPDATE designs SET name = ?, kind = ?, category = ?, orientation = ?, thumbnail = ?, variables = ?,
           document = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        input.name,
        input.kind,
        input.category ?? null,
        input.orientation,
        input.thumbnail ?? null,
        JSON.stringify(input.variables ?? []),
        JSON.stringify(input.document ?? null),
        this.now().toISOString(),
        id,
      );
    return result.changes > 0 ? this.get(id) : null;
  }

  duplicate(id: string): Design | null {
    const source = this.get(id);
    if (!source) return null;
    return this.create({
      name: `${source.name} (copy)`,
      kind: source.kind,
      category: source.category,
      orientation: source.orientation,
      thumbnail: source.thumbnail,
      variables: source.variables,
      document: source.document,
    });
  }

  softDelete(id: string): boolean {
    const at = this.now().toISOString();
    const result = this.db
      .prepare('UPDATE designs SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ?')
      .run(at, id);
    return result.changes > 0;
  }

  restore(id: string): Design | null {
    const result = this.db.prepare('UPDATE designs SET deleted_at = NULL WHERE id = ?').run(id);
    return result.changes > 0 ? this.get(id) : null;
  }

  purge(id: string): boolean {
    return this.db.prepare('DELETE FROM designs WHERE id = ?').run(id).changes > 0;
  }

  recordPrint(id: string, at: Date): void {
    this.db
      .prepare('UPDATE designs SET last_printed_at = ?, print_count = print_count + 1 WHERE id = ?')
      .run(at.toISOString(), id);
  }
}
