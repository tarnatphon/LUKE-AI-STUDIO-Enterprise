const fs = require('fs');
const path = require('path');

function createStatusError(message, status) {
  const err = new Error(message);
  err.status = status;
  err.statusCode = status;
  return err;
}

class WorkFileManager {
  constructor(projectRoot = process.cwd()) {
    this.projectRoot = projectRoot;
  }

  resolveRootAndPath(arg1, arg2) {
    let root = this.projectRoot;
    let filePath = '';

    if (typeof arg1 === 'object' && arg1 !== null) {
      root = arg1.root || arg1.projectRoot || this.projectRoot;
      filePath = arg1.filePath || arg1.path || arg1.directoryPath || '';
    } else if (typeof arg1 === 'string') {
      filePath = arg1;
      if (typeof arg2 === 'object' && arg2 !== null) {
        root = arg2.root || arg2.projectRoot || this.projectRoot;
      }
    }

    const realRoot = fs.existsSync(root) ? fs.realpathSync(root) : path.resolve(root);
    // Resolve target path using the canonical realRoot to prevent macOS /private/var path mismatch
    const targetPath = path.resolve(realRoot, filePath);
    const rel = path.relative(realRoot, targetPath);

    // Guard path traversal (e.g. ../secret.txt)
    if (rel.startsWith('..') || path.isAbsolute(filePath) && !filePath.startsWith(realRoot)) {
      throw createStatusError('Path traversal not permitted outside project root', 400);
    }

    return { root, realRoot, filePath, targetPath };
  }

  async readWorkFile(arg1, arg2) {
    const { realRoot, targetPath, filePath } = this.resolveRootAndPath(arg1, arg2);

    if (!fs.existsSync(targetPath)) {
      throw createStatusError(`File not found: ${filePath}`, 404);
    }

    // Guard Symlink escape
    const realTarget = fs.realpathSync(targetPath);
    if (!realTarget.startsWith(realRoot)) {
      throw createStatusError('Symlink escaping project root is forbidden', 403);
    }

    // Guard binary file (check for null bytes)
    const buffer = fs.readFileSync(targetPath);
    if (buffer.includes(0)) {
      throw createStatusError('Binary files are not supported for text reading', 415);
    }

    const content = buffer.toString('utf8');
    return { content, filePath, size: buffer.length };
  }

  async writeWorkFile(arg1, content, options = {}) {
    const { targetPath, filePath } = this.resolveRootAndPath(arg1, options);
    const body = (typeof arg1 === 'object' && arg1.content !== undefined) ? arg1.content : content;

    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Atomic write
    const tempFile = `${targetPath}.tmp.${Date.now()}`;
    fs.writeFileSync(tempFile, body, 'utf8');
    fs.renameSync(tempFile, targetPath);

    return { success: true, filePath, bytes: Buffer.byteLength(body || '', 'utf8') };
  }

  async getWorkTerminalSession(options = {}) {
    const root = options.root || options.projectRoot || this.projectRoot;
    const realRoot = fs.existsSync(root) ? fs.realpathSync(root) : path.resolve(root);
    return {
      cwd: realRoot,
      prompt: 'project >',
      changeDirectoryCommand: `cd "${realRoot}"`
    };
  }

  async listWorkDirectory(options = {}) {
    const { root, targetPath, filePath } = this.resolveRootAndPath(options);

    if (!fs.existsSync(targetPath)) {
      throw createStatusError(`Directory not found: ${filePath}`, 404);
    }

    const dirents = fs.readdirSync(targetPath, { withFileTypes: true });
    const entries = dirents.map(d => {
      const rel = filePath ? path.join(filePath, d.name) : d.name;
      return {
        name: d.name,
        path: rel,
        isDirectory: d.isDirectory()
      };
    });

    return {
      path: filePath,
      entries
    };
  }
}

const defaultManager = new WorkFileManager();

module.exports = {
  WorkFileManager,
  readWorkFile: (arg1, arg2) => defaultManager.readWorkFile(arg1, arg2),
  writeWorkFile: (arg1, c, opt) => defaultManager.writeWorkFile(arg1, c, opt),
  getWorkTerminalSession: (opt) => defaultManager.getWorkTerminalSession(opt),
  listWorkDirectory: (opt) => defaultManager.listWorkDirectory(opt),
  readProjectFile: (arg1, arg2) => defaultManager.readWorkFile(arg1, arg2),
  writeProjectFile: (arg1, c, opt) => defaultManager.writeWorkFile(arg1, c, opt)
};
