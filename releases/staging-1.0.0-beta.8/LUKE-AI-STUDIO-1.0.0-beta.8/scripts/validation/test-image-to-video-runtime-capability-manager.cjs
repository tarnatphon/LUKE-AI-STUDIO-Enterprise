#!/usr/bin/env node
"use strict";

const fs =
  require("node:fs");

const os =
  require("node:os");

const path =
  require("node:path");

const {
  ImageToVideoRuntimeCapabilityManager,
} = require(
  "../server/image-to-video-runtime-capability-manager.cjs"
);

function main() {
  const root =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "luke-i2v-capability-"
      )
    );

  try {
    const runtimeRoot =
      path.join(
        root,
        "app",
        "runtimes",
        "image-to-video"
      );

    const pythonPath =
      process.platform ===
      "win32"
        ? path.join(
            runtimeRoot,
            "venv",
            "Scripts",
            "python.exe"
          )
        : path.join(
            runtimeRoot,
            "venv",
            "bin",
            "python"
          );

    fs.mkdirSync(
      path.dirname(
        pythonPath
      ),
      {
        recursive: true,
      }
    );

    fs.writeFileSync(
      pythonPath,
      ""
    );

    fs.chmodSync(
      pythonPath,
      0o755
    );

    fs.mkdirSync(
      path.join(
        root,
        "scripts",
        "workers"
      ),
      {
        recursive: true,
      }
    );

    fs.writeFileSync(
      path.join(
        root,
        "scripts",
        "workers",
        "install_image_to_video_runtime.py"
      ),
      "# test\n"
    );

    fs.mkdirSync(
      path.join(
        root,
        "app",
        "config"
      ),
      {
        recursive: true,
      }
    );

    fs.writeFileSync(
      path.join(
        root,
        "app",
        "config",
        "runtime-dependencies.json"
      ),
      "{}"
    );

    fs.writeFileSync(
      path.join(
        runtimeRoot,
        "installed.json"
      ),
      JSON.stringify({
        installed: true,
        pythonVersion:
          "3.test",
        torchVersion:
          "2.test",
      })
    );

    const fakeProbe =
      () => ({
        ok: true,

        pythonVersion:
          "3.test",

        packages: {
          torch: {
            installed: true,
            version: "2.test",
          },

          diffusers: {
            installed: true,
            version: "0.test",
          },

          transformers: {
            installed: true,
            version: "4.test",
          },

          accelerate: {
            installed: true,
            version: "1.test",
          },

          PIL: {
            installed: true,
            version: "11.test",
          },

          imageio: {
            installed: true,
            version: "2.test",
          },

          imageio_ffmpeg: {
            installed: true,
            version: "0.test",
          },

          safetensors: {
            installed: true,
            version: "0.test",
          },
        },

        torch: {
          available: true,
          version: "2.test",
          mpsBuilt: true,
          mpsAvailable: true,
          mpsTest: "passed",
        },

        ffmpeg: {
          available: true,
          executable:
            "/tmp/ffmpeg",
          version:
            "test",
        },
      });

    const manager =
      new ImageToVideoRuntimeCapabilityManager({
        root,
        probeRunner:
          fakeProbe,
      });

    const status =
      manager.getStatus();

    if (
      status.state !==
      "ready"
    ) {
      throw new Error(
        "Expected runtime ready."
      );
    }

    if (
      status.packages.ready !==
      true
    ) {
      throw new Error(
        "Package readiness failed."
      );
    }

    if (
      status.acceleration
        .recommendedDevice !==
      "mps"
    ) {
      throw new Error(
        "MPS recommendation failed."
      );
    }

    if (
      status.ffmpeg
        .available !==
      true
    ) {
      throw new Error(
        "FFmpeg readiness failed."
      );
    }

    if (
      status.safety
        .packageInstall !==
      false
    ) {
      throw new Error(
        "Capability manager must not install."
      );
    }

    console.log(
      "PASS: Image-to-Video runtime path is detected."
    );

    console.log(
      "PASS: Required package readiness is evaluated."
    );

    console.log(
      "PASS: Torch MPS capability is evaluated."
    );

    console.log(
      "PASS: FFmpeg capability is evaluated."
    );

    console.log(
      "PASS: Capability probe performs no package installation."
    );

    console.log(
      "PASS: Capability probe performs no model download."
    );

    console.log(
      "PASS: Image-to-Video Runtime Capability Manager validation completed."
    );

  } finally {
    fs.rmSync(
      root,
      {
        recursive: true,
        force: true,
      }
    );
  }
}

try {
  main();
} catch (error) {
  console.error(
    error instanceof Error
      ? error.stack ||
        error.message
      : String(error)
  );

  process.exit(1);
}
