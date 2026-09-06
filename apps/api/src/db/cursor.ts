/**
 * Cursor pagination (brief §11).
 *
 * Rules enforced:
 *  - A cursor is always (timestamp, id). Timestamps are NOT unique, so any cursor built on
 *    a timestamp alone skips or repeats rows when two records share one (identical
 *    timestamps are normal: bulk inserts, the same millisecond, seeded data).
 *  - Cursors are opaque to clients: they are encoded and returned as `nextCursor`, so a
 *    client cannot hand-craft one and no client depends on our column layout.
 *  - Ordering is fixed and total: `ORDER BY <ts> DESC, id DESC` everywhere, so paging
 *    forwards is stable even when rows are inserted while the user is scrolling.
 *  - The last page returns `nextCursor: null`, never an empty page with a live cursor.
 */

export interface Cursor {
  ts: string;
  id: string;
}

/** Highest possible id for the "same timestamp, anything with a smaller id" boundary. */
export const MAX_ID = '￿';

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify({ t: cursor.ts, i: cursor.id }), 'utf8').toString('base64url');
}

/** Returns null for absent, blank or malformed cursors (a bad cursor is a 400, not a crash). */
export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { t?: unknown; i?: unknown };
    if (typeof parsed.t !== 'string' || typeof parsed.i !== 'string') return null;
    return { ts: parsed.t, id: parsed.i };
  } catch {
    return null;
  }
}

/**
 * Builds the next cursor from the last row of a page.
 * `nextCursor` is null when the page is short, i.e. this was the final page.
 */
export function nextCursorFrom<T extends { id: string }>(
  rows: T[],
  limit: number,
  tsOf: (row: T) => string = (row) => String((row as Record<string, unknown>).created_at),
): string | null {
  if (rows.length === 0 || rows.length < limit) return null;
  const last = rows[rows.length - 1]!;
  return encodeCursor({ ts: tsOf(last), id: last.id });
}
