const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

class WorkActionRunner {
  constructor(projectRoot = process.cwd()) {
    this.projectRoot = projectRoot;
  }

  async executeCommand(command, options = {}) {
    return new Promise((resolve, reject) => {
      const blocked = ['rm -rf /', ':(){ :|:& };:'];
      if (blocked.some(b => command.includes(b))) {
        return reject(new Error('Command blocked for safety reasons.'));
      }

      exec(command, { cwd: options.cwd || this.projectRoot, timeout: 60000 }, (error, stdout, stderr) => {
        resolve({
          success: !error,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: error ? error.code : 0
        });
      });
    });
  }

  async listProjectFiles(subDir = '') {
    const targetDir = path.join(this.projectRoot, subDir);
    const files = fs.readdirSync(targetDir, { withFileTypes: true });
    return files.map(f => ({
      name: f.name,
      isDirectory: f.isDirectory(),
      path: path.relative(this.projectRoot, path.join(targetDir, f.name))
    }));
  }

  async runWorkFileDiff(oldContent, newContent) {
    const linesOld = (oldContent || '').split('\n');
    const linesNew = (newContent || '').split('\n');
    return {
      totalOldLines: linesOld.length,
      totalNewLines: linesNew.length,
      hasChanges: oldContent !== newContent
    };
  }
}

module.exports = WorkActionRunner;
