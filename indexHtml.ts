import { faviconDataUrl } from './faviconServer';

export const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CCRouter</title>
<link rel="shortcut icon" type="image/svg+xml" href="${faviconDataUrl}">
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
        color: #1d1d1f;
        background: linear-gradient(135deg, #e1d7cdff, #e9e8e6ff);
        min-height: 100vh;
        padding: 20px;
        overflow-x: hidden;
    }
    #bgCanvas {
        position: fixed;
        top: 0; left: 0;
        width: 100%; height: 100%;
        z-index: -1;
    }

    .container {
        max-width: 900px;
        margin: 0 auto;
        background: rgba(255, 255, 255, 0.45);
        backdrop-filter: blur(30px) saturate(180%);
        -webkit-backdrop-filter: blur(30px) saturate(180%);
        border-radius: 24px;
        box-shadow: 0 4px 30px rgba(0,0,0,0.06),
                    inset 0 1px 0 rgba(255,255,255,0.4);
        border: 1px solid rgba(255,255,255,0.3);
    }
    .header {
        position: relative;
        background: linear-gradient(160deg, rgba(255, 127, 42, 1), rgba(251, 140, 37, 0.9));
        padding: 50px 20px;
        color: white;
        border-bottom: 1px solid rgba(255, 255, 255, 0.2);
        text-align: center;
        text-shadow: 0 1px 2px rgba(0,0,0,0.15);
        border-radius: 24px 24px 0 0;
    }
    .header h1 { font-size: 2.4em; font-weight: 600; margin-bottom: 8px; }
    .content {
        padding: 30px;
        opacity: 0;
        transform: translateY(40px) scale(0.97);
        animation: slideInUp 0.45s cubic-bezier(.25,.8,.25,1) forwards;
    }
    @keyframes slideInUp {
        to {
            opacity: 1;
            transform: translateY(0) scale(1);
        }
    }
.step {
    background: rgba(255,255,255,0.65);
    border-left: 4px solid #FF7A00;
    border-radius: 0 16px 16px 0;
    backdrop-filter: blur(20px);
    margin-bottom: 30px;
    padding: 20px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.05);

    transition: transform 0.18s cubic-bezier(.25,1.7,.45,.9),
                box-shadow 0.18s;
    will-change: transform;
}

.step:hover {
    transform: scale(1.02);
    box-shadow: 0 12px 32px rgba(0,0,0,.08);
}

    .step:nth-child(1) { animation-delay: 0.1s; }
    .step:nth-child(2) { animation-delay: 0.3s; }
    .step:nth-child(3) { animation-delay: 0.5s; }
    .step:nth-child(4) { animation-delay: 0.7s; }
    @keyframes dockBounce {
        0%   { transform: translateY(30px) scale(0.95); opacity: 0; }
        60%  { transform: translateY(-8px) scale(1.02); opacity: 1; }
        80%  { transform: translateY(4px) scale(0.99); }
        100% { transform: translateY(0) scale(1); opacity: 1; }
    }
    .step h2 {
        display: flex; align-items: center;
        font-size: 1.3em; margin-bottom: 15px;
    }
    .step-number {
        background: #FF7A00;
        color: white;
        width: 28px; height: 28px;
        border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        margin-right: 15px;
        font-weight: bold;
        font-size: 0.9em;
        box-shadow: 0 2px 6px rgba(255,122,0,0.4);
    }
    .code-block {
        background: rgba(30,41,59,0.9);
        color: #f3f4f6;
        padding: 15px;
        border-radius: 8px;
        font-family: 'Menlo', monospace;
        margin: 10px 0;
        overflow-x: auto;
        font-size: 0.9em;
        position: relative;
        line-height: 1.8;  
    }
    .copy-button {
        position: absolute;
        top: 10px; right: 10px;
        background: linear-gradient(to bottom, #FF7A00, #E56700);
        border-radius: 999px;
        border: none;
        padding: 7px 14px;
        color: white;
        font-size: 0.8em;
        font-weight: 500;
        cursor: pointer;
        box-shadow: 0 2px 6px rgba(255,122,0,0.3);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.15s ease-out;
    }
    .copy-button:hover { transform: scale(1.05); }
    .copy-button:active { transform: scale(0.92); }
    .copy-button.copied {
        background: linear-gradient(to bottom, #34C759, #28A745);
    }
    .note {
        background: rgba(255,247,237,0.8);
        border: 1px solid #fed7aa;
        color: #FF7A00;
        padding: 10px;
        border-radius: 8px;
        margin: 0px 0;
        font-size: 0.9em;
    }
    .success {
        background: linear-gradient(45deg, rgba(255,122,0,0.9), rgba(234,88,12,0.9));
        color: white;
        padding: 25px;
        border-radius: 16px;
        text-align: center;
        margin: 30px 0;
        box-shadow: 0 6px 20px rgba(255,122,0,0.4);
    }
    .success-green {
        background: linear-gradient(45deg, rgba(52,199,89,0.95), rgba(48,209,88,0.95));
        box-shadow: 0 6px 20px rgba(52,199,89,0.4);
    }
    .footer-links {
        text-align: center;
        padding: 15px;
        background: rgba(255, 255, 255, 0.5);
        backdrop-filter: blur(10px);
        border-top: 1px solid rgba(0,0,0,0.05);
        border-radius: 0 0 24px 24px;
        font-size: 0.9em;
        line-height: 1.5;  
    }
    .footer-links a {
        color: #6c757d;
        text-decoration: none;
        margin: 0 15px;
    }
    .footer-links a:hover { color: #FF7A00; }
</style>
</head>
<body>
<canvas id="bgCanvas"></canvas>
<div class="container">
    <div class="header">
        <h1>🔗 CCRouter</h1>
        <p>Connect Claude Code with OpenRouter and beyond !!!!!</p>
    </div>
    <div class="content">
        <div class="step">
            <h2><span class="step-number">⚡</span>One-line Install (Recommended)</h2>
            <div class="code-block">
                bash -c "$(curl -fsSL https://ccrouter.yiguanyaoyaofen.workers.dev/install.sh)"
                <button class="copy-button" onclick="copyToClipboard(this, 'bash -c &quot;$(curl -fsSL https://ccrouter.yiguanyaoyaofen.workers.dev/install.sh)&quot;')">Copy</button>
            </div>
            <div class="note">This script will automatically install Node.js, Claude Code, and configure your environment with OpenRouter or Moonshot</div>
        </div>
        <div class="step">
            <h2><span class="step-number">1</span>Manual: Install Claude Code</h2>
            <div class="code-block">
                npm install -g @anthropic-ai/claude-code
                <button class="copy-button" onclick="copyToClipboard(this, 'npm install -g @anthropic-ai/claude-code')">Copy</button>
            </div>
            <div class="note">Or download from <a href="https://claude.ai/code" target="_blank">claude.ai/code</a></div>
        </div>
        <div class="step">
            <h2><span class="step-number">2</span>Manual: Get OpenRouter API Key</h2>
            <p>Sign up at <a href="https://openrouter.ai" target="_blank">openrouter.ai</a> and get your API key</p>
        </div>
        <div class="step">
            <h2><span class="step-number">3</span>Manual: Configure</h2>
            <p>Add these to your shell config (<code>~/.bashrc</code> or <code>~/.zshrc</code>):</p>
            <div class="code-block">
                export ANTHROPIC_BASE_URL="https://ccrouter.yiguanyaoyaofen.workers.dev"<br>
                export ANTHROPIC_AUTH_TOKEN="your-openrouter-api-key"
                <button class="copy-button" onclick="copyToClipboard(this, 'export ANTHROPIC_BASE_URL=&quot;https://ccrouter.yiguanyaoyaofen.workers.dev&quot;\\nexport ANTHROPIC_AUTH_TOKEN=&quot;your-openrouter-api-key&quot;')">Copy</button>
            </div>
            <p><strong>Optional:</strong> Configure specific models (browse at <a href="https://openrouter.ai/models" target="_blank">openrouter.ai/models</a>):</p>
            <div class="code-block">
                export ANTHROPIC_MODEL="moonshotai/kimi-k2"<br>
                export ANTHROPIC_SMALL_FAST_MODEL="google/gemini-2.5-flash"
                <button class="copy-button" onclick="copyToClipboard(this, 'export ANTHROPIC_MODEL=&quot;moonshotai/kimi-k2&quot;\\nexport ANTHROPIC_SMALL_FAST_MODEL=&quot;google/gemini-2.5-flash&quot;')">Copy</button>
            </div>
            <p>Then reload your shell:</p>
            <div class="code-block">
                source ~/.bashrc
                <button class="copy-button" onclick="copyToClipboard(this, 'source ~/.bashrc')">Copy</button>
            </div>
        </div>
        <div class="success success-green">
            <h2>🎉 Ready to go!</h2>
            <p>Run <code>claude</code> in your terminal and enjoy access to Claude models</p>
        </div>
        <div class="note">
            <p><strong>For data privacy:</strong> Consider self-deploying CCRouter to Cloudflare Workers instead of using this shared instance.</p>
        </div>
    </div>
    <div class="footer-links">
        <a href="https://github.com/Yif1999/CCRouter" target="_blank">CCRouter</a>
        <a href="https://openrouter.ai" target="_blank">OpenRouter</a>
        <a href="https://claude.ai/code" target="_blank">Claude Code</a>
        <a href="https://github.com/Yif1999/CCRouter" target="_blank">GitHub</a>
        <br>
        <a href="/terms">Terms</a>
        <a href="/privacy">Privacy</a>
    </div>
</div>
<script>
function copyToClipboard(button, text) {
    navigator.clipboard.writeText(text).then(() => {
        button.textContent = 'Copied!';
        button.classList.add('copied');
        setTimeout(() => {
            button.textContent = 'Copy';
            button.classList.remove('copied');
        }, 2000);
    });
}
// 浅色玻璃风格背景
const canvas = document.getElementById('bgCanvas');
const ctx = canvas.getContext('2d');
let width, height;
function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();
const blobs = Array.from({length: 6}, () => ({
    x: Math.random(),
    y: Math.random(),
    r: 100 + Math.random()*200,
    dx: (Math.random() - 0.5) * 0.0005,
    dy: (Math.random() - 0.5) * 0.0005,
    color: \`hsla(\${Math.random()*60 + 20}, 90%, 80%, 0.4)\`

}));
function animate() {
    ctx.clearRect(0,0,width,height);
    blobs.forEach(b => {
        b.x += b.dx; b.y += b.dy;
        if (b.x<0||b.x>1) b.dx*=-1;
        if (b.y<0||b.y>1) b.dy*=-1;
        const gx = b.x * width;
        const gy = b.y * height;
        const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, b.r);
        grad.addColorStop(0, b.color);
        grad.addColorStop(1, 'rgba(253, 252, 251, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(gx, gy, b.r, 0, Math.PI*2);
        ctx.fill();
    });
    requestAnimationFrame(animate);
}
animate();
</script>
</body>
</html>`;
