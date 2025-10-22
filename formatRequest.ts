interface MessageCreateParamsBase {
  model: string;
  messages: any[];
  system?: any;
  temperature?: number;
  tools?: any[];
  stream?: boolean;
  thinking?: {
    type: string;
    budget_tokens?: number;
  }
  // Some clients may also send max_tokens; keep loose typing
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  max_tokens?: number;
}

/**
 * Error used to signal a client-side problem with the request body (HTTP 400).
 */
export class BadRequestError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}

export type CacheTtlMode = 'ephemeral_5m' | 'ephemeral_1h' | 'mixed';

export interface CacheControlMetadata {
  ttlMode: CacheTtlMode;
  explicitTtls: Array<'5m' | '1h'>;
  sawEphemeralWithoutTtl: boolean;
  sawCacheControl: boolean;
  sources: string[];
}

function normalizeTtlRaw(ttl: unknown): '5m' | '1h' | null {
  if (typeof ttl === 'string') {
    const normalized = ttl.trim().toLowerCase();
    if (['1h', '1hr', '3600s', '3600', '60m'].includes(normalized)) {
      return '1h';
    }
    if (['5m', '5min', '300s', '300'].includes(normalized)) {
      return '5m';
    }
  } else if (typeof ttl === 'number' && Number.isFinite(ttl)) {
    if (ttl >= 3600) {
      return '1h';
    }
    if (ttl > 0) {
      return '5m';
    }
  }
  return null;
}

function collectCacheControlMetadata(body: any): CacheControlMetadata {
  const explicit = new Set<'5m' | '1h'>();
  const sources: string[] = [];
  let sawEphemeralWithoutTtl = false;
  let sawCacheControl = false;

  const recordCacheControl = (value: any, origin: string) => {
    if (!value || typeof value !== 'object') {
      return;
    }
    const cacheControl = (value as any).cache_control;
    if (!cacheControl || typeof cacheControl !== 'object') {
      return;
    }
    if ((cacheControl as any).type !== 'ephemeral') {
      return;
    }
    sawCacheControl = true;
    const ttl = normalizeTtlRaw((cacheControl as any).ttl);
    if (ttl) {
      explicit.add(ttl);
      sources.push(`${origin}:${ttl}`);
    } else {
      sawEphemeralWithoutTtl = true;
      sources.push(`${origin}:default`);
    }
  };

  const inspectContentParts = (content: any, origin: string) => {
    if (!content) {
      return;
    }
    if (Array.isArray(content)) {
      content.forEach((part, idx) => {
        if (part && typeof part === 'object') {
          recordCacheControl(part, `${origin}.content[${idx}]`);
        }
      });
    } else if (typeof content === 'object') {
      recordCacheControl(content, `${origin}.content`);
    }
  };

  if (Array.isArray(body?.system)) {
    body.system.forEach((item: any, idx: number) => {
      recordCacheControl(item, `system[${idx}]`);
      inspectContentParts(item?.content, `system[${idx}]`);
    });
  } else if (body?.system && typeof body.system === 'object') {
    recordCacheControl(body.system, 'system');
    inspectContentParts((body.system as any).content, 'system');
  }

  if (Array.isArray(body?.messages)) {
    body.messages.forEach((message: any, msgIdx: number) => {
      recordCacheControl(message, `messages[${msgIdx}]`);
      if (message && typeof message === 'object') {
        inspectContentParts(message.content, `messages[${msgIdx}]`);
      }
    });
  }

  const hasExplicit1h = explicit.has('1h');
  const hasExplicit5m = explicit.has('5m');
  const ttlMode: CacheTtlMode = hasExplicit1h && (hasExplicit5m || sawEphemeralWithoutTtl)
    ? 'mixed'
    : hasExplicit1h
      ? 'ephemeral_1h'
      : 'ephemeral_5m';

  return {
    ttlMode,
    explicitTtls: Array.from(explicit),
    sawEphemeralWithoutTtl,
    sawCacheControl,
    sources,
  };
}

/**
 * Validates OpenAI format messages to ensure complete tool_calls/tool message pairing.
 * Requires tool messages to immediately follow assistant messages with tool_calls.
 * Enforces strict immediate following sequence between tool_calls and tool messages.
 */
function validateOpenAIToolCalls(messages: any[]): any[] {
  const validatedMessages: any[] = [];
  
  for (let i = 0; i < messages.length; i++) {
    const currentMessage = { ...messages[i] };
    
    // Process assistant messages with tool_calls
    if (currentMessage.role === "assistant" && currentMessage.tool_calls) {
      const validToolCalls: any[] = [];
      const removedToolCallIds: string[] = [];
      
      // Collect all immediately following tool messages
      const immediateToolMessages: any[] = [];
      let j = i + 1;
      while (j < messages.length && messages[j].role === "tool") {
        immediateToolMessages.push(messages[j]);
        j++;
      }
      
      // For each tool_call, check if there's an immediately following tool message
      currentMessage.tool_calls.forEach((toolCall: any) => {
        const hasImmediateToolMessage = immediateToolMessages.some(toolMsg => 
          toolMsg.tool_call_id === toolCall.id
        );
        
        if (hasImmediateToolMessage) {
          validToolCalls.push(toolCall);
        } else {
          removedToolCallIds.push(toolCall.id);
        }
      });
      
      // Update the assistant message
      if (validToolCalls.length > 0) {
        currentMessage.tool_calls = validToolCalls;
      } else {
        delete currentMessage.tool_calls;
      }
      
      
      // Only include message if it has content or valid tool_calls
      if (currentMessage.content || currentMessage.tool_calls) {
        validatedMessages.push(currentMessage);
      }
    }
    
    // Process tool messages
    else if (currentMessage.role === "tool") {
      let hasImmediateToolCall = false;
      
      // Check if the immediately preceding assistant message has matching tool_call
      if (i > 0) {
        const prevMessage = messages[i - 1];
        if (prevMessage.role === "assistant" && prevMessage.tool_calls) {
          hasImmediateToolCall = prevMessage.tool_calls.some((toolCall: any) => 
            toolCall.id === currentMessage.tool_call_id
          );
        } else if (prevMessage.role === "tool") {
          // Check for assistant message before the sequence of tool messages
          for (let k = i - 1; k >= 0; k--) {
            if (messages[k].role === "tool") continue;
            if (messages[k].role === "assistant" && messages[k].tool_calls) {
              hasImmediateToolCall = messages[k].tool_calls.some((toolCall: any) => 
                toolCall.id === currentMessage.tool_call_id
              );
            }
            break;
          }
        }
      }
      
      if (hasImmediateToolCall) {
        validatedMessages.push(currentMessage);
      }
    }
    
    // For all other message types, include as-is
    else {
      validatedMessages.push(currentMessage);
    }
  }
  
  return validatedMessages;
}

export function mapModel(anthropicModel: string): string {
  // If model already contains '/', it's an OpenRouter model ID - return as-is
  if (anthropicModel.includes('/')) {
    return anthropicModel;
  }
  
  if (anthropicModel.includes('haiku')) {
    return 'anthropic/claude-haiku-4.5';
  } else if (anthropicModel.includes('sonnet')) {
    return 'anthropic/claude-sonnet-4.5';
  } else if (anthropicModel.includes('opus')) {
    return 'anthropic/claude-opus-4.1';
  }
  return anthropicModel;
}

function mapAnthropicImageToOpenAIImageUrl(contentPart: any): any {
  const src = contentPart?.source || {};
  const srcType = src?.type;
  if (!srcType) {
    throw new BadRequestError('Image block is missing source.type');
  }

  if (srcType === 'url') {
    if (!src.url || typeof src.url !== 'string') {
      throw new BadRequestError('Image source.type=url requires a valid url');
    }
    return {
      type: 'image_url',
      image_url: { url: src.url }
    };
  }

  if (srcType === 'base64') {
    const allowed = new Set(['image/jpeg','image/png','image/gif','image/webp']);
    const mediaType = src.media_type;
    if (!mediaType || typeof mediaType !== 'string' || !allowed.has(mediaType)) {
      throw new BadRequestError(`Unsupported image media_type: ${mediaType}. Supported types: image/jpeg, image/png, image/gif, image/webp.`);
    }
    if (!src.data || typeof src.data !== 'string') {
      throw new BadRequestError('Image source.type=base64 requires a base64 data string');
    }
    return {
      type: 'image_url',
      image_url: { url: `data:${mediaType};base64,${src.data}` }
    };
  }

  if (srcType === 'file') {
    throw new BadRequestError('Image source.type=file is not supported via OpenRouter /chat/completions. Please use a publicly accessible URL (source.type="url") or provide base64 data (source.type="base64").');
  }

  throw new BadRequestError(`Unsupported image source type: ${srcType}. Use "url" or "base64".`);
}

export function formatAnthropicToOpenAI(body: MessageCreateParamsBase): any {
  const { model, messages, system = [], temperature, tools, stream, thinking } = body as any;
  const cacheMetadata = collectCacheControlMetadata(body);

  const openAIMessages = Array.isArray(messages)
    ? messages.flatMap((anthropicMessage) => {
        const openAiMessagesFromThisAnthropicMessage: any[] = [];

        if (!Array.isArray(anthropicMessage.content)) {
          // For simple string content, push as-is
          if (typeof anthropicMessage.content === "string") {
            openAiMessagesFromThisAnthropicMessage.push({
              role: anthropicMessage.role,
              content: anthropicMessage.content,
            });
          }
          return openAiMessagesFromThisAnthropicMessage;
        }

        if (anthropicMessage.role === "assistant") {
          const assistantMessage: any = {
            role: "assistant",
            content: null,
          };
          const contentBlocks: any[] = []; // Use array to support mixed content/images
          const toolCalls: any[] = [];
          const reasoningDetails: any[] = [];

          anthropicMessage.content.forEach((contentPart: any) => {
            if (contentPart.type === "text") {
              contentBlocks.push({
                type: "text",
                text: typeof contentPart.text === "string"
                  ? contentPart.text
                  : JSON.stringify(contentPart.text)
              });
            } else if (contentPart.type === "image") {
              contentBlocks.push(mapAnthropicImageToOpenAIImageUrl(contentPart));
            } else if (contentPart.type === "tool_use") {
              toolCalls.push({
                id: contentPart.id,
                type: "function",
                function: {
                  name: contentPart.name,
                  arguments: JSON.stringify(contentPart.input),
                },
              });
            } else if (contentPart.type === "thinking") {
              const rd: any = { text: contentPart.text };
              if (contentPart.signature) rd.signature = contentPart.signature;
              reasoningDetails.push(rd);
            } else if (contentPart.type === "redacted_thinking") {
              const rd: any = { encrypted: true };
              reasoningDetails.push(rd);
            }
          });

          // Decide content format: array for mixed/image, string for single text
          if (contentBlocks.length > 1 || contentBlocks.some(block => block.type === "image_url")) {
            assistantMessage.content = contentBlocks;
          } else if (contentBlocks.length === 1 && contentBlocks[0].type === "text") {
            assistantMessage.content = contentBlocks[0].text;
          }
          
          if (toolCalls.length > 0) {
            assistantMessage.tool_calls = toolCalls;
          }
          if (reasoningDetails.length > 0) {
            assistantMessage.reasoning_details = reasoningDetails;
          }
          if (
            assistantMessage.content ||
            (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) ||
            assistantMessage.reasoning_details
          ) {
            openAiMessagesFromThisAnthropicMessage.push(assistantMessage);
          }
        } else if (anthropicMessage.role === "user") {
          const contentBlocks: any[] = [];
          const subsequentToolMessages: any[] = [];

          anthropicMessage.content.forEach((contentPart: any) => {
            if (contentPart.type === "text") {
              contentBlocks.push({
                type: "text",
                text: typeof contentPart.text === "string"
                  ? contentPart.text
                  : JSON.stringify(contentPart.text)
              });
            } else if (contentPart.type === "image") {
              contentBlocks.push(mapAnthropicImageToOpenAIImageUrl(contentPart));
            } else if (contentPart.type === "tool_result") {
              subsequentToolMessages.push({
                role: "tool",
                tool_call_id: contentPart.tool_use_id,
                content: typeof contentPart.content === "string"
                  ? contentPart.content
                  : JSON.stringify(contentPart.content),
              });
            }
          });

          if (contentBlocks.length > 0) {
            const userMessage: any = {
              role: "user",
              content: null
            };

            if (contentBlocks.length > 1 || contentBlocks.some(block => block.type === "image_url")) {
              userMessage.content = contentBlocks;
            } else if (contentBlocks.length === 1 && contentBlocks[0].type === "text") {
              userMessage.content = contentBlocks[0].text;
            }
            
            openAiMessagesFromThisAnthropicMessage.push(userMessage);
          }
          openAiMessagesFromThisAnthropicMessage.push(...subsequentToolMessages);
        }
        return openAiMessagesFromThisAnthropicMessage;
      })
    : [];

  // --- 核心缓存逻辑：断点 1 (静态前缀) ---
  // 这个断点放在 system 消息的末尾。
  // 根据 Anthropic 的自动前缀匹配，它会缓存从请求开始到此点的所有内容，
  // 包括在它之前的 `tools` 数组 (如果 tools 数组被包含在请求中并保持不变)。
  const systemMessages = Array.isArray(system)
    ? system.map((item, index, arr) => {
        const content: any = {
          type: "text",
          text: item.text
        };
        if (model.includes('claude') && index === arr.length - 1) { // 仅在模型是 Claude 且是系统消息的最后一个内容块时添加
          content.cache_control = {"type": "ephemeral"};
        }
        return {
          role: "system",
          content: [content]
        };
      })
    : [{
        role: "system",
        content: [{
          type: "text",
          text: system,
          // 如果 system 是字符串或单个对象，且模型是 Claude，直接添加 cache_control
          ...(model.includes('claude') ? { cache_control: {"type": "ephemeral"} } : {})
        }]
      }];

  const data: any = {
    model: mapModel(model),
    messages: [], // 将在后面填充
    temperature,
    stream,
    usage: { // 包含 usage 字段以获取 OpenRouter 的使用信息
      include: true
    }
  };

  // Map Anthropic thinking -> OpenRouter unified reasoning
  if (thinking && thinking.type === 'enabled') {
    const budget = typeof thinking.budget_tokens === 'number' ? thinking.budget_tokens : undefined;
    if (budget && budget > 0) {
      data.reasoning = { max_tokens: budget };
      // Enforce max_tokens strictly greater than reasoning budget to leave room for the final answer
      const requestedMax = (body as any).max_tokens;
      const minNeeded = budget + 512;
      if (typeof requestedMax === 'number' && isFinite(requestedMax)) {
        data.max_tokens = Math.max(requestedMax, minNeeded);
      } else {
        data.max_tokens = minNeeded;
      }
    } else {
      // If no budget provided, enable minimal reasoning by signaling low effort
      data.reasoning = { max_tokens: 256 };
      const requestedMax = (body as any).max_tokens;
      const minNeeded = 256 + 512;
      if (typeof requestedMax === 'number' && isFinite(requestedMax)) {
        data.max_tokens = Math.max(requestedMax, minNeeded);
      } else {
        data.max_tokens = minNeeded;
      }
    }
  }

  // `tools` 数组不需要自己的 cache_control，因为它会被 system 消息的断点覆盖。
  // 仅进行格式化，不添加 cache_control
  if (tools) {
    data.tools = tools.map((item: any) => ({
      type: "function",
      function: {
        name: item.name,
        description: item.description,
        parameters: item.input_schema,
      },
    }));
  }

  // 组合系统消息和转换后的 OpenAI 消息
  data.messages = [...systemMessages, ...validateOpenAIToolCalls(openAIMessages)];

  // --- 核心缓存逻辑：断点 2 (增量对话) ---
  // 这个断点放在整个消息列表的末尾，用于缓存动态变化的对话历史。
  if (data.messages.length > 0 && model.includes('claude')) { // 仅对 Claude 模型进行缓存
      const lastMessage = data.messages[data.messages.length - 1];

      // 确保最后一个消息不是系统消息（系统消息已通过断点 1 处理）
      // 并且确保它有内容可以添加 cache_control
      if (lastMessage.role !== 'system' && lastMessage.content) {
          let lastContentBlock;

          if (Array.isArray(lastMessage.content) && lastMessage.content.length > 0) {
              lastContentBlock = lastMessage.content[lastMessage.content.length - 1];
          } else if (typeof lastMessage.content === 'string') {
              // 如果最后一个消息的内容是字符串，将其视为文本块
              lastMessage.content = [{ type: 'text', text: lastMessage.content }];
              lastContentBlock = lastMessage.content[0];
          }
          // 对于 tool 消息，如果其 content 是字符串或 JSON，也可以被视为文本块来缓存
          else if (lastMessage.role === 'tool' && lastMessage.content) {
              // 假设 tool message 的 content 已经是字符串或 JSON，直接将其视为文本块
              // OpenAI 的 tool message content 通常是字符串
              lastContentBlock = { type: 'text', text: lastMessage.content }; 
          }
          // 不处理 image 或 tool_use 类型的 content，因为它们的缓存行为可能不同或不能直接标记
          // 思考块也不能直接缓存，这里也避免对它们进行操作

          if (lastContentBlock && lastContentBlock.type === 'text') {
              lastContentBlock.cache_control = { type: 'ephemeral' };
          }
      }
  }

  Object.defineProperty(data, '__ccrouter', {
    value: { cacheMetadata },
    enumerable: false,
    configurable: true,
  });

  return data;
}
