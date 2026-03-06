/**
 * NotificationListenerPlugin.test.ts
 *
 * Unit tests for the TypeScript interface and registration of the
 * NotificationListenerPlugin Capacitor bridge.
 *
 * Because the Capacitor native layer is unavailable in a Node / Vitest
 * environment, @capacitor/core is mocked.  The tests verify:
 *  - The exported types have the correct shapes.
 *  - `registerPlugin` is called with the exact plugin name "NotificationListener".
 *  - The `NotificationListener` export is the object returned by `registerPlugin`.
 *  - All expected plugin methods are present on the registered object.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock @capacitor/core before importing the plugin under test.
// vi.hoisted() ensures variables are available when the hoisted vi.mock()
// factory runs.
// ---------------------------------------------------------------------------

const { mockPluginInstance, registerPluginMock } = vi.hoisted(() => {
  const mockPluginInstance = {
    openNotificationAccessSettings: vi.fn(),
    isNotificationAccessGranted: vi.fn(),
    requestPostNotificationsPermission: vi.fn(),
    openBatteryOptimizationSettings: vi.fn(),
    isBatteryOptimizationExcluded: vi.fn(),
    showAutoStartGuidance: vi.fn(),
    startListening: vi.fn(),
    stopListening: vi.fn(),
    addListener: vi.fn(),
    removeAllListeners: vi.fn(),
  };
  const registerPluginMock = vi.fn(() => mockPluginInstance);
  return { mockPluginInstance, registerPluginMock };
});

vi.mock("@capacitor/core", () => ({
  registerPlugin: registerPluginMock,
}));

// ---------------------------------------------------------------------------
// Import after mock is set up
// ---------------------------------------------------------------------------

import {
  NotificationListener,
  type NotificationListenerPlugin,
  type NotificationEventData,
  type PermissionResult,
  type AutoStartGuidanceResult,
} from "../../src/plugins/NotificationListenerPlugin";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NotificationListenerPlugin registration", () => {
  it("calls registerPlugin with the name 'NotificationListener'", () => {
    expect(registerPluginMock).toHaveBeenCalledWith("NotificationListener");
  });

  it("exports NotificationListener as the registered plugin instance", () => {
    expect(NotificationListener).toBe(mockPluginInstance);
  });
});

describe("NotificationListenerPlugin interface methods", () => {
  it("has openNotificationAccessSettings method", () => {
    expect(typeof NotificationListener.openNotificationAccessSettings).toBe(
      "function"
    );
  });

  it("has isNotificationAccessGranted method", () => {
    expect(typeof NotificationListener.isNotificationAccessGranted).toBe(
      "function"
    );
  });

  it("has requestPostNotificationsPermission method", () => {
    expect(typeof NotificationListener.requestPostNotificationsPermission).toBe(
      "function"
    );
  });

  it("has openBatteryOptimizationSettings method", () => {
    expect(typeof NotificationListener.openBatteryOptimizationSettings).toBe(
      "function"
    );
  });

  it("has isBatteryOptimizationExcluded method", () => {
    expect(typeof NotificationListener.isBatteryOptimizationExcluded).toBe(
      "function"
    );
  });

  it("has showAutoStartGuidance method", () => {
    expect(typeof NotificationListener.showAutoStartGuidance).toBe("function");
  });

  it("has startListening method", () => {
    expect(typeof NotificationListener.startListening).toBe("function");
  });

  it("has stopListening method", () => {
    expect(typeof NotificationListener.stopListening).toBe("function");
  });

  it("has addListener method", () => {
    expect(typeof NotificationListener.addListener).toBe("function");
  });

  it("has removeAllListeners method", () => {
    expect(typeof NotificationListener.removeAllListeners).toBe("function");
  });
});

describe("NotificationEventData type shape", () => {
  it("accepts an object with title, body, and packageName string fields", () => {
    const event: NotificationEventData = {
      title: "Revolut",
      body: "You paid 1,000 HUF",
      packageName: "com.revolut.revolut",
    };
    expect(event.title).toBe("Revolut");
    expect(event.body).toBe("You paid 1,000 HUF");
    expect(event.packageName).toBe("com.revolut.revolut");
  });
});

describe("PermissionResult type shape", () => {
  it("accepts an object with a granted boolean", () => {
    const result: PermissionResult = { granted: true };
    expect(result.granted).toBe(true);
  });
});

describe("AutoStartGuidanceResult type shape", () => {
  it("accepts an object with a shown boolean", () => {
    const resultShown: AutoStartGuidanceResult = { shown: true };
    const resultNotShown: AutoStartGuidanceResult = { shown: false };
    expect(resultShown.shown).toBe(true);
    expect(resultNotShown.shown).toBe(false);
  });
});

describe("addListener event contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls addListener with 'notificationReceived' event name", async () => {
    const handler = vi.fn();
    mockPluginInstance.addListener.mockResolvedValue({ remove: vi.fn() });

    await NotificationListener.addListener("notificationReceived", handler);

    expect(mockPluginInstance.addListener).toHaveBeenCalledWith(
      "notificationReceived",
      handler
    );
  });

  it("returns a PluginListenerHandle with a remove function", async () => {
    const removeFn = vi.fn();
    mockPluginInstance.addListener.mockResolvedValue({ remove: removeFn });

    const handle = await NotificationListener.addListener(
      "notificationReceived",
      vi.fn()
    );
    expect(typeof handle.remove).toBe("function");
  });
});

describe("permission method signatures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("isNotificationAccessGranted resolves to PermissionResult shape", async () => {
    mockPluginInstance.isNotificationAccessGranted.mockResolvedValue({
      granted: false,
    });
    const result = await NotificationListener.isNotificationAccessGranted();
    expect(result).toHaveProperty("granted");
    expect(typeof result.granted).toBe("boolean");
  });

  it("requestPostNotificationsPermission resolves to PermissionResult shape", async () => {
    mockPluginInstance.requestPostNotificationsPermission.mockResolvedValue({
      granted: true,
    });
    const result =
      await NotificationListener.requestPostNotificationsPermission();
    expect(result).toHaveProperty("granted");
    expect(typeof result.granted).toBe("boolean");
  });

  it("isBatteryOptimizationExcluded resolves to PermissionResult shape", async () => {
    mockPluginInstance.isBatteryOptimizationExcluded.mockResolvedValue({
      granted: true,
    });
    const result = await NotificationListener.isBatteryOptimizationExcluded();
    expect(result).toHaveProperty("granted");
    expect(typeof result.granted).toBe("boolean");
  });

  it("showAutoStartGuidance resolves to AutoStartGuidanceResult shape", async () => {
    mockPluginInstance.showAutoStartGuidance.mockResolvedValue({ shown: false });
    const result = await NotificationListener.showAutoStartGuidance();
    expect(result).toHaveProperty("shown");
    expect(typeof result.shown).toBe("boolean");
  });
});
