const fs = require('fs');
const path = require('path');

class LocalRagSearchEngine {
  constructor(projectRoot = process.cwd(), storageDir = 'app/runtime-state/storage') {
    this.projectRoot = projectRoot;
    this.storagePath = path.join(projectRoot, storageDir, 'rag-vector-index.json');
    this.documents = [];
    this.loadIndex();
  }

  loadIndex() {
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, 'utf8');
        this.documents = JSON.parse(raw);
      }
    } catch (e) {
      this.documents = [];
    }
  }

  saveIndex() {
    const dir = path.dirname(this.storagePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.storagePath, JSON.stringify(this.documents, null, 2), 'utf8');
  }

  // Tokenize & create frequency vector for fast local semantic scoring
  vectorize(text) {
    const words = text.toLowerCase().match(/\b[a-z0-9_\-\.]{2,}\b/g) || [];
    const freq = {};
    for (const w of words) freq[w] = (freq[w] || 0) + 1;
    return freq;
  }

  cosineSimilarity(vecA, vecB) {
    let dot = 0, normA = 0, normB = 0;
    for (const k in vecA) {
      if (vecB[k]) dot += vecA[k] * vecB[k];
      normA += vecA[k] * vecA[k];
    }
    for (const k in vecB) normB += vecB[k] * vecB[k];
    if (!normA || !normB) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  indexFile(relativePath, content) {
    // Chunking text into ~500 character semantic chunks
    const chunkSize = 500;
    const overlap = 100;
    let start = 0;
    let chunkId = 0;

    // Remove existing chunks for this file
    this.documents = this.documents.filter(d => d.filePath !== relativePath);

    while (start < content.length) {
      const chunkText = content.slice(start, start + chunkSize);
      this.documents.push({
        id: `${relativePath}#chunk-${chunkId++}`,
        filePath: relativePath,
        content: chunkText,
        vector: this.vectorize(chunkText),
        updatedAt: Date.now()
      });
      start += (chunkSize - overlap);
    }
    this.saveIndex();
  }

  search(query, topK = 5) {
    const qVec = this.vectorize(query);
    const scored = this.documents.map(doc => ({
      filePath: doc.filePath,
      content: doc.content,
      score: this.cosineSimilarity(qVec, doc.vector)
    }));

    return scored
      .filter(s => s.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}

module.exports = LocalRagSearchEngine;
