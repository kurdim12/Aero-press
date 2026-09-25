// Set-based helpers so a chunk of rows costs one query, not one per row.

/**
 * INSERT OR IGNORE many rows in one statement: the rows travel as a single JSON
 * parameter and json_each unpacks them. `fixed` values apply to every row.
 * Table and column names must be code constants, never user input.
 */
export function insertJsonRows(
  db: D1Database,
  table: string,
  fixed: Record<string, string | number | null>,
  columns: readonly string[],
  rows: readonly object[],
): D1PreparedStatement {
  const fixedNames = Object.keys(fixed);
  const names = [...fixedNames, ...columns].join(', ');
  const values = [...fixedNames.map(() => '?'), ...columns.map((col) => `json_extract(value, '$.${col}')`)].join(', ');
  const payload = rows.map((row) => {
    const r = row as Record<string, unknown>;
    return Object.fromEntries(columns.map((col) => [col, typeof r[col] === 'boolean' ? (r[col] ? 1 : 0) : (r[col] ?? null)]));
  });
  return db
    .prepare(`INSERT OR IGNORE INTO ${table} (${names}) SELECT ${values} FROM json_each(?)`)
    .bind(...Object.values(fixed), JSON.stringify(payload));
}

/** Which of `ids` already exist in `table` (optionally within one team). */
export async function existingIds(
  db: D1Database,
  table: 'beans' | 'recipes' | 'brews' | 'duels',
  ids: readonly string[],
  teamId?: string,
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const teamClause = teamId ? 'team_id = ? AND ' : '';
  const params = teamId ? [teamId, JSON.stringify(ids)] : [JSON.stringify(ids)];
  const { results } = await db
    .prepare(`SELECT id FROM ${table} WHERE ${teamClause}id IN (SELECT value FROM json_each(?))`)
    .bind(...params)
    .all<{ id: string }>();
  return new Set(results.map((r) => r.id));
}
