#!/usr/bin/env python3

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
from typing import Iterable

import imageio_ffmpeg


SEGMENT_SECONDS = 5
OUTPUT_FPS = 6
SUPPORTED_DURATIONS = {
    10,
    15,
}

_progress_pattern = re.compile(
    r"(?<!\d)(\d{1,4})\s*/\s*(\d{1,4})(?!\d)"
)

_active_child: subprocess.Popen[str] | None = None
_cancelled = False


def emit_json(payload: dict) -> None:
    print(
        json.dumps(
            payload,
            ensure_ascii=False,
        ),
        flush=True,
    )


def fail(message: str, code: int = 1) -> int:
    emit_json(
        {
            "ok": False,
            "error": message,
        }
    )

    return code


def get_flag(
    args: list[str],
    name: str,
    default: str | None = None,
) -> str | None:
    try:
        index = args.index(name)
    except ValueError:
        return default

    if index + 1 >= len(args):
        return default

    return args[index + 1]


def replace_flag(
    args: list[str],
    name: str,
    value: str,
) -> list[str]:
    result = list(args)

    try:
        index = result.index(name)
    except ValueError:
        result.extend(
            [
                name,
                value,
            ]
        )

        return result

    if index + 1 >= len(result):
        result.append(value)
    else:
        result[index + 1] = value

    return result


def remove_flag(
    args: list[str],
    name: str,
) -> list[str]:
    result: list[str] = []

    index = 0

    while index < len(args):
        if args[index] == name:
            index += 2
            continue

        result.append(
            args[index]
        )

        index += 1

    return result


def video_duration(
    video_path: Path,
) -> float:
    _, seconds = (
        imageio_ffmpeg
        .count_frames_and_secs(
            str(video_path)
        )
    )

    return float(seconds)


def run_ffmpeg(
    arguments: Iterable[str],
) -> None:
    ffmpeg = (
        imageio_ffmpeg
        .get_ffmpeg_exe()
    )

    command = [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        *arguments,
    ]

    result = subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    if result.returncode != 0:
        message = (
            result.stderr.strip()
            or result.stdout.strip()
            or "FFmpeg operation failed."
        )

        raise RuntimeError(
            message
        )


def normalize_segment(
    source: Path,
    target: Path,
    target_seconds: float = SEGMENT_SECONDS,
) -> None:
    current_seconds = (
        video_duration(
            source
        )
    )

    if current_seconds <= 0:
        raise RuntimeError(
            "Generated segment has invalid duration."
        )

    stretch_factor = (
        target_seconds /
        current_seconds
    )

    filter_value = (
        f"setpts={stretch_factor:.10f}*PTS,"
        f"fps={OUTPUT_FPS}"
    )

    run_ffmpeg(
        [
            "-i",
            str(source),
            "-an",
            "-vf",
            filter_value,
            "-t",
            f"{target_seconds:.6f}",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(target),
        ]
    )


def extract_last_frame(
    video_path: Path,
    output_image: Path,
) -> None:
    run_ffmpeg(
        [
            "-sseof",
            "-0.20",
            "-i",
            str(video_path),
            "-frames:v",
            "1",
            str(output_image),
        ]
    )

    if (
        not output_image.exists()
        or output_image.stat().st_size <= 0
    ):
        raise RuntimeError(
            "Unable to extract continuity frame."
        )


def concat_segments(
    segments: list[Path],
    target: Path,
    target_seconds: float,
    workspace: Path,
) -> None:
    concat_file = (
        workspace /
        "segments.txt"
    )

    concat_lines = []

    for segment in segments:
        escaped = (
            str(segment)
            .replace(
                "'",
                "'\\''",
            )
        )

        concat_lines.append(
            f"file '{escaped}'"
        )

    concat_file.write_text(
        "\n".join(
            concat_lines
        ) + "\n",
        encoding="utf-8",
    )

    joined = (
        workspace /
        "joined.mp4"
    )

    run_ffmpeg(
        [
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_file),
            "-c",
            "copy",
            str(joined),
        ]
    )

    current_seconds = (
        video_duration(
            joined
        )
    )

    if current_seconds <= 0:
        raise RuntimeError(
            "Joined video has invalid duration."
        )

    stretch_factor = (
        target_seconds /
        current_seconds
    )

    run_ffmpeg(
        [
            "-i",
            str(joined),
            "-an",
            "-vf",
            (
                f"setpts={stretch_factor:.10f}*PTS,"
                f"fps={OUTPUT_FPS}"
            ),
            "-t",
            f"{target_seconds:.6f}",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(target),
        ]
    )


def transform_progress_line(
    text: str,
    segment_index: int,
    segment_count: int,
) -> str | None:
    matches = list(
        _progress_pattern
        .finditer(text)
    )

    if not matches:
        return None

    match = matches[-1]

    step = int(
        match.group(1)
    )

    total = int(
        match.group(2)
    )

    if (
        total < 20
        or step < 0
        or step > total
    ):
        return None

    global_step = (
        segment_index *
        total
    ) + step

    global_total = (
        segment_count *
        total
    )

    return (
        f"{global_step}/{global_total} "
        f"[segment "
        f"{segment_index + 1}/"
        f"{segment_count}]"
    )


def stream_pipe(
    pipe,
    destination,
    progress: bool,
    segment_index: int,
    segment_count: int,
    collected: list[str],
) -> None:
    buffer = ""

    while True:
        character = (
            pipe.read(1)
        )

        if character == "":
            break

        if character in {
            "\r",
            "\n",
        }:
            if buffer:
                if progress:
                    transformed = (
                        transform_progress_line(
                            buffer,
                            segment_index,
                            segment_count,
                        )
                    )

                    if transformed:
                        print(
                            transformed,
                            file=destination,
                            flush=True,
                        )
                    else:
                        print(
                            buffer,
                            file=destination,
                            flush=True,
                        )
                else:
                    collected.append(
                        buffer
                    )

                    if not (
                        buffer.lstrip()
                        .startswith("{")
                        and buffer.rstrip()
                        .endswith("}")
                    ):
                        print(
                            buffer,
                            file=destination,
                            flush=True,
                        )

                buffer = ""

            continue

        buffer += character

    if buffer:
        if progress:
            transformed = (
                transform_progress_line(
                    buffer,
                    segment_index,
                    segment_count,
                )
            )

            if transformed:
                print(
                    transformed,
                    file=destination,
                    flush=True,
                )
            else:
                print(
                    buffer,
                    file=destination,
                    flush=True,
                )
        else:
            collected.append(
                buffer
            )


def parse_worker_result(
    lines: list[str],
) -> dict | None:
    for line in reversed(
        lines
    ):
        text = line.strip()

        if not text.startswith(
            "{"
        ):
            continue

        try:
            parsed = (
                json.loads(text)
            )
        except Exception:
            continue

        if isinstance(
            parsed,
            dict,
        ):
            return parsed

    return None


def signal_handler(
    signum,
    _frame,
) -> None:
    global _cancelled

    _cancelled = True

    child = _active_child

    if (
        child is not None
        and child.poll() is None
    ):
        try:
            child.send_signal(
                signum
            )
        except Exception:
            try:
                child.terminate()
            except Exception:
                pass


def run_base_worker(
    worker: Path,
    args: list[str],
    segment_index: int,
    segment_count: int,
) -> dict:
    global _active_child

    stdout_lines: list[str] = []

    process = subprocess.Popen(
        [
            sys.executable,
            "-u",
            str(worker),
            *args,
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=0,
        env={
            **os.environ,
            "HF_HUB_OFFLINE": "1",
            "TRANSFORMERS_OFFLINE": "1",
            "HF_HUB_DISABLE_XET": "1",
            "TOKENIZERS_PARALLELISM": "false",
            "PYTHONUNBUFFERED": "1",
        },
    )

    _active_child = process

    assert (
        process.stdout
        is not None
    )

    assert (
        process.stderr
        is not None
    )

    stdout_thread = threading.Thread(
        target=stream_pipe,
        args=(
            process.stdout,
            sys.stdout,
            False,
            segment_index,
            segment_count,
            stdout_lines,
        ),
        daemon=True,
    )

    stderr_thread = threading.Thread(
        target=stream_pipe,
        args=(
            process.stderr,
            sys.stderr,
            True,
            segment_index,
            segment_count,
            [],
        ),
        daemon=True,
    )

    stdout_thread.start()
    stderr_thread.start()

    return_code = (
        process.wait()
    )

    stdout_thread.join()
    stderr_thread.join()

    _active_child = None

    if _cancelled:
        raise KeyboardInterrupt

    result = (
        parse_worker_result(
            stdout_lines
        )
    )

    if (
        return_code != 0
        or result is None
        or result.get("ok")
        is not True
    ):
        error = (
            result.get("error")
            if isinstance(
                result,
                dict,
            )
            else None
        )

        raise RuntimeError(
            error
            or (
                "Image-to-Video segment "
                f"{segment_index + 1} failed "
                f"with exit code {return_code}."
            )
        )

    return result


def main() -> int:
    raw_args = (
        sys.argv[1:]
    )

    output_value = (
        get_flag(
            raw_args,
            "--output",
        )
    )

    input_value = (
        get_flag(
            raw_args,
            "--image",
        )
    )

    duration_value = (
        get_flag(
            raw_args,
            "--seconds",
            "5",
        )
    )

    if not output_value:
        return fail(
            "--output is required."
        )

    if not input_value:
        return fail(
            "--image is required."
        )

    try:
        requested_seconds = int(
            float(
                duration_value
                or "5"
            )
        )
    except ValueError:
        return fail(
            "Invalid --seconds value."
        )

    if (
        requested_seconds
        not in SUPPORTED_DURATIONS
    ):
        return fail(
            "Duration worker supports only 10 or 15 seconds."
        )

    segment_count = (
        requested_seconds //
        SEGMENT_SECONDS
    )

    output_path = Path(
        output_value
    ).resolve()

    initial_image = Path(
        input_value
    ).resolve()

    output_path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    base_worker = Path(
        os.environ.get(
            "LUKE_AI_I2V_BASE_WORKER",
            Path(__file__)
            .with_name(
                "image_to_video_worker.py"
            ),
        )
    ).resolve()

    if not base_worker.exists():
        return fail(
            "Base Image-to-Video worker is missing."
        )

    signal.signal(
        signal.SIGTERM,
        signal_handler,
    )

    signal.signal(
        signal.SIGINT,
        signal_handler,
    )

    workspace_parent = (
        output_path.parent
    )

    try:
        with tempfile.TemporaryDirectory(
            prefix=(
                output_path.stem +
                "-segments-"
            ),
            dir=str(
                workspace_parent
            ),
        ) as temporary:
            workspace = Path(
                temporary
            )

            segments: list[
                Path
            ] = []

            current_image = (
                initial_image
            )

            for index in range(
                segment_count
            ):
                if _cancelled:
                    raise KeyboardInterrupt

                raw_segment = (
                    workspace /
                    f"segment-{index + 1}-raw.mp4"
                )

                normalized_segment = (
                    workspace /
                    f"segment-{index + 1}.mp4"
                )

                segment_args = (
                    list(
                        raw_args
                    )
                )

                segment_args = (
                    replace_flag(
                        segment_args,
                        "--image",
                        str(
                            current_image
                        ),
                    )
                )

                segment_args = (
                    replace_flag(
                        segment_args,
                        "--output",
                        str(
                            raw_segment
                        ),
                    )
                )

                segment_args = (
                    replace_flag(
                        segment_args,
                        "--seconds",
                        str(
                            SEGMENT_SECONDS
                        ),
                    )
                )

                print(
                    (
                        f"Starting segment "
                        f"{index + 1}/"
                        f"{segment_count}"
                    ),
                    file=sys.stderr,
                    flush=True,
                )

                run_base_worker(
                    base_worker,
                    segment_args,
                    index,
                    segment_count,
                )

                if (
                    not raw_segment.exists()
                    or raw_segment
                    .stat()
                    .st_size <= 0
                ):
                    raise RuntimeError(
                        (
                            "Segment output "
                            f"{index + 1} "
                            "was not created."
                        )
                    )

                normalize_segment(
                    raw_segment,
                    normalized_segment,
                )

                segments.append(
                    normalized_segment
                )

                if (
                    index <
                    segment_count - 1
                ):
                    continuity_image = (
                        workspace /
                        (
                            "continuity-"
                            f"{index + 1}.png"
                        )
                    )

                    extract_last_frame(
                        normalized_segment,
                        continuity_image,
                    )

                    current_image = (
                        continuity_image
                    )

            temporary_output = (
                workspace /
                "final.mp4"
            )

            concat_segments(
                segments,
                temporary_output,
                requested_seconds,
                workspace,
            )

            final_seconds = (
                video_duration(
                    temporary_output
                )
            )

            tolerance = 0.20

            if (
                abs(
                    final_seconds -
                    requested_seconds
                ) >
                tolerance
            ):
                raise RuntimeError(
                    (
                        "Final duration verification failed: "
                        f"expected "
                        f"{requested_seconds:.2f}s, "
                        f"got "
                        f"{final_seconds:.3f}s."
                    )
                )

            shutil.move(
                str(
                    temporary_output
                ),
                str(
                    output_path
                ),
            )

        emit_json(
            {
                "ok": True,
                "output":
                    str(
                        output_path
                    ),
                "requestedSeconds":
                    requested_seconds,
                "actualSeconds":
                    round(
                        final_seconds,
                        3,
                    ),
                "segments":
                    segment_count,
                "segmentSeconds":
                    SEGMENT_SECONDS,
                "continuity":
                    "last-frame",
                "strategy":
                    "segment-stitch-v1",
            }
        )

        return 0

    except KeyboardInterrupt:
        return fail(
            "Image-to-Video duration job was cancelled.",
            130,
        )

    except Exception as exc:
        return fail(
            str(exc)
        )


if __name__ == "__main__":
    raise SystemExit(
        main()
    )
