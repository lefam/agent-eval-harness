import * as fs from "node:fs/promises";
import { z } from "zod";

const StarterSchema = z.enum(["blank", "bouncing_ball", "pong", "freeform", "blank_3d"] as const);

const HistoryTurnSchema = z.object({
  userPrompt: z.string().min(1),
  finishSummary: z.string().nullable(),
});

const PromptCaseSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .regex(/^[a-z0-9][a-z0-9_-]*$/, {
        message: "id must be kebab/snake-case ASCII (a-z 0-9 _ -)",
      }),
    kind: z.enum(["create", "edit"]),
    starter: StarterSchema,
    prompt: z.string().min(1),
    history: z.array(HistoryTurnSchema).default([]),
    askUserResponses: z.array(z.string()).default([]),
  })
  .superRefine((c, ctx) => {
    if (c.kind === "create" && c.history.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "create-kind prompts must not carry history",
        path: ["history"],
      });
    }
  });

export type PromptCase = z.infer<typeof PromptCaseSchema>;

const PromptSetSchema = z.array(PromptCaseSchema).superRefine((cases, ctx) => {
  const seen = new Set<string>();
  for (const c of cases) {
    if (seen.has(c.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate prompt id "${c.id}"`,
        path: [c.id],
      });
    }
    seen.add(c.id);
  }
});

export type PromptSet = z.infer<typeof PromptSetSchema>;

export function parsePromptSet(text: string): PromptSet {
  const obj = JSON.parse(text);
  return PromptSetSchema.parse(obj);
}

export async function loadPromptSet(filePath: string): Promise<PromptSet> {
  const text = await fs.readFile(filePath, "utf8");
  return parsePromptSet(text);
}

export function filterPromptSet(set: PromptSet, only: readonly string[]): PromptSet {
  if (only.length === 0) return set;
  const wanted = new Set(only);
  const have = new Set(set.map((c) => c.id));
  for (const id of only) {
    if (!have.has(id)) {
      throw new Error(`Unknown prompt id "${id}" in only-filter`);
    }
  }
  return set.filter((c) => wanted.has(c.id));
}
