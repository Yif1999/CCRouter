import type { CacheControlMetadata, CacheTtlMode } from './formatRequest';
import { getCachedModelPricing, getModelPricing, getPricingCacheTimestamp, type ModelPricing } from './pricingUtils';

const PRECISION = 1e-6;
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER_5M = 1.25;
const CACHE_WRITE_MULTIPLIER_1H = 2.0;

interface PromptTokensDetails {
  cached_tokens?: number;
}

export interface UpstreamUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  reasoning_tokens?: number;
  cost?: number | string;
  prompt_tokens_details?: PromptTokensDetails;
  cache_creation_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  } | null;
}

export interface UsageComputationOptions {
  usage?: UpstreamUsage | null;
  model: string;
  cacheMetadata?: CacheControlMetadata;
}

export interface TokenBreakdown {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

export interface CostBreakdown {
  input: number;
  output: number;
  read: number;
  write: number;
  total: number;
  residual: number;
  actual: number | null;
}

export interface BillingDebugPayload {
  model: string;
  priceVersion: string | null;
  priceSource: 'cache' | 'network' | 'missing';
  rates: {
    prompt: number | null;
    completion: number | null;
    cache_read: number | null;
    cache_write_ephemeral_5m: number | null;
    cache_write_ephemeral_1h: number | null;
  };
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    cache_read_tokens: number;
    reasoning_tokens: number;
    cache_creation_input_tokens_provided: number | null;
    cache_creation_breakdown_provided: UpstreamUsage['cache_creation'];
  };
  ttl: {
    mode: CacheTtlMode;
    explicit: Array<'5m' | '1h'>;
    sawEphemeralWithoutTtl: boolean;
    sawCacheControl: boolean;
    sources: string[];
  };
  costs: {
    input: number;
    output: number;
    read: number;
    write: number;
    total: number;
    actual: number | null;
    residual: number;
    residual_before_clamp: number | null;
    residual_after_clamp: number | null;
  };
  inference: {
    needed: boolean;
    source: 'upstream_detailed' | 'upstream_simple' | 'inferred' | 'unavailable';
    performed: boolean;
    notes: string[];
    write_rate_used: number | null;
    writes_raw: number;
    writes_rounded: number;
  };
  rounding: {
    precision: number;
  };
}

export interface BillingComputationResult {
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
    cache_creation?: {
      ephemeral_5m_input_tokens: number;
      ephemeral_1h_input_tokens: number;
    } | null;
    reasoning_tokens?: number;
  };
  tokens: TokenBreakdown;
  costs: CostBreakdown;
  debug: BillingDebugPayload;
  estimation: {
    inferred: boolean;
    source: 'upstream_detailed' | 'upstream_simple' | 'inferred' | 'unavailable';
    ttlMode: CacheTtlMode;
    notes: string[];
  };
  pricing: {
    source: 'cache' | 'network' | 'missing';
    timestamp: number | null;
  };
}

function roundCurrency(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const factor = 1 / PRECISION;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function safeNumber(value: unknown): number {
  const num = typeof value === 'string' ? Number.parseFloat(value) : Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normaliseTokens(value: unknown): number {
  if (value === undefined || value === null) {
    return 0;
  }
  const num = typeof value === 'string' ? Number.parseFloat(value) : Number(value);
  if (!Number.isFinite(num)) {
    return 0;
  }
  const rounded = Math.round(num);
  return rounded < 0 ? 0 : rounded;
}

function determinePricingSource(pricing: ModelPricing | null, fetchedViaNetwork: boolean): 'cache' | 'network' | 'missing' {
  if (!pricing) {
    return 'missing';
  }
  return fetchedViaNetwork ? 'network' : 'cache';
}

function deriveWriteRate(ttlMode: CacheTtlMode, promptRate: number): number {
  if (!Number.isFinite(promptRate) || promptRate <= 0) {
    return 0;
  }
  switch (ttlMode) {
    case 'ephemeral_1h':
      return promptRate * CACHE_WRITE_MULTIPLIER_1H;
    case 'mixed':
      return promptRate * CACHE_WRITE_MULTIPLIER_5M;
    case 'ephemeral_5m':
    default:
      return promptRate * CACHE_WRITE_MULTIPLIER_5M;
  }
}

function buildCacheCreationBreakdown(source: 'upstream_detailed' | 'upstream_simple' | 'inferred' | 'unavailable', ttlMode: CacheTtlMode, writeTokens: number, upstreamBreakdown: UpstreamUsage['cache_creation'] | null): {
  breakdown: { ephemeral_5m_input_tokens: number; ephemeral_1h_input_tokens: number; } | null;
  allowField: boolean;
} {
  if (source === 'upstream_detailed') {
    const five = normaliseTokens(upstreamBreakdown?.ephemeral_5m_input_tokens);
    const one = normaliseTokens(upstreamBreakdown?.ephemeral_1h_input_tokens);
    return {
      breakdown: {
        ephemeral_5m_input_tokens: five,
        ephemeral_1h_input_tokens: one,
      },
      allowField: true,
    };
  }

  if (source === 'upstream_simple' || source === 'unavailable') {
    return {
      breakdown: null,
      allowField: false,
    };
  }

  if (ttlMode === 'mixed') {
    return {
      breakdown: null,
      allowField: false,
    };
  }

  if (ttlMode === 'ephemeral_1h') {
    return {
      breakdown: {
        ephemeral_5m_input_tokens: 0,
        ephemeral_1h_input_tokens: writeTokens,
      },
      allowField: true,
    };
  }

  return {
    breakdown: {
      ephemeral_5m_input_tokens: writeTokens,
      ephemeral_1h_input_tokens: 0,
    },
    allowField: true,
  };
}

interface PricingResolution {
  pricing: ModelPricing | null;
  pricingSource: 'cache' | 'network' | 'missing';
  promptRate: number;
  completionRate: number;
  readRate: number;
  writeRate5m: number;
  writeRate1h: number;
}

async function resolvePricing(model: string): Promise<PricingResolution> {
  let pricing = getCachedModelPricing(model);
  let fetchedViaNetwork = false;
  if (!pricing) {
    pricing = await getModelPricing(model);
    fetchedViaNetwork = !!pricing;
  }

  const promptRate = pricing ? safeNumber(pricing.prompt) : 0;
  const completionRate = pricing ? safeNumber(pricing.completion) : 0;
  const readRate = Number.isFinite(promptRate) && promptRate > 0 ? promptRate * CACHE_READ_MULTIPLIER : 0;
  const writeRate5m = Number.isFinite(promptRate) && promptRate > 0 ? promptRate * CACHE_WRITE_MULTIPLIER_5M : 0;
  const writeRate1h = Number.isFinite(promptRate) && promptRate > 0 ? promptRate * CACHE_WRITE_MULTIPLIER_1H : 0;

  return {
    pricing,
    pricingSource: determinePricingSource(pricing, fetchedViaNetwork),
    promptRate,
    completionRate,
    readRate,
    writeRate5m,
    writeRate1h,
  };
}

function clampWriteTokens(writeTokens: number, promptTokens: number): number {
  if (writeTokens < 0) {
    return 0;
  }
  if (writeTokens > promptTokens) {
    return promptTokens;
  }
  return writeTokens;
}

export async function computeUsageMetrics(options: UsageComputationOptions): Promise<BillingComputationResult> {
  const upstreamUsage: UpstreamUsage = options.usage ?? {};
  const cacheMetadata = options.cacheMetadata;
  const ttlMode: CacheTtlMode = cacheMetadata?.ttlMode ?? 'ephemeral_5m';

  const promptTokens = normaliseTokens(upstreamUsage.prompt_tokens);
  const completionTokens = normaliseTokens(upstreamUsage.completion_tokens);
  const reasoningTokens = normaliseTokens(upstreamUsage.reasoning_tokens);
  const cacheReadTokens = normaliseTokens(upstreamUsage.prompt_tokens_details?.cached_tokens);

  const outputTokens = completionTokens;
  const inputTokens = Math.max(0, promptTokens - cacheReadTokens);

  const actualCostRaw = upstreamUsage.cost === undefined || upstreamUsage.cost === null
    ? null
    : safeNumber(upstreamUsage.cost);

  const pricingResolution = await resolvePricing(options.model);
  const pricingTimestamp = getPricingCacheTimestamp();

  const costInputRaw = pricingResolution.promptRate > 0 ? inputTokens * pricingResolution.promptRate : NaN;
  const costOutputRaw = pricingResolution.completionRate > 0 ? outputTokens * pricingResolution.completionRate : NaN;
  const costReadRaw = pricingResolution.readRate > 0 ? cacheReadTokens * pricingResolution.readRate : NaN;
  let costWriteRaw = 0;

  let writeTokens = 0;
  let writesRaw = 0;
  let residualBeforeClamp: number | null = null;
  let residualAfterClamp: number | null = null;
  const estimationNotes: string[] = [];
  let estimationSource: 'upstream_detailed' | 'upstream_simple' | 'inferred' | 'unavailable' = 'unavailable';
  let inferenceNeeded = false;
  let inferencePerformed = false;
  let writeRateUsed: number | null = null;

  const upstreamBreakdown = upstreamUsage.cache_creation ?? null;

  if (upstreamBreakdown && (upstreamBreakdown.ephemeral_5m_input_tokens !== undefined || upstreamBreakdown.ephemeral_1h_input_tokens !== undefined)) {
    const five = normaliseTokens(upstreamBreakdown.ephemeral_5m_input_tokens);
    const one = normaliseTokens(upstreamBreakdown.ephemeral_1h_input_tokens);
    writeTokens = Math.max(0, five + one);
    estimationSource = 'upstream_detailed';

    if (pricingResolution.writeRate5m > 0) {
      costWriteRaw += five * pricingResolution.writeRate5m;
    }
    if (pricingResolution.writeRate1h > 0) {
      costWriteRaw += one * pricingResolution.writeRate1h;
    }
  } else if (upstreamUsage.cache_creation_input_tokens !== undefined && upstreamUsage.cache_creation_input_tokens !== null) {
    writeTokens = clampWriteTokens(normaliseTokens(upstreamUsage.cache_creation_input_tokens), promptTokens);
    estimationSource = 'upstream_simple';
    const rate = ttlMode === 'ephemeral_1h' ? pricingResolution.writeRate1h : pricingResolution.writeRate5m;
    if (rate > 0) {
      writeRateUsed = rate;
      costWriteRaw = rate * writeTokens;
    }
  } else {
    inferenceNeeded = true;
    estimationSource = 'inferred';
    if (actualCostRaw !== null && Number.isFinite(actualCostRaw) && Number.isFinite(costInputRaw) && Number.isFinite(costOutputRaw) && Number.isFinite(costReadRaw)) {
      const knownCost = (Number.isFinite(costInputRaw) ? costInputRaw : 0)
        + (Number.isFinite(costOutputRaw) ? costOutputRaw : 0)
        + (Number.isFinite(costReadRaw) ? costReadRaw : 0);
      residualBeforeClamp = actualCostRaw - knownCost;
      if (residualBeforeClamp < 0) {
        estimationNotes.push('negative_residual_clamped');
      }
      residualAfterClamp = residualBeforeClamp > 0 ? residualBeforeClamp : 0;

      const rate = deriveWriteRate(ttlMode, pricingResolution.promptRate);
      if (rate > 0) {
        writeRateUsed = rate;
        inferencePerformed = true;
        writesRaw = rate > 0 ? residualAfterClamp / rate : 0;
        const roundedWrites = Math.round(writesRaw);
        const clampedWrites = clampWriteTokens(roundedWrites, promptTokens);
        if (clampedWrites !== roundedWrites) {
          estimationNotes.push('write_tokens_clamped');
        }
        writeTokens = Math.max(0, clampedWrites);
        if (ttlMode === 'mixed') {
          estimationNotes.push('mixed_ttl_ambiguous');
        }
        costWriteRaw = rate * writeTokens;
      } else {
        estimationSource = 'unavailable';
        estimationNotes.push('missing_write_rate');
        writeTokens = 0;
        costWriteRaw = 0;
      }
    } else {
      estimationSource = 'unavailable';
      if (actualCostRaw === null || !Number.isFinite(actualCostRaw)) {
        estimationNotes.push('missing_actual_cost');
      }
      if (!Number.isFinite(costInputRaw) || !Number.isFinite(costOutputRaw) || !Number.isFinite(costReadRaw)) {
        estimationNotes.push('missing_pricing');
      }
      writeTokens = 0;
      costWriteRaw = 0;
    }
  }

  if (!Number.isFinite(costWriteRaw) || costWriteRaw < 0) {
    costWriteRaw = 0;
  }

  const cacheCreationPayload = buildCacheCreationBreakdown(estimationSource, ttlMode, writeTokens, upstreamBreakdown);

  const costInput = Number.isFinite(costInputRaw) ? roundCurrency(costInputRaw) : 0;
  const costOutput = Number.isFinite(costOutputRaw) ? roundCurrency(costOutputRaw) : 0;
  const costRead = Number.isFinite(costReadRaw) ? roundCurrency(costReadRaw) : 0;
  const costWrite = roundCurrency(costWriteRaw);

  const actualCostRounded = actualCostRaw !== null && Number.isFinite(actualCostRaw) ? roundCurrency(actualCostRaw) : null;
  const totalCost = actualCostRounded !== null ? actualCostRounded : roundCurrency(costInput + costOutput + costRead + costWrite);
  const residualCost = actualCostRounded !== null
    ? roundCurrency(actualCostRounded - (costInput + costOutput + costRead + costWrite))
    : 0;

  const usageResult: BillingComputationResult['usage'] = {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_input_tokens: cacheReadTokens,
    cache_creation_input_tokens: writeTokens,
  };

  if (reasoningTokens > 0) {
    usageResult.reasoning_tokens = reasoningTokens;
  }

  if (cacheCreationPayload.allowField) {
    usageResult.cache_creation = cacheCreationPayload.breakdown ?? {
      ephemeral_5m_input_tokens: 0,
      ephemeral_1h_input_tokens: 0,
    };
  } else {
    usageResult.cache_creation = null;
  }

  const tokens: TokenBreakdown = {
    input: inputTokens,
    output: outputTokens,
    cacheRead: cacheReadTokens,
    cacheCreation: writeTokens,
  };

  const costs: CostBreakdown = {
    input: costInput,
    output: costOutput,
    read: costRead,
    write: costWrite,
    total: totalCost,
    residual: residualCost,
    actual: actualCostRounded,
  };

  const debug: BillingDebugPayload = {
    model: options.model,
    priceVersion: pricingTimestamp ? new Date(pricingTimestamp).toISOString() : null,
    priceSource: pricingResolution.pricingSource,
    rates: {
      prompt: pricingResolution.promptRate > 0 ? pricingResolution.promptRate : null,
      completion: pricingResolution.completionRate > 0 ? pricingResolution.completionRate : null,
      cache_read: pricingResolution.readRate > 0 ? pricingResolution.readRate : null,
      cache_write_ephemeral_5m: pricingResolution.writeRate5m > 0 ? pricingResolution.writeRate5m : null,
      cache_write_ephemeral_1h: pricingResolution.writeRate1h > 0 ? pricingResolution.writeRate1h : null,
    },
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      cache_read_tokens: cacheReadTokens,
      reasoning_tokens: reasoningTokens,
      cache_creation_input_tokens_provided: upstreamUsage.cache_creation_input_tokens ?? null,
      cache_creation_breakdown_provided: upstreamBreakdown,
    },
    ttl: {
      mode: ttlMode,
      explicit: cacheMetadata?.explicitTtls ?? [],
      sawEphemeralWithoutTtl: cacheMetadata?.sawEphemeralWithoutTtl ?? false,
      sawCacheControl: cacheMetadata?.sawCacheControl ?? false,
      sources: cacheMetadata?.sources ?? [],
    },
    costs: {
      input: costInput,
      output: costOutput,
      read: costRead,
      write: costWrite,
      total: totalCost,
      actual: actualCostRounded,
      residual: residualCost,
      residual_before_clamp: residualBeforeClamp ?? null,
      residual_after_clamp: residualAfterClamp ?? null,
    },
    inference: {
      needed: inferenceNeeded,
      source: estimationSource,
      performed: inferencePerformed,
      notes: estimationNotes,
      write_rate_used: writeRateUsed,
      writes_raw: Number.isFinite(writesRaw) ? writesRaw : 0,
      writes_rounded: writeTokens,
    },
    rounding: {
      precision: PRECISION,
    },
  };

  const estimation = {
    inferred: estimationSource === 'inferred' && inferencePerformed,
    source: estimationSource,
    ttlMode,
    notes: estimationNotes,
  };

  const pricingInfo = {
    source: pricingResolution.pricingSource,
    timestamp: pricingTimestamp ?? null,
  };

  return {
    usage: usageResult,
    tokens,
    costs,
    debug,
    estimation,
    pricing: pricingInfo,
  };
}
