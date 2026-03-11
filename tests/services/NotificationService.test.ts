/**
 * NotificationService.test.ts
 *
 * Unit tests for NotificationService business logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isRevolutNotification,
  parseAmountAndCurrency,
  createTransactionFromNotification,
} from "../../src/services/NotificationService";

// ---------------------------------------------------------------------------
// isRevolutNotification
// ---------------------------------------------------------------------------

describe("isRevolutNotification", () => {
  it("returns true for the exact Revolut package name", () => {
    expect(isRevolutNotification("com.revolut.revolut")).toBe(true);
  });

  it("returns false for a different package name", () => {
    expect(isRevolutNotification("com.revolut.revolut.extra")).toBe(false);
  });

  it("returns false for a partial match", () => {
    expect(isRevolutNotification("com.revolut")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isRevolutNotification("")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isRevolutNotification(null)).toBe(false);
  });

  it("returns false for a completely unrelated package name", () => {
    expect(isRevolutNotification("com.example.bank")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseAmountAndCurrency
// ---------------------------------------------------------------------------

describe("parseAmountAndCurrency", () => {
  // European format: period thousands separator, comma decimal separator
  describe("European format (1.234,56 EUR)", () => {
    it("parses amount and currency", () => {
      const result = parseAmountAndCurrency("You paid 1.234,56 EUR today");
      expect(result.amount).toBeCloseTo(1234.56);
      expect(result.currency).toBe("EUR");
    });

    it("handles no thousands separator", () => {
      const result = parseAmountAndCurrency("234,56 EUR");
      expect(result.amount).toBeCloseTo(234.56);
      expect(result.currency).toBe("EUR");
    });

    it("handles the € symbol as currency", () => {
      const result = parseAmountAndCurrency("1.234,56€");
      expect(result.amount).toBeCloseTo(1234.56);
      expect(result.currency).toBe("EUR");
    });
  });

  // US format: comma thousands separator, period decimal separator
  describe("US format ($1,234.56)", () => {
    it("parses leading dollar sign with comma thousands", () => {
      const result = parseAmountAndCurrency("Charged $1,234.56");
      expect(result.amount).toBeCloseTo(1234.56);
      expect(result.currency).toBe("USD");
    });

    it("parses trailing ISO code with comma thousands", () => {
      const result = parseAmountAndCurrency("Total 1,234.56 USD");
      expect(result.amount).toBeCloseTo(1234.56);
      expect(result.currency).toBe("USD");
    });
  });

  // Symbol-prefixed plain: $50.00
  describe("Symbol-prefixed plain format ($50.00)", () => {
    it("parses dollar-prefixed amount without thousands", () => {
      const result = parseAmountAndCurrency("Payment of $50.00 received");
      expect(result.amount).toBeCloseTo(50.0);
      expect(result.currency).toBe("USD");
    });

    it("parses euro-prefixed amount", () => {
      const result = parseAmountAndCurrency("€25.99 charged");
      expect(result.amount).toBeCloseTo(25.99);
      expect(result.currency).toBe("EUR");
    });
  });

  // Space-separated with trailing code: 6 337 Ft
  describe("Space-separated format (6 337 Ft)", () => {
    it("parses space-grouped digits with Ft suffix", () => {
      const result = parseAmountAndCurrency("Fizetés: 6 337 Ft");
      expect(result.amount).toBeCloseTo(6337);
      expect(result.currency).toBe("HUF");
    });

    it("parses space-grouped digits with HUF suffix", () => {
      const result = parseAmountAndCurrency("Transaction 10 000 HUF");
      expect(result.amount).toBeCloseTo(10000);
      expect(result.currency).toBe("HUF");
    });
  });

  // Code-prefixed space-separated: HUF 1 234
  describe("Plain code-prefixed format (HUF 1 234)", () => {
    it("parses ISO code prefix with space-grouped digits", () => {
      const result = parseAmountAndCurrency("HUF 1 234");
      expect(result.amount).toBeCloseTo(1234);
      expect(result.currency).toBe("HUF");
    });

    it("parses EUR prefix with simple amount", () => {
      const result = parseAmountAndCurrency("EUR 500");
      expect(result.amount).toBeCloseTo(500);
      expect(result.currency).toBe("EUR");
    });
  });

  // Edge cases
  describe("edge cases", () => {
    it("returns null amount and currency for empty string", () => {
      const result = parseAmountAndCurrency("");
      expect(result.amount).toBeNull();
      expect(result.currency).toBeNull();
    });

    it("returns null amount and currency for null input", () => {
      const result = parseAmountAndCurrency(null);
      expect(result.amount).toBeNull();
      expect(result.currency).toBeNull();
    });

    it("returns null currency for text with only a bare number", () => {
      const result = parseAmountAndCurrency("Amount: 42");
      expect(result.amount).toBeCloseTo(42);
      expect(result.currency).toBeNull();
    });

    it("returns null amount and null currency for text with no digits", () => {
      // All try-parse helpers require at least one digit — none should match.
      expect(parseAmountAndCurrency("no digits here")).toEqual({
        amount: null,
        currency: null,
      });
    });

    it("returns null amount and null currency for a currency-code-only string", () => {
      // "EUR" alone matches no format because every format requires digits.
      expect(parseAmountAndCurrency("EUR")).toEqual({
        amount: null,
        currency: null,
      });
    });
  });

  // MC/DC: US format — trailing currency symbol (groups 3 & 4 with a symbol token)
  describe("US format – trailing currency symbol", () => {
    it("parses amount with trailing dollar symbol: '100 $'", () => {
      // Exercises the tryParseUS groups-3&4 path with a symbol instead of ISO code.
      const result = parseAmountAndCurrency("You owe 100 $");
      expect(result.amount).toBeCloseTo(100);
      expect(result.currency).toBe("USD");
    });

    it("parses amount with trailing euro symbol: '25.50 €'", () => {
      const result = parseAmountAndCurrency("Total 25.50 €");
      expect(result.amount).toBeCloseTo(25.5);
      expect(result.currency).toBe("EUR");
    });
  });

  // Format priority — European wins over US when both could match
  describe("format priority", () => {
    it("European format takes priority over bare-number fallback", () => {
      // "1.234,56 EUR" must be parsed as European (1234.56), not as "1" bare.
      const result = parseAmountAndCurrency("1.234,56 EUR");
      expect(result.amount).toBeCloseTo(1234.56);
      expect(result.currency).toBe("EUR");
    });
  });
});

// ---------------------------------------------------------------------------
// createTransactionFromNotification
// ---------------------------------------------------------------------------

describe("createTransactionFromNotification", () => {
  const FIXED_ISO = "2024-06-15T12:00:00.000Z";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_ISO));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sets receivedAt to the current UTC ISO 8601 timestamp", () => {
    const tx = createTransactionFromNotification(
      "Payment received",
      "You received $50.00",
      "com.revolut.revolut"
    );
    expect(tx.receivedAt).toBe(FIXED_ISO);
  });

  it("defaults currency to HUF when none is detected", () => {
    const tx = createTransactionFromNotification(
      "Alert",
      "Unknown notification text without currency",
      "com.example.app"
    );
    expect(tx.currency).toBe("HUF");
  });

  it("uses detected currency when present", () => {
    const tx = createTransactionFromNotification(
      "Revolut",
      "You paid 1.234,56 EUR",
      "com.revolut.revolut"
    );
    expect(tx.currency).toBe("EUR");
    expect(tx.amount).toBeCloseTo(1234.56);
  });

  it("jsonContent contains title, body, packageName, timestamp, rawText, amount, currency", () => {
    const title = "Bank Alert";
    const body = "Transaction $75.00";
    const packageName = "com.example.bank";
    const tx = createTransactionFromNotification(title, body, packageName);

    const json = JSON.parse(tx.jsonContent as string);
    expect(json.title).toBe(title);
    expect(json.body).toBe(body);
    expect(json.packageName).toBe(packageName);
    expect(json.timestamp).toBe(FIXED_ISO);
    expect(json.rawText).toBe(`${title} ${body}`);
    expect(json.amount).toBeCloseTo(75.0);
    expect(json.currency).toBe("USD");
  });

  it("sets notificationTitle and notificationBody correctly", () => {
    const tx = createTransactionFromNotification(
      "My Title",
      "My Body",
      "com.example"
    );
    expect(tx.notificationTitle).toBe("My Title");
    expect(tx.notificationBody).toBe("My Body");
  });

  it("handles null title and body gracefully", () => {
    const tx = createTransactionFromNotification(null, null, "com.example");
    expect(tx.rawContent).toBeNull();
    expect(tx.currency).toBe("HUF");
  });

  it("rawContent is the concatenated title and body", () => {
    const tx = createTransactionFromNotification(
      "Title",
      "Body text",
      "com.example"
    );
    expect(tx.rawContent).toBe("Title Body text");
  });

  it("sets isDeleted to false by default", () => {
    const tx = createTransactionFromNotification("T", "B", "com.example");
    expect(tx.isDeleted).toBe(false);
  });

  it("sets isCash to false by default", () => {
    const tx = createTransactionFromNotification("T", "B", "com.example");
    expect(tx.isCash).toBe(false);
  });

  it("uses the supplied posted timestamp when provided", () => {
    const tx = createTransactionFromNotification(
      "Payment received",
      "You received $50.00",
      "com.revolut.revolut",
      "2024-06-15T11:59:00.000Z"
    );
    expect(tx.receivedAt).toBe("2024-06-15T11:59:00.000Z");

    const json = JSON.parse(tx.jsonContent as string);
    expect(json.timestamp).toBe("2024-06-15T11:59:00.000Z");
  });
});
