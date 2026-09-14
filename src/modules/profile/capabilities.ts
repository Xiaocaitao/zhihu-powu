import type { CapabilityContext, DomainCapability, DomainCommand } from '../../contracts/capability.ts';
import { getProfileCompletionInputSchema, getUserProfileInputSchema, saveProfileFactInputSchema, updateUserGoalInputSchema } from './contracts.ts';
import type { ProfileApplication } from './service.ts';
import type { SaveProfileFactInput, UpdateUserGoalInput, LegacyUpdateUserGoalInput } from './contracts.ts';
const command = <T>(ctx:CapabilityContext,payload:T):DomainCommand<T> => ({context:ctx,payload,idempotencyKey:ctx.operationKey});
export function createProfileCapabilities(service:ProfileApplication):DomainCapability[]{
 const read=(data:unknown)=>({ok:true,changed:false,domain:'profile',status:'read' as const,summary:'Profile 查询完成',data});
 return [
  {name:'get_user_profile',description:'读取当前用户画像',inputSchema:getUserProfileInputSchema,execute:async(ctx,input)=>read(await service.getUserProfile(ctx,getUserProfileInputSchema.parse(input)))},
  {name:'get_profile_completion',description:'读取画像完善度',inputSchema:getProfileCompletionInputSchema,execute:async(ctx,input)=>read(await service.getProfileCompletion(ctx,getProfileCompletionInputSchema.parse(input)))},
  {name:'save_profile_fact',description:'保存画像事实',inputSchema:saveProfileFactInputSchema,execute:async(ctx,input)=>service.saveProfileFact(command<SaveProfileFactInput>(ctx,saveProfileFactInputSchema.parse(input) as SaveProfileFactInput))},
  {name:'update_user_goal',description:'更新用户目标方向',inputSchema:updateUserGoalInputSchema,execute:async(ctx,input)=>{ const parsed=updateUserGoalInputSchema.parse(input); const normalized='value' in parsed ? parsed : { goalType:'target_direction' as const, value:{direction:parsed.direction}, expectedVersion:parsed.expectedVersion }; return service.updateUserGoal(command<UpdateUserGoalInput>(ctx,normalized)); }},
 ];
}

