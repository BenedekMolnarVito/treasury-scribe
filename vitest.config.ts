import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // Redirect Capacitor plugins to no-op stubs so unit tests can run
      // outside of a Capacitor/Android WebView context.
      "@capacitor/share": resolve(
        __dirname,
        "src/__mocks__/@capacitor/share.ts"
      ),
    },
  },
});
