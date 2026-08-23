const fs = require('fs');
const path = require('path');

class WorkFileManager {
  constructor(projectRoot = process.cwd()) {
    this.projectRoot = projectRoot;
    this.sessions = new Map();
  }

  extractPath(arg) {
    if (!arg) return '';
    if (typeof arg === 'string') return arg;
    if (typeof arg === 'object') {
      return arg.filePath || arg.path || arg.targetPath || arg.relativePath || arg.file || '';
    }
    return String(arg);
  }

  isSafePath(targetPath, customRoot) {
    const rawPath = this.extractPath(targetPath);
    const root = customRoot || this.projectRoot;
    const resolved = path.resolve(root, rawPath);
    return resolved.startsWith(path.resolve(root));
  }

  readWorkFile(target, options = {}) {
    const rawPath = this.extractPath(target);
    const root = (typeof target === 'object' && target.projectRoot) || options.projectRoot || this.projectRoot;
    
    if (!this.isSafePath(rawPath, root)) throw new Error('Path outside project root');
    const full = path.resolve(root, rawPath);
    if (!fs.existsSync(full)) throw new Error(`File not found: ${rawPath}`);
    return fs.readFileSync(full, options.encoding || 'utf8');
  }

  writeWorkFile(target, content, options = {}) {
    const rawPath = this.extractPath(target);
    const body = (typeof target === 'object' && target.content !== undefined) ? target.content : content;
    const root = (typeof target === 'object' && target.projectRoot) || options.projectRoot || this.projectRoot;

    if (!this.isSafePath(rawPath, root)) throw new Error('Path outside project root');
    const full = path.resolve(root, rawPath);
    const dir = path.dirname(full);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(full, body, options.encoding || 'utf8');
    return { success: true, filePath: rawPath, bytes: (body || '').length };
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

module.exports = {
  WorkFileManager,
  getWorkTerminalSession: (s) => defaultManager.getWorkTerminalSession(s),
  readWorkFile: (p, opt) => defaultManager.readWorkFile(p, opt),
  writeWorkFile: (p, c, opt) => defaultManager.writeWorkFile(p, c, opt),
  readProjectFile: (p, opt) => defaultManager.readWorkFile(p, opt),
  writeProjectFile: (p, c, opt) => defaultManager.writeWorkFile(p, c, opt)
};
