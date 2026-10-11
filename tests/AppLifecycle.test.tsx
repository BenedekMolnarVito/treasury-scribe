/**
 * AppLifecycle.test.tsx
 *
 * Verifies that the native notification bootstrap re-checks permissions when
 * the app regains focus after returning from Android settings.
 */

// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";

const {
  mockDb,
  listenerHandle,
  loadPersistedDatabaseMock,
  persistDatabaseMock,
  notificationListenerMock,
  ingestNotificationMock,
} = vi.hoisted(() => ({
  mockDb: { close: vi.fn() },
  listenerHandle: { remove: vi.fn() },
  loadPersistedDatabaseMock: vi.fn(),
  persistDatabaseMock: vi.fn(),
  ingestNotificationMock: vi.fn(),
  notificationListenerMock: {
    addListener: vi.fn(),
    isNotificationAccessGranted: vi.fn(),
    openNotificationAccessSettings: vi.fn(),
    requestPostNotificationsPermission: vi.fn(),
    isBatteryOptimizationExcluded: vi.fn(),
    openBatteryOptimizationSettings: vi.fn(),
    showAutoStartGuidance: vi.fn(),
    startListening: vi.fn(),
    stopListening: vi.fn(),
    getActiveNotifications: vi.fn(),
  },
}));

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: "mock-sql-wasm-url",
}));

vi.mock("../src/data/DatabaseService", () => ({
  loadPersistedDatabase: loadPersistedDatabaseMock,
  persistDatabase: persistDatabaseMock,
}));

vi.mock("../src/plugins/NotificationListenerPlugin", () => ({
  NotificationListener: notificationListenerMock,
}));

vi.mock("../src/services/IngestionService", () => ({
  ingestNotification: ingestNotificationMock,
}));

vi.mock("../src/pages/TransactionsPage", () => ({
  default: () => <div>Transactions page mock</div>,
}));

vi.mock("../src/pages/EditTransactionPage", () => ({
  default: () => <div>Edit transaction page mock</div>,
}));

vi.mock("../src/pages/DashboardPage", () => ({
  default: () => <div>Dashboard page mock</div>,
}));

describe("App notification lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Deterministic localStorage: the jsdom build here does not provide a
    // working one, and App/ProcessedNotifications access it defensively.
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
    loadPersistedDatabaseMock.mockResolvedValue(mockDb);
    ingestNotificationMock.mockReturnValue({ id: "tx-1", transactionTags: [] });
    notificationListenerMock.addListener.mockResolvedValue(listenerHandle);
    notificationListenerMock.openNotificationAccessSettings.mockResolvedValue(
      undefined
    );
    notificationListenerMock.requestPostNotificationsPermission.mockResolvedValue(
      { granted: true }
    );
    notificationListenerMock.isBatteryOptimizationExcluded.mockResolvedValue({
      granted: true,
    });
    notificationListenerMock.openBatteryOptimizationSettings.mockResolvedValue(
      undefined
    );
    notificationListenerMock.showAutoStartGuidance.mockResolvedValue({
      shown: false,
    });
    notificationListenerMock.startListening.mockResolvedValue(undefined);
    notificationListenerMock.getActiveNotifications.mockResolvedValue({
      notifications: [],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a loading state while the database is still initializing", async () => {
    let resolveDatabase: ((value: typeof mockDb) => void) | undefined;
    loadPersistedDatabaseMock.mockReturnValue(
      new Promise((resolve) => {
        resolveDatabase = resolve;
      })
    );

    render(<App />);

    expect(screen.getByText(/initializing local database/i)).toBeTruthy();

    resolveDatabase?.(mockDb);

    await waitFor(() => {
      expect(screen.getByText(/dashboard page mock/i)).toBeTruthy();
    });
  });

  it("re-checks notification access on focus after returning from settings", async () => {
    notificationListenerMock.isNotificationAccessGranted
      .mockResolvedValueOnce({ granted: false })
      .mockResolvedValue({ granted: true });

    render(<App />);

    await waitFor(() => {
      expect(loadPersistedDatabaseMock).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(
        screen.getByText(/notification access required\. opening android settings/i)
      ).toBeTruthy();
    });

    expect(
      notificationListenerMock.openNotificationAccessSettings
    ).toHaveBeenCalledTimes(1);
    expect(notificationListenerMock.startListening).not.toHaveBeenCalled();
    expect(notificationListenerMock.addListener).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("focus"));

    await waitFor(() => {
      expect(notificationListenerMock.startListening).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(
        screen.getByText(/listening for revolut notifications/i)
      ).toBeTruthy();
    });

    expect(
      notificationListenerMock.openNotificationAccessSettings
    ).toHaveBeenCalledTimes(1);
    expect(persistDatabaseMock).not.toHaveBeenCalled();
  });

  it("drains active notifications from the native queue on app focus (resume)", async () => {
    notificationListenerMock.isNotificationAccessGranted.mockResolvedValue({
      granted: true,
    });

    render(<App />);

    // Wait for cold-start bootstrap to complete:
    // addListener → ensureNotificationMonitoring → startListening → cold-start drain.
    await waitFor(() => {
      expect(notificationListenerMock.startListening).toHaveBeenCalledOnce();
    });
    await waitFor(() => {
      expect(notificationListenerMock.getActiveNotifications).toHaveBeenCalledOnce();
    });

    // Simulate app returning to foreground.
    window.dispatchEvent(new Event("focus"));

    // Resume should trigger a second drain of the notification shade.
    await waitFor(() => {
      expect(notificationListenerMock.getActiveNotifications).toHaveBeenCalledTimes(2);
    });
  });

  it("drains active notifications from the native queue on visibility change to visible", async () => {
    notificationListenerMock.isNotificationAccessGranted.mockResolvedValue({
      granted: true,
    });

    render(<App />);

    await waitFor(() => {
      expect(notificationListenerMock.startListening).toHaveBeenCalledOnce();
    });
    await waitFor(() => {
      expect(notificationListenerMock.getActiveNotifications).toHaveBeenCalledOnce();
    });

    // Simulate app returning to foreground via visibility change.
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() => {
      expect(notificationListenerMock.getActiveNotifications).toHaveBeenCalledTimes(2);
    });
  });

  it("ingests a stale shade item only once across repeated polls", async () => {
    localStorage.clear();
    notificationListenerMock.isNotificationAccessGranted.mockResolvedValue({
      granted: true,
    });
    ingestNotificationMock.mockReturnValue({ id: "tx-1", transactionTags: [] });
    const staleNotif = {
      title: "OBI",
      body: "1 599 Ft összeget fizettél itt: OBI.",
      packageName: "com.revolut.revolut",
      // Posted long ago: far outside the ±seconds SQL dedup window.
      postedAt: "2024-03-01T12:00:00.000Z",
    };
    notificationListenerMock.getActiveNotifications.mockResolvedValue({
      notifications: [staleNotif],
    });

    render(<App />);

    // Cold-start poll ingests it once.
    await waitFor(() => {
      expect(ingestNotificationMock).toHaveBeenCalledTimes(1);
    });

    // Repeated focus polls must not re-ingest the same stale item.
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => {
      expect(notificationListenerMock.getActiveNotifications).toHaveBeenCalledTimes(2);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(ingestNotificationMock).toHaveBeenCalledTimes(1);
  });

  it("does not re-ingest on focus an item already delivered live", async () => {
    localStorage.clear();
    notificationListenerMock.isNotificationAccessGranted.mockResolvedValue({
      granted: true,
    });
    ingestNotificationMock.mockReturnValue({ id: "tx-1", transactionTags: [] });
    const liveNotif = {
      title: "OBI",
      body: "1 599 Ft összeget fizettél itt: OBI.",
      packageName: "com.revolut.revolut",
      postedAt: "2024-03-01T12:00:00.000Z",
    };
    notificationListenerMock.getActiveNotifications.mockResolvedValue({
      notifications: [],
    });

    render(<App />);

    await waitFor(() => {
      expect(notificationListenerMock.startListening).toHaveBeenCalledOnce();
    });

    // Live delivery while the app is open.
    const liveCallback = notificationListenerMock.addListener.mock.calls[0][1] as (
      n: typeof liveNotif
    ) => void;
    liveCallback(liveNotif);
    liveCallback(liveNotif);
    expect(ingestNotificationMock).toHaveBeenCalledTimes(1);

    // The item is still visible in the shade; a focus poll must skip it.
    notificationListenerMock.getActiveNotifications.mockResolvedValue({
      notifications: [liveNotif],
    });
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => {
      expect(notificationListenerMock.getActiveNotifications).toHaveBeenCalledTimes(2);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(ingestNotificationMock).toHaveBeenCalledTimes(1);
  });
});

