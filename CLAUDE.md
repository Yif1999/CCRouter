# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CCRouter is a Cloudflare Worker that acts as a translation layer between Anthropic's Claude API and OpenAI-compatible APIs (primarily OpenRouter). It allows Claude Code to work with various language models through a unified interface.

## Development Commands

### Local Development
```bash
npm run dev    # Start Wrangler development server on localhost:8787
npm run deploy # Deploy to Cloudflare Workers
```

### Docker Development
```bash
docker-compose up -d        # Start services in background
docker-compose down         # Stop and remove containers
docker-compose logs         # View logs
docker-compose restart      # Restart services
```

### Testing
Tests are written as standalone Node.js scripts:
```bash
node test_cache_simple.js           # Test cache_control preservation logic
node test_cache_preservation.js     # Integration test for cache_control
```

## Core Architecture

The application consists of several key modules that handle API translation:

### Main Entry Point (`index.ts`)
- Handles HTTP routing for `/v1/messages`, `/install.sh`, `/`, `/terms`, `/privacy`
- Coordinates request/response conversion between Anthropic and OpenAI formats
- Manages both streaming and non-streaming responses
- Integrates pricing calculation and usage tracking

### Request Translation (`formatRequest.ts`)
- Converts Anthropic API format to OpenAI chat completions format
- Handles model mapping (e.g., `claude-3-5-sonnet` → `anthropic/claude-sonnet-4`)
- Preserves cache_control fields when present in message content
- Validates and normalizes tool calls between formats
- Implements system message handling with ephemeral caching for Claude models

### Response Translation (`formatResponse.ts`)
- Converts OpenAI responses back to Anthropic format
- Calculates accurate usage metrics including cache creation tokens
- Handles both text and tool_use content types

### Stream Processing (`streamResponse.ts`)
- Handles real-time streaming of OpenAI server-sent events to Anthropic format
- Manages content block transitions (text ↔ tool_use)
- Preserves usage information and cost data from streaming responses
- Implements proper SSE event sequencing for Anthropic's message format

### Pricing & Billing (`pricingUtils.ts`)
- Fetches and caches model pricing from OpenRouter API (1-hour cache)
- Reverse-engineers cache creation token counts from actual usage costs
- Supports accurate billing calculation for cache read/write operations

## Key Technical Details

### Cache Control Handling
The system preserves Anthropic's `cache_control` metadata:
- Content blocks with `cache_control` are kept in array format
- System messages automatically get ephemeral caching for Claude models
- Cache creation tokens are calculated from OpenRouter's actual billing data

### Model Mapping
- Models with `/` (e.g., `moonshotai/kimi-k2`) are passed through unchanged
- Anthropic model names are mapped to OpenRouter equivalents
- System supports both official Anthropic models and third-party alternatives

### Tool Call Validation
- Ensures tool_calls and tool messages are properly paired
- Removes orphaned tool calls that lack corresponding tool result messages
- Maintains message sequence integrity during conversion

## Environment Variables

- `OPENROUTER_BASE_URL`: Target API base URL (defaults to `https://openrouter.ai/api/v1`)

## File Structure

- `index.ts` - Main worker entry point and routing
- `formatRequest.ts` - Anthropic → OpenAI format conversion
- `formatResponse.ts` - OpenAI → Anthropic format conversion  
- `streamResponse.ts` - Real-time streaming response handling
- `pricingUtils.ts` - Model pricing and usage calculation
- `env.ts` - TypeScript environment interface
- `wrangler.toml` - Cloudflare Workers configuration
- `docker-compose.yml` - Docker deployment configuration