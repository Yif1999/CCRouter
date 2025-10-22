import assert from 'node:assert/strict';
import { formatAnthropicToOpenAI } from '../formatRequest';
import { formatOpenAIToAnthropic } from '../formatResponse';
import { streamOpenAIToAnthropic } from '../streamResponse';
import { __setPricingCacheForTests } from '../pricingUtils';
import type { CacheControlMetadata } from '../formatRequest';
import type { UpstreamUsage } from '../usageUtils';

const MODEL = 'anthropic/claude-haiku-4.5';
const PROMPT_RATE = 0.000001;
const COMPLETION_RATE = 0.000002;

const DEFAULT_METADATA: CacheControlMetadata = {
  ttlMode: 'ephemeral_5m',
  explicitTtls: [],
  sawEphemeralWithoutTtl: false,
  sawCacheControl: false,
  sources: [],
};

function seedPricing() {
  __setPricingCacheForTests({
    [MODEL]: {
      prompt: PROMPT_RATE.toString(),
      completion: COMPLETION_RATE.toString(),
      request: '0',
      image: '0',
      audio: '0',
      web_search: '0',
      internal_reasoning: '0',
    },
  });
}

function baseAnthropicRequest() {
  return {
    model: MODEL,
    system: [],
    messages: [] as any[],
  };
}

export async function runIntegrationTests() {
  // text-only usage mapping
  {
    seedPricing();
    const req = baseAnthropicRequest();
    req.messages.push({ role: 'user', content: [{ type: 'text', text: 'hello' }] });
    const openaiReq = formatAnthropicToOpenAI(req as any);
    const requestMeta = (openaiReq as any).__ccrouter;

    const usage: UpstreamUsage = {
      prompt_tokens: 30,
      completion_tokens: 15,
      prompt_tokens_details: { cached_tokens: 0 },
      cost: 0.00006,
    };
    const openaiResp = {
      choices: [
        {
          message: { content: 'hi there', tool_calls: undefined },
          finish_reason: 'stop',
        },
      ],
      usage,
    };

    const anthropicResp = await formatOpenAIToAnthropic(openaiResp, openaiReq.model, {
      cacheMetadata: requestMeta?.cacheMetadata,
      mode: 'openrouter',
    });

    assert.equal(anthropicResp.usage.input_tokens, 30);
    assert.equal(anthropicResp.usage.output_tokens, 15);
    assert.equal(anthropicResp.usage.cache_read_input_tokens, 0);
    assert.equal(anthropicResp.usage.cache_creation_input_tokens, 0);

    const billing = (anthropicResp as any).__ccrouterBilling;
    assert.ok(billing, 'billing metadata should be attached');
    assert.equal(billing.tokens.input, 30);
    assert.equal(billing.costs.total.toFixed(6), '0.000060');
  }

  // cache read only (no writes inferred)
  {
    seedPricing();
    const req = baseAnthropicRequest();
    req.messages.push({ role: 'user', content: [{ type: 'text', text: 'describe' }] });
    const openaiReq = formatAnthropicToOpenAI(req as any);
    const requestMeta = (openaiReq as any).__ccrouter;

    const usage: UpstreamUsage = {
      prompt_tokens: 40,
      completion_tokens: 12,
      prompt_tokens_details: { cached_tokens: 10 },
      cost: 0.000055,
    };
    const openaiResp = {
      choices: [
        {
          message: { content: 'answer', tool_calls: undefined },
          finish_reason: 'stop',
        },
      ],
      usage,
    };

    const anthropicResp = await formatOpenAIToAnthropic(openaiResp, openaiReq.model, {
      cacheMetadata: requestMeta?.cacheMetadata,
      mode: 'openrouter',
    });

    assert.equal(anthropicResp.usage.input_tokens, 30);
    assert.equal(anthropicResp.usage.cache_read_input_tokens, 10);
    assert.equal(anthropicResp.usage.cache_creation_input_tokens, 0);

    const billing = (anthropicResp as any).__ccrouterBilling;
    assert.equal(billing.costs.write, 0);
  }

  // cache write inference
  {
    seedPricing();
    const req = baseAnthropicRequest();
    req.messages.push({ role: 'user', content: [{ type: 'text', text: 'plan' }] });
    const openaiReq = formatAnthropicToOpenAI(req as any);
    const requestMeta = (openaiReq as any).__ccrouter;

    const usage: UpstreamUsage = {
      prompt_tokens: 60,
      completion_tokens: 20,
      prompt_tokens_details: { cached_tokens: 0 },
      cost: 0.00013,
    };
    const openaiResp = {
      choices: [
        {
          message: { content: 'done', tool_calls: undefined },
          finish_reason: 'stop',
        },
      ],
      usage,
    };

    const anthropicResp = await formatOpenAIToAnthropic(openaiResp, openaiReq.model, {
      cacheMetadata: requestMeta?.cacheMetadata,
      mode: 'openrouter',
    });

    assert.equal(anthropicResp.usage.cache_creation_input_tokens, 24);
    assert.deepEqual(anthropicResp.usage.cache_creation, {
      ephemeral_5m_input_tokens: 24,
      ephemeral_1h_input_tokens: 0,
    });

    const billing = (anthropicResp as any).__ccrouterBilling;
    assert.equal(billing.estimation.source, 'inferred');
  }

  // reasoning tokens preserved
  {
    seedPricing();
    const req = baseAnthropicRequest();
    req.messages.push({ role: 'user', content: [{ type: 'text', text: 'think' }] });
    const openaiReq = formatAnthropicToOpenAI(req as any);
    const requestMeta = (openaiReq as any).__ccrouter;

    const usage: UpstreamUsage = {
      prompt_tokens: 90,
      completion_tokens: 70,
      reasoning_tokens: 20,
      prompt_tokens_details: { cached_tokens: 0 },
      cost: 0.00009 + 0.00014,
    };
    const openaiResp = {
      choices: [
        {
          message: {
            content: 'final',
            reasoning_details: [{ text: 'deliberation' }],
          },
          finish_reason: 'stop',
        },
      ],
      usage,
    };

    const anthropicResp = await formatOpenAIToAnthropic(openaiResp, openaiReq.model, {
      cacheMetadata: requestMeta?.cacheMetadata,
      mode: 'openrouter',
    });

    assert.equal(anthropicResp.usage.output_tokens, 70);
    assert.equal(anthropicResp.usage.reasoning_tokens, 20);
  }

  // mixed TTL request infers writes without breakdown
  {
    seedPricing();
    const req = baseAnthropicRequest();
    req.messages.push({
      role: 'user',
      content: [
        { type: 'text', text: 'segment-a', cache_control: { type: 'ephemeral', ttl: '1h' } },
        { type: 'text', text: 'segment-b', cache_control: { type: 'ephemeral' } },
      ],
    });
    const openaiReq = formatAnthropicToOpenAI(req as any);
    const requestMeta = (openaiReq as any).__ccrouter;

    const usage: UpstreamUsage = {
      prompt_tokens: 200,
      completion_tokens: 80,
      prompt_tokens_details: { cached_tokens: 40 },
      cost: 0.000374,
    };

    const openaiResp = {
      choices: [
        {
          message: { content: 'mixed ttl result' },
          finish_reason: 'stop',
        },
      ],
      usage,
    };

    const anthropicResp = await formatOpenAIToAnthropic(openaiResp, openaiReq.model, {
      cacheMetadata: requestMeta?.cacheMetadata,
      mode: 'openrouter',
    });

    assert.ok(anthropicResp.usage.cache_creation_input_tokens > 0);
    assert.strictEqual(anthropicResp.usage.cache_creation, null);
    const billing = (anthropicResp as any).__ccrouterBilling;
    assert.ok(billing.estimation.notes.includes('mixed_ttl_ambiguous'));
  }

  // streaming finalization emits usage only at the end
  {
    seedPricing();

    const upstreamEvents = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"usage":{"prompt_tokens":60,"completion_tokens":20,"prompt_tokens_details":{"cached_tokens":10},"cost":0.00013}}\n\n',
      'data: [DONE]\n\n',
    ];

    const upstreamStream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const evt of upstreamEvents) {
          controller.enqueue(encoder.encode(evt));
        }
        controller.close();
      },
    });

    const anthropicStream = streamOpenAIToAnthropic(upstreamStream, MODEL, {
      cacheMetadata: DEFAULT_METADATA,
    });

    const reader = anthropicStream.getReader();
    const decoder = new TextDecoder();
    let output = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      output += decoder.decode(value);
    }

    const events = output.split('\n\n').filter(Boolean);
    const messageStart = events.find((evt) => evt.includes('event: message_start'));
    assert.ok(messageStart);
    assert.ok(!messageStart.includes('usage'), 'message_start should not include usage');

    const messageDeltaRaw = events.find((evt) => evt.includes('event: message_delta'));
    assert.ok(messageDeltaRaw, 'message_delta event should exist');
    const deltaPayload = JSON.parse(messageDeltaRaw.split('data: ')[1]);
    assert.equal(deltaPayload.usage.cache_read_input_tokens, 10);
    assert.equal(deltaPayload.usage.cache_creation_input_tokens, 24);
  }
}
