import { getProfileCompletionInputSchema, getUserProfileInputSchema, saveProfileFactInputSchema, updateUserGoalInputSchema } from './contracts.ts';
import type { ProfileApplication } from './service.ts';

export function createProfileCapabilities(service: ProfileApplication) {
  const read = async <T>(data: T) => ({ ok: true, changed: false, domain: 'profile' as const, status: 'read' as const, summary: 'Profile 查询完成', data });
  return [
    { name: 'get_user_profile', description: '读取当前用户画像', inputSchema: getUserProfileInputSchema, execute: async (ctx: { ownerId: string }, input: unknown) => read(await service.getUserProfile(ctx, getUserProfileInputSchema.parse(input))) },
    { name: 'get_profile_completion', description: '读取画像完善度', inputSchema: getProfileCompletionInputSchema, execute: async (ctx: { ownerId: string }, input: unknown) => read(await service.getProfileCompletion(ctx, getProfileCompletionInputSchema.parse(input))) },
    { name: 'save_profile_fact', description: '保存画像事实', inputSchema: saveProfileFactInputSchema, execute: (ctx: { ownerId: string }, input: unknown) => service.saveProfileFact(ctx, saveProfileFactInputSchema.parse(input) as never) },
    { name: 'update_user_goal', description: '更新用户目标方向', inputSchema: updateUserGoalInputSchema, execute: (ctx: { ownerId: string }, input: unknown) => service.updateUserGoal(ctx, updateUserGoalInputSchema.parse(input)) },
  ];
}
