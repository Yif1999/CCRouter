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
    return 'anthropic/claude-3.5-haiku';
  } else if (anthropicModel.includes('sonnet')) {
    return 'anthropic/claude-sonnet-4.5';
  } else if (anthropicModel.includes('opus')) {
    return 'anthropic/claude-opus-4.1';
  }
  return anthropicModel;
}

export function formatAnthropicToOpenAI(body: MessageCreateParamsBase): any {
  const { model, messages, system = [], temperature, tools, stream, thinking } = body;

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

          anthropicMessage.content.forEach((contentPart: any) => {
            if (contentPart.type === "text") {
              contentBlocks.push({
                type: "text",
                text: typeof contentPart.text === "string"
                  ? contentPart.text
                  : JSON.stringify(contentPart.text)
              });
            } else if (contentPart.type === "image") {
              contentBlocks.push({
                type: "image_url",
                image_url: {
                  url: contentPart.source?.type === "base64"
                  ? `data:${contentPart.source.media_type || 'image/jpeg'};base64,${contentPart.source.data}` // Default media type
                  : contentPart.source?.data || contentPart.source?.url // Fallback for other source types
                }
              });
            } else if (contentPart.type === "tool_use") {
              toolCalls.push({
                id: contentPart.id,
                type: "function",
                function: {
                  name: contentPart.name,
                  arguments: JSON.stringify(contentPart.input),
                },
              });
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
          if (assistantMessage.content || (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0)) {
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
              contentBlocks.push({
                type: "image_url",
                image_url: {
                  url: contentPart.source?.type === "base64"
                  ? `data:${contentPart.source.media_type || 'image/jpeg'};base64,${contentPart.source.data}`
                  : contentPart.source?.data || contentPart.source?.url
                }
              });
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

  if (thinking && thinking.type === 'enabled') {
    data.reasoning = {
      effort: thinking.budget_tokens ? (thinking.budget_tokens > 50000 ? "high" : thinking.budget_tokens >  20000 ? "medium" : "low") : "low",
      enabled: true
    };
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
  return data;
}
