import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const APP_DIRS = ["app", "components", "lib"];
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const HARDCODED_CREDENTIAL = /^(?:\s*[,{]\s*)?(?:(?:const|let|var)\s+)?(?:demo[_-]?)?(?:password|passphrase|credential|secret)\s*[:=]\s*(['"`])[^'"`\r\n]{8,}\1/i;
const HARDCODED_DEMO_VALUE = /(['"`])[^'"`\r\n]{0,80}\bdemo[!@#$%^&*.-][A-Za-z0-9]{3,}[^'"`\r\n]*\1/i;

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const file = join(dir, name);
    const fullPath = join(ROOT, file);
    if (statSync(fullPath).isDirectory()) return sourceFiles(file);
    return CODE_EXTENSIONS.has(file.slice(file.lastIndexOf("."))) ? [file] : [];
  });
}

describe("credential exposure regression", () => {
  it("application source has no hard-coded credential/password values", () => {
    const offenders = APP_DIRS.flatMap(sourceFiles).filter((file) => {
      const source = readFileSync(join(ROOT, file), "utf8");
      return source.split(/\r?\n/).some((line) => HARDCODED_CREDENTIAL.test(line) || HARDCODED_DEMO_VALUE.test(line));
    });

    expect(offenders.map((file) => relative(ROOT, join(ROOT, file)))).toEqual([]);
  });
});
