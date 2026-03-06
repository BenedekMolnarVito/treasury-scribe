/**
 * TransactionTag.ts
 *
 * Domain model for the junction entity that links a Transaction to a Tag.
 */

/**
 * Represents a many-to-many link between a Transaction and a Tag.
 */
export interface TransactionTag {
  /** Auto-incremented primary key. */
  id: number;
  /** Foreign key referencing Transactions.Id. */
  transactionId: number;
  /** Foreign key referencing Tags.Id. */
  tagId: number;
  /** ISO 8601 UTC timestamp when the link was created. */
  createdAt: string;
  /**
   * Eagerly loaded tag name from the Tags table.
   * Populated when transactions are fetched via the repository JOIN query.
   */
  tagName?: string;
}

/**
 * Creates a TransactionTag with required fields and the current UTC timestamp.
 *
 * @param transactionId - The id of the related transaction.
 * @param tagId - The id of the related tag.
 * @param createdAt - ISO 8601 timestamp; defaults to now.
 * @returns A partial TransactionTag (id is assigned by the database).
 */
export function createTransactionTag(
  transactionId: number,
  tagId: number,
  createdAt: string = new Date().toISOString()
): Omit<TransactionTag, "id"> {
  return { transactionId, tagId, createdAt };
}
