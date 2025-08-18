# CCRouter

A Cloudflare Worker that translates between Anthropic's Claude API and OpenAI-compatible APIs, enabling you to use Claude Code with OpenRouter and other OpenAI-compatible providers.

## ✨ Key Enhancements (This Fork)

This fork adds several important improvements over the original:

- **🔧 Accurate Cache Billing**: Reverse-engineers cache creation tokens from actual OpenRouter costs for precise billing
- **📊 Enhanced Usage Tracking**: Properly calculates and reports cache read/write tokens to match Anthropic's format
- **⚡ Maximized Cache Utilization**: Optimizes caching strategy to significantly reduce API costs
- **🛠️ Better Tool Call Handling**: Improved validation and conversion of tool calls between formats
- **🎯 Model Mapping**: Intelligent model name translation between Anthropic and OpenRouter formats
- **💰 Cost Transparency**: Real-time cost calculation based on OpenRouter's actual billing

> **Note:** For Anthropic models with heavy usage (>$200), consider using [claude-relay-service](https://github.com/Wei-Shaw/claude-relay-service) for better value.

## Quick Usage

### One-line Install (Recommended)
```bash
bash -c "$(curl -fsSL https://ccrouter.yiguanyaoyaofen.workers.dev/install.sh)"
```

This script will automatically:
- Install Node.js (if needed)
- Install Claude Code
- Configure your environment with OpenRouter or Moonshot
- Set up all necessary environment variables

### Manual Setup

**Step 1:** Install Claude Code
```bash
npm install -g @anthropic-ai/claude-code
```

**Step 2:** Get OpenRouter API key from [openrouter.ai](https://openrouter.ai)

**Step 3:** Configure environment variables in your shell config (`~/.bashrc` or `~/.zshrc`):

```bash
# For quick testing, you can use our shared instance. For daily use, deploy your own instance for better reliability.
export ANTHROPIC_BASE_URL="https://ccrouter.yiguanyaoyaofen.workers.dev"
export ANTHROPIC_AUTH_TOKEN="your-openrouter-api-key"
export ANTHROPIC_CUSTOM_HEADERS="x-api-key: $ANTHROPIC_AUTH_TOKEN"
```

**Optional:** Configure specific models (browse models at [openrouter.ai/models](https://openrouter.ai/models)):
```bash
export ANTHROPIC_MODEL="moonshotai/kimi-k2"
export ANTHROPIC_SMALL_FAST_MODEL="google/gemini-2.5-flash"
```

**Step 4:** Reload your shell and run Claude Code:
```bash
source ~/.bashrc
claude
```

That's it! Claude Code will now use OpenRouter's models through CCRouter.

### Multiple Configurations

To maintain multiple Claude Code configurations for different providers or models, use shell aliases:

```bash
# Example aliases for different configurations
alias c1='ANTHROPIC_BASE_URL="https://ccrouter.yiguanyaoyaofen.workers.dev" ANTHROPIC_AUTH_TOKEN="your-openrouter-key" ANTHROPIC_CUSTOM_HEADERS="x-api-key: $ANTHROPIC_AUTH_TOKEN" ANTHROPIC_MODEL="moonshotai/kimi-k2" ANTHROPIC_SMALL_FAST_MODEL="google/gemini-2.5-flash" claude'
alias c2='ANTHROPIC_BASE_URL="https://api.moonshot.ai/anthropic/" ANTHROPIC_AUTH_TOKEN="your-moonshot-key" ANTHROPIC_CUSTOM_HEADERS="x-api-key: $ANTHROPIC_AUTH_TOKEN" ANTHROPIC_MODEL="kimi-k2-0711-preview" ANTHROPIC_SMALL_FAST_MODEL="moonshot-v1-8k" claude'
```

Add these aliases to your shell config file (`~/.bashrc` or `~/.zshrc`), then use `c1` or `c2` to switch between configurations.

## GitHub Actions Usage

To use Claude Code in GitHub Actions workflows, add the environment variable to your workflow:

```yaml
env:
  ANTHROPIC_BASE_URL: ${{ secrets.ANTHROPIC_BASE_URL }}
```

Set `ANTHROPIC_BASE_URL` to `https://ccrouter.yiguanyaoyaofen.workers.dev` in your repository secrets.

Example workflows:
- [Interactive Claude Code](.github/workflows/claude.yml) - Responds to @claude mentions
- [Automated Code Review](.github/workflows/claude-code-review.yml) - Automatic PR reviews

## How It Works

CCRouter acts as a translation layer that:
- Accepts requests in Anthropic's API format (`/v1/messages`)
- Converts to OpenAI chat completions format with intelligent model mapping
- **Preserves cache_control metadata** for proper caching behavior
- Forwards to OpenRouter with usage tracking enabled
- **Reverse-engineers cache creation tokens** from actual billing costs
- Translates responses back to Anthropic format with accurate usage metrics

## Deployment

### Docker
```bash
git clone <repo>
cd CCRouter
docker-compose up -d
```
Service available at `http://localhost:8787`

### Cloudflare Workers
```bash
npm install -g wrangler
wrangler deploy
```

## Development
```bash
npm run dev    # Local development
npm run deploy # Deploy to Workers
```

## Thanks

Special thanks to these projects that inspired CCRouter:
- [claude-code-router](https://github.com/musistudio/claude-code-router)
- [claude-code-proxy](https://github.com/kiyo-e/claude-code-proxy)

## Disclaimer

**Important Legal Notice:**

- **Third-party Tool**: CCRouter is an independent, unofficial tool and is not affiliated with, endorsed by, or supported by Anthropic PBC, OpenAI, or OpenRouter
- **Service Terms**: Users are responsible for ensuring compliance with the Terms of Service of all involved parties (Anthropic, OpenRouter, and any other API providers)
- **API Key Responsibility**: Users must use their own valid API keys and are solely responsible for any usage, costs, or violations associated with those keys
- **No Warranty**: This software is provided "as is" without any warranties. The authors are not responsible for any damages, service interruptions, or legal issues arising from its use
- **Data Privacy**: While CCRouter does not intentionally store user data, users should review the privacy policies of all connected services
- **Compliance**: Users are responsible for ensuring their use complies with applicable laws and regulations in their jurisdiction
- **Commercial Use**: Any commercial use should be carefully evaluated against relevant terms of service and licensing requirements

**Use at your own risk and discretion.**

## License

MIT
