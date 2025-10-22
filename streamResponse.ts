import type { CacheControlMetadata } from './formatRequest';
import { computeUsageMetrics, type UpstreamUsage } from './usageUtils';

export function streamOpenAIToAnthropic(
  openaiStream: ReadableStream,
  model: string,
  options?: {
    cacheMetadata?: CacheControlMetadata;
  }
): ReadableStream {
  const messageId = "msg_" + Date.now();

  const enqueueSSE = (controller: ReadableStreamDefaultController, eventType: string, data: any) => {
    const sseMessage = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    controller.enqueue(new TextEncoder().encode(sseMessage));
  };

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalReasoningTokens = 0;
  let totalCacheReadTokens = 0;
  let actualCost: number | null = null;
  let latestUsage: any = null;

  return new ReadableStream({
    async start(controller) {
      // Send message_start event
      const messageStart = {
        type: "message_start",
        message: {
          id: messageId,
          type: "message",
          role: "assistant",
          content: [],
          model,
          stop_reason: null,
          stop_sequence: null,
        },
      };
      enqueueSSE(controller, "message_start", messageStart);

      let contentBlockIndex = 0;
      let hasStartedTextBlock = false;
      let hasStartedThinkingBlock = false;
      let isToolUse = false;
      let currentToolCallId: string | null = null;
      let toolCallJsonMap = new Map<string, string>();
      let hasProcessedAnnotations = false;

      const reader = openaiStream.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // Process any remaining data in buffer
            if (buffer.trim()) {
              const lines = buffer.split('\n');
              for (const line of lines) {
                if (line.trim() && line.startsWith('data: ')) {
                  const data = line.slice(6).trim();
                  if (data === '[DONE]') continue;

                  try {
                    const parsed = JSON.parse(data);
                    const delta = parsed.choices?.[0]?.delta;
                    if (delta) {
                      processStreamDelta(delta);
                    }
                    // Extract usage information if available
                    if (parsed.usage) {
                      latestUsage = parsed.usage;
                      totalInputTokens = parsed.usage.prompt_tokens ?? totalInputTokens;
                      totalOutputTokens = parsed.usage.completion_tokens ?? totalOutputTokens;
                      totalReasoningTokens = parsed.usage.reasoning_tokens ?? totalReasoningTokens;
                      totalCacheReadTokens = parsed.usage.prompt_tokens_details?.cached_tokens ?? totalCacheReadTokens;
                      if (parsed.usage.cost !== undefined && parsed.usage.cost !== null) {
                        actualCost = parsed.usage.cost;
                      }
                    }
                  } catch (e) {
                    // Parse error
                  }
                }
              }
            }
            break;
          }

          // Decode chunk and add to buffer
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;

          // Process complete lines from buffer
          const lines = buffer.split('\n');
          // Keep the last potentially incomplete line in buffer
          buffer = lines.pop() || '';

          // Process complete lines in order
          for (const line of lines) {
            if (line.trim() && line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta;

                // Extract usage information if available
                if (parsed.usage) {
                  latestUsage = parsed.usage;
                  totalInputTokens = parsed.usage.prompt_tokens ?? totalInputTokens;
                  totalOutputTokens = parsed.usage.completion_tokens ?? totalOutputTokens;
                  totalReasoningTokens = parsed.usage.reasoning_tokens ?? totalReasoningTokens;
                  totalCacheReadTokens = parsed.usage.prompt_tokens_details?.cached_tokens ?? totalCacheReadTokens;
                  if (parsed.usage.cost !== undefined && parsed.usage.cost !== null) {
                    actualCost = parsed.usage.cost;
                  }
                }

                if (!delta) continue;
                processStreamDelta(delta);
              } catch (e) {
                // Parse error
                continue;
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      function processStreamDelta(delta: any) {

        // Handle reasoning (thinking) deltas first to preserve sequence
        if (delta.reasoning || delta.reasoning_details) {
          // Close any open tool/text block before starting thinking
          if (!hasStartedThinkingBlock) {
            if (isToolUse || hasStartedTextBlock) {
              enqueueSSE(controller, "content_block_stop", {
                type: "content_block_stop",
                index: contentBlockIndex,
              });
              isToolUse = false;
              hasStartedTextBlock = false;
              contentBlockIndex++;
            }
          }

          // Process structured reasoning_details if provided
          if (Array.isArray(delta.reasoning_details)) {
            for (const item of delta.reasoning_details) {
              if (item?.encrypted || item?.type === 'redacted' || item?.type === 'summary') {
                // Close any open thinking block
                if (hasStartedThinkingBlock) {
                  enqueueSSE(controller, "content_block_stop", {
                    type: "content_block_stop",
                    index: contentBlockIndex,
                  });
                  hasStartedThinkingBlock = false;
                  contentBlockIndex++;
                }
                // Start and stop a redacted_thinking block at current index
                enqueueSSE(controller, "content_block_start", {
                  type: "content_block_start",
                  index: contentBlockIndex,
                  content_block: { type: 'redacted_thinking' },
                });
                enqueueSSE(controller, "content_block_stop", {
                  type: "content_block_stop",
                  index: contentBlockIndex,
                });
                // Prepare next index for any subsequent block
                contentBlockIndex++;
              } else if (typeof item?.text === 'string' && item.text.length > 0) {
                if (!hasStartedThinkingBlock) {
                  enqueueSSE(controller, "content_block_start", {
                    type: "content_block_start",
                    index: contentBlockIndex,
                    content_block: { type: "thinking", text: "" },
                  });
                  hasStartedThinkingBlock = true;
                }
                enqueueSSE(controller, "content_block_delta", {
                  type: "content_block_delta",
                  index: contentBlockIndex,
                  delta: { type: "text_delta", text: item.text },
                });
              }
            }
          }

          // Process simple reasoning text
          if (typeof delta.reasoning === 'string' && delta.reasoning.length > 0) {
            if (!hasStartedThinkingBlock) {
              enqueueSSE(controller, "content_block_start", {
                type: "content_block_start",
                index: contentBlockIndex,
                content_block: { type: "thinking", text: "" },
              });
              hasStartedThinkingBlock = true;
            }
            enqueueSSE(controller, "content_block_delta", {
              type: "content_block_delta",
              index: contentBlockIndex,
              delta: { type: "text_delta", text: delta.reasoning },
            });
          }
        }

        // Handle tool calls
        if (delta.tool_calls?.length > 0) {
          // Close thinking block before switching to tool
          if (hasStartedThinkingBlock) {
            enqueueSSE(controller, "content_block_stop", {
              type: "content_block_stop",
              index: contentBlockIndex,
            });
            hasStartedThinkingBlock = false;
            contentBlockIndex++;
          }
          // Existing tool call logic
          for (const toolCall of delta.tool_calls) {
            const toolCallId = toolCall.id;

            if (toolCallId && toolCallId !== currentToolCallId) {
              if (isToolUse || hasStartedTextBlock) {
                enqueueSSE(controller, "content_block_stop", {
                  type: "content_block_stop",
                  index: contentBlockIndex,
                });
              }

              isToolUse = true;
              hasStartedTextBlock = false; // Reset text block flag
              currentToolCallId = toolCallId;
              contentBlockIndex++;
              toolCallJsonMap.set(toolCallId, "");

              const toolBlock = {
                type: "tool_use",
                id: toolCallId,
                name: toolCall.function?.name,
                input: {},
              };

              enqueueSSE(controller, "content_block_start", {
                type: "content_block_start",
                index: contentBlockIndex,
                content_block: toolBlock,
              });
            }

            if (toolCall.function?.arguments && currentToolCallId) {
              const currentJson = toolCallJsonMap.get(currentToolCallId) || "";
              toolCallJsonMap.set(currentToolCallId, currentJson + toolCall.function.arguments);

              enqueueSSE(controller, "content_block_delta", {
                type: "content_block_delta",
                index: contentBlockIndex,
                delta: {
                  type: "input_json_delta",
                  partial_json: toolCall.function.arguments,
                },
              });
            }
          }
        } else if (delta.content) {
          // Close thinking block before text
          if (hasStartedThinkingBlock) {
            enqueueSSE(controller, "content_block_stop", {
              type: "content_block_stop",
              index: contentBlockIndex,
            });
            hasStartedThinkingBlock = false;
            contentBlockIndex++;
          }
          if (isToolUse) {
            enqueueSSE(controller, "content_block_stop", {
              type: "content_block_stop",
              index: contentBlockIndex,
            });
            isToolUse = false; // Reset tool use flag
            currentToolCallId = null;
            contentBlockIndex++; // Increment for new text block
          }

          if (!hasStartedTextBlock) {
            enqueueSSE(controller, "content_block_start", {
              type: "content_block_start",
              index: contentBlockIndex,
              content_block: {
                type: "text",
                text: "",
              },
            });
            hasStartedTextBlock = true;
          }

          enqueueSSE(controller, "content_block_delta", {
            type: "content_block_delta",
            index: contentBlockIndex,
            delta: {
              type: "text_delta",
              text: delta.content,
            },
          });
        }
        if (delta.annotations && !hasProcessedAnnotations) {
          hasProcessedAnnotations = true;

          // Close current content block if needed
          if (isToolUse || hasStartedTextBlock || hasStartedThinkingBlock) {
            enqueueSSE(controller, "content_block_stop", {
              type: "content_block_stop",
              index: contentBlockIndex,
            });
            isToolUse = false;
            hasStartedTextBlock = false;
            hasStartedThinkingBlock = false;
            contentBlockIndex++;
          }

          // Add web search results
          for (const annotation of delta.annotations) {
            const searchId = `srvtoolu_${Date.now()}_${contentBlockIndex}`;

            enqueueSSE(controller, "content_block_start", {
              type: "content_block_start",
              index: contentBlockIndex,
              content_block: {
                type: "web_search_tool_result",
                tool_use_id: searchId,
                content: [{
                  type: "web_search_result",
                  url: annotation.url_citation?.url || annotation.url,
                  title: annotation.url_citation?.title || annotation.title
                }]
              }
            });
            enqueueSSE(controller, "content_block_stop", {
              type: "content_block_stop",
              index: contentBlockIndex,
            });

            contentBlockIndex++;
          }
        }
      }

      // Close last content block
      if (isToolUse || hasStartedTextBlock || hasStartedThinkingBlock) {
        enqueueSSE(controller, "content_block_stop", {
          type: "content_block_stop",
          index: contentBlockIndex,
        });
      }

      // Send message_delta and message_stop
      const fallbackUsage: UpstreamUsage = {
        prompt_tokens: totalInputTokens,
        completion_tokens: totalOutputTokens,
        reasoning_tokens: totalReasoningTokens,
        prompt_tokens_details: {
          cached_tokens: totalCacheReadTokens,
        },
      };
      if (actualCost !== null) {
        fallbackUsage.cost = actualCost;
      }

      const billing = await computeUsageMetrics({
        usage: latestUsage ?? fallbackUsage,
        model,
        cacheMetadata: options?.cacheMetadata,
      });

      enqueueSSE(controller, "message_delta", {
        type: "message_delta",
        delta: {
          stop_reason: isToolUse ? "tool_use" : "end_turn",
          stop_sequence: null,
        },
        usage: billing.usage,
      });

      enqueueSSE(controller, "message_stop", {
        type: "message_stop",
      });

      controller.close();
    },
  });
}