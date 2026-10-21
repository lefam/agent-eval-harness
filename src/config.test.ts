import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, parseConfig, stripJsoncComments } from "./config";

describe("stripJsoncComments", () => {
  it("strips line comments", () => {
    expect(stripJsoncComments("a // comment\nb")).toBe("a \nb");
  });

  it("strips block comments", () => {
    expect(stripJsoncComments("a /* x\ny */ b")).toBe("a  b");
  });

  it("preserves // inside strings", () => {
    expect(stripJsoncComments('"http://example.com"')).toBe('"http://example.com"');
  });

  it("preserves /* */ inside strings", () => {
    expect(stripJsoncComments('"a /* b */ c"')).toBe('"a /* b */ c"');
  });

  it("handles escaped quotes inside strings", () => {
    expect(stripJsoncComments('"a \\"// not a comment\\" b" // gone')).toBe(
      '"a \\"// not a comment\\" b" ',
    );
  });
});

describe("parseConfig", () => {
  it("applies all defaults for an empty object", () => {
    const c = parseConfig("{}");
    expect(c.model).toBeNull();
    expect(c.repairModel).toBeNull();
    expect(c.moderationModel).toBeNull();
    expect(c.judgeModel).toBeNull();
    expect(c.repeats).toBe(3);
    expect(c.maxCostUsd).toBe(5);
    expect(c.prompts).toBe("./prompts/v1.json");
    expect(c.outDir).toBe("./results");
    expect(c.only).toEqual([]);
    expect(c.tag).toBeNull();
    expect(c.baseline).toBeNull();
  });

  it("parses JSONC with comments and overrides", () => {
    const c = parseConfig(`{
      // model selection
      "model": "ollama/qwen2.5-coder:7b",
      "repeats": 5 /* bumped */
    }`);
    expect(c.model).toBe("ollama/qwen2.5-coder:7b");
    expect(c.repeats).toBe(5);
  });

  it("rejects an invalid model spec", () => {
    expect(() => parseConfig(`{"model": "not-a-spec"}`)).toThrow();
  });

  it("rejects a missing provider", () => {
    expect(() => parseConfig(`{"model": "/foo"}`)).toThrow();
  });

  it("rejects repeats=0", () => {
    expect(() => parseConfig(`{"repeats": 0}`)).toThrow();
  });

  it("rejects negative maxCostUsd", () => {
    expect(() => parseConfig(`{"maxCostUsd": -1}`)).toThrow();
  });
});

describe("loadConfig", () => {
  it("returns defaults when configPath is null", async () => {
    const c = await loadConfig(null);
    expect(c.configPath).toBeNull();
    expect(c.promptsPath).toBe(path.resolve(process.cwd(), "./prompts/v1.json"));
    expect(c.outDirPath).toBe(path.resolve(process.cwd(), "./results"));
    expect(c.baselinePath).toBeNull();
  });

  it("resolves paths relative to the config file directory", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "loop-eval-"));
    try {
      const file = path.join(dir, "my.jsonc");
      await fs.writeFile(
        file,
        `{ "prompts": "./p.json", "outDir": "./out", "baseline": "./b.json" }`,
      );
      const c = await loadConfig(file);
      expect(c.configPath).toBe(file);
      expect(c.promptsPath).toBe(path.join(dir, "p.json"));
      expect(c.outDirPath).toBe(path.join(dir, "out"));
      expect(c.baselinePath).toBe(path.join(dir, "b.json"));
    } finally {
      await fs.rm(dir, { recursive: true });
    }
  });

  it("loads the shipped default config", async () => {
    const here = path.dirname(new URL(import.meta.url).pathname);
    const defaultPath = path.resolve(here, "../configs/default.jsonc");
    const c = await loadConfig(defaultPath);
    expect(c.configPath).toBe(defaultPath);
    expect(c.repeats).toBeGreaterThanOrEqual(1);
    // Both null and valid model specs are accepted.
  });
});
