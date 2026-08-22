"use strict";

const path = require("node:path");
const {
  execFile,
} = require("node:child_process");
const {
  promisify,
} = require("node:util");

const execFileAsync =
  promisify(execFile);

async function chooseStorageFolder({
  prompt =
    "Choose a storage folder for LUKE AI STUDIO",
  defaultLocation = null,
} = {}) {
  if (
    process.platform !==
    "darwin"
  ) {
    const error =
      new Error(
        "Native folder picker is currently supported on macOS."
      );

    error.statusCode = 501;
    throw error;
  }

  const safePrompt =
    String(prompt)
      .replaceAll("\\", "\\\\")
      .replaceAll('"', '\\"');

  const script = [
    `set selectedFolder to choose folder with prompt "${safePrompt}"`,
    "return POSIX path of selectedFolder",
  ].join("\n");

  const argumentsValue = [
    "-e",
    script,
  ];

  if (defaultLocation) {
    const resolved =
      path.resolve(
        String(defaultLocation)
      );

    const escaped =
      resolved
        .replaceAll("\\", "\\\\")
        .replaceAll('"', '\\"');

    argumentsValue.splice(
      1,
      1,
      "-e",
      [
        `set defaultFolder to POSIX file "${escaped}"`,
        `set selectedFolder to choose folder with prompt "${safePrompt}" default location defaultFolder`,
        "return POSIX path of selectedFolder",
      ].join("\n")
    );
  }

  try {
    const result =
      await execFileAsync(
        "/usr/bin/osascript",
        argumentsValue,
        {
          timeout: 120000,
          shell: false,
          maxBuffer:
            1024 * 1024,
        }
      );

    const selectedPath =
      String(
        result.stdout || ""
      ).trim();

    if (!selectedPath) {
      const error =
        new Error(
          "No folder was selected."
        );

      error.statusCode = 400;
      throw error;
    }

    return {
      selectedPath:
        path.resolve(
          selectedPath
        ),
      platform:
        process.platform,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    if (
      message.includes(
        "User canceled"
      ) ||
      message.includes(
        "-128"
      )
    ) {
      const cancelled =
        new Error(
          "Folder selection was cancelled."
        );

      cancelled.statusCode = 409;
      cancelled.cancelled =
        true;

      throw cancelled;
    }

    throw error;
  }
}

module.exports = {
  chooseStorageFolder,
};
