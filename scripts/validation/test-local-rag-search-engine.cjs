const LocalRagSearchEngine = require('../server/local-rag-search-engine.cjs');
const engine = new LocalRagSearchEngine();

engine.indexFile('src/server.js', 'Express server running on port 1420 managing local text, images and video.');
engine.indexFile('src/tts.js', 'Kokoro ONNX text-to-speech audio synthesis engine for Apple Silicon.');

const results = engine.search('audio voice synthesis');
if (results.length > 0 && results[0].filePath === 'src/tts.js') {
  console.log('PASS: Local RAG Search Engine successfully indexed and semantically retrieved code chunks.');
} else {
  console.error('FAIL: Local RAG Search failed to retrieve relevant match.');
  process.exit(1);
}
