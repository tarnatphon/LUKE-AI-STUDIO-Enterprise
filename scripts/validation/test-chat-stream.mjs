import assert from 'node:assert/strict';
import { streamChatWithLlm, chatWithLlm } from '../../app/frontend/src/services/api.js';

const encoder = new TextEncoder();
const originalFetch = globalThis.fetch;
const event = (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
try {
  // Split UTF-8 and SSE framing across arbitrary network chunks.
  const bytes = encoder.encode(event('สวัสดี') + 'data: [DONE]\n\n');
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); },
  }));
  const result = await streamChatWithLlm([], { allowNonStreamFallback: false });
  assert.equal(result.content, 'สวัสดี');
  assert.equal(result.finishReason, null);

  globalThis.fetch = async () => new Response(event('partial'));
  const partial = await streamChatWithLlm([], { allowNonStreamFallback: false });
  assert.equal(partial.finishReason, 'stream_interrupted');
  assert.equal(partial.content, 'partial');

  let cancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode(event('partial'))); },
    cancel() { cancelled = true; },
  }));
  const idle = await streamChatWithLlm([], { streamIdleTimeoutMs: 10, allowNonStreamFallback: false });
  assert.equal(idle.finishReason, 'stream_idle_partial');
  assert.equal(cancelled, true);

  const abort = new AbortController();
  cancelled = false;
  const pending = streamChatWithLlm([], { signal: abort.signal, allowNonStreamFallback: false });
  setTimeout(() => abort.abort(), 10);
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(cancelled, true);

  let received;
  globalThis.fetch = async (_url, options) => {
    received = JSON.parse(options.body);
    return Response.json({ choices: [{ message: { content: 'ok' } }] });
  };
  await chatWithLlm([], { assistantMode: 'work' });
  assert.equal(received.assistantMode, 'work');
  console.log('PASS: stream framing, interrupted responses, idle cleanup, cancellation and fallback mode');
} finally {
  globalThis.fetch = originalFetch;
}
