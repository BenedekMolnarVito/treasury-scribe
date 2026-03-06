/**
 * Stub for @capacitor/share used in non-Android environments (unit tests,
 * CI, browser dev builds).  The real plugin is loaded from node_modules in
 * the Android WebView via the Capacitor runtime.
 */
export const Share = {
  share: async (_opts: Record<string, string>): Promise<void> => {
    // No-op: real sharing only works inside a Capacitor WebView.
  },
};
