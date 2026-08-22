#!/usr/bin/env python3
"""Automatic reference-matched local Image-to-Video worker."""
import argparse, json
from pathlib import Path


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def fail(message, code=2):
    emit({"ok": False, "error": message}); raise SystemExit(code)


def fit_frame(image, width=1024, height=576):
    """Fit without stretching and use a restrained neutral canvas."""
    from PIL import Image
    image = image.convert("RGB")
    ratio = min(width / image.width, height / image.height)
    resized = image.resize((max(1, int(image.width * ratio)), max(1, int(image.height * ratio))), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (width, height), resized.resize((1, 1)).getpixel((0, 0)))
    canvas.paste(resized, ((width - resized.width) // 2, (height - resized.height) // 2))
    return canvas


def prepare_reference_frame(source, refs, device, dtype, automatic_match):
    if not refs:
        return source
    try:
        import torch
        from diffusers import AutoPipelineForImage2Image
        from PIL import Image
        pipe = AutoPipelineForImage2Image.from_pretrained(
            "stabilityai/stable-diffusion-xl-refiner-1.0",
            torch_dtype=dtype,
            variant="fp16",
            use_safetensors=True,
        )
        pipe.load_ip_adapter("h94/IP-Adapter", subfolder="sdxl_models", weight_name="ip-adapter_sdxl.bin")
        if device == "cuda": pipe.enable_model_cpu_offload()
        else: pipe.to(device)
        images = [Image.open(item["path"]).convert("RGB") for item in refs]
        # Automatic mode deliberately prioritizes similarity over creativity.
        pipe.set_ip_adapter_scale(1.0 if automatic_match else sum(float(x.get("weight", .85)) for x in refs) / len(refs))
        prompt = (
            "Create an opening frame that is as visually identical to the supplied source and reference photographs as possible. "
            "Preserve exact face and identity, age, hairstyle, skin tone, body proportions, clothing cut, fabric pattern, seams, colors, "
            "product geometry, materials, texture, artwork, text and logo placement. Preserve the same background and lighting. "
            "Do not redesign, restyle, beautify, replace, add or remove anything. Photorealistic reconstruction only."
        )
        negative = (
            "different person, changed face, changed hairstyle, changed clothes, changed logo, changed text, changed product shape, "
            "new accessories, extra objects, missing details, stylized, illustration, distorted hands, warped fabric, color shift"
        )
        result = pipe(
            prompt=prompt,
            negative_prompt=negative,
            image=source,
            ip_adapter_image=images,
            strength=.12 if automatic_match else .28,
            guidance_scale=4.0 if automatic_match else 6.0,
            num_inference_steps=30 if automatic_match else 24,
        ).images[0]
        del pipe
        if device == "cuda": torch.cuda.empty_cache()
        return result
    except Exception as exc:
        fail("Automatic Reference Match requires SDXL/IP-Adapter support. Install current diffusers, transformers, accelerate and safetensors. Details: " + str(exc))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True); ap.add_argument("--image", required=True); ap.add_argument("--output", required=True)
    ap.add_argument("--prompt", default=""); ap.add_argument("--seconds", type=int, default=5); ap.add_argument("--references", default="")
    ap.add_argument("--reference-lock", default="1"); ap.add_argument("--automatic-match", default="0")
    args = ap.parse_args(); automatic_match = args.automatic_match != "0"
    try:
        import torch
        from PIL import Image
        from diffusers import StableVideoDiffusionPipeline
        from diffusers.utils import export_to_video
    except Exception as exc:
        fail("Image-to-Video runtime is not installed. Install torch, diffusers, transformers, accelerate, pillow, imageio, imageio-ffmpeg and safetensors. Details: " + str(exc))
    repo = {"svd-xt":"stabilityai/stable-video-diffusion-img2vid-xt", "svd":"stabilityai/stable-video-diffusion-img2vid"}.get(args.model)
    if not repo: fail(f"Model '{args.model}' does not have a verified local worker adapter.")
    if torch.cuda.is_available(): device, dtype = "cuda", torch.float16
    elif getattr(torch.backends, "mps", None) and torch.backends.mps.is_available(): device, dtype = "mps", torch.float16
    else: fail("A CUDA GPU or Apple Silicon Metal device is required.")

    source = fit_frame(Image.open(args.image))
    refs = []
    if args.references and Path(args.references).exists(): refs = json.loads(Path(args.references).read_text())
    if refs and args.reference_lock != "0": source = fit_frame(prepare_reference_frame(source, refs, device, dtype, automatic_match))

    # LUKE_AI_I2V_LOCAL_ONLY_MODEL_V2
    pipe = StableVideoDiffusionPipeline.from_pretrained(repo, torch_dtype=dtype, variant="fp16",
        local_files_only=True,
    )
    if device == "cuda": pipe.enable_model_cpu_offload()
    else: pipe.to(device)
    # LUKE_AI_I2V_DIFFUSERS_COMPAT_V1
    if hasattr(pipe, "enable_vae_slicing"):
        pipe.enable_vae_slicing()

    if hasattr(pipe, "enable_vae_tiling"):
        pipe.enable_vae_tiling()
    # Low motion and low augmentation preserve the reference more faithfully.
    frames = pipe(
        source,
        num_frames=21 if automatic_match else max(14, min(25, args.seconds * 4)),
        decode_chunk_size=2,
        motion_bucket_id=28 if automatic_match else 70,
        noise_aug_strength=0.01 if automatic_match else 0.02,
        min_guidance_scale=1.0,
        max_guidance_scale=2.0 if automatic_match else 3.0,
    ).frames[0]
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    export_to_video(frames, args.output, fps=6)
    emit({"ok": True, "output": args.output, "referencesUsed": len(refs), "automaticMatch": automatic_match})


if __name__ == "__main__": main()
