(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const catalog = window.HybridServicePrices;
  const meters = new Map(catalog.components.map(m => [m.id,m]));
  const engine = window.HybridCostEngine;
  const fxCatalog = window.FoundryFX;
  let reportingCurrency = 'USD', fxRates = {...fxCatalog.ratesPerUSD}, hardwareCurrency = 'USD';
  const currencyOptions = fxCatalog.currencies.map(c=>[c.code,c.code+' · '+c.name]);
  const asUSD = (value,code='USD') => Number(value) / Number(fxRates[code]);
  const reportValue = value => value === null || value === undefined ? null : value * Number(fxRates[reportingCurrency]);
  const number = new Intl.NumberFormat('en-US',{maximumFractionDigits:6});
  const money = (v,precise=false) => {const value=reportValue(v);const digits=fxCatalog.currencies.find(c=>c.code===reportingCurrency)?.minorUnitDigits??2;return value===null||!Number.isFinite(value)?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:reportingCurrency,minimumFractionDigits:precise?4:digits,maximumFractionDigits:precise?6:digits}).format(value);};
  const rateText = v => v === null ? 'Unpriced' : new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:8}).format(v);
  const n = v => number.format(v);
  const sharedFields = ['users','tasks','days','calls','inputTokens','outputTokens'];
  const hardwareFields = ['count','purchasePerDevice','lifeMonths','wattsPerDevice','powerHoursMonth','pue','kwhRate','annualMaintenancePercent'];
  const hardwareDefaults = Object.fromEntries(hardwareFields.map(k=>[k,$('hardware-'+k).value]));
  const panels = [...document.querySelectorAll('.tab-panel')];
  const tabs = [...document.querySelectorAll('[role="tab"][data-tab]')];
  const cardUI = new Map();
  let nextId = 1, lines = [], latest = null, currentPlan = null, modelSync = false;

  function el(tag,text,className){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;}
  function external(text,url){const a=el('a',text);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
  function activeMode(){return document.querySelector('[name="solution-mode"]:checked').value;}
  function domainActive(domain){return domain==='shared'||(domain==='cloud'&&activeMode()!=='local')||(domain==='local'&&activeMode()!=='cloud');}
  function readNumber(value){return String(value).trim()===''?NaN:Number(value);}
  function updateCurrencyLabels(){
    document.querySelectorAll('[data-report-currency]').forEach(e=>{e.textContent=reportingCurrency;});
    const value=Number(fxRates[reportingCurrency]),valid=Number.isFinite(value)&&value>0,custom=valid&&value!==Number(fxCatalog.ratesPerUSD[reportingCurrency]);
    $('fx-status').textContent=reportingCurrency==='USD'?'USD base · no currency conversion':custom?'Custom planning exchange rate':'ECB reference snapshot · '+fxCatalog.asOfDate;
    $('fx-example').textContent=valid?(reportingCurrency==='USD'?'Source USD amounts are shown unchanged.':'1 USD = '+n(value)+' '+reportingCurrency+'. A $100 USD cost becomes '+money(100)+'.'):'Enter a positive exchange rate to calculate.';
    $('report-fx').readOnly=reportingCurrency==='USD';$('report-fx').setAttribute('aria-invalid',String(!valid));
    $('hardware-price-code').textContent=hardwareCurrency;$('hardware-energy-code').textContent=hardwareCurrency+'/kWh';
  }
  function showTab(id,focus=false){
    if(!tabs.some(t=>t.dataset.tab===id))id='solution';
    tabs.forEach(t=>{const selected=t.dataset.tab===id;t.setAttribute('aria-selected',String(selected));t.tabIndex=selected?0:-1;});
    panels.forEach(p=>p.hidden=p.id!=='panel-'+id);document.body.dataset.activeTab=id;
    if(focus)$('tab-'+id).focus();
  }
  function routeHash(){
    const hash=decodeURIComponent(location.hash.slice(1));
    if(tabs.some(t=>t.dataset.tab===hash)){showTab(hash);return;}
    const target=$(hash);if(target){const panel=target.closest('.tab-panel');if(panel)showTab(panel.id.replace('panel-',''));requestAnimationFrame(()=>target.scrollIntoView({block:'start'}));}
  }
  tabs.forEach((t,index)=>{
    t.addEventListener('click',()=>{showTab(t.dataset.tab);history.replaceState(null,'','#'+t.dataset.tab);});
    t.addEventListener('keydown',event=>{let i;if(event.key==='ArrowRight')i=(index+1)%tabs.length;else if(event.key==='ArrowLeft')i=(index-1+tabs.length)%tabs.length;else if(event.key==='Home')i=0;else if(event.key==='End')i=tabs.length-1;else return;event.preventDefault();showTab(tabs[i].dataset.tab,true);history.replaceState(null,'','#'+tabs[i].dataset.tab);});
  });
  window.addEventListener('hashchange',routeHash);
  document.addEventListener('click',event=>{const a=event.target.closest('a[href^="#"]');if(!a)return;const id=a.getAttribute('href').slice(1);if(tabs.some(t=>t.dataset.tab===id)){event.preventDefault();showTab(id);history.replaceState(null,'','#'+id);$('tab-'+id).scrollIntoView({behavior:'smooth',block:'start'});}else{const target=$(id),panel=target?.closest('.tab-panel');if(panel)showTab(panel.id.replace('panel-',''));}});

  const factor=(label,value,integer=false)=>({label,value:String(value),integer});
  const presets={
    'search-basic':{name:'AI Search · Basic',factors:[factor('Replicas',1,true),factor('Partitions',1,true),factor('Provisioned hours / month',730)]},
    'search-s1':{name:'AI Search · Standard S1',factors:[factor('Replicas',1,true),factor('Partitions',1,true),factor('Provisioned hours / month',730)]},
    'app-service-linux-b1':{name:'App Service plan · Linux B1',factors:[factor('Plan instances',1,true),factor('Provisioned hours / month',730)]},
    'app-service-linux-p1v3':{name:'App Service plan · Linux P1v3',factors:[factor('Plan instances',1,true),factor('Provisioned hours / month',730)]},
    'app-service-linux-p1v4':{name:'App Service plan · Linux P1v4',factors:[factor('Plan instances',1,true),factor('Provisioned hours / month',730)]},
    'aca-cpu-active':{name:'Container Apps · active CPU',factors:[factor('vCPUs / replica',0.5),factor('Aggregate active replica-hours',730)],multiplier:3600},
    'aca-memory-active':{name:'Container Apps · active memory',factors:[factor('GiB / replica',1),factor('Aggregate active replica-hours',730)],multiplier:3600},
    'aca-cpu-idle':{name:'Container Apps · idle CPU',factors:[factor('vCPUs / replica',0.5),factor('Qualifying idle replica-hours',0)],multiplier:3600},
    'aca-memory-idle':{name:'Container Apps · idle memory',factors:[factor('GiB / replica',1),factor('Qualifying idle replica-hours',0)],multiplier:3600},
    'aca-requests':{name:'Container Apps · external requests',quantity:22000},
    'apim-standard-v2':{name:'API Management · Standard v2 first unit',quantity:730},
    'apim-standard-v2-calls':{name:'API Management · Standard v2 calls',quantity:22000},
    'blob-hot-lrs':{name:'Blob documents · Hot LRS',quantity:100},
    'blob-writes':{name:'Blob write operations',quantity:10000},
    'blob-reads':{name:'Blob read operations',quantity:100000},
    'embedding-small-global':{name:'Embeddings · text-embedding-3-small',quantity:2000000},
    'document-read':{name:'Document Intelligence · Read',quantity:1000},
    'logs-ingestion':{name:'Monitor · Analytics Logs ingestion',quantity:10},
    'key-vault-ops':{name:'Key Vault · standard operations',quantity:10000},
    'acr-premium':{name:'Container Registry · Premium',factors:[factor('Registries',1,true),factor('Billable calendar days',30,true)]},
    'acr-basic':{name:'Container Registry · Basic',factors:[factor('Registries',1,true),factor('Billable calendar days',30,true)]},
    'vpn-gw1az':{name:'VPN Gateway · VpnGw1AZ',quantity:730},
    'private-endpoint':{name:'Private endpoints',factors:[factor('Endpoints',4,true),factor('Provisioned hours / month',730)]},
    'private-data-ingress':{name:'Private Link · ingress data',quantity:50},
    'private-data-egress':{name:'Private Link · egress data',quantity:50},
    'internet-egress-mgn':{name:'Internet egress · Microsoft routing',quantity:100}
  };
  function presetLine(meterId,enabled=true,role='service'){
    const m=meters.get(meterId),p=presets[meterId]||{};
    return {id:'line-'+nextId++,meterId,name:p.name||m.service+' · '+m.meterName,domain:'cloud',category:m.service,enabled,recurrence:'monthly',factors:structuredClone(p.factors||[factor(m.usageUnit+' / month',p.quantity??0)]),multiplier:p.multiplier||1,override:false,rate:String(m.rate),freeQuantity:'0',priceCurrency:'USD',billingScope:'primary gateway',role};
  }
  function manualLine(name,domain,recurrence,quantity,rate,unit='units',status='assumption'){
    return {id:'line-'+nextId++,name,domain,category:'Custom / operations',enabled:true,recurrence,factors:[factor(unit,quantity)],multiplier:1,rate:rate===null?'':String(rate),unitSize:'1',usageUnit:unit,freeQuantity:'0',priceCurrency:'USD',pricingStatus:status,override:true,role:'service'};
  }
  function defaultLines(){
    const ids=['search-basic','apim-standard-v2','apim-standard-v2-calls','blob-hot-lrs','blob-writes','blob-reads','embedding-small-global','document-read','logs-ingestion','key-vault-ops','vpn-gw1az','private-endpoint','private-data-ingress','private-data-egress','internet-egress-mgn'];
    lines=[presetLine('app-service-linux-b1',true,'host'),...ids.map(id=>presetLine(id))];
    lines.push(manualLine('Local operations and support','local','monthly',8,50,'hours / month'));
    lines.push(manualLine('Local backup and software','local','monthly',1,20,'monthly allocation'));
    lines.push(manualLine('Local connectivity and facilities','local','monthly',1,50,'monthly allocation'));
    lines.push(manualLine('Implementation and rollout','shared','oneTime',40,75,'implementation hours'));
    const licence=manualLine('Additional licences / security services','shared','monthly',1,null,'monthly allocation','unpriced');licence.enabled=false;lines.push(licence);
  }
  function makeField(label,id,value,type='number'){
    const wrap=el('div',undefined,'field'),l=el('label',label);l.htmlFor=id;const input=el('input');input.id=id;input.type=type;input.value=value;input.className='plain-input';if(type==='number'){input.min='0';input.step='any';input.inputMode='decimal';}else input.maxLength=120;wrap.append(l,input);return{wrap,input};
  }
  function selectField(label,id,value,options){const wrap=el('div',undefined,'field'),l=el('label',label);l.htmlFor=id;const input=el('select');input.id=id;input.className='plain-input';options.forEach(([v,t])=>{const option=el('option',t);option.value=v;input.append(option);});input.value=value;wrap.append(l,input);return{wrap,input};}
  function renderLines(){
    cardUI.clear();$('azure-service-lines').replaceChildren();$('custom-service-lines').replaceChildren();
    lines.forEach(line=>{
      const m=meters.get(line.meterId),card=el('details',undefined,'service-line');card.id=line.id;card.dataset.domain=line.domain;
      const summary=el('summary'),left=el('span',undefined,'service-heading'),enabled=el('input');enabled.type='checkbox';enabled.checked=line.enabled;enabled.setAttribute('aria-label','Include '+line.name);enabled.addEventListener('click',e=>e.stopPropagation());
      const name=el('span',line.name),small=el('small',m?m.sku+' · '+m.referenceRegion:'User supplied · '+line.domain+' · '+(line.recurrence==='monthly'?'monthly':'one-time'));const label=el('span');label.append(name,small);left.append(enabled,label);
      const cost=el('strong','—','service-summary-cost');summary.append(left,cost,el('span','+','service-expand'));card.append(summary);
      const body=el('div',undefined,'service-body'),fields=el('div',undefined,'service-fields'),factorInputs=[];
      if(!m){const f=makeField('Cost line name',line.id+'-name',line.name,'text');fields.append(f.wrap);f.input.addEventListener('input',()=>{line.name=f.input.value;name.textContent=line.name;enabled.setAttribute('aria-label','Include '+line.name);update();});
        const d=selectField('Environment',line.id+'-domain',line.domain,[['cloud','Azure / cloud'],['local','Local'],['shared','Shared']]);fields.append(d.wrap);d.input.addEventListener('change',()=>{line.domain=d.input.value;card.dataset.domain=line.domain;small.textContent='User supplied · '+line.domain+' · '+(line.recurrence==='monthly'?'monthly':'one-time');update();});}
      line.factors.forEach((f,index)=>{const field=makeField(f.label,line.id+'-factor-'+index,f.value);if(f.integer)field.input.step='1';factorInputs.push(field.input);fields.append(field.wrap);field.input.addEventListener('input',()=>{f.value=field.input.value;update();});});
      const cadence=selectField('Cost frequency',line.id+'-cadence',line.recurrence,[['monthly','Monthly recurring'],['oneTime','One-time upfront']]);fields.append(cadence.wrap);cadence.input.addEventListener('change',()=>{line.recurrence=cadence.input.value;update();});
      const rate=makeField((line.priceCurrency||'USD')+' per '+(m?m.billingUnit:(line.unitSize||1)+' '+line.usageUnit),line.id+'-rate',line.rate);rate.input.readOnly=Boolean(m&&!line.override);fields.append(rate.wrap);rate.input.addEventListener('input',()=>{line.rate=rate.input.value;if(!m)line.pricingStatus=readNumber(line.rate)>=0?'custom':'unpriced';update();});
      const priceCurrency=selectField('Currency of entered price',line.id+'-currency',line.priceCurrency||'USD',currencyOptions);priceCurrency.input.disabled=Boolean(m&&!line.override);fields.append(priceCurrency.wrap);priceCurrency.input.addEventListener('change',()=>{const prior=line.priceCurrency||'USD',next=priceCurrency.input.value;if(![prior,next].every(code=>Number.isFinite(Number(fxRates[code]))&&Number(fxRates[code])>0)){priceCurrency.input.value=prior;$('solution-download-status').textContent='Fix or restore the exchange rate before changing the price currency. Existing prices were kept.';update();return;}if(line.rate!==''&&Number.isFinite(readNumber(line.rate)))line.rate=String(asUSD(line.rate,prior)*Number(fxRates[next]));line.priceCurrency=next;rate.input.value=line.rate;update();});
      if(!m){const size=makeField('Units included in this price',line.id+'-unit',line.unitSize||1);size.input.min='0.000001';fields.append(size.wrap);size.input.addEventListener('input',()=>{line.unitSize=size.input.value;update();});}
      if(m?.id.startsWith('apim-')&&m.id.endsWith('-calls')){const scope=makeField('APIM instance / billing scope',line.id+'-scope',line.billingScope||'primary gateway','text');fields.append(scope.wrap);scope.input.addEventListener('input',()=>{line.billingScope=scope.input.value;update();});}
      let freeInput=null;
      if(m?.freeAllowance){const free=makeField('Remaining free allocation · '+m.freeAllowance.unit,line.id+'-free',line.freeQuantity);free.input.max=String(m.freeAllowance.quantity);freeInput=free.input;fields.append(free.wrap);free.input.addEventListener('input',()=>{line.freeQuantity=free.input.value;update();});}
      body.append(fields);
      const formula=el('p','','service-formula'),status=el('span','','price-badge'),meta=el('div',undefined,'service-meta');meta.append(status);
      if(m){const overrideLabel=el('label',undefined,'checkbox-label'),override=el('input');override.type='checkbox';override.checked=line.override;overrideLabel.append(override,el('span','Use my flat rate'));meta.append(overrideLabel);override.addEventListener('change',()=>{line.override=override.checked;rate.input.readOnly=!line.override;priceCurrency.input.disabled=!line.override;if(!line.override){line.rate=String(m.rate);rate.input.value=line.rate;line.priceCurrency='USD';priceCurrency.input.value='USD';}update();});meta.append(external('Azure API ↗',m.sourceApiUrl));}
      body.append(meta,formula);
      if(m){
        body.append(el('p',(m.assumptions||[]).join(' '),'subtle-note'));
        if(m.freeAllowance)body.append(el('p','Grant scope: '+m.freeAllowance.scope+'. Enter only the unused share allocated here.','subtle-note'));
        const evidence=el('div',undefined,'service-evidence');evidence.append(external('Pricing page ↗',m.pricingPage));const record=m.rawMeterRecords[0];evidence.append(el('span','Snapshot '+catalog.verifiedDate+' · meter effective '+record.effectiveStartDate.slice(0,10)+' · '+record.meterId));body.append(evidence);
      } else body.append(el('p','Manual price assumption. Select the currency of your quote, then enter your supplier price, licence charge or internal cost allocation.','subtle-note'));
      const remove=el('button','Remove line','text-button remove-line');remove.type='button';remove.addEventListener('click',()=>{lines=lines.filter(x=>x!==line);renderLines();update();});body.append(remove);card.append(body);
      (m?$('azure-service-lines'):$('custom-service-lines')).append(card);
      cardUI.set(line.id,{card,enabled,rate:rate.input,rateLabel:rate.wrap.querySelector('label'),cost,formula,status,factorInputs,freeInput,body});
      enabled.addEventListener('change',()=>{line.enabled=enabled.checked;update();});
    });
  }
  function lineQuantity(line){return line.factors.reduce((q,f)=>q*readNumber(f.value),line.multiplier||1);}
  function normalizedTiers(line,m){
    if(!m||line.override)return undefined;
    if(m.id==='logs-ingestion')return [{minimumUsageQuantity:0,rate:m.rate}];
    if(m.id==='internet-egress-mgn')return m.tiers.filter(t=>t.ratePerBillingUnit>0).map(t=>({minimumUsageQuantity:t.minimumUsageQuantity-100,rate:t.ratePerBillingUnit}));
    return m.tiers;
  }
  function modelBase(){const raw=Object.fromEntries(Object.keys(window.FoundryCalculator.rules).map(k=>[k,$(k).value]));raw.otherCharges=0;raw.allowance=0;const result=window.FoundryCalculator.estimate(raw);if(result.ok){['inputCost','cacheCost','cacheWriteCost','outputCost','modelCost'].forEach(k=>{result[k]=asUSD(result[k],$('currency').value);});}return result;}
  function rawHardware(){return {enabled:$('hardware-enabled').checked,purchaseNow:$('hardware-purchaseNow').checked,priceCurrency:hardwareCurrency,...Object.fromEntries(hardwareFields.map(k=>[k,$('hardware-'+k).value]))};}
  function buildPlan(){
    const hardware=rawHardware();['purchasePerDevice','kwhRate'].forEach(k=>{hardware[k]=String(hardware[k]).trim()===''?'':asUSD(hardware[k],hardwareCurrency);});
    return {mode:activeMode(),cloudShare:$('solution-cloud-share').value,reservePercent:$('solution-reserve').value,horizonMonths:$('solution-horizon').value,modelCurrency:'USD',modelSourceCurrency:$('currency').value,baseModel:modelBase(),hardware,
      serviceLines:lines.map(line=>{const m=meters.get(line.meterId),sourceCurrency=m&&!line.override?'USD':(line.priceCurrency||'USD');return{id:line.id,name:line.name,domain:line.domain,category:line.category,enabled:line.enabled,recurrence:line.recurrence,quantity:lineQuantity(line),unitSize:m?m.quantityDivisor:line.unitSize,rate:line.rate===''?null:asUSD(line.rate,sourceCurrency),sourceRate:line.rate,sourceCurrency,billingScope:line.billingScope,freeQuantity:m?.freeAllowance?line.freeQuantity:0,pricingStatus:m?(line.override?'custom':'verified'):(line.pricingStatus||'custom'),sourceUrl:m?.sourceApiUrl||'',usageUnit:m?.usageUnit||line.usageUnit,tiers:normalizedTiers(line,m)};})};
  }
  function grantGroup(id){if(id?.startsWith('aca-cpu'))return'ACA CPU';if(id?.startsWith('aca-memory'))return'ACA memory';if(id==='aca-requests')return'ACA requests';if(id==='logs-ingestion')return'Analytics Logs';if(id==='internet-egress-mgn')return'Internet egress';return id;}
  function validateExtra(plan){
    const errors={},grants=new Map(),apimScopes=new Set(),usedCurrencies=new Set([reportingCurrency]);if(plan.mode!=='cloud'&&plan.hardware.enabled)usedCurrencies.add(hardwareCurrency);if(plan.mode!=='local')usedCurrencies.add($('currency').value);
    for(const line of lines){if(!line.enabled||!domainActive(line.domain))continue;line.factors.forEach(f=>{const v=readNumber(f.value);if(!Number.isFinite(v)||v<0||(f.integer&&!Number.isSafeInteger(v)))errors[line.id]='Check '+line.name+': '+f.label+' must be a non-negative '+(f.integer?'whole number.':'number.');});
      const m=meters.get(line.meterId);usedCurrencies.add(m&&!line.override?'USD':line.priceCurrency||'USD');if(m?.freeAllowance){const g=grantGroup(m.id),sum=(grants.get(g)?.sum||0)+readNumber(line.freeQuantity);grants.set(g,{sum,max:m.freeAllowance.quantity});}if(m?.id.startsWith('apim-')&&m.id.endsWith('-calls')&&!line.override){const scope=(line.billingScope||'').trim().toLowerCase();if(!scope)errors[line.id]='Enter the API Management instance or billing scope.';else if(apimScopes.has(scope))errors[line.id]='Combine APIM calls for '+scope+' in one row so its included quota is applied once. Use a different scope only for a different gateway instance.';apimScopes.add(scope);}}
    for(const[g,a]of grants)if(a.sum>a.max)errors['grant-'+g]=g+': the combined free allocation cannot exceed '+n(a.max)+' across active lines.';
    for(const code of usedCurrencies)if(!Number.isFinite(Number(fxRates[code]))||Number(fxRates[code])<=0)errors['fx-'+code]='Enter a positive exchange rate for '+code+' or restore its ECB reference rate.';
    return errors;
  }
  function mirrorModel(){
    if(modelSync)return;sharedFields.forEach(k=>{$('solution-'+k).value=$(k).value;});$('solution-model').value=$('model').value;
    const state=window.FoundryModelState,m=state?.model;
    $('solution-model-rates').textContent=m?m.name+' · ordinary input '+rateText(m.inputRate)+' USD / 1M · output '+rateText(m.outputRate)+' USD / 1M · Global PAYG.':'Custom model prices use the currency entered in the Model costs tab; the engine converts them to USD before reporting.';
  }
  function update(){
    updateCurrencyLabels();
    currentPlan=buildPlan();latest=engine.estimate(currentPlan);const extra=validateExtra(currentPlan);if(Object.keys(extra).length){latest.ok=false;latest.complete=false;latest.errors={...latest.errors,...extra};}
    const r=latest,mode=currentPlan.mode,activeCloud=mode!=='local',activeLocal=mode!=='cloud',good=r.ok&&r.complete;
    $('solution-cloud-share').disabled=mode!=='hybrid';
    $('cloud-inactive').hidden=activeCloud;$('local-inactive').hidden=activeLocal;$('local-hardware').classList.toggle('inactive-environment',!activeLocal);
    $('architecture-cloud').classList.toggle('inactive-lane',!activeCloud);$('architecture-local').classList.toggle('inactive-lane',!activeLocal);$('architecture-mode').textContent=mode==='hybrid'?'Hybrid scenario':mode==='cloud'?'Cloud-only scenario':'Local-only scenario';
    $('cloud-route-count').textContent=r.ok?n(r.cloudCalls):'—';$('local-route-count').textContent=r.ok?n(r.localCalls):'—';
    const amounts={'solution-budget':good?r.monthlyPlanningBudget:null,'solution-run-rate':good?r.monthlyCashRunRate:null,'solution-cloud':r.ok?r.cloudSubtotal:null,'solution-local':r.ok?r.localSubtotal:null,'solution-shared':r.ok?r.sharedSubtotal:null,'solution-cash':good?r.monthlyCashRunRate:null,'solution-reserve-cost':good?r.monthlyReserve:null,'solution-allocated':good?r.fullyAllocatedMonthly:null,'solution-upfront':r.ok?r.totalUpfront:null,'solution-year1':good?r.year1CashBudget:null,'solution-horizon-cost':good?r.horizonCashBudget:null};
    Object.entries(amounts).forEach(([id,value])=>{$(id).textContent=money(value);});$('solution-per-task').textContent=money(good?r.perTask:null,true);$('horizon-label').textContent=currentPlan.horizonMonths+'-month cash budget';
    $('solution-status').textContent=!r.ok?'Check inputs':!r.complete?'Incomplete · one or more rates missing':'Published rates + your sizing assumptions';
    $('solution-budget-caption').textContent=good?'Includes '+n(Number(currentPlan.reservePercent))+'% planning reserve. Hardware purchases appear in upfront cash.':r.ok?'Known monthly subtotal: '+money(r.knownMonthlySubtotal)+'. Add the missing prices to complete the budget.':'Fix the highlighted or listed inputs to calculate.';
    const error=$('solution-error');error.hidden=good;error.textContent=!r.ok?Object.values(r.errors).join(' '):!r.complete?'Missing price: '+r.missingRates.map(x=>x.name).join(', ')+'. These components have not been treated as free.':'';
    const pc=r.pricingCoverage;$('solution-coverage').textContent=r.ok?pc.verified+' published service rates · '+(pc.custom+pc.assumption)+' custom or assumed service rates · '+pc.unpriced+' unpriced service lines. Model prices are tracked separately; hardware and sizing are user assumptions.':'';
    const parts=[r.cloudSubtotal,r.localSubtotal,r.sharedSubtotal];[...$('solution-cost-bar').children].forEach((e,i)=>{e.style.width=good&&r.monthlyCashRunRate>0?(parts[i]/r.monthlyCashRunRate*100)+'%':'0%';});$('solution-cost-bar').setAttribute('aria-label',good?'Monthly operating cash: Azure '+money(r.cloudSubtotal)+', local '+money(r.localSubtotal)+', shared '+money(r.sharedSubtotal)+'.':'Cost composition unavailable until all inputs and prices are complete.');
    $('hardware-cost-summary').textContent=r.ok?'Asset value '+money(r.hardwareAssetValue)+' · new purchase '+money(r.hardwareUpfront)+' · power '+money(r.hardwarePowerMonthly)+'/month · maintenance '+money(r.hardwareMaintenanceMonthly)+'/month · amortization '+money(r.hardwareAmortizedMonthly)+'/month':'Complete the hardware and workload inputs to see the allocation.';
    for(const line of lines){const ui=cardUI.get(line.id);if(!ui)continue;const calc=r.lines.find(x=>x.id===line.id),active=line.enabled&&domainActive(line.domain),m=meters.get(line.meterId);ui.card.classList.toggle('excluded-line',!active);ui.cost.textContent=!active?'Excluded':calc?money(calc.cost):'—';ui.card.dataset.recurrence=line.recurrence;ui.status.textContent=!active?'Not included':line.rate===''?'Unpriced':m&&!line.override?'Azure published rate':line.pricingStatus==='assumption'?'Example assumption':'Custom rate';ui.status.className='price-badge '+(m&&!line.override?'published':'assumed');ui.formula.textContent=calc?calculationText(calc):'Quantity and unit price are required for an enabled component.';ui.rateLabel.textContent=(m&&!line.override?'USD':line.priceCurrency||'USD')+' per '+(m?m.billingUnit:(line.unitSize||1)+' '+line.usageUnit);ui.factorInputs.forEach((input,i)=>{const v=readNumber(line.factors[i].value);input.setAttribute('aria-invalid',String(active&&(!Number.isFinite(v)||v<0||(line.factors[i].integer&&!Number.isSafeInteger(v)))));});ui.rate.setAttribute('aria-invalid',String(active&&line.rate!==''&&(!Number.isFinite(readNumber(line.rate))||readNumber(line.rate)<0)));}
    $('download-solution-csv').disabled=!r.ok;
    renderSolutionMath();renderLedger();
    window.FoundrySolutionState={plan:currentPlan,result:r};
  }
  function calculationText(line){
    if(line.cost===null)return n(line.billableQuantity)+' '+line.usageUnit+' require a price.';
    const prefix=(line.sourceCurrency&&line.sourceCurrency!=='USD'?'Entered '+line.sourceRate+' '+line.sourceCurrency+' ÷ '+n(Number(fxRates[line.sourceCurrency]))+' = '+rateText(line.rate)+' USD per billing unit. ':'')+(line.freeQuantity>0?'max(0, '+n(line.quantity)+' − '+n(line.freeQuantity)+') = '+n(line.billableQuantity)+' after allocated free usage. ':'');
    const conversion=reportingCurrency==='USD'?'':' USD, then × '+n(Number(fxRates[reportingCurrency]))+' '+reportingCurrency+'/USD';
    if(line.tierSegments?.length>1)return prefix+'('+line.tierSegments.map(t=>n(t.quantity)+' ÷ '+n(line.unitSize)+' × '+rateText(t.rate)).join(' + ')+')'+conversion+' = '+money(line.cost,true)+' '+(line.recurrence==='monthly'?'/ month':'one-time');
    const rate=line.tierSegments?.length?line.tierSegments[0].rate:line.rate;
    return prefix+n(line.billableQuantity)+' '+line.usageUnit+' ÷ '+n(line.unitSize)+' × '+rateText(rate)+conversion+' = '+money(line.cost,true)+' '+(line.recurrence==='monthly'?'/ month':'one-time');
  }
  function renderSolutionMath(){
    const r=latest,p=currentPlan,b=p.baseModel,ids=['routing','model','services','local','capital','budget'];
    if(!r.ok){ids.forEach(id=>$('solution-math-'+id).textContent='Complete the solution inputs to calculate.');return;}
    const percent=r.effectiveCloudShare/100;
    const expr={
      routing:n(b.inputs.users)+' × '+n(b.inputs.tasks)+' × '+n(b.inputs.days)+' = '+n(b.monthlyTasks)+' tasks\n'+n(b.monthlyTasks)+' × '+n(b.inputs.calls)+' = '+n(b.monthlyCalls)+' calls\nCloud: '+n(b.monthlyCalls)+' × '+n(r.effectiveCloudShare)+'% = '+n(r.cloudCalls)+' · local: '+n(r.localCalls),
      model:'Cloud input: '+n(r.cloudInputTokens)+' · cloud output: '+n(r.cloudOutputTokens)+' tokens\nOrdinary '+money(b.inputCost*percent,true)+' + cache reads '+money(b.cacheCost*percent,true)+' + writes '+money(b.cacheWriteCost*percent,true)+' + output '+money(b.outputCost*percent,true)+'\n= '+money(r.cloudModelCost)+' cloud model cost',
      services:r.lines.length+' included service lines; '+r.lines.filter(l=>l.recurrence==='monthly').length+' recurring, '+r.lines.filter(l=>l.recurrence==='oneTime').length+' one-time.\nAzure total including tokens: '+money(r.cloudSubtotal)+'\nSee each quantity, unit and progressive band in the audit trail below.',
      local:'Power in USD: '+(p.hardware.enabled&&p.mode!=='cloud'?p.hardware.count+' × '+p.hardware.wattsPerDevice+' ÷ 1,000 × '+p.hardware.powerHoursMonth+' × '+p.hardware.pue+' × '+n(Number(p.hardware.kwhRate)):'excluded')+'\nReported power cost: '+money(r.hardwarePowerMonthly)+'\nMaintenance: '+money(r.hardwareAssetValue)+' × '+n(Number(p.hardware.annualMaintenancePercent))+'% ÷ 12 = '+money(r.hardwareMaintenanceMonthly)+'\nLocal running total: '+money(r.localSubtotal),
      capital:'Upfront: '+money(r.hardwareUpfront)+' hardware + '+money(r.serviceUpfront)+' one-time services = '+money(r.totalUpfront)+'\nAmortization: '+money(r.hardwareAssetValue)+' ÷ '+p.hardware.lifeMonths+' months = '+money(r.hardwareAmortizedMonthly)+'/month\nAllocated monthly cost: '+money(r.fullyAllocatedMonthly),
      budget:r.complete?'Operating cash: '+money(r.monthlyCashRunRate)+'\nReserve: '+money(r.monthlyCashRunRate)+' × '+p.reservePercent+'% = '+money(r.monthlyReserve)+'\nYear 1: '+money(r.totalUpfront)+' + 12 × '+money(r.monthlyPlanningBudget)+' = '+money(r.year1CashBudget):'Known monthly subtotal: '+money(r.knownMonthlySubtotal)+'\nFinal budget withheld until all enabled usage has a price.'
    };ids.forEach(id=>$('solution-math-'+id).textContent=expr[id]);
  }
  function renderLedger(){
    const body=$('solution-ledger-rows');body.replaceChildren();const r=latest;if(!r.ok)return;
    function row(name,formula,status,cost,note='',source=''){
      const tr=el('tr'),th=el('th',name);th.scope='row';if(note)th.append(el('small',note));const formulaCell=el('td',formula),statusCell=el('td',status);if(source){statusCell.append(el('br'),external('Source meter ↗',source));}tr.append(th,formulaCell,statusCell,el('td',money(cost,true)));body.append(tr);return tr;
    }
    const model=window.FoundryModelState?.model;
    row(model?.name||'Custom cloud model',money(currentPlan.baseModel.modelCost,true)+' full-workload tokens × '+n(r.effectiveCloudShare)+'% routed to Azure',model?'Published model rates':'Custom model rates',r.cloudModelCost,'cloud · monthly',model?.sourceUrl);
    for(const line of r.lines){const tr=row(line.name,calculationText(line),line.pricingStatus,line.cost,line.domain+' · '+(line.recurrence==='monthly'?'monthly':'one-time'),line.sourceUrl);if(line.tierSegments?.length>1){const details=el('details',undefined,'tier-audit');details.append(el('summary','Inspect '+line.tierSegments.length+' pricing bands'));for(const t of line.tierSegments)details.append(el('p',n(t.quantity)+' units ÷ '+n(line.unitSize)+' × '+rateText(t.rate)+' USD'+(reportingCurrency==='USD'?'':' × '+n(Number(fxRates[reportingCurrency]))+' '+reportingCurrency+'/USD')+' = '+money(t.cost,true)));tr.children[1].append(details);}}
    if(currentPlan.hardware.enabled&&currentPlan.mode!=='cloud'){
      row('Local power','devices × watts ÷ 1,000 × powered hours × PUE × electricity price','User assumption',r.hardwarePowerMonthly,'local · monthly');
      row('Local maintenance','asset value × annual maintenance % ÷ 12','User assumption',r.hardwareMaintenanceMonthly,'local · monthly');
      row('Hardware purchase',currentPlan.hardware.purchaseNow?'device count × asset value per device':'Existing equipment: no new purchase','User assumption',r.hardwareUpfront,'local · upfront');
      row('Hardware amortization','allocated asset value ÷ useful life in months','Planning allocation',r.hardwareAmortizedMonthly,'monthly allocation · excluded from cash');
    }
    row('Monthly operating cash','Cloud + local + shared recurring costs','Before reserve',r.monthlyCashRunRate);
    row('Monthly planning reserve','monthly operating cash × '+currentPlan.reservePercent+'%','User planning allowance',r.monthlyReserve);
    row('Monthly planning budget','monthly operating cash + reserve','Estimate',r.monthlyPlanningBudget);
    row('Year 1 cash budget','upfront cash + 12 × monthly planning budget','No double-counted amortization',r.year1CashBudget);
  }
  function setHost(value){lines=lines.filter(l=>l.role!=='host');if(value==='container-apps')lines.unshift(...['aca-cpu-active','aca-memory-active','aca-requests'].map(id=>presetLine(id,true,'host')));else if(value!=='none')lines.unshift(presetLine(value,true,'host'));renderLines();update();}
  function downloadFile(name,type,content){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function csvCell(value){let s=String(value??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
  function snapshot(){return{schema:'foundry-solution-scenario-v1',priceSnapshotDate:catalog.verifiedDate,createdAt:new Date().toISOString(),label:$('solution-label').value,mode:activeMode(),cloudShare:$('solution-cloud-share').value,reservePercent:$('solution-reserve').value,horizonMonths:$('solution-horizon').value,hosting:$('hosting-choice').value,reportingCurrency,fxRates:Object.fromEntries(fxCatalog.currencies.map(c=>[c.code,Number.isFinite(Number(fxRates[c.code]))&&Number(fxRates[c.code])>0?Number(fxRates[c.code]):c.unitsPerUSD])),restoredUnusedFX:fxCatalog.currencies.filter(c=>!Number.isFinite(Number(fxRates[c.code]))||Number(fxRates[c.code])<=0).map(c=>c.code),fxSnapshotDate:fxCatalog.asOfDate,model:$('model').value,modelCurrency:$('currency').value,modelInputs:Object.fromEntries(Object.keys(window.FoundryCalculator.rules).map(k=>[k,$(k).value])),hardware:rawHardware(),lines:structuredClone(lines)};}
  function exportCSV(){update();if(!latest.ok)return;const p=currentPlan,r=latest,s=snapshot();
    const rows=[['Foundry whole-solution cost estimate','Value','Basis / note'],['Scenario',s.label,''],['Created',new Date().toISOString(),'UTC'],['Calculation base','USD','All price inputs normalize to USD'],['Reporting currency',reportingCurrency,'Solution totals are converted for reporting'],['FX units per USD',fxRates[reportingCurrency],'Reference date '+fxCatalog.asOfDate+'; edited rates are user assumptions'],['Status',r.complete?'Complete for selected components':'Incomplete: missing prices','Completeness is not an architecture coverage guarantee'],['Price snapshot',catalog.verifiedDate,'Azure Retail Prices API'],['Mode',p.mode,''],['Cloud share',r.effectiveCloudShare,'%'],['Model',window.FoundryModelState?.model?.name||'Custom',''],['Model source currency',s.modelCurrency,'Raw model input prices use this currency; normalized to USD for solution totals'],['Monthly tasks',p.baseModel.monthlyTasks,''],['Cloud model calls',r.cloudCalls,''],['Local model calls',r.localCalls,''],['Cloud input tokens',r.cloudInputTokens,''],['Cloud output tokens',r.cloudOutputTokens,''],...Object.entries(s.modelInputs).map(([k,v])=>['Model assumption: '+k,v,k==='otherCharges'||k==='allowance'?'Not carried into whole-solution engine':'']),...Object.entries(s.hardware).map(([k,v])=>['Hardware input: '+k,v,'User assumption; price currency '+s.hardware.priceCurrency]),...Object.entries(fxRates).map(([k,v])=>['Exchange rate: '+k,v,'currency units per USD']),[],['Component','Environment','Frequency','Usage','Allocated free usage','Billing unit size','Rate USD / billing unit','Price basis','Cost USD','Calculation','Official source','Billing scope','Entered price','Entered price currency'],['Model token cost','cloud','monthly',r.cloudCalls,0,'Model categories','See Model costs tab',window.FoundryModelState?.model?'verified':'custom',r.cloudModelCost,'Model token subtotal × cloud share',window.FoundryModelState?.model?.sourceUrl||''],...r.lines.map(l=>[l.name,l.domain,l.recurrence,l.quantity,l.freeQuantity,l.unitSize,l.rate,l.pricingStatus,l.cost===null?'UNPRICED':l.cost,calculationText(l),l.sourceUrl,l.billingScope||'',l.sourceRate,l.sourceCurrency]),[],['Calculated total','USD',reportingCurrency,'Basis'],...['cloudSubtotal','localSubtotal','sharedSubtotal','hardwarePowerMonthly','hardwareMaintenanceMonthly','knownMonthlySubtotal','monthlyCashRunRate','hardwareAssetValue','hardwareUpfront','serviceUpfront','totalUpfront','hardwareAmortizedMonthly','fullyAllocatedMonthly','monthlyReserve','monthlyPlanningBudget','year1CashBudget','horizonCashBudget','perTask'].map(k=>[k,r[k]===null?'UNAVAILABLE':r[k],r[k]===null?'UNAVAILABLE':reportValue(r[k]),k==='hardwareAmortizedMonthly'?'Excluded from cash':k==='fullyAllocatedMonthly'?'Operating cash plus amortization; before reserve':'']),['Reserve percentage',p.reservePercent,'Applied to monthly operating cash'],['Horizon months',p.horizonMonths,'Initial hardware only; no automatic refresh'],[],['Tier calculation','Band quantity','Billing unit size','USD per billing unit','Cost USD'],...r.lines.flatMap(l=>(l.tierSegments||[]).map(t=>[l.name+' — band from '+t.minimumUsageQuantity,t.quantity,l.unitSize,t.rate,t.cost])),[],['Excluded components','Reason'],...lines.filter(l=>!l.enabled||!domainActive(l.domain)).map(l=>[l.name,!l.enabled?'Disabled by user':'Inactive environment']),[],['Limitations','Forecast based on selected components and user sizing. Not an Azure invoice. Taxes, negotiated discounts and unlisted services are excluded. Reporting FX uses the displayed snapshot or your override; Azure invoice FX may differ.']];
    downloadFile('foundry-solution-cost-breakdown.csv','text/csv;charset=utf-8;','\ufeff'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n'));$('solution-download-status').textContent='Downloaded inputs, active and excluded components, price sources, tier calculations and totals.';
  }
  function sanitizeScenario(value){
    if(!value||value.schema!=='foundry-solution-scenario-v1'||!['cloud','local','hybrid'].includes(value.mode)||!Array.isArray(value.lines)||value.lines.length>200)throw new Error('Choose a scenario JSON file saved by this calculator.');
    if(!value.hardware||!value.modelInputs||!fxCatalog.currencies.some(c=>c.code===value.modelCurrency)||![...$('model').options].some(o=>o.value===value.model))throw new Error('The scenario has an unsupported model or missing assumptions.');
    const codes=fxCatalog.currencies.map(c=>c.code),report=value.reportingCurrency||'USD';if(!codes.includes(report)||!codes.includes(value.hardware.priceCurrency||'USD'))throw new Error('The scenario has an unsupported currency.');
    const importedFX={...fxCatalog.ratesPerUSD};if(value.fxRates){for(const code of codes){const amount=Number(value.fxRates[code]);if(!Number.isFinite(amount)||amount<=0||(code==='USD'&&amount!==1))throw new Error('The scenario has an invalid exchange rate.');importedFX[code]=amount;}}
    const safeLines=value.lines.map(raw=>{if(!raw||!['cloud','local','shared'].includes(raw.domain)||!['monthly','oneTime'].includes(raw.recurrence)||!Array.isArray(raw.factors)||raw.factors.length<1||raw.factors.length>6||typeof raw.enabled!=='boolean'||(raw.meterId&&!meters.has(raw.meterId)))throw new Error('The scenario contains an unsupported cost line.');
      if(!codes.includes(raw.priceCurrency||'USD'))throw new Error('A cost line uses an unsupported currency.');
      return{id:'line-'+nextId++,meterId:raw.meterId||undefined,name:String(raw.name||'Cost line').slice(0,120),domain:raw.domain,category:String(raw.category||'Custom').slice(0,100),enabled:raw.enabled,recurrence:raw.recurrence,factors:raw.factors.map(f=>({label:String(f.label||'Quantity').slice(0,100),value:String(f.value??''),integer:f.integer===true})),multiplier:raw.multiplier===undefined?1:Number(raw.multiplier),override:raw.override===true,rate:raw.meterId&&!raw.override?String(meters.get(raw.meterId).rate):String(raw.rate??''),freeQuantity:String(raw.freeQuantity??0),unitSize:String(raw.unitSize??1),usageUnit:String(raw.usageUnit||'units').slice(0,100),priceCurrency:raw.meterId&&!raw.override?'USD':raw.priceCurrency||'USD',billingScope:String(raw.billingScope||'primary gateway').slice(0,120),pricingStatus:['custom','assumption','unpriced'].includes(raw.pricingStatus)?raw.pricingStatus:'custom',role:raw.role==='host'?'host':'service'};});
    if(safeLines.some(l=>!Number.isFinite(l.multiplier)||l.multiplier<=0))throw new Error('The scenario contains an invalid usage multiplier.');
    return{...value,lines:safeLines,reportingCurrency:report,fxRates:importedFX};
  }
  function importScenario(s){
    reportingCurrency=s.reportingCurrency;fxRates={...s.fxRates};hardwareCurrency=s.hardware.priceCurrency||'USD';$('report-currency').value=reportingCurrency;$('report-fx').value=fxRates[reportingCurrency];$('hardware-currency').value=hardwareCurrency;
    document.querySelector('[name="solution-mode"][value="'+s.mode+'"]').checked=true;$('solution-cloud-share').value=s.cloudShare;$('solution-reserve').value=s.reservePercent;$('solution-horizon').value=s.horizonMonths;$('solution-label').value=String(s.label||'Imported scenario').slice(0,120);$('hosting-choice').value=s.hosting||'none';
    hardwareFields.forEach(k=>{$('hardware-'+k).value=s.hardware[k]??'';});$('hardware-enabled').checked=s.hardware.enabled===true;$('hardware-purchaseNow').checked=s.hardware.purchaseNow!==false;
    lines=s.lines;renderLines();Object.keys(window.FoundryCalculator.rules).forEach(k=>{$(k).value=s.modelInputs[k]??'';});$('model').value=s.model;$('model').dispatchEvent(new Event('change',{bubbles:true}));if(s.model==='custom'){$('currency').value=s.modelCurrency;$('currency').dispatchEvent(new Event('change',{bubbles:true}));}mirrorModel();update();$('solution-download-status').textContent='Scenario loaded. Published presets use the included '+catalog.verifiedDate+' price snapshot; custom rates are preserved.';
  }

  const architecture={
    'cloud-api':{title:'Cloud gateway and orchestrator',body:'App Service or Container Apps hosts the API adapter, prompt assembly and routing. API Management is a separate optional gateway. Charge one selected application host; add gateway capacity and calls only when deployed. Standard v2 is the reference gateway for supported private-network scenarios. App Service plan cost is provisioned instance-hours, shared by apps on that plan.',target:'cloud-services',doc:'https://learn.microsoft.com/en-us/azure/app-service/overview-hosting-plans'},
    'cloud-model':{title:'Foundry model deployments',body:'Use a deployed model with confirmed regional availability, quota and feature support. Azure model calls are the workload multiplied by the permitted cloud share. Input, cache reads, separately priced writes and output each use their own rate. The Model costs tab retains every source meter and compares the full workload across providers.',target:'models',doc:'https://learn.microsoft.com/en-us/azure/foundry/concepts/foundry-models-overview'},
    'cloud-rag':{title:'Cloud retrieval and document ingestion',body:'AI Search uses replicas × partitions × provisioned hours. Embedding input tokens, Blob storage and transactions, and Document Intelligence Read pages are distinct charges. Enter indexing and query embeddings explicitly; ingestion volume does not automatically fall when generation traffic moves local. Initial bulk ingestion can be a one-time cost line.',target:'cloud-services',doc:'https://learn.microsoft.com/en-us/azure/search/search-sku-tier'},
    'cloud-ops':{title:'Cloud identity, network and monitoring',body:'Use Entra ID for users and managed identities for backend access where supported. Key Vault operations, log ingestion/retention, VPN hours, private endpoints and data transfer have different billing units. Add identity licences, DNS, public IPs, firewalls and security services when the design requires them. Private endpoint counts alone do not validate a complete network design.',target:'cloud-services',doc:'https://learn.microsoft.com/en-us/azure/app-service/overview-managed-identity'},
    'local-api':{title:'Independent local gateway and orchestrator',body:'Deploy a local interface and API adapter that can authorize, route and finish requests without Azure. Keep the required configuration, credentials, queues and packages locally available. This reference does not assume that an Azure API Management self-hosted gateway is a fully disconnected control plane. Its licensing and disconnection constraints must be assessed separately if selected.',target:'operations-services',doc:'https://learn.microsoft.com/en-us/azure/api-management/self-hosted-gateway-overview'},
    'local-model':{title:'Local inference and licensed models',body:'Foundry Local suits on-device applications. For a shared server, choose an inference runtime and licensed model supported by the required hardware and concurrency. Pre-stage model files and execution dependencies before disconnecting. Model calls drive capacity sizing; the engine prices hardware, power, maintenance and operations rather than inventing a local per-token Azure charge.',target:'local-hardware',doc:'https://learn.microsoft.com/en-us/azure/foundry-local/what-is-foundry-local'},
    'local-rag':{title:'Local retrieval, documents and OCR',body:'Keep approved documents, ACL metadata, embeddings, vector storage and OCR available locally. Use the same embedding model to index and query a given vector store. Different cloud and local embedding models require separate compatible indexes, so synchronize approved source documents instead of blindly copying vectors. Price storage, backups, software and ingestion labour as local lines.',target:'operations-services',doc:'https://learn.microsoft.com/en-us/azure/search/vector-search-how-to-generate-embeddings'},
    'local-ops':{title:'Local identity and operations',body:'Provide local identity or AD access, secrets and certificates, monitoring, audit storage and package registries. The offline path must not depend on a cloud token refresh or online package download. Add allocated connectivity, backup, licences, operational labour and support. Controlled synchronization and optional log exports happen only when connected and permitted.',target:'operations-services',doc:'https://learn.microsoft.com/en-us/azure/foundry-local/what-is-foundry-local'}
  };
  document.querySelectorAll('[data-architecture]').forEach(button=>button.addEventListener('click',()=>{const id=button.dataset.architecture,d=architecture[id];document.querySelectorAll('[data-architecture]').forEach(b=>b.classList.toggle('selected',b===button));$('architecture-detail-kicker').textContent=id.startsWith('cloud')?'AZURE COST MAPPING':'LOCAL COST MAPPING';$('architecture-detail-title').textContent=d.title;$('architecture-detail-body').textContent=d.body;const links=$('architecture-detail-links');links.replaceChildren();const a=el('a','Open corresponding cost inputs →','secondary-button');a.href='#'+d.target;links.append(a,external('Microsoft documentation ↗',d.doc));}));

  for(const [code,label]of currencyOptions){const option=el('option',label);option.value=code;$('report-currency').append(option);$('hardware-currency').append(option.cloneNode(true));if(![...$('currency').options].some(o=>o.value===code)){$('currency').append(option.cloneNode(true));}}
  $('report-currency').addEventListener('change',()=>{reportingCurrency=$('report-currency').value;$('report-fx').value=fxRates[reportingCurrency];update();});
  $('report-fx').addEventListener('input',()=>{fxRates[reportingCurrency]=reportingCurrency==='USD'?1:$('report-fx').value;update();});
  $('restore-fx').addEventListener('click',()=>{fxRates[reportingCurrency]=fxCatalog.ratesPerUSD[reportingCurrency];$('report-fx').value=fxRates[reportingCurrency];update();});
  $('hardware-currency').addEventListener('change',()=>{const next=$('hardware-currency').value;if(![hardwareCurrency,next].every(code=>Number.isFinite(Number(fxRates[code]))&&Number(fxRates[code])>0)){$('hardware-currency').value=hardwareCurrency;$('solution-download-status').textContent='Fix or restore the exchange rate before changing the hardware currency. Existing prices were kept.';update();return;}['purchasePerDevice','kwhRate'].forEach(k=>{const input=$('hardware-'+k);if(input.value!==''&&Number.isFinite(readNumber(input.value)))input.value=asUSD(input.value,hardwareCurrency)*Number(fxRates[next]);});hardwareCurrency=next;update();});
  sharedFields.forEach(k=>$('solution-'+k).addEventListener('input',()=>{$(k).value=$('solution-'+k).value;modelSync=true;$(k).dispatchEvent(new Event('input',{bubbles:true}));modelSync=false;update();}));
  $('solution-model').replaceChildren(...[...$('model').children].map(e=>e.cloneNode(true)));$('solution-model').value=$('model').value;$('solution-model').addEventListener('change',()=>{$('model').value=$('solution-model').value;$('model').dispatchEvent(new Event('change',{bubbles:true}));if($('model').value==='custom'){$('solution-model-rates').textContent='Edit custom USD rates in the Model costs tab.';}});
  window.addEventListener('foundry-model-update',()=>{mirrorModel();update();});
  ['solution-cloud-share','solution-reserve','solution-horizon',...hardwareFields.map(k=>'hardware-'+k)].forEach(id=>$(id).addEventListener('input',update));
  ['hardware-enabled','hardware-purchaseNow'].forEach(id=>$(id).addEventListener('change',update));
  document.querySelectorAll('[name="solution-mode"]').forEach(e=>e.addEventListener('change',update));
  $('hosting-choice').addEventListener('change',()=>setHost($('hosting-choice').value));
  const add=$('add-azure-preset');catalog.components.forEach(m=>{const option=el('option',(presets[m.id]?.name||m.service+' · '+m.meterName)+' — '+rateText(m.rate)+' / '+m.billingUnit);option.value=m.id;add.append(option);});
  $('add-azure-service').addEventListener('click',()=>{const line=presetLine(add.value);lines.push(line);renderLines();cardUI.get(line.id).card.open=true;update();cardUI.get(line.id).card.scrollIntoView({behavior:'smooth',block:'center'});});
  $('add-custom-service').addEventListener('click',()=>{const line=manualLine('Additional cost','shared','monthly',1,null,'units','unpriced');lines.push(line);renderLines();cardUI.get(line.id).card.open=true;update();$(line.id+'-name').focus();});
  $('download-solution-csv').addEventListener('click',exportCSV);
  $('save-scenario').addEventListener('click',()=>{update();if(!latest.ok){$('solution-download-status').textContent='Fix invalid inputs before saving a scenario. Missing prices can still be saved for later.';return;}const saved=snapshot();downloadFile('foundry-solution-scenario.json','application/json',JSON.stringify(saved,null,2));$('solution-download-status').textContent='Scenario saved with your assumptions, currencies and custom prices.'+(saved.restoredUnusedFX.length?' Unused invalid FX rates were restored to the reference snapshot: '+saved.restoredUnusedFX.join(', ')+'.':'');});
  $('load-scenario').addEventListener('click',()=>$('scenario-file').click());$('scenario-file').addEventListener('change',async()=>{const file=$('scenario-file').files[0];if(!file)return;try{if(file.size>500000)throw new Error('The scenario file is too large.');const value=sanitizeScenario(JSON.parse(await file.text()));importScenario(value);}catch(error){$('solution-download-status').textContent=error.message||'Could not load the scenario.';}$('scenario-file').value='';});
  $('solution-reset').addEventListener('click',()=>{reportingCurrency='USD';hardwareCurrency='USD';fxRates={...fxCatalog.ratesPerUSD};$('report-currency').value='USD';$('report-fx').value=1;$('hardware-currency').value='USD';defaultLines();renderLines();document.querySelector('[name="solution-mode"][value="hybrid"]').checked=true;$('solution-cloud-share').value=80;$('solution-reserve').value=20;$('solution-horizon').value=36;$('solution-label').value='Hybrid reference example';$('hosting-choice').value='app-service-linux-b1';hardwareFields.forEach(k=>{$('hardware-'+k).value=hardwareDefaults[k];});$('hardware-enabled').checked=true;$('hardware-purchaseNow').checked=true;$('reset-example').click();mirrorModel();update();$('solution-download-status').textContent='Illustrative hybrid example restored.';});
  document.querySelectorAll('[data-copy-code]').forEach(button=>button.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(button.parentElement.querySelector('code').textContent);button.textContent='Copied';}catch{button.textContent='Select text to copy';}setTimeout(()=>{button.textContent='Copy';},2200);}));
  defaultLines();renderLines();mirrorModel();update();routeHash();
})();
