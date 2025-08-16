import { Env } from './env';
import { formatAnthropicToOpenAI } from './formatRequest';
import { streamOpenAIToAnthropic } from './streamResponse';
import { formatOpenAIToAnthropic } from './formatResponse';
import { indexHtml } from './indexHtml';
import { termsHtml } from './termsHtml';
import { privacyHtml } from './privacyHtml';
import { installSh } from './installSh';
import { prefetchModelPricing } from './pricingUtils';

// Prefetch model pricing on startup
prefetchModelPricing().catch(console.error);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    if (url.pathname === '/' && request.method === 'GET') {
      return new Response(indexHtml, {
        headers: { "Content-Type": "text/html" }
      });
    }
    
    if (url.pathname === '/terms' && request.method === 'GET') {
      return new Response(termsHtml, {
        headers: { "Content-Type": "text/html" }
      });
    }
    
    if (url.pathname === '/privacy' && request.method === 'GET') {
      return new Response(privacyHtml, {
        headers: { "Content-Type": "text/html" }
      });
    }
    
    if (url.pathname === '/install.sh' && request.method === 'GET') {
      return new Response(installSh, {
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }
    
    if (url.pathname === '/v1/messages' && request.method === 'POST') {
      const anthropicRequest = await request.json();
      const openaiRequest = formatAnthropicToOpenAI(anthropicRequest);
      const bearerToken = request.headers.get("X-Api-Key") || 
        request.headers.get("Authorization")?.replace("Bearer ", "");

      const baseUrl = env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
      const openaiResponse = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${bearerToken}`,
        },
        body: JSON.stringify(openaiRequest),
      });

      if (!openaiResponse.ok) {
        return new Response(await openaiResponse.text(), { status: openaiResponse.status });
      }

      if (openaiRequest.stream) {
        const anthropicStream = streamOpenAIToAnthropic(openaiResponse.body as ReadableStream, openaiRequest.model);
        return new Response(anthropicStream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          },
        });
      } else {
        const openaiData = await openaiResponse.json();
        const anthropicResponse = formatOpenAIToAnthropic(openaiData, openaiRequest.model);
        
        // Add debug headers
        const debugInfo = (globalThis as any).debugInfo;
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (debugInfo) {
          headers["X-Debug-ActualCost"] = String(debugInfo.actualCost || 'undefined');
          headers["X-Debug-InputTokens"] = String(debugInfo.inputTokens);
          headers["X-Debug-CacheRead"] = String(debugInfo.cacheReadTokens);
          headers["X-Debug-Model"] = debugInfo.model;
          headers["X-Debug-CacheCreation"] = String(debugInfo.cacheCreationTokens || 0);
          if (debugInfo.pricing) {
            headers["X-Debug-CacheWritePrice"] = String(debugInfo.pricing.input_cache_write || 'undefined');
          }
        }
        
        return new Response(JSON.stringify(anthropicResponse), { headers });
      }
    }
    
    return new Response('Not Found', { status: 404 });
  }
}