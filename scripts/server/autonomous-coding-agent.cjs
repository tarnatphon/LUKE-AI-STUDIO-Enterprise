const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

class AutonomousCodingAgent {
  constructor(projectRoot = process.cwd()) {
    this.projectRoot = projectRoot;
  }

  readFile(relPath) {
    const full = path.join(this.projectRoot, relPath);
    if (!fs.existsSync(full)) throw new Error(`File not found: ${relPath}`);
    return fs.readFileSync(full, 'utf8');
  }

  writeFile(relPath, newContent) {
    const full = path.join(this.projectRoot, relPath);
    const dir = path.dirname(full);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(full, newContent, 'utf8');
    return { success: true, filePath: relPath, size: newContent.length };
  }

  async runTest(command) {
    return new Promise((resolve) => {
      exec(command, { cwd: this.projectRoot, timeout: 30000 }, (error, stdout, stderr) => {
        resolve({
          passed: !error,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: error ? error.code : 0
        });
      });
    });
  }

  async executeTaskLoop(taskName, testCmd, maxRetries = 3) {
    const log = [];
    log.push(`[Agent] Starting autonomous task: ${taskName}`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      log.push(`[Agent] Running verification step (Attempt ${attempt}/${maxRetries}): ${testCmd}`);
      const testResult = await this.runTest(testCmd);

      if (testResult.passed) {
        log.push(`[Agent] ✅ Verification passed on attempt ${attempt}`);
        return { success: true, attempts: attempt, logs: log };
      } else {
        log.push(`[Agent] ⚠️ Verification failed (Exit code ${testResult.exitCode}): ${testResult.stderr || testResult.stdout}`);
      }
    }

    return { success: false, attempts: maxRetries, logs: log };
  }
}

module.exports = AutonomousCodingAgent;
