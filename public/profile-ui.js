(() => {
  const form = document.querySelector('#profile-form');
  const read = document.querySelector('[data-profile-action="read"]');
  const json = async (url, body, key) => { let response; try { response = await fetch(url, { method:'POST', headers:{'content-type':'application/json','idempotency-key':key}, body:JSON.stringify(body) }); } catch { throw new Error('当前页面未连接到服务，请打开项目服务地址后重试。'); } if(!response.ok) throw new Error(`画像保存失败（${response.status}）`); return response.json(); };
  async function save(event) {
    event.preventDefault(); event.stopImmediatePropagation();
    const button=form?.querySelector('button[type="submit"]'), status=document.querySelector('#profile-status'); if(button) button.disabled=true; if(status) status.textContent='正在保存画像…';
    try { const data=Object.fromEntries(new FormData(form).entries()), key=(globalThis.crypto?.randomUUID?.()||Date.now().toString()); const jobs=[];
      for(const factType of ['school','major','grade']) { const value=String(data[factType]||'').trim(); if(value) jobs.push(json('/api/growth/profile/facts',{factType,value:{text:value},source:'user_input'},`${key}-${factType}`)); }
      for(const factType of ['interest_direction','learned_content','learning_preference']) { const items=String(data[factType]||'').split(/[,，]/).map(v=>v.trim()).filter(Boolean); if(items.length) jobs.push(json('/api/growth/profile/facts',{factType,value:{items},source:'user_input'},`${key}-${factType}`)); }
      const baseline=String(data.current_baseline||'').trim(); if(baseline) jobs.push(json('/api/growth/profile/facts',{factType:'current_baseline',value:{summary:baseline},source:'user_input'},`${key}-current_baseline`));
      if(String(data.weekly_time||'').trim()) jobs.push(json('/api/growth/profile/facts',{factType:'weekly_time',value:{hours:Number(data.weekly_time)},source:'user_input'},`${key}-weekly_time`));
      jobs.push(json('/api/growth/profile/goal',{direction:String(data.target_direction||'').trim()||null},`${key}-goal`)); await Promise.all(jobs); await refreshProfile(); if(status) status.textContent='画像已保存，完善度已更新。';
    } catch(error) { if(status) status.textContent=error.message||'画像保存失败'; } finally { if(button) button.disabled=false; }
  }
  form?.addEventListener('submit', save, true);
  read?.addEventListener('click', async event => { event.preventDefault(); event.stopImmediatePropagation(); const status=document.querySelector('#profile-status'); if(status) status.textContent='正在读取画像完善度…'; try { await refreshProfile(); if(status && document.querySelector('#profile-percent')?.textContent!=='读取失败') status.textContent='画像完善度已更新。'; } catch { if(status) status.textContent='当前页面未连接到服务，请打开项目服务地址后重试。'; } }, true);
})();
