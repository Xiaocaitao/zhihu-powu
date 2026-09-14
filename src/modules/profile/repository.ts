import type { CapabilityResult } from '../../contracts/capability.ts';
import type { ProfileFactDTO, ProfileSection, UserGoalDTO, ProfileFactType } from './contracts.ts';
export type ProfileWriteMeta={commandName:string;requestId:string;idempotencyKey:string;requestHash:string};
export type ProfileCommandReceipt={requestHash:string;result:CapabilityResult;};
export interface ProfileRepository { getFacts(ownerId:string,sections?:ProfileSection[]):Promise<ProfileFactDTO[]>; getGoals(ownerId:string):Promise<UserGoalDTO[]>; saveFact(ownerId:string,fact:Omit<ProfileFactDTO,'id'|'version'|'updatedAt'>,expectedVersion?:number):Promise<ProfileFactDTO>; saveGoal(ownerId:string,value:{direction:string|null},expectedVersion?:number):Promise<UserGoalDTO>; getCommandReceipt?(ownerId:string,key:string):Promise<ProfileCommandReceipt|undefined>; saveCommandReceipt?(ownerId:string,key:string,meta:ProfileWriteMeta,result:CapabilityResult):Promise<void>; }
export class MemoryProfileRepository implements ProfileRepository {
 private facts=new Map<string,Map<ProfileFactType,ProfileFactDTO>>(); private goals=new Map<string,UserGoalDTO>(); private receipts=new Map<string,Map<string,ProfileCommandReceipt>>();
 async getFacts(ownerId:string,sections?:ProfileSection[]){const all=[...(this.facts.get(ownerId)?.values()??[])];return sections?.length?all.filter(f=>sections.includes(f.section)):all;}
 async getGoals(ownerId:string){const g=this.goals.get(ownerId);return g?[g]:[];}
 async saveFact(ownerId:string,fact:Omit<ProfileFactDTO,'id'|'version'|'updatedAt'>,expectedVersion?:number){let m=this.facts.get(ownerId);if(!m){m=new Map();this.facts.set(ownerId,m)}const old=m.get(fact.factType);if(expectedVersion!==undefined&&old?.version!==expectedVersion)throw new Error('VERSION_CONFLICT');const next={...fact,id:old?.id??crypto.randomUUID(),version:(old?.version??0)+1,updatedAt:new Date().toISOString()} as ProfileFactDTO;m.set(fact.factType,next);return next;}
 async saveGoal(ownerId:string,value:{direction:string|null},expectedVersion?:number){const old=this.goals.get(ownerId);if(expectedVersion!==undefined&&old?.version!==expectedVersion)throw new Error('VERSION_CONFLICT');const next={id:old?.id??crypto.randomUUID(),goalType:'target_direction' as const,value,version:(old?.version??0)+1,updatedAt:new Date().toISOString()};this.goals.set(ownerId,next);return next;}
 async getCommandReceipt(ownerId:string,key:string){return this.receipts.get(ownerId)?.get(key);}
 async saveCommandReceipt(ownerId:string,key:string,meta:ProfileWriteMeta,result:CapabilityResult){let m=this.receipts.get(ownerId);if(!m){m=new Map();this.receipts.set(ownerId,m)}const old=m.get(key);if(old&&old.requestHash!==meta.requestHash)throw new Error('DUPLICATE_REQUEST');if(!old)m.set(key,{requestHash:meta.requestHash,result});}
}

