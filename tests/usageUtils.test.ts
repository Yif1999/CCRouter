import assert from 'node:assert/strict';
import type { CacheControlMetadata } from '../formatRequest';
import { computeUsageMetrics, type UpstreamUsage } from '../usageUtils';
import { __setPricingCacheForTests } from '../pricingUtils';

const TEST_MODEL = 'test/model';

function setPricing(promptRate: number, completionRate: number) {
  __setPricingCacheForTests({
    [TEST_MODEL]: {
      prompt: promptRate.toString(),
      completion: completionRate.toString(),
      request: '0',
      image: '0',
      audio: '0',
      web_search: '0',
      internal_reasoning: '0',
    },
  });
}

const DEFAULT_CACHE_METADATA: CacheControlMetadata = {
  ttlMode: 'ephemeral_5m',
  explicitTtls: [],
  sawEphemeralWithoutTtl: false,
  sawCacheControl: false,
  sources: [],
};

const ONE_HOUR_CACHE_METADATA: CacheControlMetadata = {
  ttlMode: 'ephemeral_1h',
  explicitTtls: ['1h'],
  sawEphemeralWithoutTtl: false,
  sawCacheControl: true,
  sources: ['test'],
};

const MIXED_CACHE_METADATA: CacheControlMetadata = {
  ttlMode: 'mixed',
  explicitTtls: ['1h', '5m'],
  sawEphemeralWithoutTtl: true,
  sawCacheControl: true,
  sources: ['test'],
};

export async function runUsageUtilsTests() {
  // Residual inference for 5m TTL
  {
    setPricing(0.000001, 0.000002);
    const usage: UpstreamUsage = {
      prompt_tokens: 1000,
      completion_tokens: 400,
      prompt_tokens_details: { cached_tokens: 200 },
      cost: 0.001745,
    };

    const result = await computeUsageMetrics({
      usage,
      model: TEST_MODEL,
      cacheMetadata: DEFAULT_CACHE_METADATA,
    });

    assert.equal(result.usage.cache_creation_input_tokens, 100);
    assert.deepEqual(result.usage.cache_creation, {
      ephemeral_5m_input_tokens: 100,
      ephemeral_1h_input_tokens: 0,
    });
    assert.equal(result.tokens.cacheCreation, 100);
    assert.ok(Math.abs(result.costs.write - 0.000125) < 1e-6);
    assert.ok(result.estimation.inferred, 'should infer cache writes');
    assert.equal(result.estimation.source, 'inferred');
  }

  // Residual inference for 1h TTL
  {
    setPricing(0.000001, 0.000002);
    const usage: UpstreamUsage = {
      prompt_tokens: 500,
      completion_tokens: 200,
      prompt_tokens_details: { cached_tokens: 0 },
      cost: 0.00102,
    };

    const result = await computeUsageMetrics({
      usage,
      model: TEST_MODEL,
      cacheMetadata: ONE_HOUR_CACHE_METADATA,
    });

    assert.equal(result.usage.cache_creation_input_tokens, 60);
    assert.deepEqual(result.usage.cache_creation, {
      ephemeral_5m_input_tokens: 0,
      ephemeral_1h_input_tokens: 60,
    });
    assert.ok(Math.abs(result.costs.write - 0.00012) < 1e-6);
    assert.ok(result.estimation.inferred, 'should infer cache writes with 1h TTL');
    assert.equal(result.estimation.source, 'inferred');
  }

  // Negative residual clamp
  {
    setPricing(0.000001, 0.000002);
    const usage: UpstreamUsage = {
      prompt_tokens: 100,
      completion_tokens: 50,
      prompt_tokens_details: { cached_tokens: 0 },
      cost: 0.00019,
    };

    const result = await computeUsageMetrics({
      usage,
      model: TEST_MODEL,
      cacheMetadata: DEFAULT_CACHE_METADATA,
    });

    assert.equal(result.usage.cache_creation_input_tokens, 0);
    assert.strictEqual(result.costs.write, 0);
    assert.ok(result.estimation.notes.includes('negative_residual_clamped'));
  }

  // Mixed TTL ambiguity path
  {
    setPricing(0.000001, 0.000002);
    const usage: UpstreamUsage = {
      prompt_tokens: 800,
      completion_tokens: 300,
      prompt_tokens_details: { cached_tokens: 100 },
      cost: 0.00141,
    };

    const result = await computeUsageMetrics({
      usage,
      model: TEST_MODEL,
      cacheMetadata: MIXED_CACHE_METADATA,
    });

    assert.equal(result.usage.cache_creation_input_tokens, 80);
    assert.equal(result.tokens.cacheCreation, 80);
    assert.strictEqual(result.usage.cache_creation, null, 'cache_creation should be null for mixed TTL');
    assert.ok(result.estimation.notes.includes('mixed_ttl_ambiguous'));
  }

  // Upstream detailed breakdown
  {
    setPricing(0.000001, 0.000002);
    const usage: UpstreamUsage = {
      prompt_tokens: 500,
      completion_tokens: 100,
      prompt_tokens_details: { cached_tokens: 50 },
      cache_creation: {
        ephemeral_5m_input_tokens: 20,
        ephemeral_1h_input_tokens: 30,
      },
      cost: 0.00074,
    };

    const result = await computeUsageMetrics({
      usage,
      model: TEST_MODEL,
      cacheMetadata: DEFAULT_CACHE_METADATA,
    });

    assert.equal(result.estimation.source, 'upstream_detailed');
    assert.strictEqual(result.estimation.inferred, false);
    assert.deepEqual(result.usage.cache_creation, {
      ephemeral_5m_input_tokens: 20,
      ephemeral_1h_input_tokens: 30,
    });
    assert.equal(result.usage.cache_creation_input_tokens, 50);
  }

  // Upstream simple total without breakdown
  {
    setPricing(0.000001, 0.000002);
    const usage: UpstreamUsage = {
      prompt_tokens: 300,
      completion_tokens: 120,
      prompt_tokens_details: { cached_tokens: 20 },
      cache_creation_input_tokens: 40,
      cost: 0.000602,
    };

    const result = await computeUsageMetrics({
      usage,
      model: TEST_MODEL,
      cacheMetadata: ONE_HOUR_CACHE_METADATA,
    });

    assert.equal(result.estimation.source, 'upstream_simple');
    assert.strictEqual(result.estimation.inferred, false);
    assert.strictEqual(result.usage.cache_creation, null);
    assert.equal(result.usage.cache_creation_input_tokens, 40);
  }

  // Rounding to nearest token
  {
    setPricing(0.000001, 0.000002);
    const baseCost = 0.0008 + 0.00002 + 0.0008; // input + read + output for prompt=1000 cached=200 completion=400
    const residual = 0.00000125 * 10.4;
    const usage: UpstreamUsage = {
      prompt_tokens: 1000,
      completion_tokens: 400,
      prompt_tokens_details: { cached_tokens: 200 },
      cost: baseCost + residual,
    };

    const result = await computeUsageMetrics({
      usage,
      model: TEST_MODEL,
      cacheMetadata: DEFAULT_CACHE_METADATA,
    });

    assert.equal(result.usage.cache_creation_input_tokens, 10);
    assert.ok(Math.abs(result.costs.write - 0.0000125) < 1e-6);
    assert.ok(result.debug.inference.writes_raw > 10);
    assert.ok(result.debug.inference.writes_raw < 11);
  }
}
