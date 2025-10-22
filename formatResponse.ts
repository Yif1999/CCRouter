import type { CacheControlMetadata } from './formatRequest';
import { computeUsageMetrics } from './usageUtils';

export async function formatOpenAIToAnthropic(
  completion: any,
  model: string,
  options?: {
    cacheMetadata?: CacheControlMetadata;
    mode?: 'anthropic' | 'openrouter';
  }
): Promise<any> {
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

  // Add reasoning details (thinking) if present, preserving order
  const message = completion.choices[0].message || {};
  const rd = message.reasoning_details;
  if (Array.isArray(rd)) {
    for (const item of rd) {
      if (item?.encrypted || item?.type === 'redacted') {
        content.push({ type: 'redacted_thinking' });
      } else if (typeof item?.text === 'string') {
        const thinkingBlock: any = { type: 'thinking', text: item.text };
        if (item.signature) thinkingBlock.signature = item.signature;
        content.push(thinkingBlock);
      }
    }
  } else if (typeof message.reasoning === 'string' && message.reasoning.length > 0) {
    // Fallback for simple reasoning text
    content.push({ type: 'thinking', text: message.reasoning });
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

  const billing = await computeUsageMetrics({
    usage: completion.usage,
    model,
    cacheMetadata: options?.cacheMetadata,
  });

  const result = {
    id: messageId,
    type: "message",
    role: "assistant",
    content: content,
    stop_reason: completion.choices[0].finish_reason === 'tool_calls' ? "tool_use" : "end_turn",
    stop_sequence: null,
    model,
    usage: billing.usage,
  };

  Object.defineProperty(result, '__ccrouterBilling', {
    value: {
      ...billing,
      mode: options?.mode ?? 'openrouter',
    },
    enumerable: false,
    configurable: true,
  });

  return result;
}
