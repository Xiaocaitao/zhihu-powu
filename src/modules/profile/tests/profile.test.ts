import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryProfileRepository } from '../repository.ts';
import { ProfileService } from '../service.ts';
import { createProfileCapabilities } from '../capabilities.ts';

function setup(){const repo=new MemoryProfileRepository(); return {repo,service:new ProfileService(repo)};}

test('保存并读取画像事实与目标方向', async()=>{const {service}=setup(); const ctx={ownerId:'u1'}; const saved=await service.saveProfileFact(ctx,{factType:'major',value:{text:'计算机科学'},source:'user_input'}); assert.equal(saved.ok,true); const goal=await service.updateUserGoal(ctx,{direction:'前端开发'}); assert.equal(goal.ok,true); const profile=await service.getUserProfile(ctx,{}); assert.equal((profile?.facts[0].value as {text:string}).text,'计算机科学'); assert.equal(profile?.goals[0].value.direction,'前端开发');});

test('用户数据隔离', async()=>{const {service}=setup(); await service.saveProfileFact({ownerId:'u1'},{factType:'school',value:{text:'甲大学'},source:'user_input'}); const other=await service.getUserProfile({ownerId:'u2'},{}); assert.equal(other?.facts.length,0);});

test('完善度按九项字段计算', async()=>{const {service}=setup(); const result=await service.getProfileCompletion({ownerId:'u1'},{includeMissingFields:true}); assert.equal(result.percentage,0); assert.equal(result.missingFields.length,9);});

test('版本冲突会拒绝过期写入', async()=>{const {service}=setup(); const ctx={ownerId:'u1'}; await service.saveProfileFact(ctx,{factType:'grade',value:{text:'大一'},source:'user_input'}); await assert.rejects(()=>service.saveProfileFact(ctx,{factType:'grade',value:{text:'大二'},source:'user_input',expectedVersion:99}),/VERSION_CONFLICT/);});

test('四个 Agent Tool 均委托 Service', async()=>{const calls:string[]=[]; const fake:any={getUserProfile:async()=>{calls.push('get_user_profile');return null},getProfileCompletion:async()=>{calls.push('get_profile_completion');return {}},saveProfileFact:async()=>{calls.push('save_profile_fact');return {}},updateUserGoal:async()=>{calls.push('update_user_goal');return {}}}; const tools=createProfileCapabilities(fake); for(const tool of tools) await tool.execute({ownerId:'u1'},tool.name==='update_user_goal'?{direction:'后端'}:tool.name==='save_profile_fact'?{factType:'major',value:{text:'CS'},source:'user_input'}:{}); assert.deepEqual(calls,['get_user_profile','get_profile_completion','save_profile_fact','update_user_goal']);});


test('校验测评来源必须带证据引用', async()=>{const {service}=setup(); await assert.rejects(()=>service.saveProfileFact({ownerId:'u1'},{factType:'major',value:{text:'CS'},source:'assessment'}),/INVALID_ARGUMENT/);});
test('每周时间不允许为负数', async()=>{const {service}=setup(); await assert.rejects(()=>service.saveProfileFact({ownerId:'u1'},{factType:'weekly_time',value:{hours:-1},source:'user_input'}),/INVALID_ARGUMENT/);});

test('分区查询只返回指定分区但缺失字段仍按完整画像计算', async()=>{const {service}=setup(); const ctx={ownerId:'u1'}; await service.saveProfileFact(ctx,{factType:'major',value:{text:'CS'},source:'user_input'}); await service.saveProfileFact(ctx,{factType:'school',value:{text:'甲大学'},source:'user_input'}); const profile=await service.getUserProfile(ctx,{sections:['identity']}); assert.equal(profile?.facts.length,2); assert.equal(profile?.missingFields.length,7);});

test('完善度查询可隐藏缺失字段', async()=>{const {service}=setup(); const result=await service.getProfileCompletion({ownerId:'u1'},{includeMissingFields:false}); assert.equal(result.missingFields.length,0); assert.equal(result.percentage,0);});

test('目标方向版本冲突会拒绝过期更新', async()=>{const {service}=setup(); const ctx={ownerId:'u1'}; await service.updateUserGoal(ctx,{direction:'前端'}); await assert.rejects(()=>service.updateUserGoal(ctx,{direction:'后端',expectedVersion:9}),/VERSION_CONFLICT/);});
