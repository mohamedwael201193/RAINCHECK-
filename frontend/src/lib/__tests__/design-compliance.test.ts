import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TOKENS } from "../tokens";

/**
 * DESIGN-COMPLIANCE — binding per ~/workspace/your_files/design-standard.md.
 *
 * (1) No serif font-family declarations in src/ (outside comments).
 *     Standard §1: one heavy grotesque + one neutral sans; no serif anywhere.
 * (2) Old pre-standard tokens #0A0A0B / #16A34A / #F5F1E8 absent from src/
 *     (case-insensitive). Standard §9 is the token source of truth.
 * (3) The RAINCHECK accent #35E0FF appears in the token file
 *     (src/lib/tokens.ts).
 *
 * These tests scan the real source tree (not a snapshot) so any new
 * violation fails the build. A failing test is a finding for the design
 * implementers — it names the exact file:line, never a guess.
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function srcFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name === "node_modules" || name === "__tests__" || name === "__fixtures__")
          continue;
        walk(p);
      } else if (/\.(ts|tsx|css)$/.test(name)) {
        out.push(p);
      }
    }
  };
  walk(SRC);
  return out;
}

/** Strip // line comments, block comments, and CSS comments. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^\S\r\n])\/\/[^\r\n]*/g, "$1");
}

describe("design compliance (design-standard.md, binding)", () => {
  const files = srcFiles();

  it("scans a non-empty src tree", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("(1) no serif font-family declarations in src/ outside comments", () => {
    const hits: string[] = [];
    for (const f of files) {
      const code = stripComments(readFileSync(f, "utf8"));
      const lines = code.split("\n");
      lines.forEach((line, i) => {
        if (/\bserif\b/i.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits, `serif declarations found:\n${hits.join("\n")}`).toEqual([]);
  });

  it("(2) old pre-standard tokens #0A0A0B / #16A34A / #F5F1E8 absent from src/", () => {
    const hits: string[] = [];
    for (const f of files) {
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (/#0a0a0b|#16a34a|#f5f1e8/i.test(line))
          hits.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(
      hits,
      `old tokens found (replace per design-standard §9):\n${hits.join("\n")}`,
    ).toEqual([]);
  });

  it("(3) accent #35E0FF is declared in the token file", () => {
    expect(TOKENS.accentRainCyan).toBe("#35E0FF");
    const tokenSrc = readFileSync(join(SRC, "lib", "tokens.ts"), "utf8");
    expect(tokenSrc).toContain("#35E0FF");
  });

  it("token file carries the full RAINCHECK §9 identity (no third accent)", () => {
    expect(TOKENS.bgInkNavy).toBe("#0B1220");
    expect(TOKENS.paperWarm).toBe("#F4EFE6");
    expect(TOKENS.textOnDark).toBe("#F4FEFF");
    expect(TOKENS.textOnPaper).toBe("#0B1220");
  });

  it("(4) no file aliases `import.meta` before reading `.env` (Vite injection)", () => {
    // 2026-10-15: `const im = import.meta; im.env?.[k]` silently yields
    // undefined in Vite dev — the transform only injects import.meta.env
    // when it sees the literal `(import.meta as …).env` member access.
    // Aliasing broke the Activity feed (VITE_API_URL read as empty).
    const hits: string[] = [];
    for (const f of files) {
      if (!/\.(ts|tsx)$/.test(f)) continue;
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (/=\s*import\.meta\s*;/.test(line))
          hits.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(
      hits,
      `import.meta aliased to a variable (breaks Vite env injection):\n${hits.join("\n")}`,
    ).toEqual([]);
  });
});
