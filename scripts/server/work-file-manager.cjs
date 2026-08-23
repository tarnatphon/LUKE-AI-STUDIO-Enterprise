const fs = require('fs');
const path = require('path');

class WorkFileManager {
  constructor(projectRoot = process.cwd()) {
    this.projectRoot = projectRoot;
    this.sessions = new Map();
  }

  isSafePath(targetPath) {
    const resolved = path.resolve(this.projectRoot, targetPath);
    return resolved.startsWith(path.resolve(this.projectRoot));
  }

  readProjectFile(relPath) {
    if (!this.isSafePath(relPath)) throw new Error('Path outside project root');
    const full = path.resolve(this.projectRoot, relPath);
    if (!fs.existsSync(full)) throw new Error(`File not found: ${relPath}`);
    return fs.readFileSync(full, 'utf8');
  }

  writeProjectFile(relPath, content) {
    if (!this.isSafePath(relPath)) throw new Error('Path outside project root');
    const full = path.resolve(this.projectRoot, relPath);
    const dir = path.dirname(full);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
    return { success: true, filePath: relPath, bytes: content.length };
  }

  getWorkTerminalSession(sessionId = 'default') {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        id: sessionId,
        history: [],
        createdAt: Date.now()
      });
    }
    return this.sessions.get(sessionId);
  }
}

const defaultManager = new WorkFileManager();
function getWorkTerminalSession(sessionId) {
  return defaultManager.getWorkTerminalSession(sessionId);
}

module.exports = {
  WorkFileManager,
  getWorkTerminalSession,
  readProjectFile: (p) => defaultManager.readProjectFile(p),
  writeProjectFile: (p, c) => defaultManager.writeProjectFile(p, c)
};
