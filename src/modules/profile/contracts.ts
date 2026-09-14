import { z } from "zod";

export const profileSections = ["identity", "background", "interests", "availability", "preferences", "goals"] as const;
export type ProfileSection = (typeof profileSections)[number];

export const profileFactTypes = [
  "school", "major", "grade", "learned_content", "current_baseline",
  "interest_direction", "weekly_time", "learning_preference", "target_direction",
] as const;
export type ProfileFactType = (typeof profileFactTypes)[number];
export type ProfileFactSource = "user_input" | "user_confirmed" | "assessment";

export type ProfileFactPayload =
  | { factType: "school" | "major" | "grade"; value: { text: string } }
  | { factType: "learned_content" | "interest_direction" | "learning_preference"; value: { items: string[] } }
  | { factType: "current_baseline"; value: { summary: string } }
  | { factType: "weekly_time"; value: { hours: number } };

export interface ProfileFactDTO {
  id: string;
  factType: ProfileFactType;
  section: Exclude<ProfileSection, "goals">;
  value: ProfileFactPayload["value"];
  source: ProfileFactSource;
  isConfirmed: boolean;
  evidenceRef?: { evidenceId: string; evaluatedAt: string };
  version: number;
  updatedAt: string;
}

export interface UserGoalDTO {
  id: string;
  goalType: "target_direction";
  value: { direction: string | null };
  version: number;
  updatedAt: string;
}

export interface UserProfileDTO {
  ownerId: string;
  facts: ProfileFactDTO[];
  goals: UserGoalDTO[];
  includedSections: ProfileSection[];
  missingFields: ProfileFactType[];
}

export interface ProfileCompletionDTO {
  ownerId: string;
  percentage: number;
  completedSections: ProfileSection[];
  missingSections: ProfileSection[];
  missingFields: ProfileFactType[];
  ruleVersion: string;
}

export interface ProfileWriteResult<TFact extends ProfileFactDTO | undefined = ProfileFactDTO | undefined> {
  ok: boolean;
  changed: boolean;
  domain: "profile";
  data?: { fact?: TFact; goal?: UserGoalDTO };
  entityId?: string;
  version?: number;
  status?: string;
  summary?: string;
}

export interface GetUserProfileInput { sections?: ProfileSection[] }
export interface GetProfileCompletionInput { includeMissingFields?: boolean }
export type SaveProfileFactInput = ProfileFactPayload & {
  source: ProfileFactSource;
  isConfirmed?: boolean;
  evidenceRef?: { evidenceId: string; evaluatedAt: string };
  expectedVersion?: number;
}
export interface UpdateUserGoalInput {
  direction: string | null;
  expectedVersion?: number;
}

const nonEmpty = z.string().trim().min(1);
export const getUserProfileInputSchema = z.object({ sections: z.array(z.enum(profileSections)).optional() });
export const getProfileCompletionInputSchema = z.object({ includeMissingFields: z.boolean().optional() });
export const saveProfileFactInputSchema = z.object({
  factType: z.enum(profileFactTypes).exclude(["target_direction"]),
  // Keep the value shape visible to the Agent tool schema. `z.unknown()` was
  // rendered as `{}`, so the model commonly sent a string for a text fact and
  // the service rejected an otherwise valid user request.
  value: z.union([
    z.object({ text: nonEmpty }),
    z.object({ items: z.array(nonEmpty).min(1) }),
    z.object({ summary: nonEmpty }),
    z.object({ hours: z.number().nonnegative() }),
  ]),
  source: z.enum(["user_input", "user_confirmed", "assessment"]),
  isConfirmed: z.boolean().optional(),
  evidenceRef: z.object({ evidenceId: nonEmpty, evaluatedAt: nonEmpty }).optional(),
  expectedVersion: z.number().int().positive().optional(),
});
export const updateUserGoalInputSchema = z.object({ direction: z.string().trim().nullable(), expectedVersion: z.number().int().positive().optional() });
