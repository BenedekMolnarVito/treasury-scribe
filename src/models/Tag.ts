/**
 * Tag.ts
 *
 * Domain model for a Tag entity persisted in the Tags table.
 */

import type { TransactionTag } from "./TransactionTag";

/**
 * Represents a user-defined tag that can be linked to transactions.
 */
export interface Tag {
  /** Auto-incremented primary key. */
  id: number;
  /** Unique tag name. */
  name: string;
  /** ISO 8601 UTC timestamp of last use. */
  lastUsedAt: string;
  /** Navigation: all junction rows linking this tag to transactions. */
  transactionTags: TransactionTag[];
}

/**
 * Creates a Tag with required fields and sensible defaults.
 *
 * @param name - Unique tag name.
 * @param lastUsedAt - ISO 8601 timestamp; defaults to the current UTC time.
 * @returns A partial Tag (id is assigned by the database).
 */
export function createTag(
  name: string,
  lastUsedAt: string = new Date().toISOString()
): Omit<Tag, "id"> {
  return {
    name,
    lastUsedAt,
    transactionTags: [],
  };
}
