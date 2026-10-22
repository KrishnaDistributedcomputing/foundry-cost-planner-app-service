(function (root) {
  'use strict';
  const defaults = {users:100,tasks:10,days:22,calls:1,inputTokens:2000,outputTokens:500,inputRate:0.25,outputRate:2,cacheShare:0,cacheRate:0.025,cacheWriteShare:0,cacheWriteRate:0,otherCharges:0,allowance:20};
  const rules = {
    users:{label:'Active users',max:1000000000,integer:true},tasks:{label:'Tasks per user per day',max:1000000},
    days:{label:'Active days',max:31,integer:true},calls:{label:'Model calls per task',max:1000000},
    inputTokens:{label:'Average input tokens',max:1000000000},outputTokens:{label:'Average output tokens',max:1000000000},
    inputRate:{label:'Input price',max:1000000000},outputRate:{label:'Output price',max:1000000000},
    cacheShare:{label:'Cache-read share',max:100},cacheRate:{label:'Cache-read price',max:1000000000},
    cacheWriteShare:{label:'Cache-write share',max:100},cacheWriteRate:{label:'Cache-write price',max:1000000000},
    otherCharges:{label:'Other monthly charges',max:1000000000000},allowance:{label:'Planning allowance',max:1000}
  };
  function estimate(raw) {
    const p={},errors={};
    for (const key of Object.keys(rules)) {
      const rule=rules[key],value=raw[key];
      if(value===undefined||value===null||String(value).trim()===''){errors[key]='Enter '+rule.label.toLowerCase()+'.';continue;}
      const n=Number(value);
      if(!Number.isFinite(n)||n<0){errors[key]='Enter a number of zero or more.';continue;}
      if(n>rule.max){errors[key]='Use a value no greater than '+rule.max.toLocaleString('en-US')+'.';continue;}
      if(rule.integer&&!Number.isInteger(n)){errors[key]='Enter a whole number.';continue;}
      p[key]=n;
    }
    if(Object.keys(errors).length)return {ok:false,errors};
    if(p.cacheShare+p.cacheWriteShare>100)return {ok:false,errors:{cacheShare:'Cache reads and writes together cannot exceed 100% of input.',cacheWriteShare:'Cache reads and writes together cannot exceed 100% of input.'}};
    const monthlyTasks=p.users*p.tasks*p.days,monthlyCalls=monthlyTasks*p.calls;
    const inputTotal=monthlyCalls*p.inputTokens,outputTotal=monthlyCalls*p.outputTokens,totalTokens=inputTotal+outputTotal;
    if(!Number.isFinite(totalTokens)||totalTokens>Number.MAX_SAFE_INTEGER)return {ok:false,errors:{users:'This workload is too large for a precise estimate. Split it into smaller workloads.'}};
    const cachedTokens=inputTotal*p.cacheShare/100,cacheWriteTokens=inputTotal*p.cacheWriteShare/100,uncachedTokens=Math.max(0,inputTotal-cachedTokens-cacheWriteTokens);
    const inputCost=uncachedTokens*p.inputRate/1000000,cacheCost=cachedTokens*p.cacheRate/1000000,cacheWriteCost=cacheWriteTokens*p.cacheWriteRate/1000000,outputCost=outputTotal*p.outputRate/1000000;
    const modelCost=inputCost+cacheCost+cacheWriteCost+outputCost,baseCost=modelCost+p.otherCharges,allowanceCost=baseCost*p.allowance/100,budget=baseCost+allowanceCost;
    return {ok:true,inputs:p,monthlyTasks,monthlyCalls,inputTotal,outputTotal,totalTokens,cachedTokens,cacheWriteTokens,uncachedTokens,inputCost,cacheCost,cacheWriteCost,outputCost,modelCost,otherCharges:p.otherCharges,baseCost,allowanceCost,budget,annualBudget:budget*12,annualModelCost:modelCost*12,perTask:monthlyTasks>0?modelCost/monthlyTasks:null,perUser:p.users>0?modelCost/p.users:null};
  }
  function estimateForModel(raw,model){
    return estimate({...raw,inputRate:model.inputRate,outputRate:model.outputRate,cacheRate:model.cacheRate??0,cacheWriteRate:model.cacheWriteRate??0,cacheShare:model.cacheRate===null?0:raw.cacheShare,cacheWriteShare:model.cacheWriteRate===null?0:raw.cacheWriteShare});
  }
  const api={defaults,rules,estimate,estimateForModel};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FoundryCalculator=api;
})(typeof globalThis!=='undefined'?globalThis:this);
