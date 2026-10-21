import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseModelSpec } from "./model";
import { z } from "zod";

const ModelSpecString = z.string().refine(
  (v) => {
    try {
      parseModelSpec(v);
      return true;
    } catch {
      return false;
    }
  },
  { message: "Invalid model spec; expected 'provider/model'" },
);

const RawConfigSchema = z.object({
  model: ModelSpecString.nullable().default(null),
  repairModel: ModelSpecString.nullable().default(null),
  planModel: ModelSpecString.nullable().default(null),
  moderationModel: ModelSpecString.nullable().default(null),
  judgeModel: ModelSpecString.nullable().default(null),
  repeats: z.number().int().positive().default(3),
  maxCostUsd: z.number().nonnegative().default(5),
  prompts: z.string().default("./prompts/v1.json"),
  only: z.array(z.string()).default([]),
  outDir: z.string().default("./results"),
  tag: z.string().nullable().default(null),
  baseline: z.string().nullable().default(null),
});

export type RawEvalConfig = z.infer<typeof RawConfigSchema>;

export type EvalConfig = RawEvalConfig & {

  configPath: string | null;

  promptsPath: string;

  outDirPath: string;

  baselinePath: string | null;
};

export function stripJsoncComments(src: string): string {
  let out = "";
  let i = 0;
  let inString = false;
  let stringChar = "";
  while (i < src.length) {
    const c = src[i] as string;
    const next = src[i + 1];
    if (inString) {
      out += c;
      if (c === "\\" && i + 1 < src.length) {
        out += src[i + 1] as string;
        i += 2;
        continue;
      }
      if (c === stringChar) inString = false;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = true;
      stringChar = c;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < src.length - 1 && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export function parseConfig(text: string): RawEvalConfig {
  const stripped = stripJsoncComments(text);
  const obj = JSON.parse(stripped);
  return RawConfigSchema.parse(obj);
}

export async function loadConfig(configPath: string | null): Promise<EvalConfig> {
  let raw: RawEvalConfig;
  if (configPath) {
    const text = await fs.readFile(configPath, "utf8");
    raw = parseConfig(text);
  } else {
    raw = RawConfigSchema.parse({});
  }
  const baseDir = configPath ? path.dirname(path.resolve(configPath)) : process.cwd();
  const resolveRel = (p: string): string => (path.isAbsolute(p) ? p : path.resolve(baseDir, p));
  return {
    ...raw,
    configPath: configPath ? path.resolve(configPath) : null,
    promptsPath: resolveRel(raw.prompts),
    outDirPath: resolveRel(raw.outDir),
    baselinePath: raw.baseline ? resolveRel(raw.baseline) : null,
  };
}
