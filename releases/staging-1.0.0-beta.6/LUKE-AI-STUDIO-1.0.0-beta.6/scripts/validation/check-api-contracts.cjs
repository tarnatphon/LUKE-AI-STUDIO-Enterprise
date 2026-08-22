#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..", "..");
const frontendRoot = path.join(projectRoot, "app", "frontend", "src");

const backendRoots = [
  path.join(projectRoot, "scripts"),
  path.join(projectRoot, "app", "backend"),
];

const allowedExtensions = new Set([
  ".js",
  ".jsx",
  ".cjs",
  ".mjs",
  ".ts",
  ".tsx",
  ".py",
]);

const ignoredDirectories = new Set([
  ".git",
  "node_modules",
  "node_modules_mac",
  "dist",
  "site-packages",
  "__pycache__",
  "coreml_venv",
]);

function walkFiles(root) {
  if (!fs.existsSync(root)) {
    return [];
  }

  const files = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          stack.push(fullPath);
        }

        continue;
      }

      if (
        entry.isFile() &&
        allowedExtensions.has(path.extname(entry.name).toLowerCase())
      ) {
        files.push(fullPath);
      }
    }
  }

  return files.sort();
}

function normalizeEndpoint(rawEndpoint) {
  if (typeof rawEndpoint !== "string") {
    return "";
  }

  let endpoint = rawEndpoint.trim();

  endpoint = endpoint.replace(/^["'`]/, "");
  endpoint = endpoint.split("${", 1)[0];
  endpoint = endpoint.split("?", 1)[0];
  endpoint = endpoint.split("#", 1)[0];

  endpoint = endpoint.replace(/[."'`,;)}\]]+$/g, "");
  endpoint = endpoint.replace(/\/+$/g, "");

  if (!endpoint.startsWith("/api/")) {
    return "";
  }

  return endpoint || "/";
}

function extractEndpoints(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const endpoints = new Set();

  const pattern = /(?:["'`(=:\s]|^)\/api\/[A-Za-z0-9_.~!$&'()*+,;=:@%/?#{}${}-]*/gm;
  const matches = source.match(pattern) || [];

  for (const rawMatch of matches) {
    const match = rawMatch.replace(/^[\\s"'`(=:]+/, "");
    const normalized = normalizeEndpoint(match);

    if (normalized) {
      endpoints.add(normalized);
    }
  }

  return endpoints;
}

function collectEndpoints(files) {
  const endpoints = new Map();

  for (const filePath of files) {
    for (const endpoint of extractEndpoints(filePath)) {
      if (!endpoints.has(endpoint)) {
        endpoints.set(endpoint, new Set());
      }

      endpoints.get(endpoint).add(
        path.relative(projectRoot, filePath)
      );
    }
  }

  return endpoints;
}

function endpointMatches(frontendEndpoint, backendEndpoint) {
  if (frontendEndpoint === backendEndpoint) {
    return true;
  }

  const frontendParts = frontendEndpoint.split("/").filter(Boolean);
  const backendParts = backendEndpoint.split("/").filter(Boolean);

  if (frontendParts.length !== backendParts.length) {
    return false;
  }

  return frontendParts.every((part, index) => {
    const backendPart = backendParts[index];

    if (
      backendPart.startsWith(":") ||
      backendPart.startsWith("{") ||
      backendPart.includes("${")
    ) {
      return true;
    }

    return part === backendPart;
  });
}

const frontendFiles = walkFiles(frontendRoot);

const backendFiles = backendRoots.flatMap((root) =>
  walkFiles(root)
);

const frontendEndpoints = collectEndpoints(frontendFiles);
const backendEndpoints = collectEndpoints(backendFiles);

const unmatched = [];

for (const frontendEndpoint of frontendEndpoints.keys()) {
  const matched = Array.from(backendEndpoints.keys()).some(
    (backendEndpoint) =>
      endpointMatches(frontendEndpoint, backendEndpoint)
  );

  if (!matched) {
    unmatched.push(frontendEndpoint);
  }
}

console.log("LUKE AI STUDIO API Contract Validation");
console.log(`Frontend endpoints: ${frontendEndpoints.size}`);
console.log(`Backend endpoints : ${backendEndpoints.size}`);

if (unmatched.length > 0) {
  console.error("");
  console.error("Frontend endpoints without backend contracts:");

  for (const endpoint of unmatched.sort()) {
    console.error(`  ${endpoint}`);

    for (const filePath of frontendEndpoints.get(endpoint)) {
      console.error(`    - ${filePath}`);
    }
  }

  process.exit(1);
}

console.log("PASS: All frontend API endpoints have backend contracts.");
process.exit(0);
