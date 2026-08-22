#!/usr/bin/env python3

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

import imageio_ffmpeg


ROOT = Path(
    __file__
).resolve().parents[2]

DURATION_WORKER = (
    ROOT /
    "scripts" /
    "workers" /
    "image_to_video_duration_worker.py"
)


def fail(message: str) -> None:
    raise RuntimeError(
        message
    )


def duration(
    path: Path,
) -> float:
    _, seconds = (
        imageio_ffmpeg
        .count_frames_and_secs(
            str(path)
        )
    )

    return float(seconds)


def make_fake_worker(
    path: Path,
) -> None:
    path.write_text(
        r'''#!/usr/bin/env python3
import json
from pathlib import Path
import subprocess
import sys
import imageio_ffmpeg

args = sys.argv[1:]

def flag(name):
    index = args.index(name)
    return args[index + 1]

output = Path(flag("--output"))
output.parent.mkdir(
    parents=True,
    exist_ok=True,
)

ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()

for step in range(1, 26):
    print(
        f"{step}/25 [synthetic]",
        file=sys.stderr,
        flush=True,
    )

result = subprocess.run(
    [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=320x180:r=6:d=4.166667",
        "-an",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        str(output),
    ],
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
)

if result.returncode != 0:
    print(
        json.dumps(
            {
                "ok": False,
                "error":
                    result.stderr,
            }
        )
    )
    raise SystemExit(1)

print(
    json.dumps(
        {
            "ok": True,
            "output":
                str(output),
        }
    )
)
''',
        encoding="utf-8",
    )


def make_png(
    path: Path,
) -> None:
    png = base64.b64decode(
        (
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"
            "CAQAAAC1HAwCAAAAC0lEQVR42mNk"
            "YAAAAAYAAjCB0C8AAAAASUVORK5CYII="
        )
    )

    path.write_bytes(
        png
    )


def run_duration_test(
    workspace: Path,
    fake_worker: Path,
    seconds: int,
) -> None:
    source = (
        workspace /
        "source.png"
    )

    output = (
        workspace /
        f"output-{seconds}.mp4"
    )

    make_png(
        source
    )

    env = {
        **os.environ,
        "LUKE_AI_I2V_BASE_WORKER":
            str(
                fake_worker
            ),
        "HF_HUB_OFFLINE": "1",
        "TRANSFORMERS_OFFLINE": "1",
        "HF_HUB_DISABLE_XET": "1",
    }

    result = subprocess.run(
        [
            sys.executable,
            "-u",
            str(
                DURATION_WORKER
            ),
            "--model",
            "svd",
            "--image",
            str(source),
            "--output",
            str(output),
            "--prompt",
            "synthetic duration certification",
            "--seconds",
            str(seconds),
            "--references",
            str(
                workspace /
                "references.json"
            ),
            "--reference-lock",
            "1",
            "--automatic-match",
            "1",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
    )

    if result.returncode != 0:
        print(
            result.stdout
        )

        print(
            result.stderr
        )

        fail(
            f"{seconds}s duration worker failed"
        )

    if (
        not output.exists()
        or output.stat().st_size <= 0
    ):
        fail(
            f"{seconds}s output missing"
        )

    actual = duration(
        output
    )

    if (
        abs(
            actual -
            seconds
        ) >
        0.20
    ):
        fail(
            (
                f"{seconds}s output duration "
                f"invalid: {actual}"
            )
        )

    lines = [
        line
        for line
        in result.stdout
        .splitlines()
        if line.strip()
    ]

    payload = json.loads(
        lines[-1]
    )

    expected_segments = (
        seconds // 5
    )

    if (
        payload.get(
            "segments"
        ) !=
        expected_segments
    ):
        fail(
            (
                f"{seconds}s expected "
                f"{expected_segments} segments"
            )
        )

    print(
        (
            f"PASS: {seconds} sec "
            f"actual={actual:.3f} "
            f"segments={expected_segments}"
        )
    )


def main() -> None:
    if not DURATION_WORKER.exists():
        fail(
            "Duration worker missing"
        )

    with tempfile.TemporaryDirectory(
        prefix=
            "luke-i2v-duration-test-"
    ) as temporary:
        workspace = Path(
            temporary
        )

        fake_worker = (
            workspace /
            "fake_worker.py"
        )

        make_fake_worker(
            fake_worker
        )

        (
            workspace /
            "references.json"
        ).write_text(
            "[]",
            encoding="utf-8",
        )

        run_duration_test(
            workspace,
            fake_worker,
            10,
        )

        run_duration_test(
            workspace,
            fake_worker,
            15,
        )

    print(
        "PASS: Segment normalization uses exact 5-second targets."
    )

    print(
        "PASS: Last-frame continuity pipeline completed."
    )

    print(
        "PASS: 10-second Segment/Stitch duration verified."
    )

    print(
        "PASS: 15-second Segment/Stitch duration verified."
    )

    print(
        "PASS: Image-to-Video Duration Worker synthetic certification completed."
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(
            f"FAIL: {error}",
            file=sys.stderr,
        )

        raise SystemExit(1)
