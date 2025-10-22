// Utility functions for model pricing and token calculation

export interface ModelPricing {
  prompt: string;
  completion: string;
  request: string;
  image: string;
  audio: string;
  web_search: string;
  internal_reasoning: string;
  input_cache_read?: string;
  input_cache_write?: string;
}

// Cache for model pricing with 1 hour expiry
interface PricingCache {
  data: { [modelId: string]: ModelPricing };
  timestamp: number;
}

let pricingCache: PricingCache | null = null;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds

/**
 * Get cached model pricing synchronously if available
 */
export function getCachedModelPricing(modelId: string): ModelPricing | null {
  const now = Date.now();
  if (pricingCache && (now - pricingCache.timestamp) < CACHE_DURATION) {
    return pricingCache.data[modelId] || null;
  }
  return null;
}

export function getPricingCacheTimestamp(): number | null {
  return pricingCache?.timestamp ?? null;
}

/**
 * Calculate cache_creation_input_tokens based on actual cost from OpenRouter
 */
export function calculateCacheCreationTokens(
  actualCost: number,
  totalInputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  pricing: ModelPricing
): number {
  const promptPrice = parseFloat(pricing.prompt);
  const completionPrice = parseFloat(pricing.completion);
  const cacheReadPrice = parseFloat(pricing.input_cache_read || '0');
  const cacheWritePrice = parseFloat(pricing.input_cache_write || '0');

  // Validate pricing data
  if (promptPrice <= 0 || completionPrice <= 0 || cacheWritePrice <= 0) {
    return 0;
  }

  // Calculate base cost (assuming all input tokens are charged at prompt price)
  const baseCost = (totalInputTokens * promptPrice) + (outputTokens * completionPrice);
  
  // Calculate adjustments for cache pricing
  const cacheReadAdjustment = cacheReadTokens * (cacheReadPrice - promptPrice);
  
  // Remaining cost difference should be from cache creation pricing difference
  const remainingCostDifference = actualCost - baseCost - cacheReadAdjustment;
  const cacheWriteAdjustment = cacheWritePrice - promptPrice;
  
  // Calculate cache creation tokens
  if (cacheWriteAdjustment > 0) {
    const cacheCreationTokens = Math.round(remainingCostDifference / cacheWriteAdjustment);
    return Math.max(0, cacheCreationTokens); // Ensure non-negative
  }
  
  return 0;
}

/**
 * Get model pricing from OpenRouter API with caching
 */
export async function getModelPricing(modelId: string): Promise<ModelPricing | null> {
  // Check if cache is valid
  const now = Date.now();
  if (pricingCache && (now - pricingCache.timestamp) < CACHE_DURATION) {
    return pricingCache.data[modelId] || null;
  }
  
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models');
    const data = await response.json();
    
    // Build cache from all models
    const newCache: PricingCache = {
      data: {},
      timestamp: now
    };
    
    if (data.data && Array.isArray(data.data)) {
      for (const model of data.data) {
        if (model.id && model.pricing) {
          newCache.data[model.id] = model.pricing;
        }
      }
    }
    
    pricingCache = newCache;
    return pricingCache.data[modelId] || null;
  } catch (error) {
    console.error('Failed to fetch model pricing:', error);
    // Return cached data if available, even if expired
    return pricingCache?.data[modelId] || null;
  }
}

/**
 * Prefetch model pricing to warm up the cache
 */
export async function prefetchModelPricing(): Promise<void> {
  try {
    await getModelPricing('dummy'); // This will populate the entire cache
  } catch (error) {
    console.error('Failed to prefetch model pricing:', error);
  }
}

export function __setPricingCacheForTests(data: { [modelId: string]: ModelPricing }, timestamp = Date.now()): void {
  pricingCache = {
    data,
    timestamp,
  };
}
