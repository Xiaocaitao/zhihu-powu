import { z } from "zod";

export type SkillRef = { skillId: string; name: string };
export type SkillDefinition = SkillRef & { description: string; aliases: string[]; revision: number };
export type SkillResolution = {
  input: string;
  status: "resolved" | "ambiguous" | "unresolved";
  candidates: SkillRef[];
};

export const skillLookupSchema = z.object({
  terms: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
}).strict();
export const skillListSchema = z.object({
  keyword: z.string().trim().max(200).optional(),
  limit: z.number().int().min(1).max(100).optional(),
}).strict();

/** Normalize spelling only. Do not infer that related skills are equivalent. */
export const normalizeSkillTerm = (term: string) => term.normalize("NFKC").trim().toLocaleLowerCase("en-US");
