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

// LUKE_AI_DYNAMIC_API_CONTRACTS_V1
// LUKE_AI_DYNAMIC_API_CONTRACTS_V2
function normalizeEndpoint(rawEndpoint) {
  if (
    typeof rawEndpoint !==
    "string"
  ) {
    return "";
  }

  let endpoint =
    rawEndpoint.trim();

  endpoint =
    endpoint.replace(
      /^["'`]/,
      ""
    );

  endpoint =
    endpoint.replace(
      /\$\{[\s\S]*?\}/g,
      ":param"
    );

  if (
    endpoint.includes(
      "${"
    )
  ) {
    return "";
  }

  if (
    endpoint.includes(
      "encodeURIComponent("
    ) ||
    endpoint.includes(
      "${encodeURIComponent("
    )
  ) {
    return "";
  }

  endpoint =
    endpoint.split(
      "?",
      1
    )[0];

  endpoint =
    endpoint.split(
      "#",
      1
    )[0];

  endpoint =
    endpoint.replace(
      /\s+/g,
      ""
    );

  endpoint =
    endpoint.replace(
      /[."'`,;)}\]]+$/g,
      ""
    );

  endpoint =
    endpoint.replace(
      /\/+$/g,
      ""
    );

  // LUKE_AI_TEMPLATE_FRAGMENT_FILTER_V3
  if (
    /[A-Za-z0-9_-]:param(?:$|\/)/.test(
      endpoint
    )
  ) {
    return "";
  }

  if (
    endpoint.includes(
      "encodeURIComponent("
    ) ||
    endpoint.includes(
      "${"
    )
  ) {
    return "";
  }

  if (
    !endpoint.startsWith(
      "/api/"
    )
  ) {
    return "";
  }

  if (
    endpoint.endsWith(
      "/:"
    )
  ) {
    return "";
  }

  return endpoint || "/";
}

function normalizeRegexEndpoint(
  raw
) {
  let endpoint =
    String(raw || "");

  endpoint =
    endpoint.replace(
      /^\/\^/,
      ""
    );

  endpoint =
    endpoint.replace(
      /\$\/[gimsuy]*$/,
      ""
    );

  endpoint =
    endpoint.replace(
      /\\\//g,
      "/"
    );

  endpoint =
    endpoint.replace(
      /$begin:math:text$\\[\\^\\/\\]\\+\$end:math:text$/g,
      ":param"
    );

  endpoint =
    endpoint.replace(
      /$begin:math:text$\\[\\^/\\]\\+\$end:math:text$/g,
      ":param"
    );

  endpoint =
    endpoint.replace(
      /$begin:math:text$(?:[A-Za-z0-9_-]+\\|)+[A-Za-z0-9_-]+\$end:math:text$/g,
      ":param"
    );

  endpoint =
    endpoint.replace(
      /\\([.])/g,
      "$1"
    );

  return normalizeEndpoint(
    endpoint
  );
}

function extractTemplateEndpoints(
  source
) {
  const endpoints =
    new Set();

  const pattern =
    /`(\/api\/[\s\S]*?)`/g;

  let match;

  while (
    (
      match =
        pattern.exec(source)
    ) !== null
  ) {
    const normalized =
      normalizeEndpoint(
        match[1]
      );

    if (normalized) {
      endpoints.add(
        normalized
      );
    }
  }

  return endpoints;
}

// LUKE_AI_REGEX_ENDPOINT_EXTRACTION_V3
function extractRegexEndpoints(
  source
) {
  const endpoints =
    new Set();

  const lines =
    String(
      source || ""
    ).split(
      /\r?\n/
    );

  for (
    const line of
    lines
  ) {
    const trimmed =
      line.trim();

    if (
      !trimmed.includes(
        "^\\/api\\/"
      )
    ) {
      continue;
    }

    const literalStart =
      trimmed.indexOf(
        "/^"
      );

    if (
      literalStart < 0
    ) {
      continue;
    }

    // LUKE_AI_REGEX_CHARACTER_CLASS_SCANNER_V1
    let literalEnd = -1;
    let escaped = false;
    let inCharacterClass = false;

    for (
      let index =
        literalStart + 1;
      index <
        trimmed.length;
      index += 1
    ) {
      const character =
        trimmed[index];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (
        character === "\\"
      ) {
        escaped = true;
        continue;
      }

      if (
        character === "[" &&
        !inCharacterClass
      ) {
        inCharacterClass =
          true;

        continue;
      }

      if (
        character === "]" &&
        inCharacterClass
      ) {
        inCharacterClass =
          false;

        continue;
      }

      if (
        character === "/" &&
        !inCharacterClass
      ) {
        literalEnd =
          index;

        break;
      }
    }

    if (
      literalEnd < 0
    ) {
      continue;
    }

    let endpoint =
      trimmed.slice(
        literalStart + 2,
        literalEnd
      );

    if (
      !endpoint.startsWith(
        "\\/api\\/"
      )
    ) {
      continue;
    }

    endpoint =
      endpoint.replace(
        /\\\//g,
        "/"
      );

    endpoint =
      endpoint.replace(
        /\(\[\^\/\?\]\+\)/g,
        ":param"
      );

    endpoint =
      endpoint.replace(
        /\(\[\^\?\/\]\+\)/g,
        ":param"
      );

    endpoint =
      endpoint.replace(
        /\(\[\^\/\]\+\)/g,
        ":param"
      );

    endpoint =
      endpoint.replace(
        /\(\?:\/\(([^)]+)\)\)\?/g,
        "/:param"
      );

    endpoint =
      endpoint.replace(
        /\((?:[A-Za-z0-9_-]+\|)+[A-Za-z0-9_-]+\)/g,
        ":param"
      );

    endpoint =
      endpoint.replace(
        /\$$/,
        ""
      );

    const normalized =
      normalizeEndpoint(
        endpoint
      );

    if (normalized) {
      endpoints.add(
        normalized
      );
    }
  }

  return endpoints;
}

function extractEndpoints(filePath) {
  const source =
    fs.readFileSync(
      filePath,
      "utf8"
    );

  const endpoints =
    new Set();

  const pattern =
    /(?:["'`(=:\s]|^)\/api\/[A-Za-z0-9_.~!$&'()*+,;=:@%/?#{}${\}-]*/gm;

  const matches =
    source.match(
      pattern
    ) || [];

  for (
    const rawMatch of
    matches
  ) {
    const match =
      rawMatch.replace(
        /^[\\s"'\`(=:]+/,
        ""
      );

    const normalized =
      normalizeEndpoint(
        match
      );

    if (normalized) {
      endpoints.add(
        normalized
      );
    }
  }

  const templateEndpoints =
    extractTemplateEndpoints(
      source
    );

  for (
    const endpoint of
    templateEndpoints
  ) {
    endpoints.add(
      endpoint
    );

    const dynamicIndex =
      endpoint.indexOf(
        "/:param"
      );

    if (
      dynamicIndex > 0
    ) {
      const falsePrefix =
        endpoint.slice(
          0,
          dynamicIndex
        );

      endpoints.delete(
        falsePrefix
      );
    }
  }

  const regexEndpoints =
    extractRegexEndpoints(
      source
    );

  for (
    const endpoint of
    regexEndpoints
  ) {
    endpoints.add(
      endpoint
    );
  }

  return endpoints;
}

// LUKE_AI_API_ROUTE_COMPATIBILITY_V1
function endpointSegments(
  endpoint
) {
  return String(
    endpoint || ""
  )
    .split("/")
    .filter(Boolean);
}

function endpointsCompatible(
  frontendEndpoint,
  backendEndpoint
) {
  if (
    frontendEndpoint ===
    backendEndpoint
  ) {
    return true;
  }

  const frontend =
    endpointSegments(
      frontendEndpoint
    );

  const backend =
    endpointSegments(
      backendEndpoint
    );

  if (
    frontend.length !==
    backend.length
  ) {
    return false;
  }

  for (
    let index = 0;
    index <
      frontend.length;
    index += 1
  ) {
    const left =
      frontend[index];

    const right =
      backend[index];

    if (
      left === right
    ) {
      continue;
    }

    if (
      left === ":param" ||
      right === ":param"
    ) {
      continue;
    }

    return false;
  }

  return true;
}

function hasBackendContract(
  frontendEndpoint,
  backendEndpoints
) {
  for (
    const backendEndpoint of
    backendEndpoints
  ) {
    if (
      endpointsCompatible(
        frontendEndpoint,
        backendEndpoint
      )
    ) {
      return true;
    }
  }

  return false;
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

// LUKE_AI_ENDPOINT_MATCHES_DYNAMIC_V2
function endpointMatches(
  frontendEndpoint,
  backendEndpoint
) {
  return endpointsCompatible(
    frontendEndpoint,
    backendEndpoint
  );
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
