/**
 * models.test.ts
 *
 * Unit tests for domain model factories and computed properties.
 * No database required – tests run in pure TypeScript.
 */

import { describe, it, expect } from "vitest";
import {
  createTransaction,
  withComputedProps,
} from "../../src/models/Transaction";
import type { Transaction } from "../../src/models/Transaction";
import { createTag } from "../../src/models/Tag";
import { createTransactionTag } from "../../src/models/TransactionTag";

// ---------------------------------------------------------------------------
// Transaction – createTransaction defaults
// ---------------------------------------------------------------------------

describe("createTransaction – defaults", () => {
  it("sets isDeleted to false by default", () => {
    const tx = createTransaction({ receivedAt: "2024-01-01T00:00:00.000Z" });
    expect(tx.isDeleted).toBe(false);
  });

  it("sets isCash to false by default", () => {
    const tx = createTransaction({ receivedAt: "2024-01-01T00:00:00.000Z" });
    expect(tx.isCash).toBe(false);
  });

  it("sets isIncome to false by default", () => {
    const tx = createTransaction({ receivedAt: "2024-01-01T00:00:00.000Z" });
    expect(tx.isIncome).toBe(false);
  });

  it("sets excludeFromAutoLearn to false by default (FR8)", () => {
    const tx = createTransaction({ receivedAt: "2024-01-01T00:00:00.000Z" });
    expect(tx.excludeFromAutoLearn).toBe(false);
  });

  it("respects excludeFromAutoLearn=true when explicitly set (FR8)", () => {
    const tx = createTransaction({
      receivedAt: "2024-01-01T00:00:00.000Z",
      excludeFromAutoLearn: true,
    });
    expect(tx.excludeFromAutoLearn).toBe(true);
  });

  it("sets rawContent to null by default", () => {
    const tx = createTransaction({ receivedAt: "2024-01-01T00:00:00.000Z" });
    expect(tx.rawContent).toBeNull();
  });

  it("sets jsonContent to null by default", () => {
    const tx = createTransaction({ receivedAt: "2024-01-01T00:00:00.000Z" });
    expect(tx.jsonContent).toBeNull();
  });

  it("sets notificationTitle to null by default", () => {
    const tx = createTransaction({ receivedAt: "2024-01-01T00:00:00.000Z" });
    expect(tx.notificationTitle).toBeNull();
  });

  it("sets notificationBody to null by default", () => {
    const tx = createTransaction({ receivedAt: "2024-01-01T00:00:00.000Z" });
    expect(tx.notificationBody).toBeNull();
  });

  it("sets packageName to null by default", () => {
    const tx = createTransaction({ receivedAt: "2024-01-01T00:00:00.000Z" });
    expect(tx.packageName).toBeNull();
  });

  it("sets amount to null by default", () => {
    const tx = createTransaction({ receivedAt: "2024-01-01T00:00:00.000Z" });
    expect(tx.amount).toBeNull();
  });

  it("sets currency to null by default", () => {
    const tx = createTransaction({ receivedAt: "2024-01-01T00:00:00.000Z" });
    expect(tx.currency).toBeNull();
  });

  it("sets transactionTags to an empty array by default", () => {
    const tx = createTransaction({ receivedAt: "2024-01-01T00:00:00.000Z" });
    expect(tx.transactionTags).toEqual([]);
  });

  it("preserves a provided receivedAt value", () => {
    const ts = "2024-06-15T12:00:00.000Z";
    const tx = createTransaction({ receivedAt: ts });
    expect(tx.receivedAt).toBe(ts);
  });

  it("accepts and stores optional field overrides", () => {
    const tx = createTransaction({
      receivedAt: "2024-01-01T00:00:00.000Z",
      notificationTitle: "Test Title",
      notificationBody: "Test Body",
      packageName: "com.example",
      amount: 99.99,
      currency: "EUR",
      isDeleted: true,
      isCash: true,
      isIncome: true,
    });

    expect(tx.notificationTitle).toBe("Test Title");
    expect(tx.notificationBody).toBe("Test Body");
    expect(tx.packageName).toBe("com.example");
    expect(tx.amount).toBe(99.99);
    expect(tx.currency).toBe("EUR");
    expect(tx.isDeleted).toBe(true);
    expect(tx.isCash).toBe(true);
    expect(tx.isIncome).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Transaction – parsedAmount computed property
// ---------------------------------------------------------------------------

describe("Transaction.parsedAmount – fallback logic", () => {
  it("returns amount directly when amount is non-null", () => {
    const tx = createTransaction({
      receivedAt: "2024-01-01T00:00:00.000Z",
      amount: 42.5,
      currency: "EUR",
    });
    expect(tx.parsedAmount).toBe(42.5);
  });

  it("returns null when amount is null and jsonContent is null", () => {
    const tx = createTransaction({ receivedAt: "2024-01-01T00:00:00.000Z" });
    expect(tx.parsedAmount).toBeNull();
  });

  it("falls back to amount in jsonContent when transaction amount is null", () => {
    const tx = createTransaction({
      receivedAt: "2024-01-01T00:00:00.000Z",
      amount: null,
      jsonContent: JSON.stringify({ amount: 123.45, currency: "HUF" }),
    });
    expect(tx.parsedAmount).toBeCloseTo(123.45);
  });

  it("returns null when amount is null and jsonContent has no numeric amount", () => {
    const tx = createTransaction({
      receivedAt: "2024-01-01T00:00:00.000Z",
      amount: null,
      jsonContent: JSON.stringify({ currency: "EUR" }),
    });
    expect(tx.parsedAmount).toBeNull();
  });

  it("returns null when amount is null and jsonContent is invalid JSON", () => {
    const tx = createTransaction({
      receivedAt: "2024-01-01T00:00:00.000Z",
      amount: null,
      jsonContent: "not-valid-json",
    });
    expect(tx.parsedAmount).toBeNull();
  });

  it("prefers explicit amount over jsonContent amount", () => {
    const tx = createTransaction({
      receivedAt: "2024-01-01T00:00:00.000Z",
      amount: 10,
      jsonContent: JSON.stringify({ amount: 999 }),
    });
    expect(tx.parsedAmount).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Transaction – parsedCurrency computed property
// ---------------------------------------------------------------------------

describe("Transaction.parsedCurrency – fallback logic", () => {
  it("returns currency directly when currency is non-null", () => {
    const tx = createTransaction({
      receivedAt: "2024-01-01T00:00:00.000Z",
      currency: "USD",
    });
    expect(tx.parsedCurrency).toBe("USD");
  });

  it("returns null when currency is null and jsonContent is null", () => {
    const tx = createTransaction({ receivedAt: "2024-01-01T00:00:00.000Z" });
    expect(tx.parsedCurrency).toBeNull();
  });

  it("falls back to currency in jsonContent when transaction currency is null", () => {
    const tx = createTransaction({
      receivedAt: "2024-01-01T00:00:00.000Z",
      currency: null,
      jsonContent: JSON.stringify({ amount: 50, currency: "GBP" }),
    });
    expect(tx.parsedCurrency).toBe("GBP");
  });

  it("returns null when currency is null and jsonContent has no string currency", () => {
    const tx = createTransaction({
      receivedAt: "2024-01-01T00:00:00.000Z",
      currency: null,
      jsonContent: JSON.stringify({ amount: 50 }),
    });
    expect(tx.parsedCurrency).toBeNull();
  });

  it("returns null when currency is null and jsonContent is invalid JSON", () => {
    const tx = createTransaction({
      receivedAt: "2024-01-01T00:00:00.000Z",
      currency: null,
      jsonContent: "{{broken",
    });
    expect(tx.parsedCurrency).toBeNull();
  });

  it("prefers explicit currency over jsonContent currency", () => {
    const tx = createTransaction({
      receivedAt: "2024-01-01T00:00:00.000Z",
      currency: "EUR",
      jsonContent: JSON.stringify({ currency: "USD" }),
    });
    expect(tx.parsedCurrency).toBe("EUR");
  });

  it("returns null when jsonContent currency is an empty string", () => {
    const tx = createTransaction({
      receivedAt: "2024-01-01T00:00:00.000Z",
      currency: null,
      jsonContent: JSON.stringify({ currency: "" }),
    });
    expect(tx.parsedCurrency).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// withComputedProps – attaches getters to raw objects
// ---------------------------------------------------------------------------

describe("withComputedProps", () => {
  it("adds parsedAmount getter that returns amount when non-null", () => {
    const raw = {
      id: 1,
      rawContent: null,
      jsonContent: null,
      receivedAt: "2024-01-01T00:00:00.000Z",
      notificationTitle: null,
      notificationBody: null,
      packageName: null,
      isDeleted: false,
      isCash: false,
      amount: 77,
      currency: "EUR",
      isIncome: false,
      excludeFromAutoLearn: false,
      transactionTags: [],
      parsedAmount: null,
      parsedCurrency: null,
    } as Transaction;

    const tx = withComputedProps(raw);
    expect(tx.parsedAmount).toBe(77);
  });

  it("adds parsedCurrency getter that falls back to jsonContent", () => {
    const raw = {
      id: 2,
      rawContent: null,
      jsonContent: JSON.stringify({ currency: "JPY" }),
      receivedAt: "2024-01-01T00:00:00.000Z",
      notificationTitle: null,
      notificationBody: null,
      packageName: null,
      isDeleted: false,
      isCash: false,
      amount: null,
      currency: null,
      isIncome: false,
      excludeFromAutoLearn: false,
      transactionTags: [],
      parsedAmount: null,
      parsedCurrency: null,
    } as Transaction;

    const tx = withComputedProps(raw);
    expect(tx.parsedCurrency).toBe("JPY");
  });
});

// ---------------------------------------------------------------------------
// Tag – createTag defaults
// ---------------------------------------------------------------------------

describe("createTag – defaults", () => {
  it("sets the name to the provided value", () => {
    const tag = createTag("groceries");
    expect(tag.name).toBe("groceries");
  });

  it("sets transactionTags to an empty array", () => {
    const tag = createTag("groceries");
    expect(tag.transactionTags).toEqual([]);
  });

  it("sets a non-empty lastUsedAt by default", () => {
    const tag = createTag("groceries");
    expect(tag.lastUsedAt).toBeTruthy();
    // Should be a valid ISO date string
    expect(new Date(tag.lastUsedAt).toISOString()).toBe(tag.lastUsedAt);
  });

  it("uses provided lastUsedAt when supplied", () => {
    const ts = "2024-06-01T00:00:00.000Z";
    const tag = createTag("food", ts);
    expect(tag.lastUsedAt).toBe(ts);
  });

  it("does not include an id field (assigned by DB)", () => {
    const tag = createTag("groceries");
    expect("id" in tag).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TransactionTag – createTransactionTag
// ---------------------------------------------------------------------------

describe("createTransactionTag", () => {
  it("sets transactionId and tagId correctly", () => {
    const tt = createTransactionTag(10, 20);
    expect(tt.transactionId).toBe(10);
    expect(tt.tagId).toBe(20);
  });

  it("sets a non-empty createdAt by default", () => {
    const tt = createTransactionTag(1, 2);
    expect(tt.createdAt).toBeTruthy();
    expect(new Date(tt.createdAt).toISOString()).toBe(tt.createdAt);
  });

  it("uses provided createdAt when supplied", () => {
    const ts = "2024-03-01T10:00:00.000Z";
    const tt = createTransactionTag(5, 7, ts);
    expect(tt.createdAt).toBe(ts);
  });

  it("does not include an id field (assigned by DB)", () => {
    const tt = createTransactionTag(1, 2);
    expect("id" in tt).toBe(false);
  });
});
