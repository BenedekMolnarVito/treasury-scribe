/**
 * App
 *
 * Root application component. Sets up React Router v6 routes:
 *   '/'              → DashboardPage (default)
 *   '/transactions'  → TransactionsPage
 *   '/edit/:id'      → EditTransactionPage
 *
 * Includes a fixed bottom navigation bar for Dashboard ↔ Transactions.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from "react-router-dom";
import type { PluginListenerHandle } from "@capacitor/core";
import type { Database } from "sql.js";
import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import TransactionsPage from "./pages/TransactionsPage";
import EditTransactionPage from "./pages/EditTransactionPage";
import DashboardPage from "./pages/DashboardPage";
import {
  loadPersistedDatabase,
  persistDatabase,
} from "./data/DatabaseService";
import { NotificationListener } from "./plugins/NotificationListenerPlugin";
import {
  createTransactionFromNotification,
  isRevolutNotification,
} from "./services/NotificationService";
import { ingestNotification as ingestNotificationTransaction } from "./services/IngestionService";

/** Safely reads a value from localStorage; returns null if unavailable. */
function safeGetLocalStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Safely writes a value to localStorage; silently no-ops if unavailable. */
function safeSetLocalStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Silently ignore (e.g., private browsing, test environments)
  }
}

// ---------------------------------------------------------------------------
// Bottom Navigation Bar
// ---------------------------------------------------------------------------

const NAV_STYLE = {
  bar: {
    position: "fixed",
    bottom: 0,
    left: 0,
    right: 0,
    display: "flex",
    justifyContent: "space-around",
    alignItems: "center",
    background: "#1A1A1A",
    borderTop: "1px solid #333",
    padding: "8px 0 12px",
    zIndex: 900,
  } as React.CSSProperties,
  item: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 2,
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: "4px 16px",
    minWidth: 64,
  } as React.CSSProperties,
  icon: {
    fontSize: "1.4em",
    lineHeight: 1,
  } as React.CSSProperties,
  label: {
    fontSize: "0.7em",
    fontWeight: 500,
  } as React.CSSProperties,
};

const BottomNavBar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const isDashboard = location.pathname === "/" || location.pathname === "/dashboard";
  const isTransactions = location.pathname === "/transactions" || location.pathname.startsWith("/edit/");

  return (
    <nav style={NAV_STYLE.bar} aria-label="Main navigation" data-testid="bottom-nav">
      <button
        style={NAV_STYLE.item}
        onClick={() => navigate("/")}
        aria-label="Dashboard"
        data-testid="nav-dashboard"
      >
        <span style={{ ...NAV_STYLE.icon, color: isDashboard ? "#1565C0" : "#888" }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <rect x="3" y="3" width="7" height="9" rx="1" />
            <rect x="14" y="3" width="7" height="5" rx="1" />
            <rect x="14" y="12" width="7" height="9" rx="1" />
            <rect x="3" y="16" width="7" height="5" rx="1" />
          </svg>
        </span>
        <span style={{ ...NAV_STYLE.label, color: isDashboard ? "#1565C0" : "#888" }}>Dashboard</span>
      </button>
      <button
        style={NAV_STYLE.item}
        onClick={() => navigate("/transactions")}
        aria-label="Transactions"
        data-testid="nav-transactions"
      >
        <span style={{ ...NAV_STYLE.icon, color: isTransactions ? "#1565C0" : "#888" }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
        </span>
        <span style={{ ...NAV_STYLE.label, color: isTransactions ? "#1565C0" : "#888" }}>Transactions</span>
      </button>
    </nav>
  );
};

const App: React.FC = () => {
  const [db, setDb] = useState<Database | null>(null);
  const [dbVersion, setDbVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [startupMessage, setStartupMessage] = useState(
    "Initializing local database..."
  );
  const [startupError, setStartupError] = useState<string | null>(null);
  const notificationAccessPromptedRef = useRef(false);
  const batteryOptimizationPromptedRef = useRef(false);
  const listeningStartedRef = useRef(false);

  const handleDatabaseChanged = useCallback((database: Database): void => {
    persistDatabase(database);
    setDbVersion((value) => value + 1);
  }, []);

  const refreshActiveNotifications = useCallback(async (): Promise<number> => {
    if (!db) return 0;

    try {
      // 1. Drain the durable on-disk queue first. This catches notifications
      //    captured by the native service while the WebView was suspended or
      //    killed — including ones the user has already swiped away, which
      //    would no longer appear in getActiveNotifications().
      const drained = await NotificationListener.drainQueuedNotifications()
        .catch(() => ({ notifications: [] }));
      // 2. Then read the currently-visible notification shade as a belt-and-
      //    suspenders backup for the very first install (no queue yet).
      const { notifications: active } =
        await NotificationListener.getActiveNotifications();

      let addedCount = 0;
      const sources: Array<{ notifications: typeof active }> = [
        { notifications: drained.notifications },
        { notifications: active },
      ];

      for (const source of sources) {
        for (const { title, body, packageName, postedAt } of source.notifications) {
          if (!isRevolutNotification(packageName)) {
            continue;
          }

          const transaction = createTransactionFromNotification(
            title,
            body,
            packageName,
            postedAt
          );
          const result = ingestNotificationTransaction(db, transaction, 1);
          if (result !== null) {
            addedCount += 1;
          }
        }
      }

      if (addedCount > 0) {
        handleDatabaseChanged(db);
      }
      return addedCount;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? "Unknown error");
      console.info(
        "Active notification refresh unavailable in this runtime; continuing without notification shade processing.",
        message
      );
      return 0;
    }
  }, [db, handleDatabaseChanged]);

  const ensureNotificationMonitoring = useCallback(async (): Promise<void> => {
    try {
      const notificationAccess =
        await NotificationListener.isNotificationAccessGranted();
      if (!notificationAccess.granted) {
        listeningStartedRef.current = false;
        setStartupMessage(
          "Notification access required. Opening Android settings..."
        );
        if (!notificationAccessPromptedRef.current) {
          notificationAccessPromptedRef.current = true;
          await NotificationListener.openNotificationAccessSettings();
        }
        return;
      }
      notificationAccessPromptedRef.current = false;

      const postNotifications =
        await NotificationListener.requestPostNotificationsPermission();
      if (!postNotifications.granted) {
        console.warn(
          "POST_NOTIFICATIONS denied; foreground service notification may not be shown."
        );
      }

      const batteryExcluded =
        await NotificationListener.isBatteryOptimizationExcluded();
      if (!batteryExcluded.granted) {
        listeningStartedRef.current = false;
        setStartupMessage(
          "Requesting battery optimization exclusion to keep monitoring alive..."
        );
        if (!batteryOptimizationPromptedRef.current) {
          batteryOptimizationPromptedRef.current = true;
          await NotificationListener.openBatteryOptimizationSettings();
        }
        return;
      }
      batteryOptimizationPromptedRef.current = false;

      if (safeGetLocalStorage("autoStartGuidanceShown") !== "true") {
        const autoStartGuidance = await NotificationListener.showAutoStartGuidance();
        if (autoStartGuidance.shown) {
          console.info(
            "Displayed MIUI/HyperOS guidance for Autostart and recents lock."
          );
          safeSetLocalStorage("autoStartGuidanceShown", "true");
        }
      }

      if (!listeningStartedRef.current) {
        await NotificationListener.startListening();
        listeningStartedRef.current = true;
      }
      setStartupMessage("Listening for Revolut notifications.");
    } catch (error) {
      listeningStartedRef.current = false;
      const message =
        error instanceof Error ? error.message : String(error ?? "Unknown error");
      console.info(
        "Notification listener unavailable in this runtime; continuing with local-only UI.",
        message
      );
      setStartupMessage("Running without native notification listener.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap(): Promise<void> {
      try {
        const database = await loadPersistedDatabase(sqlWasmUrl);
        if (cancelled) {
          database.close();
          return;
        }

        setDb(database);
        setStartupMessage("Database ready.");
      } catch (error) {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : "Failed to initialize database.";
        setStartupError(message);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!db) return;

    const database = db;
    let cancelled = false;
    let listenerHandle: PluginListenerHandle | null = null;

    async function bootstrapNotifications(): Promise<void> {
      try {
        listenerHandle = await NotificationListener.addListener(
          "notificationReceived",
          ({ title, body, packageName, postedAt }) => {
            if (!isRevolutNotification(packageName)) {
              return;
            }

            const transaction = createTransactionFromNotification(
              title,
              body,
              packageName,
              postedAt
            );
            const result = ingestNotificationTransaction(database, transaction);
            if (result !== null) {
              handleDatabaseChanged(database);
              console.info("Captured Revolut notification", {
                title,
                body,
                packageName,
                transactionId: result.id,
                amount: result.amount,
                currency: result.currency,
                isDeleted: result.isDeleted,
                tagNames: result.transactionTags.map((tt) => tt.tagName ?? tt.tagId),
              });
            } else {
              console.info("Skipped duplicate Revolut notification", {
                title,
                body,
                packageName,
                receivedAt: transaction.receivedAt,
              });
            }
          }
        );

        await ensureNotificationMonitoring();
        // Catch any notifications that arrived before the listener was ready
        // (e.g. during WebView initialisation or while pluginInstance was null).
        await refreshActiveNotifications();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error ?? "Unknown error");
        console.info(
          "Notification listener unavailable in this runtime; continuing with local-only UI.",
          message
        );
        if (!cancelled) {
          setStartupMessage("Running without native notification listener.");
        }
      }
    }

    const handleFocus = (): void => {
      if (cancelled) return;
      void ensureNotificationMonitoring();
      // Drain anything the native service queued while we were backgrounded.
      // This is the path that recovers notifications the user swiped away
      // before opening the app.
      void refreshActiveNotifications();
    };

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === "visible") {
        handleFocus();
      }
    };

    void bootstrapNotifications();
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      void listenerHandle?.remove();
    };
  }, [db, ensureNotificationMonitoring, handleDatabaseChanged, refreshActiveNotifications]);

  if (loading) {
    return (
      <main style={{ padding: 16 }}>
        <h1>Transactions</h1>
        <p>Initializing local database...</p>
      </main>
    );
  }

  if (startupError || !db) {
    return (
      <main style={{ padding: 16 }}>
        <h1>Transactions</h1>
        <p role="alert">{startupError ?? "Unable to load local database."}</p>
      </main>
    );
  }

  return (
    <BrowserRouter>
      <div style={{ padding: 16, paddingBottom: 0, color: "#888", background: "#121212" }}>
        <small>{startupMessage}</small>
      </div>
      <div style={{ paddingBottom: 64 }}>
        <Routes>
          <Route
            path="/"
            element={
              <DashboardPage
                db={db}
                refreshActiveNotifications={refreshActiveNotifications}
              />
            }
          />
          <Route
            path="/transactions"
            element={
              <TransactionsPage
                db={db}
                onDatabaseChanged={handleDatabaseChanged}
                dbVersion={dbVersion}
                refreshActiveNotifications={refreshActiveNotifications}
              />
            }
          />
          <Route
            path="/edit/:id"
            element={
              <EditTransactionPage
                db={db}
                onDatabaseChanged={handleDatabaseChanged}
              />
            }
          />
          <Route
            path="/dashboard"
            element={
              <DashboardPage
                db={db}
                refreshActiveNotifications={refreshActiveNotifications}
              />
            }
          />
        </Routes>
      </div>
      <BottomNavBar />
    </BrowserRouter>
  );
};

export default App;
