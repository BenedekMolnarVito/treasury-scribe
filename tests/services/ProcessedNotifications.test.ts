/**
 * ProcessedNotifications.test.ts
 *
 * Idempotency guard for shade polling: same shade item polled twice must be
 * recognised; reposts (new post time) must not be suppressed.
 */

// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isShadeNotificationProcessed,
  markShadeNotificationProcessed,
  shadeNotificationKey,
} from "../../src/services/ProcessedNotifications";

const ITEM = {
  packageName: "com.revolut.revolut",
  title: "OBI",
  body: "1 599 Ft összeget fizettél itt: OBI.",
  postedAt: "2024-03-01T12:00:00.000Z",
};

beforeEach(() => {
  // The jsdom build here does not provide working localStorage; stub it.
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string): string | null => store.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      store.set(key, value);
    },
    removeItem: (key: string): void => {
      store.delete(key);
    },
    clear: (): void => {
      store.clear();
    },
  });
  localStorage.clear();
});

describe("shadeNotificationKey", () => {
  it("is stable for identical items", () => {
    expect(shadeNotificationKey(ITEM)).toBe(shadeNotificationKey({ ...ITEM }));
  });

  it("differs when the post time differs (repost)", () => {
    expect(
      shadeNotificationKey({ ...ITEM, postedAt: "2024-03-01T12:05:00.000Z" })
    ).not.toBe(shadeNotificationKey(ITEM));
  });
});

describe("processed set", () => {
  it("starts empty", () => {
    expect(isShadeNotificationProcessed(ITEM)).toBe(false);
  });

  it("recognises an item after marking", () => {
    markShadeNotificationProcessed(ITEM);
    expect(isShadeNotificationProcessed(ITEM)).toBe(true);
  });

  it("does not suppress a repost with a new post time", () => {
    markShadeNotificationProcessed(ITEM);
    expect(
      isShadeNotificationProcessed({
        ...ITEM,
        postedAt: "2024-03-01T12:05:00.000Z",
      })
    ).toBe(false);
  });

  it("expires entries older than the TTL", () => {
    markShadeNotificationProcessed(ITEM, 1_000);
    expect(isShadeNotificationProcessed(ITEM, 2_000)).toBe(true);
    // 8 days later: expired.
    expect(
      isShadeNotificationProcessed(ITEM, 1_000 + 8 * 24 * 60 * 60 * 1000)
    ).toBe(false);
  });

  it("treats corrupt storage as empty instead of throwing", () => {
    localStorage.setItem(
      "treasuryScribe.processedShadeNotifications.v1",
      "not-json{{{"
    );
    expect(isShadeNotificationProcessed(ITEM)).toBe(false);
    expect(() => markShadeNotificationProcessed(ITEM)).not.toThrow();
    expect(isShadeNotificationProcessed(ITEM)).toBe(true);
  });

  it("treats a throwing localStorage as empty instead of crashing", () => {
    vi.stubGlobal("localStorage", {
      getItem: (): string | null => {
        throw new Error("denied");
      },
      setItem: (): void => {
        throw new Error("denied");
      },
      removeItem: (): void => {},
      clear: (): void => {},
    });
    expect(isShadeNotificationProcessed(ITEM)).toBe(false);
    expect(() => markShadeNotificationProcessed(ITEM)).not.toThrow();
  });

  it("ignores entries with wrong types instead of throwing", () => {
    localStorage.setItem(
      "treasuryScribe.processedShadeNotifications.v1",
      JSON.stringify([{ key: 123, at: "x" }, null, { key: "k" }])
    );
    expect(isShadeNotificationProcessed(ITEM)).toBe(false);
    markShadeNotificationProcessed(ITEM);
    expect(isShadeNotificationProcessed(ITEM)).toBe(true);
  });

  it("ignores non-array JSON payloads", () => {
    localStorage.setItem(
      "treasuryScribe.processedShadeNotifications.v1",
      '"just-a-string"'
    );
    expect(isShadeNotificationProcessed(ITEM)).toBe(false);
  });
});
