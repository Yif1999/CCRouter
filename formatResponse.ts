import { calculateCacheCreationTokens, getCachedModelPricing } from './pricingUtils';

function calculateUsageWithCacheCreation(usage: any, model: string) {
  const inputTokens = usage?.prompt_tokens || 0;
  const outputTokens = usage?.completion_tokens || 0;
  const cacheReadTokens = usage?.prompt_tokens_details?.cached_tokens || 0;
  const actualCost = usage?.cost;
  
  let cacheCreationTokens = 0;
  
  // Debug info - will be exposed via response headers
  const debugInfo: any = {
    actualCost,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    model,
    usageRaw: JSON.stringify(usage)
  };
  
  // If we have actual cost information, try to calculate cache creation tokens
  if (actualCost && actualCost > 0) {
    const pricing = getCachedModelPricing(model);
    debugInfo.pricing = pricing;
    if (pricing) {
      cacheCreationTokens = calculateCacheCreationTokens(
        actualCost,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        pricing
      );
      debugInfo.cacheCreationTokens = cacheCreationTokens;
    }
  }
  
  // Store debug info globally for access in response
  (globalThis as any).debugInfo = debugInfo;
  
  return {
    input_tokens: inputTokens - cacheReadTokens, // Exclude cache read tokens from input
    output_tokens: outputTokens,
    cache_creation_input_tokens: cacheCreationTokens,
    cache_read_input_tokens: cacheReadTokens
  };
}

export function formatOpenAIToAnthropic(completion: any, model: string): any {
  const messageId = "msg_" + Date.now();

  let content: any = [];
  
  // Add web search annotations if present
  if (completion.choices[0].message.annotations) {
    const searchId = `srvtoolu_${Date.now()}`;
    content.push({
      type: "server_tool_use",
      id: searchId,
      name: "web_search",
      input: { query: ""}
    });
    content.push({
      type: "web_search_tool_result",
      tool_use_id: searchId,
      content: completion.choices[0].message.annotations.map((annotation: any) => ({
        type: "web_search_result",
        url: annotation.url_citation?.url || annotation.url,
        title: annotation.url_citation?.title || annotation.title
      }))
    });
  }

  // Add text content if present
  if (completion.choices[0].message.content) {
    content.push({ 
      type: "text", 
      text: completion.choices[0].message.content 
    });
  }
  
  // Add tool calls if present (can coexist with text content)
  if (completion.choices[0].message.tool_calls) {
    const toolUses = completion.choices[0].message.tool_calls.map((item: any) => {
      let parsedInput = {};
      try {
        parsedInput = item.function?.arguments ? JSON.parse(item.function.arguments) : {};
      } catch (e) {
        console.warn('Failed to parse tool call arguments:', item.function?.arguments);
        parsedInput = {};
      }
      
      return {
        type: 'tool_use',
        id: item.id,
        name: item.function?.name,
        input: parsedInput,
      };
    });
    content.push(...toolUses);
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