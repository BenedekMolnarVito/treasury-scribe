/**
 * NotificationListenerPlugin.ts
 *
 * TypeScript interface for the Kotlin Capacitor bridge that listens for
 * Android notifications and forwards Revolut payloads to the JavaScript layer.
 */

import { registerPlugin } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";

// ---------------------------------------------------------------------------
// Event payload
// ---------------------------------------------------------------------------

/**
 * Data emitted when a Revolut notification is received from the native layer.
 */
export interface NotificationEventData {
  /** Notification title text extracted from the notification extras. */
  title: string;
  /** Notification body text extracted from the notification extras. */
  body: string;
  /** Android package name — always `"com.revolut.revolut"` for this event. */
  packageName: string;
}

// ---------------------------------------------------------------------------
// Permission result types
// ---------------------------------------------------------------------------

/** Result of a permission check or request. */
export interface PermissionResult {
  /** Whether the permission is currently granted. */
  granted: boolean;
}

/** Result of MIUI / HyperOS autostart guidance. */
export interface AutoStartGuidanceResult {
  /**
   * `true` if the device appears to be MIUI / HyperOS and the guidance dialog
   * was shown; `false` if the device is not identified as MIUI / HyperOS.
   */
  shown: boolean;
}

// ---------------------------------------------------------------------------
// Plugin interface
// ---------------------------------------------------------------------------

/**
 * Capacitor plugin interface for the Revolut notification listener.
 *
 * Implemented natively by `RevolutNotificationService` (extends
 * `NotificationListenerService`) wired through the
 * `NotificationListenerPlugin` Capacitor bridge on the Android side.
 */
export interface NotificationListenerPlugin {
  /**
   * Opens the system Notification Access settings screen so the user can
   * grant the `BIND_NOTIFICATION_LISTENER_SERVICE` permission.
   *
   * Resolves once the settings intent has been launched (does not wait for
   * the user to grant or deny).
   */
  openNotificationAccessSettings(): Promise<void>;

  /**
   * Returns whether Notification Access (BIND_NOTIFICATION_LISTENER_SERVICE)
   * has been granted by the user.
   */
  isNotificationAccessGranted(): Promise<PermissionResult>;

  /**
   * Requests the `POST_NOTIFICATIONS` runtime permission required on
   * Android 13+ (API 33+).
   *
   * On earlier API levels resolves immediately with `{ granted: true }`.
   */
  requestPostNotificationsPermission(): Promise<PermissionResult>;

  /**
   * Opens the system Battery Optimization settings so the user can exclude
   * this app from battery optimizations, keeping the foreground service alive.
   *
   * Resolves once the intent has been launched.
   */
  openBatteryOptimizationSettings(): Promise<void>;

  /**
   * Checks whether the app is already excluded from battery optimizations.
   */
  isBatteryOptimizationExcluded(): Promise<PermissionResult>;

  /**
   * On MIUI / HyperOS devices, shows an in-app guidance dialog directing the
   * user to enable autostart for this application so the foreground service
   * survives device reboots.
   *
   * On non-MIUI devices resolves with `{ shown: false }`.
   */
  showAutoStartGuidance(): Promise<AutoStartGuidanceResult>;

  /**
   * Starts the `RevolutNotificationService` foreground service, which will
   * begin delivering `notificationReceived` events to the JavaScript layer.
   *
   * Requires Notification Access to be granted first.
   */
  startListening(): Promise<void>;

  /**
   * Stops the `RevolutNotificationService` foreground service.
   */
  stopListening(): Promise<void>;

  /**
   * Registers a listener for incoming Revolut notification events.
   *
   * The event is only fired for the package `com.revolut.revolut`; all other
   * packages are silently ignored by the native layer.
   *
   * @param eventName - Must be `"notificationReceived"`.
   * @param listenerFunc - Callback invoked with the notification payload.
   * @returns A handle that can be used to remove the listener.
   */
  addListener(
    eventName: "notificationReceived",
    listenerFunc: (data: NotificationEventData) => void
  ): Promise<PluginListenerHandle>;

  /**
   * Removes all listeners registered on this plugin instance.
   */
  removeAllListeners(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

/**
 * The registered Capacitor plugin instance.
 *
 * Use this export to interact with the native notification listener bridge.
 *
 * @example
 * ```ts
 * import { NotificationListener } from './plugins/NotificationListenerPlugin';
 *
 * await NotificationListener.openNotificationAccessSettings();
 *
 * const handle = await NotificationListener.addListener(
 *   'notificationReceived',
 *   ({ title, body, packageName }) => {
 *     console.log('Revolut notification:', title, body);
 *   }
 * );
 * ```
 */
export const NotificationListener = registerPlugin<NotificationListenerPlugin>(
  "NotificationListener"
);
