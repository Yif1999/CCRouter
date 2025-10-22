import assert from 'node:assert/strict';
import { formatAnthropicToOpenAI, BadRequestError } from '../formatRequest';

function baseRequest(model = 'anthropic/claude-haiku-4.5') {
  return {
    model,
    system: [],
    messages: [] as any[],
  };
}

export async function runFormatRequestTests() {
  // url mapping
  {
    const req = baseRequest();
    req.messages.push({
      role: 'user',
      content: [
        { type: 'text', text: 'Describe this image' },
        { type: 'image', source: { type: 'url', url: 'https://example.com/a.png' } },
      ]
    });
    const out = formatAnthropicToOpenAI(req as any);
    const userMsg = out.messages.find((m: any) => m.role === 'user');
    assert.ok(userMsg, 'user message exists');
    assert.ok(Array.isArray(userMsg.content), 'content should be array for mixed types');
    assert.equal(userMsg.content[0].type, 'text');
    assert.equal(userMsg.content[0].text, 'Describe this image');
    assert.equal(userMsg.content[1].type, 'image_url');
    assert.deepEqual(userMsg.content[1].image_url, { url: 'https://example.com/a.png' });
  }

  // base64 mapping + allowed media type
  {
    const req = baseRequest();
    req.messages.push({
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } },
      ]
    });
    const out = formatAnthropicToOpenAI(req as any);
    const userMsg = out.messages.find((m: any) => m.role === 'user');
    assert.ok(Array.isArray(userMsg.content));
    assert.equal(userMsg.content[0].type, 'image_url');
    assert.equal(userMsg.content[0].image_url.url, 'data:image/png;base64,AAA');
  }

  // unsupported media type -> 400
  {
    const req = baseRequest();
    req.messages.push({
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/tiff', data: 'AAA' } },
      ]
    });
    let threw = false;
    try {
      formatAnthropicToOpenAI(req as any);
    } catch (e) {
      threw = true;
      assert.ok(e instanceof BadRequestError);
      assert.equal((e as any).status, 400);
    }
    assert.ok(threw, 'should throw BadRequestError for unsupported media type');
  }

  // file-source rejection -> 400
  {
    const req = baseRequest();
    req.messages.push({
      role: 'user',
      content: [
        { type: 'image', source: { type: 'file', media_type: 'image/png', data: 'ignored' } },
      ]
    });
    let threw = false;
    try {
      formatAnthropicToOpenAI(req as any);
    } catch (e) {
      threw = true;
      assert.ok(e instanceof BadRequestError);
      assert.equal((e as any).status, 400);
    }
    assert.ok(threw, 'should throw BadRequestError for file source');
  }

  // multi-image + mixed content order preservation
  {
    const req = baseRequest();
    req.messages.push({
      role: 'user',
      content: [
        { type: 'text', text: 'first' },
        { type: 'image', source: { type: 'url', url: 'https://example.com/1.jpg' } },
        { type: 'text', text: 'second' },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'BBB' } },
        { type: 'image', source: { type: 'url', url: 'https://example.com/2.webp' } },
      ]
    });
    const out = formatAnthropicToOpenAI(req as any);
    const userMsg = out.messages.find((m: any) => m.role === 'user');
    assert.ok(Array.isArray(userMsg.content));
    const types = userMsg.content.map((b: any) => b.type);
    assert.deepEqual(types, ['text','image_url','text','image_url','image_url']);
    assert.equal(userMsg.content[0].text, 'first');
    assert.deepEqual(userMsg.content[1].image_url, { url: 'https://example.com/1.jpg' });
    assert.equal(userMsg.content[2].text, 'second');
    assert.equal(userMsg.content[3].image_url.url, 'data:image/jpeg;base64,BBB');
    assert.deepEqual(userMsg.content[4].image_url, { url: 'https://example.com/2.webp' });
  }

  // non-image regressions: pure text remains string
  {
    const req = baseRequest();
    req.messages.push({ role: 'user', content: [ { type: 'text', text: 'hello' } ] });
    const out = formatAnthropicToOpenAI(req as any);
    const userMsg = out.messages.find((m: any) => m.role === 'user');
    assert.equal(typeof userMsg.content, 'string');
    assert.equal(userMsg.content, 'hello');
  }

  // TTL metadata defaults to 5m when unspecified
  {
    const req = baseRequest();
    const out = formatAnthropicToOpenAI(req as any);
    const meta = (out as any).__ccrouter;
    assert.ok(meta?.cacheMetadata, 'cache metadata should be attached');
    assert.equal(meta.cacheMetadata.ttlMode, 'ephemeral_5m');
  }

  // TTL metadata detects 1h requests
  {
    const req = baseRequest();
    req.messages.push({
      role: 'user',
      content: [{ type: 'text', text: 'hello', cache_control: { type: 'ephemeral', ttl: '1h' } }],
    });
    const out = formatAnthropicToOpenAI(req as any);
    const meta = (out as any).__ccrouter;
    assert.equal(meta.cacheMetadata.ttlMode, 'ephemeral_1h');
    assert.deepEqual(meta.cacheMetadata.explicitTtls, ['1h']);
  }

  // Mixed TTL metadata detection
  {
    const req = baseRequest();
    req.messages.push({
      role: 'user',
      content: [
        { type: 'text', text: 'segment-a', cache_control: { type: 'ephemeral', ttl: '1h' } },
        { type: 'text', text: 'segment-b', cache_control: { type: 'ephemeral' } },
      ],
    });
    const out = formatAnthropicToOpenAI(req as any);
    const meta = (out as any).__ccrouter;
    assert.equal(meta.cacheMetadata.ttlMode, 'mixed');
    assert.ok(meta.cacheMetadata.sources.length >= 2);
  }
}
