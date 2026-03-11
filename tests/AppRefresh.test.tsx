/**
 * AppRefresh.test.tsx
 *
 * Verifies the Flow 7 app-level refresh pipeline:
 * - active notification shade processing
 * - refresh-specific deduplication window (±1 second)
 * - recovery of missed notifications after startup / reconnect
 */

// @vitest-environment jsdom

import { readFileSync } from "fs";
import { resolve } from "path";
import React from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Database } from "sql.js";

import App from "../src/App";
import { initDatabase } from "../src/data/DatabaseService";
import {
  addTransaction,
  getAllTransactions,
} from "../src/data/TransactionRepository";
import { createTransaction } from "../src/models/Transaction";

const WASM_PATH = resolve(
  __dirname,
  "../node_modules/sql.js/dist/sql-wasm.wasm"
);

let wasmBinary: ArrayBuffer;
let db: Database;

const {
  listenerHandle,
  loadPersistedDatabaseMock,
  persistDatabaseMock,
  notificationListenerMock,
  transactionsPagePropsStore,
} = vi.hoisted(() => ({
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
    removeAllListeners: vi.fn(),
  },
  transactionsPagePropsStore: { current: null as any },
}));

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: "mock-sql-wasm-url",
}));

vi.mock("../src/data/DatabaseService", async () => {
  const actual = await vi.importActual<typeof import("../src/data/DatabaseService")>(
    "../src/data/DatabaseService"
  );
  return {
    ...actual,
    loadPersistedDatabase: loadPersistedDatabaseMock,
    persistDatabase: persistDatabaseMock,
  };
});

vi.mock("../src/plugins/NotificationListenerPlugin", () => ({
  NotificationListener: notificationListenerMock,
}));

vi.mock("../src/pages/TransactionsPage", () => ({
  default: (props: unknown) => {
    transactionsPagePropsStore.current = props;
    return <div>Transactions page mock</div>;
  },
}));

vi.mock("../src/pages/EditTransactionPage", () => ({
  default: () => <div>Edit transaction page mock</div>,
}));

beforeAll(async () => {
  wasmBinary = readFileSync(WASM_PATH).buffer as ArrayBuffer;
});

beforeEach(async () => {
  vi.clearAllMocks();
  window.history.pushState({}, "", "/");

  db = await initDatabase(wasmBinary);
  transactionsPagePropsStore.current = null;

  loadPersistedDatabaseMock.mockResolvedValue(db);
  notificationListenerMock.addListener.mockResolvedValue(listenerHandle);
  notificationListenerMock.isNotificationAccessGranted.mockResolvedValue({
    granted: true,
  });
  notificationListenerMock.requestPostNotificationsPermission.mockResolvedValue({
    granted: true,
  });
  notificationListenerMock.isBatteryOptimizationExcluded.mockResolvedValue({
    granted: true,
  });
  notificationListenerMock.openNotificationAccessSettings.mockResolvedValue(
    undefined
  );
  notificationListenerMock.openBatteryOptimizationSettings.mockResolvedValue(
    undefined
  );
  notificationListenerMock.showAutoStartGuidance.mockResolvedValue({
    shown: false,
  });
  notificationListenerMock.startListening.mockResolvedValue(undefined);
  notificationListenerMock.stopListening.mockResolvedValue(undefined);
  notificationListenerMock.getActiveNotifications.mockResolvedValue({
    notifications: [],
  });
});

afterEach(() => {
  cleanup();
  db.close();
});

async function renderAppAndGetRefresh() {
  render(<App />);

  await waitFor(() => {
    expect(loadPersistedDatabaseMock).toHaveBeenCalledOnce();
  });

  await waitFor(() => {
    expect(notificationListenerMock.addListener).toHaveBeenCalledOnce();
  });

  await waitFor(() => {
    expect(notificationListenerMock.startListening).toHaveBeenCalledOnce();
  });

  await waitFor(() => {
    expect(transactionsPagePropsStore.current).toBeTruthy();
  });

  return transactionsPagePropsStore.current.refreshActiveNotifications as () => Promise<number>;
}

describe("App Flow 7 refresh pipeline", () => {
  it("processes unseen active Revolut notifications during refresh", async () => {
    notificationListenerMock.getActiveNotifications.mockResolvedValue({
      notifications: [
        {
          title: "Lidl",
          body: "Paid 6 337 Ft",
          packageName: "com.revolut.revolut",
          postedAt: "2024-01-01T10:00:00.000Z",
        },
        {
          title: "Ignored",
          body: "hello",
          packageName: "com.whatsapp",
          postedAt: "2024-01-01T10:00:00.000Z",
        },
      ],
    });

    const refreshActiveNotifications = await renderAppAndGetRefresh();

    let addedCount = 0;
    await act(async () => {
      addedCount = await refreshActiveNotifications();
    });

    expect(addedCount).toBe(1);
    const transactions = getAllTransactions(db);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.notificationTitle).toBe("Lidl");
    expect(transactions[0]?.notificationBody).toBe("Paid 6 337 Ft");
    expect(transactions[0]?.packageName).toBe("com.revolut.revolut");
    expect(transactions[0]?.amount).toBe(6337);
    expect(transactions[0]?.currency).toBe("HUF");
    expect(persistDatabaseMock).toHaveBeenCalledWith(db);
  });

  it("uses the narrower ±1 second deduplication window during refresh", async () => {
    addTransaction(
      db,
      createTransaction({
        notificationTitle: "Refresh Vendor",
        notificationBody: "Refresh Body",
        packageName: "com.revolut.revolut",
        receivedAt: "2024-01-01T10:00:00.000Z",
      })
    );

    notificationListenerMock.getActiveNotifications.mockResolvedValue({
      notifications: [
        {
          title: "Refresh Vendor",
          body: "Refresh Body",
          packageName: "com.revolut.revolut",
          postedAt: "2024-01-01T10:00:01.000Z",
        },
      ],
    });

    const refreshActiveNotifications = await renderAppAndGetRefresh();

    let addedCount = -1;
    await act(async () => {
      addedCount = await refreshActiveNotifications();
    });

    expect(addedCount).toBe(0);
    expect(getAllTransactions(db)).toHaveLength(1);
    expect(persistDatabaseMock).not.toHaveBeenCalled();
  });

  it("adds the same active notification again when it arrives 2 seconds later", async () => {
    addTransaction(
      db,
      createTransaction({
        notificationTitle: "Refresh Vendor",
        notificationBody: "Refresh Body",
        packageName: "com.revolut.revolut",
        receivedAt: "2024-01-01T10:00:00.000Z",
      })
    );

    notificationListenerMock.getActiveNotifications.mockResolvedValue({
      notifications: [
        {
          title: "Refresh Vendor",
          body: "Refresh Body",
          packageName: "com.revolut.revolut",
          postedAt: "2024-01-01T10:00:02.000Z",
        },
      ],
    });

    const refreshActiveNotifications = await renderAppAndGetRefresh();

    let addedCount = 0;
    await act(async () => {
      addedCount = await refreshActiveNotifications();
    });

    expect(addedCount).toBe(1);
    expect(getAllTransactions(db)).toHaveLength(2);
    expect(persistDatabaseMock).toHaveBeenCalledWith(db);
  });

  it("can recover missed notifications from the shade after app startup", async () => {
    notificationListenerMock.getActiveNotifications.mockResolvedValue({
      notifications: [
        {
          title: "Missed After Restart",
          body: "$25.50",
          packageName: "com.revolut.revolut",
          postedAt: "2024-01-01T11:30:00.000Z",
        },
      ],
    });

    const refreshActiveNotifications = await renderAppAndGetRefresh();

    expect(notificationListenerMock.startListening).toHaveBeenCalledOnce();

    let addedCount = 0;
    await act(async () => {
      addedCount = await refreshActiveNotifications();
    });

    expect(addedCount).toBe(1);
    const transactions = getAllTransactions(db);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.notificationTitle).toBe("Missed After Restart");
    expect(transactions[0]?.amount).toBe(25.5);
    expect(transactions[0]?.currency).toBe("USD");
  });
});

