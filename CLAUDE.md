# CLAUDE.md

CCRouter - Enhanced Anthropic-to-OpenAI API translation layer with accurate cache billing.

## Key Enhancements (This Fork)

- **Accurate Cache Billing**: Reverse-engineers cache creation tokens from OpenRouter's actual costs
- **Enhanced Usage Tracking**: Properly reports cache read/write tokens to match Anthropic's format
- **Maximized Cache Utilization**: Optimizes caching strategy to significantly reduce API costs  
- **Intelligent Model Mapping**: Seamless translation between Anthropic and OpenRouter model names
- **Cost Transparency**: Real-time billing calculation based on actual provider costs

## Development Commands

```bash
npm run dev    # Local development server
npm run deploy # Deploy to Cloudflare Workers
docker-compose up -d  # Docker development
```

## Core Architecture

### Key Components
- **`index.ts`** - Main HTTP router and request coordinator
- **`formatRequest.ts`** - Anthropic → OpenAI format conversion with cache preservation
- **`formatResponse.ts`** - OpenAI → Anthropic conversion with accurate usage calculation
- **`streamResponse.ts`** - Real-time streaming response handling
- **`pricingUtils.ts`** - Cache creation token calculation from actual OpenRouter costs

## Key Features

- **Cache Control Preservation**: Maintains `cache_control` metadata through format conversion
- **Smart Cache Billing**: Reverse-calculates cache creation tokens from actual OpenRouter costs  
- **Model Mapping**: Intelligent translation between Anthropic and OpenRouter model names
- **Tool Call Validation**: Ensures proper pairing of tool calls and responses
- **Streaming Support**: Real-time SSE conversion with accurate usage tracking

## Environment Variables

- `OPENROUTER_BASE_URL`: Target API base URL (defaults to `https://openrouter.ai/api/v1`)