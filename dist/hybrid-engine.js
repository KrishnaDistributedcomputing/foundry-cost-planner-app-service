(function (root) {
  'use strict';

  const MODES = ['hybrid', 'cloud', 'local'];
  const DOMAINS = ['cloud', 'local', 'shared'];
  const PRICE_STATUSES = ['verified', 'custom', 'assumption', 'unpriced'];
  const MONTHLY_TOTAL_FIELDS = [
    'monthlyCashRunRate', 'fullyAllocatedMonthly', 'monthlyReserve',
    'monthlyPlanningBudget', 'year1CashBudget', 'horizonCashBudget', 'perTask'
  ];

  function estimate(plan) {
    const errors = {};
    const missingRates = [];
    const lines = [];
    const pricingCoverage = {
      scope: 'active service lines', total: 0, priced: 0,
      verified: 0, custom: 0, assumption: 0, unpriced: 0,
      zeroUsageUnpriced: 0
    };
    const result = {
      ok: false, complete: false, errors, missingRates, lines, pricingCoverage,
      effectiveCloudShare: null, cloudModelCost: null, cloudCalls: null,
      localCalls: null, cloudInputTokens: null, cloudOutputTokens: null,
      cloudSubtotal: null, localSubtotal: null, sharedSubtotal: null,
      knownMonthlySubtotal: null, hardwareAssetValue: null, hardwareUpfront: null, serviceUpfront: null,
      knownServiceUpfront: null, totalUpfront: null, knownTotalUpfront: null,
      hardwareAmortizedMonthly: null, hardwarePowerMonthly: null,
      hardwareMaintenanceMonthly: null
    };
    MONTHLY_TOTAL_FIELDS.forEach(key => { result[key] = null; });

    const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    if (!record(plan)) {
      errors.plan = 'Provide a solution plan object.';
      return result;
    }
    function numeric(value, key, label, opts) {
      const options = opts || {};
      if (value === null || value === undefined || typeof value === 'boolean' ||
          (typeof value !== 'number' && typeof value !== 'string') ||
          (typeof value === 'string' && value.trim() === '')) {
        errors[key] = 'Enter ' + label + '.';
        return null;
      }
      const n = Number(value);
      if (!Number.isFinite(n)) {
        errors[key] = label + ' must be a finite number.';
        return null;
      }
      const minimum = options.min === undefined ? 0 : options.min;
      if (n < minimum || (options.positive && n <= 0)) {
        errors[key] = label + (options.positive ? ' must be greater than zero.' : ' must be at least ' + minimum + '.');
        return null;
      }
      if (options.max !== undefined && n > options.max) {
        errors[key] = label + ' must be no greater than ' + options.max + '.';
        return null;
      }
      if (options.integer && !Number.isSafeInteger(n)) {
        errors[key] = label + ' must be a safe whole number.';
        return null;
      }
      return n;
    }
    function finiteDerived(value, key, label) {
      if (!Number.isFinite(value)) {
        errors[key] = label + ' is too large to calculate. Reduce the quantities or rates.';
        return false;
      }
      return true;
    }
    function domainActive(domain) {
      return domain === 'shared' || (domain === 'cloud' && plan.mode !== 'local') || (domain === 'local' && plan.mode !== 'cloud');
    }

    if (!MODES.includes(plan.mode)) errors.mode = 'Choose hybrid, cloud, or local mode.';
    const cloudShare = plan.mode === 'cloud' ? 100 : plan.mode === 'local' ? 0 : numeric(plan.cloudShare, 'cloudShare', 'Cloud traffic percentage', {max:100});
    const reservePercent = numeric(plan.reservePercent, 'reservePercent', 'Planning reserve percentage', {max:1000});
    const horizonMonths = numeric(plan.horizonMonths, 'horizonMonths', 'Planning horizon in months', {min:1,max:120,integer:true});
    const base = record(plan.baseModel) ? plan.baseModel : null;
    const baseValues = {};
    if (!base || base.ok !== true) {
      errors.baseModel = 'Complete the workload and model inputs before calculating the solution cost.';
    } else {
      for (const key of ['monthlyCalls','monthlyTasks','inputTotal','outputTotal','modelCost']) {
        baseValues[key] = numeric(base[key], 'baseModel.' + key, 'Model estimate ' + key);
      }
    }
    if (cloudShare !== null && cloudShare > 0 && plan.modelCurrency !== 'USD') {
      errors.modelCurrency = 'Use USD model rates to combine them with the USD Azure service prices.';
    }
    if (!Array.isArray(plan.serviceLines)) errors.serviceLines = 'Provide a service line array.';

    // Disabled or inactive components do not incur costs or require valid inputs.
    const activeLines = [];
    const seenIds = new Set();
    for (const [index, line] of (Array.isArray(plan.serviceLines) ? plan.serviceLines : []).entries()) {
      const prefix = 'serviceLines.' + index;
      if (!record(line)) { errors[prefix] = 'Provide a service line object.'; continue; }
      if (line.enabled === false) continue;
      if (DOMAINS.includes(line.domain) && !domainActive(line.domain)) continue;
      if (line.enabled !== true) { errors[prefix + '.enabled'] = 'Specify whether the service line is enabled.'; continue; }
      if (!DOMAINS.includes(line.domain)) { errors[prefix + '.domain'] = 'Choose cloud, local, or shared for the service line.'; continue; }
      if (typeof line.id !== 'string' || !line.id.trim()) errors[prefix + '.id'] = 'Give each enabled service line an ID.';
      else if (seenIds.has(line.id)) errors[prefix + '.id'] = 'Service line IDs must be unique.';
      else seenIds.add(line.id);
      if (!['monthly','oneTime'].includes(line.recurrence)) errors[prefix + '.recurrence'] = 'Choose monthly or oneTime for the service line.';
      const quantity = numeric(line.quantity, prefix + '.quantity', 'Service quantity');
      const unitSize = numeric(line.unitSize, prefix + '.unitSize', 'Billing unit size', {positive:true});
      const freeQuantity = numeric(line.freeQuantity, prefix + '.freeQuantity', 'Allocated free quantity');
      // Blank rates are missing prices, not zero-dollar prices. A genuine numeric 0 is valid.
      const flatRateMissing = line.rate === null || line.rate === undefined || (typeof line.rate === 'string' && line.rate.trim() === '');
      const rate = flatRateMissing ? null : numeric(line.rate, prefix + '.rate', 'Service rate');
      let tiers = null;
      if (line.tiers !== undefined && line.tiers !== null) {
        if (!Array.isArray(line.tiers) || line.tiers.length === 0) {
          errors[prefix + '.tiers'] = 'Provide a nonempty progressive tier array or omit tiers for a flat rate.';
        } else {
          tiers = [];
          for (const [tierIndex,tier] of line.tiers.entries()) {
            const tierPrefix = prefix + '.tiers.' + tierIndex;
            if (!record(tier)) { errors[tierPrefix] = 'Provide a tier object.'; continue; }
            const minimumUsageQuantity = numeric(tier.minimumUsageQuantity, tierPrefix + '.minimumUsageQuantity', 'Tier minimum usage quantity');
            const tierRateInput = Object.prototype.hasOwnProperty.call(tier,'rate') ? tier.rate : tier.ratePerBillingUnit;
            const tierRate = numeric(tierRateInput, tierPrefix + '.rate', 'Tier rate per billing unit');
            if (minimumUsageQuantity !== null) {
              if (tierIndex === 0 && minimumUsageQuantity !== 0) errors[tierPrefix + '.minimumUsageQuantity'] = 'The first tier must start at zero usage.';
              if (tierIndex > 0 && tiers.length && minimumUsageQuantity <= tiers[tiers.length-1].minimumUsageQuantity) errors[tierPrefix + '.minimumUsageQuantity'] = 'Tier minimums must be in strictly increasing order.';
            }
            tiers.push({...tier,minimumUsageQuantity,rate:tierRate});
          }
        }
      }
      const missingRate = flatRateMissing && !tiers;
      const pricingStatus = PRICE_STATUSES.includes(line.pricingStatus) ? line.pricingStatus : (missingRate ? 'unpriced' : 'assumption');
      activeLines.push({line,prefix,quantity,unitSize,freeQuantity,rate,tiers,missingRate,pricingStatus});
    }

    const localActive = plan.mode !== 'cloud';
    let hardware = null;
    const suppliedHardware = plan.hardware;
    if (localActive && record(suppliedHardware) && suppliedHardware.enabled === true) {
      hardware = {};
      if (suppliedHardware.purchaseNow !== undefined && typeof suppliedHardware.purchaseNow !== 'boolean') {
        errors['hardware.purchaseNow'] = 'Specify whether hardware is being purchased now.';
      }
      hardware.purchaseNow = suppliedHardware.purchaseNow !== false;
      const specifications = {
        count: {integer:true}, purchasePerDevice: {}, lifeMonths: {min:1},
        wattsPerDevice: {}, powerHoursMonth: {}, pue: {min:1}, kwhRate: {},
        annualMaintenancePercent: {}
      };
      for (const [key,options] of Object.entries(specifications)) {
        hardware[key] = numeric(suppliedHardware[key], 'hardware.' + key, 'Hardware ' + key, options);
      }
    } else if (localActive && (!record(suppliedHardware) || typeof suppliedHardware.enabled !== 'boolean')) {
      errors.hardware = 'Provide hardware settings with enabled set to true or false.';
    }
    if (Object.keys(errors).length) return result;

    result.effectiveCloudShare = cloudShare;
    const fraction = cloudShare / 100;
    result.cloudModelCost = baseValues.modelCost * fraction;
    result.cloudCalls = baseValues.monthlyCalls * fraction;
    result.localCalls = baseValues.monthlyCalls - result.cloudCalls;
    result.cloudInputTokens = baseValues.inputTotal * fraction;
    result.cloudOutputTokens = baseValues.outputTotal * fraction;

    let cloud = result.cloudModelCost, local = 0, shared = 0, serviceUpfront = 0;
    const missingByDomain = {cloud:false,local:false,shared:false};
    let unknownUpfront = false;
    for (const item of activeLines) {
      const {line,prefix,quantity,unitSize,freeQuantity,rate,tiers,missingRate,pricingStatus} = item;
      // An externally allocated grant is removed first. For tier schedules that embed
      // a free band, callers must pass freeQuantity=0 to avoid applying it twice.
      const billableQuantity = Math.max(0,quantity-freeQuantity);
      const billingUnits = billableQuantity / unitSize;
      const unresolved = missingRate && billableQuantity > 0;
      const tierSegments = [];
      let cost = unresolved ? null : billableQuantity === 0 ? 0 : billingUnits * rate;
      if (tiers) {
        cost = 0;
        for (const [tierIndex,tier] of tiers.entries()) {
          const maximumUsageQuantity = tierIndex+1 < tiers.length ? tiers[tierIndex+1].minimumUsageQuantity : null;
          const end = maximumUsageQuantity === null ? billableQuantity : Math.min(billableQuantity,maximumUsageQuantity);
          const segmentQuantity = Math.max(0,end-tier.minimumUsageQuantity);
          if (segmentQuantity === 0) continue;
          const segmentUnits = segmentQuantity/unitSize;
          const segmentCost = segmentUnits*tier.rate;
          tierSegments.push({tierIndex,minimumUsageQuantity:tier.minimumUsageQuantity,maximumUsageQuantity,quantity:segmentQuantity,billingUnits:segmentUnits,rate:tier.rate,cost:segmentCost});
          cost += segmentCost;
        }
      }
      if (!finiteDerived(billingUnits, prefix + '.billingUnits', 'Billing units') || (cost !== null && !finiteDerived(cost, prefix + '.cost', 'Service cost'))) continue;
      const calculated = {...line,quantity,unitSize,freeQuantity,rate,billableQuantity,billingUnits,cost,tierSegments,pricingStatus:missingRate?'unpriced':pricingStatus};
      if (tiers) calculated.tiers = tiers;
      lines.push(calculated);
      pricingCoverage.total++;
      pricingCoverage[calculated.pricingStatus]++;
      if (!missingRate) pricingCoverage.priced++;
      else if (!unresolved) pricingCoverage.zeroUsageUnpriced++;
      if (unresolved) {
        missingRates.push({id:line.id,name:line.name||line.id,field:prefix+'.rate',domain:line.domain,recurrence:line.recurrence,billableQuantity});
        if (line.recurrence === 'oneTime') unknownUpfront = true;
        else missingByDomain[line.domain] = true;
        continue;
      }
      if (line.recurrence === 'oneTime') serviceUpfront += cost;
      else if (line.domain === 'cloud') cloud += cost;
      else if (line.domain === 'local') local += cost;
      else shared += cost;
    }

    let hardwareAssetValue = 0, hardwareUpfront = 0, amortization = 0, power = 0, maintenance = 0;
    if (hardware) {
      hardwareAssetValue = hardware.count * hardware.purchasePerDevice;
      hardwareUpfront = hardware.purchaseNow ? hardwareAssetValue : 0;
      amortization = hardwareAssetValue / hardware.lifeMonths;
      power = hardware.count * hardware.wattsPerDevice / 1000 * hardware.powerHoursMonth * hardware.pue * hardware.kwhRate;
      maintenance = hardwareAssetValue * hardware.annualMaintenancePercent / 100 / 12;
      local += power + maintenance;
    }
    const knownMonthlySubtotal = cloud + local + shared;
    const knownTotalUpfront = hardwareUpfront + serviceUpfront;
    const derived = {cloudModelCost:result.cloudModelCost,cloudCalls:result.cloudCalls,localCalls:result.localCalls,cloudInputTokens:result.cloudInputTokens,cloudOutputTokens:result.cloudOutputTokens,cloud,local,shared,hardwareAssetValue,hardwareUpfront,amortization,power,maintenance,knownMonthlySubtotal,knownTotalUpfront,serviceUpfront};
    for (const [key,value] of Object.entries(derived)) finiteDerived(value,'calculation.'+key,key);
    if (Object.keys(errors).length) return result;

    result.ok = true;
    result.complete = missingRates.length === 0;
    result.knownCloudSubtotal = cloud;
    result.knownLocalSubtotal = local;
    result.knownSharedSubtotal = shared;
    result.cloudSubtotal = missingByDomain.cloud ? null : cloud;
    result.localSubtotal = missingByDomain.local ? null : local;
    result.sharedSubtotal = missingByDomain.shared ? null : shared;
    result.knownMonthlySubtotal = knownMonthlySubtotal;
    result.hardwareAssetValue = hardwareAssetValue;
    result.hardwareUpfront = hardwareUpfront;
    result.serviceUpfront = unknownUpfront ? null : serviceUpfront;
    result.knownServiceUpfront = serviceUpfront;
    result.knownTotalUpfront = knownTotalUpfront;
    result.totalUpfront = unknownUpfront ? null : knownTotalUpfront;
    result.hardwareAmortizedMonthly = amortization;
    result.hardwarePowerMonthly = power;
    result.hardwareMaintenanceMonthly = maintenance;
    // A partial plan exposes known subtotals only; a missing price never silently becomes free.
    if (!result.complete) return result;

    result.monthlyCashRunRate = knownMonthlySubtotal;
    result.fullyAllocatedMonthly = knownMonthlySubtotal + amortization;
    result.monthlyReserve = knownMonthlySubtotal * reservePercent / 100;
    result.monthlyPlanningBudget = knownMonthlySubtotal + result.monthlyReserve;
    result.year1CashBudget = knownTotalUpfront + result.monthlyPlanningBudget * 12;
    result.horizonCashBudget = knownTotalUpfront + result.monthlyPlanningBudget * horizonMonths;
    result.perTask = baseValues.monthlyTasks > 0 ? knownMonthlySubtotal / baseValues.monthlyTasks : null;
    for (const key of MONTHLY_TOTAL_FIELDS) {
      if (result[key] !== null) finiteDerived(result[key], 'calculation.'+key,key);
    }
    if (Object.keys(errors).length) {
      result.ok = false; result.complete = false;
      MONTHLY_TOTAL_FIELDS.forEach(key=>{result[key]=null;});
    }
    return result;
  }

  const api = {estimate, calculate:estimate};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HybridCostEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
