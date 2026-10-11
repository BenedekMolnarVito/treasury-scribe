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
} = vi.hoisted(() => ({
  mockDb: { close: vi.fn() },
  listenerHandle: { remove: vi.fn() },
  loadPersistedDatabaseMock: vi.fn(),
  persistDatabaseMock: vi.fn(),
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
    loadPersistedDatabaseMock.mockResolvedValue(mockDb);
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
});

