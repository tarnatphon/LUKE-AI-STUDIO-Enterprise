import {
  readSheet,
} from "read-excel-file/browser";

function normalizeCell(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  if (
    value instanceof Date
  ) {
    return value.toISOString();
  }

  return String(value).trim();
}

function parseCsvLine(line) {
  const values = [];

  let current = "";
  let quoted = false;

  for (
    let index = 0;
    index < line.length;
    index += 1
  ) {
    const character =
      line[index];

    if (
      character === '"'
    ) {
      if (
        quoted &&
        line[index + 1] === '"'
      ) {
        current += '"';
        index += 1;
        continue;
      }

      quoted = !quoted;
      continue;
    }

    if (
      character === "," &&
      !quoted
    ) {
      values.push(
        current.trim(),
      );

      current = "";
      continue;
    }

    current += character;
  }

  values.push(
    current.trim(),
  );

  return values;
}

export function parseCsvText(
  text,
) {
  return String(
    text || "",
  )
    .split(/\r?\n/)
    .filter(
      (line) =>
        line.trim(),
    )
    .map(
      parseCsvLine,
    );
}

function rowsToBatch(
  rows,
) {
  if (
    !Array.isArray(rows) ||
    rows.length === 0
  ) {
    return [];
  }

  const header =
    rows[0].map(
      (cell) =>
        normalizeCell(cell)
          .toLowerCase(),
    );

  const promptIndex =
    header.findIndex(
      (value) =>
        [
          "prompt",
          "prompts",
          "description",
          "video prompt",
          "video_prompt",
        ].includes(
          value,
        ),
    );

  const durationIndex =
    header.findIndex(
      (value) =>
        [
          "duration",
          "seconds",
          "sec",
          "length",
        ].includes(
          value,
        ),
    );

  const effectivePromptIndex =
    promptIndex >= 0
      ? promptIndex
      : 0;

  return rows
    .slice(1)
    .map(
      (row, index) => {
        const prompt =
          normalizeCell(
            row[
              effectivePromptIndex
            ],
          );

        const duration =
          durationIndex >= 0
            ? Number(
                row[
                  durationIndex
                ],
              )
            : null;

        return {
          id:
            `import-${index + 1}`,

          prompt,

          duration:
            [5, 10, 15]
              .includes(duration)
              ? duration
              : null,

          raw:
            row.map(
              normalizeCell,
            ),
        };
      },
    )
    .filter(
      (item) =>
        item.prompt,
    );
}

export async function importPromptFile(
  file,
) {
  if (!file) {
    throw new Error(
      "Select a prompt file first.",
    );
  }

  const name =
    String(
      file.name || "",
    ).toLowerCase();

  if (
    name.endsWith(
      ".txt",
    ) ||
    name.endsWith(
      ".md",
    )
  ) {
    const text =
      await file.text();

    const prompt =
      text.trim();

    return {
      type: "text",
      prompt,
      rows:
        prompt
          ? [
              {
                id:
                  "import-1",
                prompt,
                duration:
                  null,
                raw:
                  [prompt],
              },
            ]
          : [],
    };
  }

  if (
    name.endsWith(
      ".csv",
    )
  ) {
    const text =
      await file.text();

    const rows =
      rowsToBatch(
        parseCsvText(
          text,
        ),
      );

    return {
      type: "csv",
      prompt:
        rows[0]
          ?.prompt ||
        "",
      rows,
    };
  }

  if (
    name.endsWith(
      ".xlsx",
    )
  ) {
    const sheet =
      await readSheet(
        file,
      );

    const rows =
      rowsToBatch(
        sheet,
      );

    return {
      type: "xlsx",
      prompt:
        rows[0]
          ?.prompt ||
        "",
      rows,
    };
  }

  throw new Error(
    "Supported prompt files are .txt, .md, .csv and .xlsx.",
  );
}
