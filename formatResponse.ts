import { calculateCacheCreationTokens, getCachedModelPricing } from './pricingUtils';

function calculateUsageWithCacheCreation(usage: any, model: string) {
  const inputTokens = usage?.prompt_tokens || 0;
  const outputTokens = usage?.completion_tokens || 0;
  const cacheReadTokens = usage?.prompt_tokens_details?.cached_tokens || 0;
  const actualCost = usage?.cost;
  
  let cacheCreationTokens = 0;
  
  // If we have actual cost information, try to calculate cache creation tokens
  if (actualCost && actualCost > 0) {
    const pricing = getCachedModelPricing(model);
    if (pricing) {
      cacheCreationTokens = calculateCacheCreationTokens(
        actualCost,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        pricing
      );
    }
  }
  
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_creation_input_tokens: cacheCreationTokens,
    cache_read_input_tokens: cacheReadTokens
  };
}

export function formatOpenAIToAnthropic(completion: any, model: string): any {
  const messageId = "msg_" + Date.now();

  let content: any = [];
  if (completion.choices[0].message.content) {
    content = [{ text: completion.choices[0].message.content, type: "text" }];
  } else if (completion.choices[0].message.tool_calls) {
    content = completion.choices[0].message.tool_calls.map((item: any) => {
      return {
        type: 'tool_use',
        id: item.id,
        name: item.function?.name,
        input: item.function?.arguments ? JSON.parse(item.function.arguments) : {},
      };
    });
  }

  const result = {
    id: messageId,
    type: "message",
    role: "assistant",
    content: content,
    stop_reason: completion.choices[0].finish_reason === 'tool_calls' ? "tool_use" : "end_turn",
    stop_sequence: null,
    model,
    usage: calculateUsageWithCacheCreation(
      completion.usage,
      model
    )
  };
  return result;
}