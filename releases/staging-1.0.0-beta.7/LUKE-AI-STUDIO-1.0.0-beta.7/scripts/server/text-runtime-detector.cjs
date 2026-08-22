"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  execFile,
} = require("node:child_process");
const {
  promisify,
} = require("node:util");

const execFileAsync =
  promisify(execFile);

function unique(values) {
  return [
    ...new Set(
      values.filter(Boolean)
    ),
  ];
}

function fileExists(filePath) {
  try {
    fs.accessSync(
      filePath,
      fs.constants.X_OK
    );

    return true;
  } catch {
    return false;
  }
}

async function commandExists(command) {
  try {
    const result =
      await execFileAsync(
        "/usr/bin/which",
        [command],
        {
          timeout: 3000,
        }
      );

    return String(
      result.stdout || ""
    ).trim() || null;
  } catch {
    return null;
  }
}

async function readVersion(
  command,
  argumentsValue = [
    "--version",
  ]
) {
  if (!command) {
    return null;
  }

  try {
    const result =
      await execFileAsync(
        command,
        argumentsValue,
        {
          timeout: 5000,
        }
      );

    const output =
      String(
        result.stdout ||
        result.stderr ||
        ""
      )
        .trim()
        .split(/\r?\n/)[0];

    return output || null;
  } catch {
    return null;
  }
}

function getMacCandidatePaths() {
  const home =
    os.homedir();

  return {
    ollama: [
      "/usr/local/bin/ollama",
      "/opt/homebrew/bin/ollama",
      path.join(
        home,
        ".ollama",
        "ollama"
      ),
      "/Applications/Ollama.app/Contents/Resources/ollama",
    ],
    llamaCpp: [
      "/usr/local/bin/llama-server",
      "/opt/homebrew/bin/llama-server",
      "/usr/local/bin/server",
      "/opt/homebrew/bin/server",
      path.join(
        home,
        "llama.cpp",
        "build",
        "bin",
        "llama-server"
      ),
    ],
    mlx: [
      "/usr/local/bin/mlx_lm.server",
      "/opt/homebrew/bin/mlx_lm.server",
      path.join(
        home,
        ".local",
        "bin",
        "mlx_lm.server"
      ),
    ],
  };
}

async function resolveExecutable(
  commandName,
  candidates
) {
  const fromPath =
    await commandExists(
      commandName
    );

  if (fromPath) {
    return fromPath;
  }

  return (
    unique(candidates)
      .find(fileExists) ||
    null
  );
}

async function checkLocalHealth(
  url
) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      1500
    );

  try {
    const response =
      await fetch(
        url,
        {
          signal:
            controller.signal,
        }
      );

    return {
      reachable:
        response.ok,
      statusCode:
        response.status,
    };
  } catch {
    return {
      reachable: false,
      statusCode: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function createPreset(
  runtimeType,
  executable
) {
  if (
    runtimeType === "ollama"
  ) {
    return {
      runtimeType,
      displayName: "Ollama",
      command:
        executable || "ollama",
      arguments: [
        "serve",
      ],
      workingDirectory: ".",
      healthUrl:
        "http://127.0.0.1:11434/api/tags",
      generationBaseUrl:
        "http://127.0.0.1:11434",
      environment: {},
    };
  }

  if (
    runtimeType === "llama.cpp"
  ) {
    return {
      runtimeType,
      displayName: "llama.cpp",
      command:
        executable ||
        "llama-server",
      arguments: [
        "--host",
        "127.0.0.1",
        "--port",
        "10086",
      ],
      workingDirectory: ".",
      healthUrl:
        "http://127.0.0.1:10086/health",
      generationBaseUrl:
        "http://127.0.0.1:10086",
      environment: {},
      requiresModelPath: true,
    };
  }

  return {
    runtimeType:
      "mlx",
    displayName:
      "MLX LM Server",
    command:
      executable ||
      "mlx_lm.server",
    arguments: [
      "--host",
      "127.0.0.1",
      "--port",
      "10086",
    ],
    workingDirectory: ".",
    healthUrl:
      "http://127.0.0.1:10086/health",
    generationBaseUrl:
      "http://127.0.0.1:10086",
    environment: {},
    requiresModelPath: true,
  };
}

async function detectTextRuntimes() {
  const candidates =
    getMacCandidatePaths();

  const [
    ollamaPath,
    llamaCppPath,
    mlxPath,
  ] = await Promise.all([
    resolveExecutable(
      "ollama",
      candidates.ollama
    ),
    resolveExecutable(
      "llama-server",
      candidates.llamaCpp
    ),
    resolveExecutable(
      "mlx_lm.server",
      candidates.mlx
    ),
  ]);

  const [
    ollamaHealth,
    llamaHealth,
    mlxHealth,
  ] = await Promise.all([
    checkLocalHealth(
      "http://127.0.0.1:11434/api/tags"
    ),
    checkLocalHealth(
      "http://127.0.0.1:10086/health"
    ),
    checkLocalHealth(
      "http://127.0.0.1:8081/health"
    ),
  ]);

  const detections = [
    {
      id: "ollama",
      runtimeType: "ollama",
      displayName: "Ollama",
      installed:
        Boolean(ollamaPath),
      executable:
        ollamaPath,
      version:
        await readVersion(
          ollamaPath
        ),
      running:
        ollamaHealth.reachable,
      health:
        ollamaHealth,
      preset:
        createPreset(
          "ollama",
          ollamaPath
        ),
    },
    {
      id: "llama.cpp",
      runtimeType: "llama.cpp",
      displayName: "llama.cpp",
      installed:
        Boolean(llamaCppPath),
      executable:
        llamaCppPath,
      version:
        await readVersion(
          llamaCppPath
        ),
      running:
        llamaHealth.reachable,
      health:
        llamaHealth,
      preset:
        createPreset(
          "llama.cpp",
          llamaCppPath
        ),
    },
    {
      id: "mlx",
      runtimeType: "mlx",
      displayName:
        "MLX LM Server",
      installed:
        Boolean(mlxPath),
      executable:
        mlxPath,
      version:
        await readVersion(
          mlxPath,
          ["--help"]
        ),
      running:
        mlxHealth.reachable,
      health:
        mlxHealth,
      preset:
        createPreset(
          "mlx",
          mlxPath
        ),
    },
  ];

  return {
    platform:
      process.platform,
    architecture:
      process.arch,
    appleSilicon:
      process.platform ===
        "darwin" &&
      process.arch === "arm64",
    detectedAt:
      new Date().toISOString(),
    detections,
    installedCount:
      detections.filter(
        (runtime) =>
          runtime.installed
      ).length,
    runningCount:
      detections.filter(
        (runtime) =>
          runtime.running
      ).length,
  };
}

module.exports = {
  detectTextRuntimes,
  createPreset,
};
