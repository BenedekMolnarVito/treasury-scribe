/**
 * SplitTransactionService.ts
 *
 * Splits a single parent transaction into multiple child transactions,
 * either by fractional proportions or by explicit amounts.
 *
 * After splitting the parent is soft-deleted and each child inherits
 * the parent's metadata, tags (except "AddedManually"), plus a
 * `SplitFrom:{parentId}` provenance tag.
 */

import type { Database } from "sql.js";
import type { Transaction } from "../models/Transaction";
import {
  getTransactionById,
  addTransaction,
  softDeleteTransaction,
} from "../data/TransactionRepository";
import { addTag, addTagToTransaction } from "../data/TagRepository";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SplitByFraction {
  mode: "fraction";
  fractions: number[];
}

export interface SplitByAmount {
  mode: "amount";
  amounts: number[];
}

export type SplitSpec = SplitByFraction | SplitByAmount;

export interface SplitResult {
  parentId: number;
  children: Transaction[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FRACTION_SUM_TOLERANCE = 0.01;
const EXCLUDED_TAG_NAME = "AddedManually";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function loadAndValidateParent(db: Database, parentId: number): Transaction {
  const parent = getTransactionById(db, parentId);
  if (!parent) {
    throw new Error(`Transaction with id ${parentId} does not exist.`);
  }
  if (parent.isDeleted) {
    throw new Error(`Transaction with id ${parentId} is already deleted.`);
  }
  if (parent.amount === null || parent.amount === undefined) {
    throw new Error(`Transaction with id ${parentId} has no amount and cannot be split.`);
  }
  return parent;
}

function validateFractionSpec(spec: SplitByFraction): void {
  if (spec.fractions.length < 2) {
    throw new Error("Fraction mode requires at least 2 fractions.");
  }
  const sum = spec.fractions.reduce((acc, f) => acc + f, 0);
  if (Math.abs(sum - 1.0) > FRACTION_SUM_TOLERANCE) {
    throw new Error(
      `Fractions must sum to 1.0 (within ±${FRACTION_SUM_TOLERANCE}), but got ${sum}.`
    );
  }
}

function validateAmountSpec(spec: SplitByAmount, parentAmount: number): void {
  if (spec.amounts.length < 1) {
    throw new Error("Amount mode requires at least 1 explicit amount.");
  }
  const explicitSum = spec.amounts.reduce((acc, a) => acc + a, 0);
  if (explicitSum > parentAmount) {
    throw new Error(
      `Sum of provided amounts (${explicitSum}) exceeds parent amount (${parentAmount}).`
    );
  }
  const remainder = parentAmount - explicitSum;
  if (remainder <= 0) {
    throw new Error(
      `Remainder must be > 0, but got ${remainder}. Reduce the provided amounts.`
    );
  }
}

// ---------------------------------------------------------------------------
// Amount resolution
// ---------------------------------------------------------------------------

function resolveChildAmounts(spec: SplitSpec, parentAmount: number): number[] {
  if (spec.mode === "fraction") {
    return spec.fractions.map((f) => Math.round(f * parentAmount * 100) / 100);
  }
  const remainder =
    Math.round((parentAmount - spec.amounts.reduce((a, b) => a + b, 0)) * 100) / 100;
  return [...spec.amounts, remainder];
}

// ---------------------------------------------------------------------------
// Child creation
// ---------------------------------------------------------------------------

function buildChildTitle(
  parentTitle: string | null,
  index: number,
  total: number
): string {
  return `${parentTitle ?? ""} (Split ${index + 1}/${total})`;
}

function collectInheritableTags(parent: Transaction): string[] {
  return parent.transactionTags
    .filter((tt) => tt.tagName !== EXCLUDED_TAG_NAME)
    .map((tt) => tt.tagName)
    .filter((name): name is string => name !== undefined);
}

function createChildTransaction(
  db: Database,
  parent: Transaction,
  amount: number,
  index: number,
  total: number
): Transaction {
  return addTransaction(db, {
    rawContent: parent.rawContent,
    jsonContent: parent.jsonContent,
    receivedAt: parent.receivedAt,
    notificationTitle: buildChildTitle(parent.notificationTitle, index, total),
    notificationBody: parent.notificationBody,
    packageName: parent.packageName,
    isDeleted: false,
    isCash: parent.isCash,
    amount,
    currency: parent.currency,
    isIncome: parent.isIncome,
  });
}

function applyTags(
  db: Database,
  transactionId: number,
  parentId: number,
  inheritedTagNames: string[]
): void {
  const splitFromTag = addTag(db, `SplitFrom:${parentId}`);
  addTagToTransaction(db, transactionId, splitFromTag.id);

  for (const tagName of inheritedTagNames) {
    const tag = addTag(db, tagName);
    addTagToTransaction(db, transactionId, tag.id);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function splitTransaction(
  db: Database,
  parentId: number,
  spec: SplitSpec
): SplitResult {
  const parent = loadAndValidateParent(db, parentId);
  const parentAmount = parent.amount!;

  if (spec.mode === "fraction") {
    validateFractionSpec(spec);
  } else {
    validateAmountSpec(spec, parentAmount);
  }

  const childAmounts = resolveChildAmounts(spec, parentAmount);
  const inheritedTagNames = collectInheritableTags(parent);
  const total = childAmounts.length;

  const children: Transaction[] = [];
  for (let i = 0; i < total; i++) {
    const child = createChildTransaction(db, parent, childAmounts[i], i, total);
    applyTags(db, child.id, parentId, inheritedTagNames);
    // Re-fetch to include the tags we just applied
    const refreshed = getTransactionById(db, child.id)!;
    children.push(refreshed);
  }

  softDeleteTransaction(db, parentId);

  return { parentId, children };
}
