import type { ProfileRepository } from './repository.ts';
import type { GetProfileCompletionInput, GetUserProfileInput, ProfileCompletionDTO, ProfileFactPayload, ProfileWriteResult, SaveProfileFactInput, UpdateUserGoalInput, UserProfileDTO } from './contracts.ts';
export type ProfileContext={ownerId:string};
export interface ProfileApplication { getUserProfile(ctx:ProfileContext,input:GetUserProfileInput):Promise<UserProfileDTO|null>; getProfileCompletion(ctx:ProfileContext,input:GetProfileCompletionInput):Promise<ProfileCompletionDTO>; saveProfileFact(ctx:ProfileContext,input:SaveProfileFactInput):Promise<ProfileWriteResult>; updateUserGoal(ctx:ProfileContext,input:UpdateUserGoalInput):Promise<ProfileWriteResult>; }
const required=['school','major','grade','learned_content','current_baseline','interest_direction','weekly_time','learning_preference','target_direction'] as const;
const sectionMap:Record<string,any>={school:'identity',major:'identity',grade:'identity',learned_content:'background',current_baseline:'background',interest_direction:'interests',weekly_time:'availability',learning_preference:'preferences',target_direction:'goals'};
function validateFact(input: SaveProfileFactInput){
  if(input.factType !== 'weekly_time' && input.factType !== 'current_baseline' && input.factType !== 'school' && input.factType !== 'major' && input.factType !== 'grade' && input.factType !== 'learned_content' && input.factType !== 'interest_direction' && input.factType !== 'learning_preference') throw new Error('INVALID_ARGUMENT');
  if(input.source === 'assessment' && !input.evidenceRef) throw new Error('INVALID_ARGUMENT');
  if(input.factType === 'weekly_time' && (!Number.isFinite((input.value as {hours?:number}).hours) || (input.value as {hours:number}).hours < 0)) throw new Error('INVALID_ARGUMENT');
  const value=input.value as {text?:string;summary?:string;items?:string[]};
  if(typeof value.text === 'string' && !value.text.trim() || typeof value.summary === 'string' && !value.summary.trim() || value.items && (!value.items.length || value.items.some(item=>!item.trim()))) throw new Error('INVALID_ARGUMENT');
}
export class ProfileService implements ProfileApplication {
 private readonly repo: ProfileRepository;
 constructor(repo: ProfileRepository){ this.repo = repo; }
 async getUserProfile(ctx:ProfileContext,input:GetUserProfileInput){const facts=await this.repo.getFacts(ctx.ownerId,input.sections);const goals=await this.repo.getGoals(ctx.ownerId);const present=new Set(facts.map(f=>f.factType));if(goals.length)present.add('target_direction');return {ownerId:ctx.ownerId,facts,goals,includedSections:input.sections??['identity','background','interests','availability','preferences','goals'],missingFields:required.filter(x=>!present.has(x))};}
 async getProfileCompletion(ctx:ProfileContext,_input:GetProfileCompletionInput){const p=await this.getUserProfile(ctx,{});const missing=p?.missingFields??[...required];const percentage=Math.round((required.length-missing.length)/required.length*100);const completedSections=Array.from(new Set(required.filter(x=>!missing.includes(x)).map(x=>sectionMap[x])));const missingSections=(['identity','background','interests','availability','preferences','goals'] as const).filter(x=>!completedSections.includes(x));return {ownerId:ctx.ownerId,percentage,completedSections,missingSections,missingFields:_input.includeMissingFields===false?[]:missing,ruleVersion:'v1'};}
 async saveProfileFact(ctx:ProfileContext,input:SaveProfileFactInput){validateFact(input);const fact=await this.repo.saveFact(ctx.ownerId,{factType:input.factType,section:sectionMap[input.factType],value:input.value as any,source:input.source,isConfirmed:input.isConfirmed??input.source==='user_confirmed',evidenceRef:input.evidenceRef},input.expectedVersion);return {ok:true,changed:true,domain:'profile' as const,status:'applied',summary:'画像事实已保存',entityId:fact.id,version:fact.version,data:{fact}};}
 async updateUserGoal(ctx:ProfileContext,input:UpdateUserGoalInput){const goal=await this.repo.saveGoal(ctx.ownerId,{direction:input.direction},input.expectedVersion);return {ok:true,changed:true,domain:'profile' as const,status:'applied',summary:'目标方向已更新',entityId:goal.id,version:goal.version,data:{goal}};}
}







