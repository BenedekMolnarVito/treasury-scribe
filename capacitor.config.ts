import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.vitobudget.tracker",
  appName: "Treasury Scribe",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
};

export default config;

