import { defineConfig } from "vitest/config";
import { resolve } from "path";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.{ts,tsx}"],
    cache: false,
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx"],
    alias: {
      // Redirect Capacitor plugins to no-op stubs so unit tests can run
      // outside of a Capacitor/Android WebView context.
      "@capacitor/share": resolve(
        __dirname,
        "src/__mocks__/@capacitor/share.ts"
      ),
      "@capacitor/filesystem": resolve(
        __dirname,
        "src/__mocks__/@capacitor/filesystem.ts"
      ),
    },
  },
});
