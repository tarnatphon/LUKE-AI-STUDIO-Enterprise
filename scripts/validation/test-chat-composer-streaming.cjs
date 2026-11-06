// Guard the inexpensive composer/streaming path against accidental regressions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const chat = fs.readFileSync(path.join(__dirname, '../../app/frontend/src/components/TextChat.jsx'), 'utf8');
const start = chat.indexOf('const handleStreamToken =');
const end = chat.indexOf('let response;', start);
assert.ok(start >= 0 && end > start);
const handler = chat.slice(start, end);
assert.match(handler, /tokenBufferRef\.current = \{\s*render: \(\) => \{/);
assert.ok(handler.indexOf('processMessageContent(') > handler.indexOf('render: () =>'));
assert.match(chat, /const buffer = pending\.render\(\)/);
assert.match(chat, /interruptedBuffer = tokenBufferRef\.current\?\.render\(\)/);
assert.match(chat, /if \(tokenBufferRef\.current\) tokenBufferRef\.current\.render\(\)/);
assert.match(chat, /!event\.nativeEvent\.isComposing && event\.nativeEvent\.keyCode !== 229/);
assert.match(chat, /defaultValue=\{readChatDraft\(draftStorageKey\)\}/);
console.log('PASS: streaming parsing is batched, pending text survives stop, and IME Enter is guarded');
