#!/usr/bin/env python3
import argparse, json, os, platform, shutil, subprocess, sys
from pathlib import Path

PACKAGES = [
    "torch", "torchvision", "diffusers>=0.35.0", "transformers>=4.49.0",
    "accelerate>=1.2.0", "pillow", "imageio", "imageio-ffmpeg", "safetensors",
    "huggingface-hub>=0.27.0"
]

def emit(**payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)

def write_status(path, **payload):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

def run(cmd, status_path, step, env=None):
    write_status(status_path, state="installing", step=step, message=step)
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env)
    tail=[]
    for line in proc.stdout:
        line=line.rstrip()
        if line:
            tail=(tail+[line])[-30:]
            write_status(status_path, state="installing", step=step, message=line, log=tail)
    code=proc.wait()
    if code:
        raise RuntimeError(f"{step} failed (exit {code}). " + (tail[-1] if tail else ""))

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    ap.add_argument("--status", required=True)
    ap.add_argument("--repair", action="store_true")
    args=ap.parse_args()
    root=Path(args.root)
    runtime=root/"app"/"runtimes"/"image-to-video"
    venv=runtime/"venv"
    if args.repair and runtime.exists():
        shutil.rmtree(runtime)
    runtime.mkdir(parents=True, exist_ok=True)
    py = venv/("Scripts/python.exe" if os.name=="nt" else "bin/python")
    try:
        write_status(args.status, state="installing", step="Preparing", message="Preparing isolated Image-to-Video runtime…")
        if not py.exists():
            run([sys.executable, "-m", "venv", str(venv)], args.status, "Creating isolated Python environment")
        run([str(py), "-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"], args.status, "Updating installer")
        run([str(py), "-m", "pip", "install", "--upgrade", *PACKAGES], args.status, "Installing Image-to-Video components")
        verify = subprocess.run([str(py), "-c", "import torch,diffusers,transformers,accelerate,PIL,imageio,safetensors; print(torch.__version__)"], capture_output=True, text=True)
        if verify.returncode:
            raise RuntimeError("Runtime verification failed: " + (verify.stderr.strip() or verify.stdout.strip()))
        manifest={
            "capability":"image-to-video", "installed":True,
            "python":str(py), "pythonVersion":platform.python_version(),
            "torchVersion":verify.stdout.strip(), "packages":PACKAGES
        }
        (runtime/"installed.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        write_status(args.status, state="ready", step="Complete", message="Image-to-Video is installed and ready.", manifest=manifest)
        emit(ok=True, **manifest)
    except Exception as exc:
        write_status(args.status, state="error", step="Failed", message=str(exc))
        emit(ok=False, error=str(exc))
        raise SystemExit(1)

if __name__=="__main__": main()
