import { getProfileCompletionInputSchema, getUserProfileInputSchema, saveProfileFactInputSchema, updateUserGoalInputSchema } from './contracts.ts';
import type { ProfileApplication } from './service.ts';

export function createProfileCapabilities(service: ProfileApplication) {
  return [
    { name: 'get_user_profile', description: '读取当前用户画像', inputSchema: getUserProfileInputSchema, execute: (ctx: { ownerId: string }, input: unknown) => service.getUserProfile(ctx, getUserProfileInputSchema.parse(input)) },
    { name: 'get_profile_completion', description: '读取画像完善度', inputSchema: getProfileCompletionInputSchema, execute: (ctx: { ownerId: string }, input: unknown) => service.getProfileCompletion(ctx, getProfileCompletionInputSchema.parse(input)) },
    { name: 'save_profile_fact', description: '保存画像事实', inputSchema: saveProfileFactInputSchema, execute: (ctx: { ownerId: string }, input: unknown) => service.saveProfileFact(ctx, saveProfileFactInputSchema.parse(input) as never) },
    { name: 'update_user_goal', description: '更新用户目标方向', inputSchema: updateUserGoalInputSchema, execute: (ctx: { ownerId: string }, input: unknown) => service.updateUserGoal(ctx, updateUserGoalInputSchema.parse(input)) },
  ];
}

