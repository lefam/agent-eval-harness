import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { filterPromptSet, loadPromptSet, parsePromptSet } from "./prompts";

describe("parsePromptSet", () => {
  it("parses a minimal valid set", () => {
    const set = parsePromptSet(
      JSON.stringify([
        { id: "a", kind: "create", starter: "blank", prompt: "x" },
        { id: "b", kind: "edit", starter: "bouncing_ball", prompt: "y", history: [] },
      ]),
    );
    expect(set).toHaveLength(2);
    expect(set[0]?.id).toBe("a");
    expect(set[1]?.history).toEqual([]);
  });

  it("defaults missing history to []", () => {
    const set = parsePromptSet(
      JSON.stringify([{ id: "a", kind: "create", starter: "blank", prompt: "x" }]),
    );
    expect(set[0]?.history).toEqual([]);
  });

  it("rejects an unknown starter", () => {
    expect(() =>
      parsePromptSet(
        JSON.stringify([{ id: "a", kind: "create", starter: "made-up", prompt: "x" }]),
      ),
    ).toThrow();
  });

  it("rejects an unknown kind", () => {
    expect(() =>
      parsePromptSet(JSON.stringify([{ id: "a", kind: "remix", starter: "blank", prompt: "x" }])),
    ).toThrow();
  });

  it("rejects a malformed id", () => {
    expect(() =>
      parsePromptSet(
        JSON.stringify([{ id: "Bad ID!", kind: "create", starter: "blank", prompt: "x" }]),
      ),
    ).toThrow();
  });

  it("rejects an empty prompt", () => {
    expect(() =>
      parsePromptSet(JSON.stringify([{ id: "a", kind: "create", starter: "blank", prompt: "" }])),
    ).toThrow();
  });

  it("rejects duplicate ids", () => {
    expect(() =>
      parsePromptSet(
        JSON.stringify([
          { id: "dup", kind: "create", starter: "blank", prompt: "a" },
          { id: "dup", kind: "create", starter: "blank", prompt: "b" },
        ]),
      ),
    ).toThrow(/duplicate prompt id/);
  });

  it("rejects history on a create-kind prompt", () => {
    expect(() =>
      parsePromptSet(
        JSON.stringify([
          {
            id: "a",
            kind: "create",
            starter: "blank",
            prompt: "x",
            history: [{ userPrompt: "hi", finishSummary: "ok" }],
          },
        ]),
      ),
    ).toThrow(/must not carry history/);
  });

  it("accepts history on an edit-kind prompt", () => {
    const set = parsePromptSet(
      JSON.stringify([
        {
          id: "a",
          kind: "edit",
          starter: "pong",
          prompt: "tweak",
          history: [{ userPrompt: "first", finishSummary: "added paddles" }],
        },
      ]),
    );
    expect(set[0]?.history).toHaveLength(1);
  });

  it("defaults askUserResponses to []", () => {
    const set = parsePromptSet(
      JSON.stringify([{ id: "a", kind: "create", starter: "blank", prompt: "x" }]),
    );
    expect(set[0]?.askUserResponses).toEqual([]);
  });

  it("accepts a list of ask_user responses", () => {
    const set = parsePromptSet(
      JSON.stringify([
        {
          id: "a",
          kind: "create",
          starter: "blank",
          prompt: "make a thing",
          askUserResponses: ["red", "fast"],
        },
      ]),
    );
    expect(set[0]?.askUserResponses).toEqual(["red", "fast"]);
  });
});

describe("filterPromptSet", () => {
  const set = parsePromptSet(
    JSON.stringify([
      { id: "a", kind: "create", starter: "blank", prompt: "x" },
      { id: "b", kind: "create", starter: "blank", prompt: "y" },
      { id: "c", kind: "create", starter: "blank", prompt: "z" },
    ]),
  );

  it("returns the full set when only is empty", () => {
    expect(filterPromptSet(set, [])).toHaveLength(3);
  });

  it("filters down to the requested ids preserving order", () => {
    const filtered = filterPromptSet(set, ["c", "a"]);
    expect(filtered.map((c) => c.id)).toEqual(["a", "c"]);
  });

  it("throws on an unknown id", () => {
    expect(() => filterPromptSet(set, ["a", "missing"])).toThrow(/Unknown prompt id/);
  });
});

describe("loadPromptSet", () => {
  it("loads the shipped v1.json", async () => {
    const here = path.dirname(new URL(import.meta.url).pathname);
    const v1Path = path.resolve(here, "../prompts/v1.json");
    const set = await loadPromptSet(v1Path);
    expect(set.length).toBe(2);
    const ids = set.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
