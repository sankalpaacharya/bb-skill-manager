import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

// The frontend bundler cannot resolve server-only modules, so a value import
// from src/server or bare @get-bb/plugin-sdk breaks the marketplace build.
const ROOT = path.resolve(__dirname, "..");

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx?$/.test(entry.name) && !entry.name.includes(".test.") ? [full] : [];
  });
}

function valueImports(file: string): string[] {
  const text = fs.readFileSync(file, "utf8");
  return [...text.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gms)].map((match) => match[1]!);
}

describe("browser bundle", () => {
  it("never value-imports server code from the app or shared modules", () => {
    const offenders = [...sources(path.join(ROOT, "app")), ...sources(path.join(ROOT, "shared"))].flatMap((file) =>
      valueImports(file)
        .filter((spec) => spec === "@get-bb/plugin-sdk" || /(^|\/)server(\/|$)/.test(spec))
        .map((spec) => `${path.relative(ROOT, file)} -> ${spec}`),
    );
    expect(offenders).toEqual([]);
  });
});
