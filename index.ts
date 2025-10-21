import { Env } from './env';
import { formatAnthropicToOpenAI, BadRequestError } from './formatRequest';
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
      let openaiRequest: any;
      try {
        const anthropicRequest = await request.json();
        openaiRequest = formatAnthropicToOpenAI(anthropicRequest);
      } catch (err: any) {
        const message = err instanceof BadRequestError ? err.message : (err?.message || 'Invalid request');
        return new Response(JSON.stringify({ error: { message, type: 'invalid_request_error' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const bearerToken = request.headers.get("X-Api-Key") || 
        request.headers.get("Authorization")?.replace("Bearer ", "");

      const baseUrl = env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
      const upstreamHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${bearerToken}`,
      };
      const httpReferer = request.headers.get("HTTP-Referer");
      const xTitle = request.headers.get("X-Title");
      if (httpReferer) upstreamHeaders["HTTP-Referer"] = httpReferer;
      if (xTitle) upstreamHeaders["X-Title"] = xTitle;

      const openaiResponse = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: upstreamHeaders,
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
        const anthropicResponse = await formatOpenAIToAnthropic(openaiData, openaiRequest.model);
        
        // Add transparency headers
        const debugInfo = (globalThis as any).debugInfo;
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (debugInfo) {
          headers["X-CCRouter-Cost"] = String(debugInfo.actualCost || '0');
          headers["X-CCRouter-Model"] = debugInfo.model;
          headers["X-CCRouter-Cache-Creation"] = String(debugInfo.cacheCreationTokens || 0);
        }
        
        return new Response(JSON.stringify(anthropicResponse), { headers });
      }
    }
    
    return new Response('Not Found', { status: 404 });
  }
}