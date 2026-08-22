"use strict";

const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const PICKER_OPTIONS = {
  timeout: 120000,
  shell: false,
  maxBuffer: 1024 * 1024,
};

function cancelledError() {
  const error = new Error("Folder selection was cancelled.");
  error.statusCode = 409;
  error.cancelled = true;
  return error;
}

function isMissingCommand(error) {
  return error?.code === "ENOENT";
}

function isCancelled(error) {
  const message = String(error instanceof Error ? error.message : error);
  return Boolean(
    error?.cancelled ||
      error?.code === 1 ||
      error?.code === 2 ||
      message.includes("User canceled") ||
      message.includes("-128")
  );
}

function resolvedDefault(defaultLocation) {
  return defaultLocation
    ? path.resolve(String(defaultLocation))
    : path.resolve(process.cwd());
}

async function chooseOnMac({ prompt, defaultLocation }) {
  const safePrompt = String(prompt)
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"');
  const lines = [];

  if (defaultLocation) {
    const escaped = resolvedDefault(defaultLocation)
      .replaceAll("\\", "\\\\")
      .replaceAll('"', '\\"');
    lines.push(
      `set defaultFolder to POSIX file "${escaped}"`,
      `set selectedFolder to choose folder with prompt "${safePrompt}" default location defaultFolder`
    );
  } else {
    lines.push(`set selectedFolder to choose folder with prompt "${safePrompt}"`);
  }

  lines.push("return POSIX path of selectedFolder");
  return execFileAsync(
    "/usr/bin/osascript",
    ["-e", lines.join("\n")],
    PICKER_OPTIONS
  );
}

async function chooseOnWindows({ prompt, defaultLocation }) {
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$dialog.Description = $env:LUKE_AI_FOLDER_PROMPT",
    "$dialog.ShowNewFolderButton = $true",
    "if ($env:LUKE_AI_FOLDER_DEFAULT) { $dialog.SelectedPath = $env:LUKE_AI_FOLDER_DEFAULT }",
    "$result = $dialog.ShowDialog()",
    "if ($result -ne [System.Windows.Forms.DialogResult]::OK) { exit 2 }",
    "[Console]::Out.WriteLine($dialog.SelectedPath)",
  ].join("; ");
  const argumentsValue = [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-STA",
    "-Command",
    script,
  ];
  const options = {
    ...PICKER_OPTIONS,
    windowsHide: false,
    env: {
      ...process.env,
      LUKE_AI_FOLDER_PROMPT: String(prompt),
      LUKE_AI_FOLDER_DEFAULT: defaultLocation
        ? resolvedDefault(defaultLocation)
        : "",
    },
  };

  try {
    return await execFileAsync("powershell.exe", argumentsValue, options);
  } catch (error) {
    if (!isMissingCommand(error)) {
      throw error;
    }
    return execFileAsync("pwsh.exe", argumentsValue, options);
  }
}

async function chooseOnLinux({ prompt, defaultLocation }) {
  const initialPath = resolvedDefault(defaultLocation);
  const zenityPath = initialPath.endsWith(path.sep)
    ? initialPath
    : `${initialPath}${path.sep}`;

  try {
    return await execFileAsync(
      "zenity",
      [
        "--file-selection",
        "--directory",
        `--title=${String(prompt)}`,
        `--filename=${zenityPath}`,
      ],
      PICKER_OPTIONS
    );
  } catch (error) {
    if (!isMissingCommand(error)) {
      throw error;
    }
  }

  try {
    return await execFileAsync(
      "kdialog",
      ["--title", String(prompt), "--getexistingdirectory", initialPath],
      PICKER_OPTIONS
    );
  } catch (error) {
    if (!isMissingCommand(error)) {
      throw error;
    }
    const unavailable = new Error(
      "No supported Linux folder picker was found. Install Zenity or KDialog."
    );
    unavailable.statusCode = 501;
    throw unavailable;
  }
}

async function chooseStorageFolder({
  prompt = "Choose a storage folder for LUKE AI STUDIO",
  defaultLocation = null,
} = {}) {
  let result;

  try {
    if (process.platform === "darwin") {
      result = await chooseOnMac({ prompt, defaultLocation });
    } else if (process.platform === "win32") {
      result = await chooseOnWindows({ prompt, defaultLocation });
    } else if (process.platform === "linux") {
      result = await chooseOnLinux({ prompt, defaultLocation });
    } else {
      const unsupported = new Error(
        `Native folder picker is not supported on ${process.platform}.`
      );
      unsupported.statusCode = 501;
      throw unsupported;
    }
  } catch (error) {
    if (isCancelled(error)) {
      throw cancelledError();
    }
    throw error;
  }

  const selectedPath = String(result?.stdout || "").trim();
  if (!selectedPath) {
    const error = new Error("No folder was selected.");
    error.statusCode = 400;
    throw error;
  }

  return {
    selectedPath: path.resolve(selectedPath),
    platform: process.platform,
  };
}

module.exports = {
  chooseStorageFolder,
};
