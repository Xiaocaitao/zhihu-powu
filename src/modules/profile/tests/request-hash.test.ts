import test from 'node:test';
import assert from 'node:assert/strict';
import { hashProfileCommand } from '../request-hash.ts';
test('Profile 命令哈希对字段顺序和版本稳定',()=>{assert.equal(hashProfileCommand('save_profile_fact',{factType:'major',value:{text:'CS'}},1),hashProfileCommand('save_profile_fact',{factType:'major',value:{text:'CS'}},1));assert.notEqual(hashProfileCommand('save_profile_fact',{factType:'major',value:{text:'CS'}},1),hashProfileCommand('save_profile_fact',{factType:'major',value:{text:'CS'}},2));});
