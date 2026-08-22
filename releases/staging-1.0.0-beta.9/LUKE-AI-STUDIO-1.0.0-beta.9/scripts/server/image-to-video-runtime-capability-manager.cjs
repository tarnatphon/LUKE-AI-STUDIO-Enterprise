"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  spawnSync,
} = require("node:child_process");

const REQUIRED_PACKAGES =
  Object.freeze([
    "torch",
    "diffusers",
    "transformers",
    "accelerate",
    "PIL",
    "imageio",
    "imageio_ffmpeg",
    "safetensors",
  ]);

function safeJson(filePath) {
  try {
    if (
      !fs.existsSync(filePath)
    ) {
      return null;
    }

    return JSON.parse(
      fs.readFileSync(
        filePath,
        "utf8"
      )
    );
  } catch {
    return null;
  }
}

function isExecutable(filePath) {
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

function defaultProbeRunner({
  pythonPath,
  timeoutMs,
}) {
  const probe = String.raw`
import importlib
import importlib.util
import json
import platform
import sys

result = {
    "ok": True,
    "python": sys.executable,
    "pythonVersion": platform.python_version(),
    "packages": {},
    "torch": {
        "available": False,
        "version": None,
        "mpsBuilt": False,
        "mpsAvailable": False,
        "mpsTest": "unavailable",
        "mpsError": None,
        "error": None,
    },
    "ffmpeg": {
        "available": False,
        "executable": None,
        "version": None,
        "error": None,
    },
}

packages = [
    "torch",
    "diffusers",
    "transformers",
    "accelerate",
    "PIL",
    "imageio",
    "imageio_ffmpeg",
    "safetensors",
]

for name in packages:
    entry = {
        "installed": False,
        "version": None,
        "error": None,
    }

    try:
        spec = importlib.util.find_spec(name)

        if spec is None:
            result["packages"][name] = entry
            continue

        module = importlib.import_module(name)

        entry["installed"] = True
        entry["version"] = getattr(
            module,
            "__version__",
            "unknown",
        )

    except Exception as exc:
        entry["error"] = (
            f"{type(exc).__name__}: {exc}"
        )

    result["packages"][name] = entry

try:
    import torch

    result["torch"]["available"] = True
    result["torch"]["version"] = torch.__version__

    result["torch"]["mpsBuilt"] = bool(
        hasattr(torch.backends, "mps")
        and torch.backends.mps.is_built()
    )

    result["torch"]["mpsAvailable"] = bool(
        hasattr(torch.backends, "mps")
        and torch.backends.mps.is_available()
    )

    if result["torch"]["mpsAvailable"]:
        try:
            x = torch.ones(
                2,
                device="mps",
            )

            y = x * 2

            if y.numel() == 2:
                result["torch"]["mpsTest"] = "passed"
            else:
                result["torch"]["mpsTest"] = "failed"

        except Exception as exc:
            result["torch"]["mpsTest"] = "failed"
            result["torch"]["mpsError"] = (
                f"{type(exc).__name__}: {exc}"
            )

except Exception as exc:
    result["torch"]["error"] = (
        f"{type(exc).__name__}: {exc}"
    )

try:
    import imageio_ffmpeg

    result["ffmpeg"]["available"] = True

    result["ffmpeg"]["executable"] = (
        imageio_ffmpeg.get_ffmpeg_exe()
    )

    result["ffmpeg"]["version"] = (
        imageio_ffmpeg.get_ffmpeg_version()
    )

except Exception as exc:
    result["ffmpeg"]["error"] = (
        f"{type(exc).__name__}: {exc}"
    )

print(
    json.dumps(
        result,
        ensure_ascii=False,
    )
)
`;

  const result =
    spawnSync(
      pythonPath,
      [
        "-c",
        probe,
      ],
      {
        encoding: "utf8",
        timeout:
          timeoutMs,
        maxBuffer:
          4 * 1024 * 1024,
        env: {
          ...process.env,
          PYTHONNOUSERSITE:
            "1",
        },
      }
    );

  if (result.error) {
    return {
      ok: false,
      error:
        result.error.message,
    };
  }

  if (
    result.status !== 0
  ) {
    return {
      ok: false,
      error:
        (
          result.stderr ||
          result.stdout ||
          `Probe exited ${result.status}`
        ).trim(),
    };
  }

  try {
    return JSON.parse(
      result.stdout.trim()
    );
  } catch (error) {
    return {
      ok: false,
      error:
        `Invalid runtime probe JSON: ${error.message}`,
    };
  }
}

class ImageToVideoRuntimeCapabilityManager {
  constructor({
    root,
    probeRunner =
      defaultProbeRunner,
    timeoutMs = 20000,
  }) {
    this.root =
      path.resolve(root);

    this.runtimeRoot =
      path.join(
        this.root,
        "app",
        "runtimes",
        "image-to-video"
      );

    this.venvRoot =
      path.join(
        this.runtimeRoot,
        "venv"
      );

    this.pythonPath =
      process.platform ===
      "win32"
        ? path.join(
            this.venvRoot,
            "Scripts",
            "python.exe"
          )
        : path.join(
            this.venvRoot,
            "bin",
            "python"
          );

    this.manifestPath =
      path.join(
        this.runtimeRoot,
        "installed.json"
      );

    this.installerPath =
      path.join(
        this.root,
        "scripts",
        "workers",
        "install_image_to_video_runtime.py"
      );

    this.runtimeConfigPath =
      path.join(
        this.root,
        "app",
        "config",
        "runtime-dependencies.json"
      );

    this.probeRunner =
      probeRunner;

    this.timeoutMs =
      timeoutMs;
  }

  getFilesystemStatus() {
    return {
      runtimeRoot:
        this.runtimeRoot,

      runtimeExists:
        fs.existsSync(
          this.runtimeRoot
        ),

      venvExists:
        fs.existsSync(
          this.venvRoot
        ),

      pythonPath:
        this.pythonPath,

      pythonExists:
        fs.existsSync(
          this.pythonPath
        ),

      pythonExecutable:
        isExecutable(
          this.pythonPath
        ),

      manifestExists:
        fs.existsSync(
          this.manifestPath
        ),

      installerExists:
        fs.existsSync(
          this.installerPath
        ),

      runtimeConfigExists:
        fs.existsSync(
          this.runtimeConfigPath
        ),
    };
  }

  probeRuntime() {
    const filesystem =
      this.getFilesystemStatus();

    if (
      !filesystem.pythonExists ||
      !filesystem.pythonExecutable
    ) {
      return {
        ok: false,
        state:
          "missing",
        error:
          "Image-to-Video isolated runtime is not installed.",
      };
    }

    return this.probeRunner({
      pythonPath:
        this.pythonPath,
      timeoutMs:
        this.timeoutMs,
    });
  }

  summarizePackages(probe) {
    const packages =
      probe?.packages || {};

    const missing = [];
    const importErrors = [];

    for (
      const packageName of
      REQUIRED_PACKAGES
    ) {
      const entry =
        packages[
          packageName
        ];

      if (
        !entry ||
        entry.installed !==
          true
      ) {
        missing.push(
          packageName
        );
      }

      if (entry?.error) {
        importErrors.push({
          package:
            packageName,
          error:
            entry.error,
        });
      }
    }

    return {
      required:
        REQUIRED_PACKAGES,

      ready:
        missing.length === 0 &&
        importErrors.length ===
          0,

      missing,

      importErrors,

      versions:
        Object.fromEntries(
          Object.entries(
            packages
          ).map(
            ([
              key,
              value,
            ]) => [
              key,
              value?.version ??
                null,
            ]
          )
        ),
    };
  }

  getStatus() {
    const filesystem =
      this.getFilesystemStatus();

    const manifest =
      safeJson(
        this.manifestPath
      );

    const runtimeConfig =
      safeJson(
        this.runtimeConfigPath
      );

    const probe =
      this.probeRuntime();

    const packages =
      probe.ok
        ? this.summarizePackages(
            probe
          )
        : {
            required:
              REQUIRED_PACKAGES,

            ready:
              false,

            missing:
              REQUIRED_PACKAGES,

            importErrors: [],

            versions: {},
          };

    const torch =
      probe.ok
        ? probe.torch || {}
        : {};

    const ffmpeg =
      probe.ok
        ? probe.ffmpeg || {}
        : {};

    const runtimeReady =
      filesystem
        .pythonExecutable &&
      probe.ok === true &&
      packages.ready ===
        true &&
      torch.available ===
        true &&
      ffmpeg.available ===
        true;

    let state =
      "missing";

    if (
      filesystem
        .pythonExecutable &&
      !runtimeReady
    ) {
      state =
        "degraded";
    }

    if (runtimeReady) {
      state =
        "ready";
    }

    return {
      capability:
        "image-to-video",

      state,

      installed:
        filesystem
          .pythonExecutable,

      ready:
        runtimeReady,

      platform: {
        os:
          process.platform,

        architecture:
          process.arch,

        hostname:
          os.hostname(),
      },

      filesystem,

      manifest,

      runtimeConfigLoaded:
        Boolean(
          runtimeConfig
        ),

      probe: {
        ok:
          probe.ok === true,

        error:
          probe.error ||
          null,

        pythonVersion:
          probe.pythonVersion ||
          manifest
            ?.pythonVersion ||
          null,
      },

      packages,

      acceleration: {
        torchAvailable:
          torch.available ===
          true,

        torchVersion:
          torch.version ||
          manifest
            ?.torchVersion ||
          null,

        mpsBuilt:
          torch.mpsBuilt ===
          true,

        mpsAvailable:
          torch.mpsAvailable ===
          true,

        mpsTest:
          torch.mpsTest ||
          "unavailable",

        mpsError:
          torch.mpsError ||
          null,

        recommendedDevice:
          torch.mpsAvailable ===
            true &&
          torch.mpsTest ===
            "passed"
            ? "mps"
            : "cpu",
      },

      ffmpeg: {
        available:
          ffmpeg.available ===
          true,

        executable:
          ffmpeg.executable ||
          null,

        version:
          ffmpeg.version ||
          null,

        error:
          ffmpeg.error ||
          null,
      },

      installer: {
        available:
          filesystem
            .installerExists,

        automaticInstall:
          false,

        repairRequiresUserAction:
          true,
      },

      safety: {
        probeOnly:
          true,

        packageInstall:
          false,

        modelDownload:
          false,

        runtimeRepair:
          false,

        filesystemDeletion:
          false,

        networkAccess:
          false,
      },
    };
  }
}

module.exports = {
  ImageToVideoRuntimeCapabilityManager,
  REQUIRED_PACKAGES,
  defaultProbeRunner,
};
