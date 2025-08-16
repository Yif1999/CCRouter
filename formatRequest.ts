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

function isLikelyFileContent(text: any): boolean {
  // Ensure text is a string
  if (typeof text !== "string") return false;

  const lines = text.split('\n');
  const totalChars = text.length;
  const totalLines = lines.length;

  // 长文本直接认为是文件
  if (totalLines > 20) return true;

  // 空行比例过高 → 可能是自然语言
  const emptyLines = lines.filter(l => !l.trim()).length;
  if (emptyLines / totalLines > 0.4) return false;

  // 自然语言标点比例（中文/英文）
  const naturalPunctRegex = /[。！？，；：、“”‘’\.\?\!,;:"']/g;
  const naturalPunctCount = (text.match(naturalPunctRegex) || []).length;
  const naturalPunctRatio = naturalPunctCount / totalChars;
  if (naturalPunctRatio > 0.1) return false;

  // 代码/配置符号比例
  const codeSymbols = /[={}\[\];:#@\/\\|<>()+\-*&%$]/g;
  const codeSymbolCount = (text.match(codeSymbols) || []).length;
  const codeSymbolRatio = codeSymbolCount / totalChars;

  // 缩进/对齐特征（行开头空格或Tab）
  const indentedLines = lines.filter(l => /^\s+/.test(l)).length;
  const indentRatio = indentedLines / totalLines;

  // 判断逻辑
  const hasCodeStructure = codeSymbolRatio > 0.05 || indentRatio > 0.3;
  const hasUniformStructure = lines.every(l => /^\s*$|^\s*\S+\s*=/.test(l)); // 像配置文件

  return hasCodeStructure || hasUniformStructure;
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
    return 'anthropic/claude-sonnet-4';
  } else if (anthropicModel.includes('opus')) {
    return 'anthropic/claude-opus-4';
  }
  return anthropicModel;
}

export function formatAnthropicToOpenAI(body: MessageCreateParamsBase): any {
  const { model, messages, system = [], temperature, tools, stream, thinking } = body;

  let cacheControlBlocksCount = 0;
  const MAX_CACHE_CONTROL_BLOCKS = 4;

  const addCacheControl = (block: any, condition: boolean = true) => {
    if (cacheControlBlocksCount < MAX_CACHE_CONTROL_BLOCKS && condition) {
      if (model.includes('claude')) {
        block.cache_control = { "type": "ephemeral" };
        cacheControlBlocksCount++;
      }
    }
    return block;
  };

  const processContentPart = (block: any) => {
    if (block.cache_control) {
      if (cacheControlBlocksCount < MAX_CACHE_CONTROL_BLOCKS) {
        cacheControlBlocksCount++;
      } else {
        delete block.cache_control;
      }
    }
    return block;
  };

  const openAIMessages = Array.isArray(messages)
    ? messages.flatMap((anthropicMessage) => {
        const openAiMessagesFromThisAnthropicMessage: any[] = [];

        if (!Array.isArray(anthropicMessage.content)) {
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
          const contentBlocks: any[] = [];
          const toolCalls: any[] = [];

          anthropicMessage.content.forEach((contentPart) => {
            if (contentPart.type === "text") {
              const textBlock: any = {
                type: "text",
                text: typeof contentPart.text === "string"
                  ? contentPart.text
                  : JSON.stringify(contentPart.text)
              };
              const textBlock = processContentPart({
                type: "text",
                text: typeof contentPart.text === "string"
                  ? contentPart.text
                  : JSON.stringify(contentPart.text)
              });
              if (!textBlock.cache_control) {
                addCacheControl(textBlock, textBlock.text.length > 1000);
              }
              contentBlocks.push(textBlock);
            } else if (contentPart.type === "image") {
              const imageBlock = processContentPart({
                type: "image_url",
                image_url: {
                  url: contentPart.source?.type === "base64"
                  ? `data:${contentPart.source.media_type};base64,${contentPart.source.data}`
                  : contentPart.source?.data || contentPart.source?.url
                }
              });
              if (!imageBlock.cache_control) {
                addCacheControl(imageBlock);
              }
              contentBlocks.push(imageBlock);
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

          // Use content blocks format if we have cache_control, images, or mixed content
          if (contentBlocks.some(block => block.cache_control || block.type === "image_url" || contentBlocks.length > 1)) {
            assistantMessage.content = contentBlocks;
          } else if (contentBlocks.length === 1 && contentBlocks[0].type === "text") {
            // Convert to string for backward compatibility when single text block without cache_control
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

          anthropicMessage.content.forEach((contentPart) => {
            if (contentPart.type === "text") {
              const textBlock: any = {
                type: "text",
                text: typeof contentPart.text === "string"
                  ? contentPart.text
                  : JSON.stringify(contentPart.text)
              };
              const textBlock = processContentPart({
                type: "text",
                text: typeof contentPart.text === "string"
                  ? contentPart.text
                  : JSON.stringify(contentPart.text)
              });
              if (!textBlock.cache_control) {
                addCacheControl(textBlock, textBlock.text.length > 1000 || isLikelyFileContent(textBlock.text));
              }
              contentBlocks.push(textBlock);
            } else if (contentPart.type === "image") {
              const imageBlock = processContentPart({
                type: "image_url",
                image_url: {
                  url: contentPart.source?.type === "base64"
                  ? `data:${contentPart.source.media_type};base64,${contentPart.source.data}`
                  : contentPart.source?.data || contentPart.source?.url
                }
              });
              if (!imageBlock.cache_control) {
                addCacheControl(imageBlock);
              }
              contentBlocks.push(imageBlock);
            } else if (contentPart.type === "tool_result") {
              const toolMessage: any = {
                role: "tool",
                tool_call_id: contentPart.tool_use_id,
                content: typeof contentPart.content === "string"
                  ? contentPart.content
                  : JSON.stringify(contentPart.content),
              };
              addCacheControl(toolMessage, toolMessage.content.length > 500);
              subsequentToolMessages.push(toolMessage);
            }
          });

          if (contentBlocks.length > 0) {
            const userMessage: any = {
              role: "user",
              content: null
            };

            // Use content blocks format if we have cache_control, images, or mixed content
            if (contentBlocks.some(block => block.cache_control || block.type === "image_url" || contentBlocks.length > 1)) {
              userMessage.content = contentBlocks;
            } else {
              // Convert to string for backward compatibility when single text block without cache_control
              userMessage.content = contentBlocks[0].text;
            }
            
            openAiMessagesFromThisAnthropicMessage.push(userMessage);
          }
          openAiMessagesFromThisAnthropicMessage.push(...subsequentToolMessages);
        }
        return openAiMessagesFromThisAnthropicMessage;
      })
    : [];

  const systemMessages = Array.isArray(system)
    ? system.map((item) => {
        const content: any = {
          type: "text",
          text: item.text
        };
        addCacheControl(content);
        return {
          role: "system",
          content: [content]
        };
      })
    : [{
        role: "system",
        content: [addCacheControl({
          type: "text",
          text: system
        })]
      }];

  const data: any = {
    model: mapModel(model),
    messages: [...systemMessages, ...openAIMessages],
    temperature,
    stream,
    usage: {
      include: true
    }
  };

  if (thinking && thinking.type === 'enabled') {
    data.reasoning = {
      effort: thinking.budget_tokens ? (thinking.budget_tokens > 50000 ? "high" : thinking.budget_tokens >  20000 ? "medium" : "low") : "low",
      enabled: true
    };
  }

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

  // Validate OpenAI messages to ensure complete tool_calls/tool message pairing
  data.messages = [...systemMessages, ...validateOpenAIToolCalls(openAIMessages)];

  return data;
}