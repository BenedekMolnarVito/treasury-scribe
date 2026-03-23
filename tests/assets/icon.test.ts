import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const SVG_PATH = resolve(__dirname, "../../src/assets/icon.svg");
const ANDROID_FG_PATH = resolve(
  __dirname,
  "../../android/app/src/main/res/drawable-v24/ic_launcher_foreground.xml"
);
const ANDROID_BG_PATH = resolve(
  __dirname,
  "../../android/app/src/main/res/values/ic_launcher_background.xml"
);

describe("App icon assets", () => {
  describe("SVG icon (src/assets/icon.svg)", () => {
    it("exists on disk", () => {
      expect(existsSync(SVG_PATH)).toBe(true);
    });

    it("is a valid SVG with correct root element", () => {
      const content = readFileSync(SVG_PATH, "utf-8");
      expect(content).toContain("<svg");
      expect(content).toContain("xmlns=\"http://www.w3.org/2000/svg\"");
      expect(content).toContain("</svg>");
    });

    it("has a 512x512 viewBox for scalability", () => {
      const content = readFileSync(SVG_PATH, "utf-8");
      expect(content).toContain('viewBox="0 0 512 512"');
    });

    it("uses the required deep green palette", () => {
      const content = readFileSync(SVG_PATH, "utf-8");
      expect(content).toContain("#1B5E20");
      expect(content).toContain("#2E7D32");
    });

    it("uses gold accent colors for the quill", () => {
      const content = readFileSync(SVG_PATH, "utf-8");
      expect(content).toContain("#FFD700");
    });

    it("contains a quill pen element", () => {
      const content = readFileSync(SVG_PATH, "utf-8");
      expect(content).toContain("quillGradient");
      expect(content).toContain("nibGradient");
    });

    it("contains shield and ledger design elements", () => {
      const content = readFileSync(SVG_PATH, "utf-8");
      expect(content).toContain("shieldGradient");
      // Ledger lines group
      expect(content).toMatch(/Ledger lines/);
    });

    it("contains coin-like border ring", () => {
      const content = readFileSync(SVG_PATH, "utf-8");
      expect(content).toMatch(/coin/i);
    });
  });

  describe("Android adaptive icon foreground", () => {
    it("exists on disk", () => {
      expect(existsSync(ANDROID_FG_PATH)).toBe(true);
    });

    it("is a valid Android vector drawable", () => {
      const content = readFileSync(ANDROID_FG_PATH, "utf-8");
      expect(content).toContain("<vector");
      expect(content).toContain(
        'xmlns:android="http://schemas.android.com/apk/res/android"'
      );
      expect(content).toContain("</vector>");
    });

    it("uses the 108dp adaptive icon canvas", () => {
      const content = readFileSync(ANDROID_FG_PATH, "utf-8");
      expect(content).toContain('android:width="108dp"');
      expect(content).toContain('android:height="108dp"');
      expect(content).toContain('android:viewportHeight="108"');
      expect(content).toContain('android:viewportWidth="108"');
    });

    it("includes gold quill gradient", () => {
      const content = readFileSync(ANDROID_FG_PATH, "utf-8");
      expect(content).toContain("#FFFFD700");
    });
  });

  describe("Android adaptive icon background", () => {
    it("exists on disk", () => {
      expect(existsSync(ANDROID_BG_PATH)).toBe(true);
    });

    it("uses deep green as the launcher background", () => {
      const content = readFileSync(ANDROID_BG_PATH, "utf-8");
      expect(content).toContain("#1B5E20");
      expect(content).toContain("ic_launcher_background");
    });
  });
});
