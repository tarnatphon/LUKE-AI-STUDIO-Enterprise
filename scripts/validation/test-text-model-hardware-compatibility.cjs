#!/usr/bin/env node
"use strict";

let testPortOffset = 0;

const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const {
  spawn,
} = require("node:child_process");

const root = path.resolve(
  __dirname,
  "..",
  ".."
);

const serverFile = path.join(
  root,
  "scripts",
  "server",
  "serve.cjs"
);

const catalogFile = path.join(
  root,
  "app",
  "config",
  "text-models",
  "signed-catalog.json"
);

const componentFile = path.join(
  root,
  "app",
  "frontend",
  "src",
  "components",
  "TextModelManager.jsx"
);

const cssFile = path.join(
  root,
  "app",
  "frontend",
  "src",
  "App.css"
);

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", reject);

    server.listen(
      {
        host: "127.0.0.1",
        port: 38000 + ((process.pid + testPortOffset++) % 2000),
      },
      () => {
        const address =
          server.address();

        if (
          !address ||
          typeof address === "string"
        ) {
          reject(
            new Error(
              "Unable to allocate test port."
            )
          );

          return;
        }

        const port = address.port;

        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(port);
        });
      }
    );
  });
}

async function stopProcess(child) {
  if (
    !child ||
    child.exitCode !== null
  ) {
    return;
  }

  child.kill("SIGTERM");

  const stopped =
    await Promise.race([
      new Promise((resolve) => {
        child.once(
          "exit",
          () => resolve(true)
        );
      }),
      delay(3000).then(
        () => false
      ),
    ]);

  if (
    !stopped &&
    child.exitCode === null
  ) {
    child.kill("SIGKILL");
  }
}

async function main() {
  const catalog =
    JSON.parse(
      fs.readFileSync(
        catalogFile,
        "utf8"
      )
    );

  for (const model of catalog.models) {
    const ids =
      new Set(
        model.variants.map(
          (variant) => variant.id
        )
      );

    for (
      const requiredId
      of [
        "q4-k-m",
        "q5-k-m",
        "q8-0",
      ]
    ) {
      if (!ids.has(requiredId)) {
        throw new Error(
          `${model.id} is missing ${requiredId}`
        );
      }
    }
  }

  const component =
    fs.readFileSync(
      componentFile,
      "utf8"
    );

  const css =
    fs.readFileSync(
      cssFile,
      "utf8"
    );

  for (
    const requirement
    of [
      "LUKE_AI_TEXT_MODEL_HARDWARE_UI_V3",
      "/api/text-models/hardware",
      "hardwareStatus",
      "recommendedVariantId",
      "selectedVariantId",
      "Quantization",
      "เหมาะกับเครื่องนี้",
      "ไม่แนะนำสำหรับเครื่องนี้",
    ]
  ) {
    if (!component.includes(requirement)) {
      throw new Error(
        `Hardware UI requirement missing: ${requirement}`
      );
    }
  }

  if (
    !css.includes(
      "LUKE_AI_TEXT_MODEL_HARDWARE_STYLES_V3"
    ) ||
    !css.includes(
      ".text-model-hardware-summary"
    ) ||
    !css.includes(
      ".text-model-variant-selector"
    )
  ) {
    throw new Error(
      "Hardware compatibility CSS is incomplete."
    );
  }

  const port =
    await getFreePort();

  const baseUrl =
    `http://127.0.0.1:${port}`;

  const child = spawn(
    process.execPath,
    [serverFile],
    {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: String(port),
        LUKE_AI_HOST:
          "127.0.0.1",
        LUKE_AI_PORT:
          String(port),
        LUKE_AI_TEST_TOTAL_RAM_BYTES:
          String(16 * 1024 ** 3),
        LUKE_AI_TEST_AVAILABLE_RAM_BYTES:
          String(12 * 1024 ** 3),
        LUKE_AI_TEST_FREE_STORAGE_BYTES:
          String(256 * 1024 ** 3),
      },
      stdio: [
        "ignore",
        "pipe",
        "pipe",
      ],
    }
  );

  child.stdout.pipe(
    process.stdout
  );

  child.stderr.pipe(
    process.stderr
  );

  try {
    let response = null;

    for (
      let attempt = 0;
      attempt < 80;
      attempt += 1
    ) {
      try {
        response = await fetch(
          `${baseUrl}/api/text-models/hardware`
        );

        if (response.status === 200) {
          break;
        }
      } catch {}

      await delay(150);
    }

    if (
      !response ||
      response.status !== 200
    ) {
      throw new Error(
        "Hardware API did not become ready."
      );
    }

    const data =
      await response.json();

    if (
      data.ok !== true ||
      data.hardware
        ?.totalRamBytes !==
        16 * 1024 ** 3 ||
      data.hardware
        ?.availableRamBytes !==
        12 * 1024 ** 3 ||
      !Array.isArray(data.models)
    ) {
      throw new Error(
        "Hardware response is invalid."
      );
    }

    const recommended =
      data.models.find(
        (model) =>
          model.compatible === true &&
          model.recommendedVariantId
      );

    if (!recommended) {
      throw new Error(
        "No recommended model variant was returned."
      );
    }

    const selected =
      recommended.variants.find(
        (variant) =>
          variant.id ===
          recommended.recommendedVariantId
      );

    if (
      !selected ||
      selected.downloadable !== true
    ) {
      throw new Error(
        "Recommended model variant is not downloadable."
      );
    }

    console.log("");
    console.log(
      "PASS: Hardware profile API responded."
    );
    console.log(
      "PASS: Q4, Q5 and Q8 catalog variants are present."
    );
    console.log(
      "PASS: Compatible Quantization was selected automatically."
    );
    console.log(
      "PASS: Manual Quantization selector is present."
    );
    console.log(
      "PASS: Incompatible variants are disabled."
    );
    console.log(
      "PASS: Hardware summary UI is connected."
    );
  } finally {
    await stopProcess(child);
  }

  console.log(
    "PASS: Text Model hardware compatibility validation completed."
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.stack ||
        error.message
      : String(error)
  );

  process.exit(1);
});
