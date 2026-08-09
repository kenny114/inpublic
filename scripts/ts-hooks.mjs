/**
 * Node resolves ESM strictly; the app's TypeScript uses extensionless relative
 * imports because Next resolves them. This hook bridges the two so the test
 * harness can import the REAL modules rather than a copy of them.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const EXTS = [".ts", ".tsx", "/index.ts"];

export async function resolve(specifier, context, next) {
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
    for (const ext of EXTS) {
      const candidate = new URL(specifier + ext, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return next(specifier + ext, context);
      }
    }
  }
  return next(specifier, context);
}
