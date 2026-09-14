#!/usr/bin/env node
"use strict";
// Regression test: updateProgress must keep (percent, step, total, message)
// atomic. Independent max() merging once produced step 520 / total 25.
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ImageToVideoJobManager } = require("../server/image-to-video-job-manager.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "i2v-progress-"));
const mgr = new ImageToVideoJobManager({ statePath: path.join(root, "jobs.json") });
const job = mgr.createJob({ payload: { modelId: "svd" } });
mgr.startJob(job.id, { kill: () => true });

mgr.updateProgress(job.id, { percent: 32, step: 8, total: 25, message: "Inference 8/25" });
let cur = mgr.getJob(job.id);
assert.strictEqual(cur.progress.percent, 32);
assert.strictEqual(cur.progress.step, 8);
assert.strictEqual(cur.progress.total, 25);

// Noise from an unrelated log line wins the percent race…
mgr.updateProgress(job.id, { percent: 100, step: 520, total: 520, message: "Noise 520/520" });
cur = mgr.getJob(job.id);
assert.strictEqual(cur.progress.percent, 99);
assert.strictEqual(cur.progress.step, 520);
assert.strictEqual(cur.progress.total, 520);

// …but a later lower observation must NOT franken-merge into the record.
mgr.updateProgress(job.id, { percent: 80, step: 20, total: 25, message: "Inference 20/25" });
cur = mgr.getJob(job.id);
assert.strictEqual(cur.progress.percent, 99);
assert.strictEqual(cur.progress.step, 520);
assert.strictEqual(cur.progress.total, 520);
assert.strictEqual(cur.progress.message, "Noise 520/520");

console.log("PASS: i2v progress triple stays atomic");
