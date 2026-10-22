(function () {
  'use strict';
  const api = window.FoundryCalculator, catalog = window.FoundryPrices;
  const form = document.getElementById('cost-form'), currency = document.getElementById('currency'), modelSelect = document.getElementById('model'), download = document.getElementById('download-estimate');
  const outputs = Array.from(document.querySelectorAll('[data-output]'));
  const fields = Object.fromEntries(Object.keys(api.rules).map(k => [k, document.getElementById(k)]));
  const number = new Intl.NumberFormat('en-US', {maximumFractionDigits: 6}), compact = new Intl.NumberFormat('en-US', {notation: 'compact', maximumFractionDigits: 2});
  const models = catalog.models, providerFilter = document.getElementById('provider-filter'), includeLong = document.getElementById('include-long');
  const categories = [
    {name: 'Ordinary input', tokens: 'uncachedTokens', rate: 'inputRate', cost: 'inputCost', meter: 'input'},
    {name: 'Cache reads', tokens: 'cachedTokens', rate: 'cacheRate', cost: 'cacheCost', meter: 'cache'},
    {name: 'Cache writes', tokens: 'cacheWriteTokens', rate: 'cacheWriteRate', cost: 'cacheWriteCost', meter: 'cacheWrite'},
    {name: 'Output', tokens: 'outputTotal', rate: 'outputRate', cost: 'outputCost', meter: 'output'}
  ];
  let current = null, announcementTimer;
  function el(tag, text, className) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; }
  function link(label, url) { const a = el('a', label); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; }
  function money(n, small = false, code = currency.value) { return n === null ? '—' : new Intl.NumberFormat('en-US', {style:'currency',currency:code,minimumFractionDigits:small?4:2,maximumFractionDigits:small?6:2}).format(n); }
  function rate(n, code = currency.value) { return n === null ? 'Not listed' : new Intl.NumberFormat('en-US', {style:'currency',currency:code,minimumFractionDigits:2,maximumFractionDigits:6}).format(n); }
  function selected() { return models.find(m => m.id === modelSelect.value) || null; }
  function modelLabel(m) { return m ? m.name + (m.contextTier === 'Standard' ? '' : ' · ' + m.contextTier) : 'Custom rates'; }
  function rawInputs() { return Object.fromEntries(Object.entries(fields).map(([k,e]) => [k,e.value])); }
  function initModels() {
    modelSelect.replaceChildren();
    for (const provider of [...new Set(models.map(m => m.provider))]) {
      const group = el('optgroup'); group.label = provider;
      for (const m of models.filter(m => m.provider === provider)) { const option = el('option', modelLabel(m)); option.value = m.id; group.append(option); }
      modelSelect.append(group);
      const filterOption = el('option', provider); filterOption.value = provider; providerFilter.append(filterOption);
    }
    const custom = el('option', 'Custom / contracted rates'); custom.value = 'custom'; modelSelect.append(custom);
    document.getElementById('model-count').textContent = new Set(models.map(m => m.name)).size + ' models · ' + new Set(models.map(m => m.provider)).size + ' providers';
  }
  function setRateAvailability(key, available, message) {
    const input = fields[key], wrap = input.closest('.input-wrap');
    let unavailable = document.getElementById(key + '-unavailable');
    if (!unavailable) { unavailable = el('p', '', 'rate-unavailable'); unavailable.id = key + '-unavailable'; wrap.after(unavailable); }
    wrap.hidden = !available; unavailable.hidden = available; unavailable.textContent = message;
  }
  function configureModel() {
    const m = selected(), custom = !m;
    currency.disabled = !custom;
    if (m) {
      currency.value = 'USD';
      fields.inputRate.value = m.inputRate; fields.outputRate.value = m.outputRate;
      fields.cacheRate.value = m.cacheRate ?? 0; fields.cacheWriteRate.value = m.cacheWriteRate ?? 0;
      if (m.cacheRate === null) fields.cacheShare.value = 0;
      if (m.cacheWriteRate === null) fields.cacheWriteShare.value = 0;
    }
    ['inputRate','outputRate','cacheRate','cacheWriteRate'].forEach(k => { fields[k].readOnly = !custom; });
    fields.cacheShare.disabled = Boolean(m && m.cacheRate === null);
    fields.cacheWriteShare.disabled = Boolean(m && m.cacheWriteRate === null);
    setRateAvailability('cacheRate', custom || m.cacheRate !== null, 'No separate rate verified');
    setRateAvailability('cacheWriteRate', custom || m.cacheWriteRate !== null, 'Not separately priced');
    document.getElementById('cacheRate-help').textContent = m && m.cacheRate === null ? 'This preset prices all input at the ordinary rate; no cache discount is assumed.' : 'Per 1 million input tokens read from cache.';
    document.getElementById('cacheWriteRate-help').textContent = m && m.cacheWriteRate === null ? 'This rate set does not use a separate write category; non-read input uses the ordinary rate.' : 'Full price for the write category. These tokens are removed from ordinary input.';
    document.getElementById('cacheShare-help').textContent = fields.cacheShare.disabled ? 'No separate cache-read rate verified for this preset.' : 'Use measured cache hits. Cache reads are a subset of total input.';
    document.getElementById('cacheWriteShare-help').textContent = fields.cacheWriteShare.disabled ? 'This preset does not apply a separate cache-write category.' : 'Reads + writes must be at most 100% of total input. Use measured write tokens.';
    document.getElementById('pricing-status').textContent = custom ? 'Custom rates · entered by you' : 'Official Azure retail prices · verified 22 Oct 2026';
    document.getElementById('pricing-description').textContent = custom ? 'Enter rates for the same model, deployment, region and currency. These values are not verified Azure presets.' : 'Published price snapshot, not a live feed. Your contract or other deployment types may have different rates.';
    document.getElementById('price-notice').classList.toggle('verified-notice', !custom);
    const source = document.getElementById('selected-source'); source.hidden = custom; if (m) source.href = m.sourceUrl;
    document.getElementById('model-scope').replaceChildren(...(custom ? ['Your rate schedule','Your currency'] : ['USD',m.deployment,'East US 2 reference meters']).map(x => el('span',x)));
    document.getElementById('model-caveat').textContent = custom ? 'Use custom rates for your region or agreement. Include a cache-write share only when your billing schedule uses a separate write category.' : (m.modelVersion ? 'Model version: '+m.modelVersion+'. ' : '') + (m.contextTier !== 'Standard' ? m.contextTier + ' tariff selected. Check the request-length threshold on the Azure pricing page; calculate mixed tiers separately. ' : '') + (m.cacheWriteRate !== null ? 'Separately priced cache writes apply when used; enter their share under caching adjustments.' : 'Confirm model availability and quota in your subscription.');
    document.getElementById('currency-note').textContent = custom ? 'Use one currency for every rate and other charge. Changing currency changes labels only, without exchange conversion.' : 'Presets use USD. Choose custom rates for a different region, deployment type or contract.';
    document.getElementById('selected-model-result').textContent = modelLabel(m);
    renderEvidence();
  }
  function renderEvidence() {
    const m = selected(), body = document.getElementById('meter-rows'); body.replaceChildren();
    document.getElementById('meter-model-label').textContent = m ? modelLabel(m) + ' · '+m.deployment+' · USD · East US 2 · verified '+m.verifiedDate : 'Custom rates have no verified source meters. Select a published preset to inspect its official records.';
    for (const c of categories) {
      const tr = el('tr'); tr.append(el('th',c.name)); tr.firstChild.scope = 'row';
      const meter = m?.meters[c.meter];
      if (!meter) { const td = el('td', m ? (c.meter==='cache'?'Separate rate not verified':'Separate category not applied') : 'User-entered'); td.colSpan=5; tr.append(td); }
      else {
        const name = el('td'); name.append(el('span',meter.meterName),el('small',meter.meterId,'meter-id')); tr.append(name);
        tr.append(el('td',new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:9}).format(meter.retailPrice)+' / '+meter.unitOfMeasure));
        tr.append(el('td',rate(m[c.rate],'USD')),el('td',meter.effectiveStartDate.slice(0,10)));
        const td=el('td'); td.append(link('Azure API ↗',meter.sourceUrl)); tr.append(td);
      }
      body.append(tr);
    }
  }
  function renderComparison() {
    const body=document.getElementById('model-rows'); body.replaceChildren();
    const visible=models.filter(m=>(providerFilter.value==='all'||m.provider===providerFilter.value)&&(includeLong.checked||m.contextTier!=='Long context'));
    for (const m of visible) {
      const result=current?.ok?api.estimateForModel(current.inputs,m):null;
      const tr=el('tr'); if (m.id===modelSelect.value) tr.className='selected-row';
      const name=el('th'); name.scope='row'; name.append(el('strong',m.name),el('small',m.provider+' · '+m.contextTier)); tr.append(name);
      tr.append(el('td',rate(m.inputRate,'USD')),el('td',rate(m.cacheRate,'USD')),el('td',m.cacheWriteRate===null?'—':rate(m.cacheWriteRate,'USD')),el('td',rate(m.outputRate,'USD')));
      const cost=el('td',result?.ok?money(result.modelCost,false,'USD'):'—','comparison-cost'); tr.append(cost);
      const action=el('td'),button=el('button',m.id===modelSelect.value?'Selected':'Use','choose-model'); button.type='button'; button.dataset.modelId=m.id; button.disabled=m.id===modelSelect.value; button.setAttribute('aria-label','Use '+modelLabel(m)); action.append(button); tr.append(action); body.append(tr);
    }
    document.getElementById('comparison-cache-note').textContent=current?.ok?'Comparison assumptions: '+number.format(current.inputs.cacheShare)+'% cache reads where a verified read rate exists; '+number.format(current.inputs.cacheWriteShare)+'% cache writes where a separate write rate exists. For other models, those portions remain ordinary input.':'Fix the highlighted calculator inputs to see monthly comparisons.';
  }
  function renderMath() {
    const ids=['calls','tokens','cache','model','budget','unit'];
    const body=document.getElementById('calculation-rows'); body.replaceChildren();
    if (!current.ok) { ids.forEach(id=>{document.getElementById('math-'+id).textContent='Complete the highlighted inputs to calculate.';}); return; }
    const d=current,p=d.inputs,n=number.format.bind(number),m=selected();
    const expressions={
      calls:n(p.users)+' × '+n(p.tasks)+' × '+n(p.days)+' = '+n(d.monthlyTasks)+' tasks\n'+n(d.monthlyTasks)+' × '+n(p.calls)+' = '+n(d.monthlyCalls)+' model calls',
      tokens:'Input: '+n(d.monthlyCalls)+' × '+n(p.inputTokens)+' = '+n(d.inputTotal)+' tokens\nOutput: '+n(d.monthlyCalls)+' × '+n(p.outputTokens)+' = '+n(d.outputTotal)+' tokens',
      cache:'Reads: '+n(d.inputTotal)+' × '+n(p.cacheShare)+'% = '+n(d.cachedTokens)+'\nWrites: '+n(d.inputTotal)+' × '+n(p.cacheWriteShare)+'% = '+n(d.cacheWriteTokens)+'\nOrdinary input: '+n(d.inputTotal)+' − '+n(d.cachedTokens)+' − '+n(d.cacheWriteTokens)+' = '+n(d.uncachedTokens),
      model:money(d.inputCost)+' + '+money(d.cacheCost)+' + '+money(d.cacheWriteCost)+' + '+money(d.outputCost)+'\n= '+money(d.modelCost)+' model cost / month',
      budget:'Base: '+money(d.modelCost)+' + '+money(d.otherCharges)+' = '+money(d.baseCost)+'\nReserve: '+money(d.baseCost)+' × '+n(p.allowance)+'% = '+money(d.allowanceCost)+'\nBudget: '+money(d.baseCost)+' + '+money(d.allowanceCost)+' = '+money(d.budget),
      unit:'Annual: '+money(d.budget)+' × 12 = '+money(d.annualBudget)+'\nPer task: '+money(d.modelCost)+' ÷ '+n(d.monthlyTasks)+' = '+money(d.perTask,true)+'\nPer user / month: '+money(d.modelCost)+' ÷ '+n(p.users)+' = '+money(d.perUser)+(p.users===0||d.monthlyTasks===0?'\nA zero denominator is shown as —.':'')
    };
    for(const id of ids)document.getElementById('math-'+id).textContent=expressions[id];
    for(const c of categories){
      const tr=el('tr'),name=el('th',c.name);name.scope='row';tr.append(name,el('td',n(d[c.tokens])));
      const applies=!m||m[c.rate]!==null;
      tr.append(el('td',applies?rate(p[c.rate]):'Not applied'));
      tr.append(el('td',applies?n(d[c.tokens])+' ÷ 1,000,000 × '+rate(p[c.rate]):'No tokens in this category'));
      tr.append(el('td',money(d[c.cost],d[c.cost]>0&&d[c.cost]<0.01)));body.append(tr);
    }
  }
  function update(){
    current=api.estimate(rawInputs());
    document.querySelectorAll('[data-currency]').forEach(e=>{e.textContent=currency.value;});
    for(const [key,input]of Object.entries(fields)){
      const error=current.ok?null:current.errors[key];input.setAttribute('aria-invalid',error?'true':'false');
      const note=document.getElementById(key+'-error');note.hidden=!error;note.textContent=error||'';
    }
    const validation=document.getElementById('validation-message');validation.hidden=current.ok;validation.textContent=current.ok?'':'Check the highlighted fields to calculate your estimate.';
    if(!current.ok&&Object.keys(current.errors).some(k=>['cacheShare','cacheWriteShare','otherCharges','allowance'].includes(k)))document.getElementById('advanced-settings').open=true;
    download.disabled=!current.ok;
    outputs.forEach(e=>{const key=e.dataset.output;if(!current.ok){e.textContent='—';return;}if(['totalTokens','inputTotal','outputTotal'].includes(key)){e.textContent=compact.format(current[key]);e.title=number.format(current[key])+' tokens';}else if(key==='monthlyCalls')e.textContent=number.format(current[key]);else e.textContent=money(current[key],key==='perTask');});
    document.getElementById('budget-caption').textContent=current.ok?'Includes a '+number.format(current.inputs.allowance)+'% planning reserve. This reserve is not an Azure fee.':'Complete the highlighted fields to see an estimate.';
    const parts=[['input','inputCost'],['cache','cacheCost'],['write','cacheWriteCost'],['output','outputCost'],['other','otherCharges'],['allowance','allowanceCost']];
    parts.forEach(([name,key])=>{document.getElementById('bar-'+name).style.width=current.ok&&current.budget>0?(100*current[key]/current.budget)+'%':'0%';});
    document.getElementById('cost-bar').setAttribute('aria-label',current.ok?'Monthly costs: ordinary input '+money(current.inputCost)+', cache reads '+money(current.cacheCost)+', cache writes '+money(current.cacheWriteCost)+', output '+money(current.outputCost)+', other charges '+money(current.otherCharges)+', reserve '+money(current.allowanceCost)+'.':'Complete the inputs to show cost allocation.');
    renderComparison();renderMath();
    window.FoundryModelState={result:current,model:selected(),currency:currency.value};
    window.dispatchEvent(new CustomEvent("foundry-model-update",{detail:window.FoundryModelState}));
    document.getElementById('download-message').textContent='';
    clearTimeout(announcementTimer);announcementTimer=setTimeout(()=>{document.getElementById('live-summary').textContent=current.ok?modelLabel(selected())+'. Monthly planning budget '+money(current.budget)+' '+currency.value+'. Model cost '+money(current.modelCost)+'.':'Estimate unavailable. Check the highlighted fields.';},400);
  }
  form.addEventListener('input',event=>{if(event.target!==modelSelect&&event.target!==currency)update();});
  form.addEventListener('change',event=>{if(event.target===modelSelect)configureModel();update();});
  form.addEventListener('submit',event=>event.preventDefault());
  document.getElementById('use-custom-rates').addEventListener('click',()=>{modelSelect.value='custom';configureModel();update();fields.inputRate.focus();});
  document.getElementById('reset-example').addEventListener('click',()=>{for(const[key,value]of Object.entries(api.defaults))fields[key].value=value;currency.value='USD';document.getElementById('estimateLabel').value='';modelSelect.value=catalog.defaultModel;configureModel();update();});
  providerFilter.addEventListener('change',renderComparison);includeLong.addEventListener('change',renderComparison);
  document.getElementById('model-rows').addEventListener('click',event=>{const button=event.target.closest('button[data-model-id]');if(!button)return;modelSelect.value=button.dataset.modelId;configureModel();update();modelSelect.focus();document.getElementById('calculator').scrollIntoView({behavior:'smooth',block:'start'});});
  function csvCell(value){let s=String(value??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
  download.addEventListener('click',()=>{
    update();if(!current.ok)return;const d=current,p=d.inputs,m=selected();
    const rows=[['Azure AI Foundry cost estimate','Value','Unit or note'],['Estimate label',document.getElementById('estimateLabel').value,'Optional label'],['Created',new Date().toISOString(),'UTC'],['Model',modelLabel(m),''],['Model version',m?.modelVersion||'Not specified',''],['Currency',currency.value,'No foreign exchange conversion'],['Price source',m?'Azure Retail Prices API snapshot':'Custom / user-entered','Forecast, not a subscription invoice'],['Verified date',m?.verifiedDate||'Not verified',''],['Reference meter region',m?.region||'User-supplied',''],['Deployment',m?.deployment||'User-supplied',''],['Pricing page',m?.sourceUrl||'',''],['Official API query',m?.apiUrl||'',''],[],['Usage assumptions','Value','Unit'],...Object.keys(api.rules).map(key=>{const unavailable=m&&['cacheRate','cacheWriteRate'].includes(key)&&m[key]===null;return[api.rules[key].label,unavailable?'Not listed / not applied':p[key],unavailable?'No separate meter applied; this input uses the ordinary rate':({inputRate:currency.value+' per 1 million tokens',outputRate:currency.value+' per 1 million tokens',cacheRate:currency.value+' per 1 million tokens',cacheWriteRate:currency.value+' per 1 million tokens',cacheShare:'%',cacheWriteShare:'%',allowance:'%',otherCharges:currency.value+' per month'})[key]||''];}),[],['Monthly calculation','Value','Formula or note'],['Business tasks',d.monthlyTasks,'users x tasks per day x active days'],['Model calls',d.monthlyCalls,'business tasks x calls per task'],['Total input tokens',d.inputTotal,'model calls x input tokens per call'],['Cache-read tokens',d.cachedTokens,'total input x read percentage'],['Cache-write tokens',d.cacheWriteTokens,'total input x write percentage'],['Ordinary input tokens',d.uncachedTokens,'total input minus reads minus writes'],['Output tokens',d.outputTotal,'includes billed reasoning; do not add reasoning again'],['Total tokens',d.totalTokens,'input plus output'],...categories.map(c=>[c.name+' cost',d[c.cost],m&&m[c.rate]===null?'Category not applied; no separate verified rate':d[c.tokens]+' / 1000000 x '+p[c.rate]]),['Model token cost',d.modelCost,currency.value],['Other monthly charges',d.otherCharges,currency.value],['Base monthly cost',d.baseCost,currency.value],['Planning reserve',d.allowanceCost,'base x allowance percentage; not an Azure fee'],['Monthly planning budget',d.budget,currency.value],['Annual planning budget',d.annualBudget,'12 x monthly; '+currency.value],['Model cost per task',d.perTask??'n.a.',currency.value],['Model cost per user per month',d.perUser??'n.a.',currency.value],[],['Source meter details','Meter ID','Published unit and rate'],...categories.filter(c=>m?.meters[c.meter]).map(c=>{const v=m.meters[c.meter];return[c.name,v.meterId,v.retailPrice+' USD / '+v.unitOfMeasure+'; effective '+v.effectiveStartDate.slice(0,10)];}),[],['Scope','Text token forecast','Separate request-length tiers must be calculated separately. PTU, batch, media and tools use other rate rules. Taxes and contractual discounts are not applied.']];
    const blob=new Blob(['\ufeff'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='azure-foundry-cost-estimate.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);document.getElementById('download-message').textContent='Downloaded assumptions, prices, source meters and the full calculation.';
  });
  initModels();modelSelect.value=catalog.defaultModel;configureModel();update();
})();
