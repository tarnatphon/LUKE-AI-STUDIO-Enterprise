#!/usr/bin/env python3
"""
Probes the Core ML worker's reference-config cache without a Mac, torch, or
network — the three things the real code needs but a validation box does not
have.

The worker module is exec'd with stubs standing in for `torch`, `numpy` and
`python_coreml_stable_diffusion`, so the functions under test are the real ones
read from scripts/workers/coreml_server.py, and a fake pipeline class records
exactly what the loader asked diffusers for. That is the whole point: whether a
machine that already has the config on disk still reaches out to Hugging Face on
every start is a question about the order of those calls.

Usage: python3 coreml-reference-cache-probe.py <path to coreml_server.py> <scratch dir>
Prints a JSON array of [label, ok, detail].
"""

import json
import os
import pathlib
import sys
import types

SRC = os.path.abspath(sys.argv[1])
SANDBOX = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else os.getcwd()


def _stub(name, **attrs):
    module = types.ModuleType(name)
    for key, value in attrs.items():
        setattr(module, key, value)
    sys.modules[name] = module
    return module


class _Never:
    @classmethod
    def from_pretrained(cls, *args, **kwargs):
        raise AssertionError("the stub pipeline must not be loaded directly")


_pipeline_stub = _stub(
    "python_coreml_stable_diffusion.pipeline",
    StableDiffusionPipeline=_Never,
    StableDiffusionXLPipeline=_Never,
    get_coreml_pipe=lambda **kwargs: object(),
    SCHEDULER_MAP={},
)
_stub("python_coreml_stable_diffusion", pipeline=_pipeline_stub)
_stub("numpy", float32=None)
_stub("torch")

namespace = {"__name__": "coreml_server_under_test", "__file__": SRC}
exec(compile(pathlib.Path(SRC).read_text(), SRC, "exec"), namespace)

results = []


def check(label, ok, detail=""):
    results.append([label, bool(ok), "" if ok else str(detail)[:400]])


def fake_class(behavior):
    """A pipeline class that records every from_pretrained call it receives."""
    state = {"calls": []}

    class _Fake:
        @classmethod
        def from_pretrained(cls, repo, **kwargs):
            state["calls"].append(kwargs)
            return behavior(repo, kwargs, len(state["calls"]))

    return _Fake, state


def only_local(repo, kwargs, nth):
    if kwargs.get("local_files_only") is True:
        return "pipe"
    raise AssertionError("went to the network although a local copy was read")


def not_cached_then_download(repo, kwargs, nth):
    if kwargs.get("local_files_only") is True:
        raise OSError("no local copy of this model")
    return "pipe"


def never(repo, kwargs, nth):
    raise OSError("hub unreachable and nothing on disk")


def renamed_auth_kwarg(repo, kwargs, nth):
    if "use_auth_token" in kwargs:
        raise TypeError("from_pretrained() got an unexpected keyword argument 'use_auth_token'")
    return "pipe"


cache_probe = os.path.join(SANDBOX, "reference-cache-probe")

# ── where the cache lives ────────────────────────────────────────────────────
default_dir = str(namespace["reference_cache_dir"]())
expected_tail = os.path.join("app", "runtime-state", "huggingface-cache")
check(
    "the reference config is cached inside the app folder",
    default_dir.endswith(expected_tail),
    default_dir,
)
override_dir = os.path.join(SANDBOX, "someone-elses-cache")
os.environ["LUKE_IMAGE_MODEL_CACHE"] = override_dir
check("LUKE_IMAGE_MODEL_CACHE moves that folder", str(namespace["reference_cache_dir"]()) == override_dir)
del os.environ["LUKE_IMAGE_MODEL_CACHE"]

# ── which model a bundle belongs to ──────────────────────────────────────────
check(
    "a Core ML folder names the model its config has to come from",
    namespace["infer_model_version"](pathlib.Path("/models/coreml-stable-diffusion-v1-5")) == "runwayml/stable-diffusion-v1-5",
)
check(
    "a hashed cache copy of that folder names the same model",
    namespace["infer_model_version"](pathlib.Path("/cache/1a2b3c4d5e6f-coreml_stable_diffusion_v1_5")) == "runwayml/stable-diffusion-v1-5",
    namespace["infer_model_version"](pathlib.Path("/cache/1a2b3c4d5e6f-coreml_stable_diffusion_v1_5")),
)
check(
    "a differently named fine-tune still resolves to the model it was compiled from",
    namespace["infer_model_version"](pathlib.Path("/models/cyberrealistic_v1_1")) == "runwayml/stable-diffusion-v1-5",
)
check(
    "the model the user picked is used when the copied folder has no name to read",
    namespace["infer_model_version"](pathlib.Path("/cache/1a2b3c4d5e6f-model-copy"), "coreml-stable-diffusion-v1-5") == "runwayml/stable-diffusion-v1-5",
)
check(
    "an unknown bundle falls back to the documented default",
    namespace["infer_model_version"](pathlib.Path("/models/mystery-model")) == "runwayml/stable-diffusion-v1-5",
)
os.environ["COREML_MODEL_VERSION"] = "someone/else"
check("COREML_MODEL_VERSION still overrides all of it", namespace["infer_model_version"](pathlib.Path("/models/anything")) == "someone/else")
del os.environ["COREML_MODEL_VERSION"]

# ── the load order, which is the actual fix ──────────────────────────────────
Fake, state = fake_class(only_local)
pipe = namespace["load_reference_pipeline"](Fake, "runwayml/stable-diffusion-v1-5", pathlib.Path(cache_probe))
check(
    "a machine that already has the config does not ask the network for it",
    pipe == "pipe" and len(state["calls"]) == 1 and state["calls"][0].get("local_files_only") is True,
    json.dumps(state["calls"]),
)
check("the local read is aimed at the app's cache folder", state["calls"][0].get("cache_dir") == cache_probe)
check("that folder exists before anything is read from it", os.path.isdir(cache_probe))
check("the default still carries the stored login, so gated repos keep working", state["calls"][0].get("use_auth_token") is True)

Fake, state = fake_class(renamed_auth_kwarg)
pipe = namespace["load_reference_pipeline"](Fake, "runwayml/stable-diffusion-v1-5", pathlib.Path(cache_probe))
check(
    "a diffusers that renamed the auth keyword still loads",
    pipe == "pipe" and all("use_auth_token" not in call for call in state["calls"][1:]) and len(state["calls"]) >= 2,
    json.dumps(state["calls"]),
)

os.environ["HF_TOKEN"] = "hf_testtoken"
Fake, state = fake_class(only_local)
namespace["load_reference_pipeline"](Fake, "runwayml/stable-diffusion-v1-5", pathlib.Path(cache_probe))
check("an explicit token is passed instead of assuming a login", state["calls"][0].get("use_auth_token") == "hf_testtoken")
del os.environ["HF_TOKEN"]

Fake, state = fake_class(not_cached_then_download)
pipe = namespace["load_reference_pipeline"](Fake, "runwayml/stable-diffusion-v1-5", pathlib.Path(cache_probe))
check(
    "without a local copy it downloads once, into the same folder",
    pipe == "pipe" and len(state["calls"]) == 2
    and state["calls"][1].get("cache_dir") == cache_probe
    and not state["calls"][1].get("local_files_only"),
    json.dumps(state["calls"]),
)

Fake, state = fake_class(never)
try:
    namespace["load_reference_pipeline"](Fake, "runwayml/stable-diffusion-v1-5", pathlib.Path(cache_probe))
    check("a machine with neither copy says so plainly", False, "no error was raised")
except RuntimeError as error:
    message = str(error)
    check(
        "a machine with neither copy says so plainly",
        "LUKE_IMAGE_MODEL_CACHE" in message and "runwayml/stable-diffusion-v1-5" in message,
        message[:200],
    )
    check("and it does not blame the Core ML weights for it", "weights are on disk" in message, message[:200])

print(json.dumps(results))
