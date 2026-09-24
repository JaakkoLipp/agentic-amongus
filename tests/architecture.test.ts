import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Structural rules from the architecture: the engine is independent of UI, networking and LLMs; AI code never
 * reaches into the engine (so it cannot read GameState); packages depend only "downwards".
 */
const root = join(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

function importsOf(pkg: string): { file: string; spec: string }[] {
  const out: { file: string; spec: string }[] = [];
  for (const file of sourceFiles(join(root, "packages", pkg, "src"))) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/from\s+"([^"]+)"/g)) out.push({ file: relative(root, file), spec: m[1]! });
  }
  return out;
}

const allowed: Record<string, readonly string[]> = {
  shared: ["zod"],
  maps: ["@deduction/shared"],
  tasks: ["@deduction/shared", "zod"],
  engine: ["@deduction/shared", "@deduction/maps", "@deduction/tasks"],
  ai: ["@deduction/shared", "@deduction/maps", "@deduction/tasks", "zod"],
  runtime: ["@deduction/shared", "@deduction/maps", "@deduction/tasks", "@deduction/engine", "@deduction/ai"],
};

describe("package boundaries", () => {
  for (const [pkg, deps] of Object.entries(allowed)) {
    it(`${pkg} only imports ${deps.join(", ") || "nothing"} (plus node: builtins and relative files)`, () => {
      const bad = importsOf(pkg).filter(({ spec }) => !spec.startsWith(".") && !spec.startsWith("node:") && !deps.includes(spec));
      expect(bad).toEqual([]);
    });
  }

  it("the engine has no React, PixiJS, WebSocket or LLM dependencies", () => {
    const text = sourceFiles(join(root, "packages", "engine", "src")).map((f) => readFileSync(f, "utf8")).join("\n");
    expect(text).not.toMatch(/from\s+"(react|pixi\.js|ws|fastify|openai)"/);
  });

  it("AI code cannot reach the authoritative GameState", () => {
    expect(importsOf("ai").filter(({ spec }) => spec === "@deduction/engine")).toEqual([]);
  });
});
