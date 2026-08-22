#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
fail(){ echo "FAIL: $*" >&2; exit 1; }
pass(){ echo "PASS: $*"; }

bash -n "$ROOT/mac.sh" || fail "mac.sh syntax"
bash -n "$ROOT/scripts/setup/setup.sh" || fail "setup.sh syntax"
bash -n "$ROOT/scripts/setup/setup-tts.sh" || fail "setup-tts.sh syntax"
node --check "$ROOT/scripts/server/serve.cjs" || fail "server syntax"
node --check "$ROOT/scripts/updater/update.cjs" || fail "updater syntax"
python3 -m py_compile "$ROOT/scripts/workers/image_to_video_worker.py" || fail "image-to-video worker"
python3 -m py_compile "$ROOT/scripts/workers/install_image_to_video_runtime.py" || fail "image-to-video installer"
[ -f "$ROOT/app/capabilities/image-to-video/manifest.json" ] || fail "capability manifest missing"
[ -f "$ROOT/app/frontend/src/components/ImageToVideo.jsx" ] || fail "ImageToVideo UI missing"
find "$ROOT" -type d -name '__pycache__' -prune -exec rm -rf {} +
find "$ROOT" -type f -name '*.pyc' -delete
pass "release structure and syntax"


# LUKE_AI_PORTABLE_RUNTIME_VALIDATION_V2
validate_portable_runtime_policy() {
  local runtime_root="app/tools/node-mac"
  local runtime_metadata="$runtime_root/runtime.json"
  local packaging_mode="${LUKE_AI_PACKAGING_MODE:-0}"

  if [ ! -d "$runtime_root" ]; then
    echo "PASS: No portable Node runtime present in source workspace"
    return 0
  fi

  if [ ! -f "$runtime_metadata" ]; then
    echo "FAIL: Portable Node runtime exists without runtime.json"
    return 1
  fi

  if ! python3 -m json.tool "$runtime_metadata" >/dev/null 2>&1; then
    echo "FAIL: Portable Node runtime metadata is invalid"
    return 1
  fi

  if [ "$packaging_mode" = "1" ]; then
    for required_file in \
      "$runtime_root/bin/node" \
      "$runtime_root/bin/npm" \
      "$runtime_root/bin/npx" \
      "$runtime_root/lib/node_modules/npm/package.json"
    do
      if [ ! -f "$required_file" ]; then
        echo "FAIL: Packaging runtime is missing $required_file"
        return 1
      fi
    done

    if [ ! -x "$runtime_root/bin/node" ] \
      || [ ! -x "$runtime_root/bin/npm" ] \
      || [ ! -x "$runtime_root/bin/npx" ]; then
      echo "FAIL: Portable runtime executables do not have execute permission"
      return 1
    fi

    if ! "$runtime_root/bin/node" --version >/dev/null 2>&1 \
      || ! "$runtime_root/bin/npm" --version >/dev/null 2>&1 \
      || ! "$runtime_root/bin/npx" --version >/dev/null 2>&1; then
      echo "FAIL: Portable runtime executables are not functional"
      return 1
    fi

    echo "PASS: Portable Node runtime is valid for packaging"
    return 0
  fi

  if [ -f "$runtime_root/bin/node" ] \
    || [ -d "$runtime_root/lib/node_modules/npm" ]; then
    echo "FAIL: stale portable Node runtime present"
    echo "Set LUKE_AI_PACKAGING_MODE=1 only during validated release packaging"
    return 1
  fi

  echo "PASS: Runtime metadata present without stale packaged binaries"
  return 0
}

validate_portable_runtime_policy

# LUKE AI STUDIO API contract validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/check-api-contracts.cjs
else
  echo "FAIL: Node.js is required for API contract validation"
  exit 1
fi

# LUKE AI STUDIO backend API smoke test
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-backend-api.cjs
else
  echo "FAIL: Node.js is required for backend API smoke testing"
  exit 1
fi

# LUKE AI STUDIO runtime dependency catalog validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-runtime-dependencies.cjs
else
  echo "FAIL: Node.js is required for runtime dependency validation"
  exit 1
fi

# LUKE AI STUDIO runtime install state machine validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-runtime-install-state.cjs
else
  echo "FAIL: Node.js is required for runtime install state validation"
  exit 1
fi

# LUKE AI STUDIO safe runtime download worker validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-runtime-download-worker.cjs
else
  echo "FAIL: Node.js is required for runtime download worker validation"
  exit 1
fi

# LUKE AI STUDIO runtime download dashboard validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-runtime-dashboard.cjs
else
  echo "FAIL: Node.js is required for runtime dashboard validation"
  exit 1
fi

# LUKE AI STUDIO external drive availability validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-runtime-storage-availability.cjs
else
  echo "FAIL: Node.js is required for runtime storage validation"
  exit 1
fi

# LUKE AI STUDIO runtime storage usage and cleanup validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-runtime-storage-cleanup.cjs
else
  echo "FAIL: Node.js is required for runtime storage cleanup validation"
  exit 1
fi

# LUKE AI STUDIO Text Model Manager foundation validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-text-model-manager-foundation.cjs
else
  echo "FAIL: Node.js is required for Text Model Manager validation"
  exit 1
fi

# LUKE AI STUDIO Text Model Catalog API validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-text-model-catalog-api.cjs
else
  echo "FAIL: Node.js is required for Text Model Catalog validation"
  exit 1
fi

# LUKE AI STUDIO Community Text Model Catalog validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-community-text-model-catalog.cjs
else
  echo "FAIL: Node.js is required for Community Model validation"
  exit 1
fi

# LUKE AI STUDIO sequential Text Model download validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-text-model-download-worker.cjs
else
  echo "FAIL: Node.js is required for Text Model download validation"
  exit 1
fi

# LUKE AI STUDIO Text Model Manager UI validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-text-model-manager-ui.cjs
else
  echo "FAIL: Node.js is required for Text Model Manager UI validation"
  exit 1
fi

# LUKE AI STUDIO Text Model automatic update validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-text-model-update-manager.cjs
else
  echo "FAIL: Node.js is required for Text Model Update validation"
  exit 1
fi

# LUKE AI STUDIO Text Model hardware compatibility validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-text-model-hardware-compatibility.cjs
else
  echo "FAIL: Node.js is required for Text Model hardware validation"
  exit 1
fi

# LUKE AI STUDIO Persistent Text Chat validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-persistent-text-chat.cjs
else
  echo "FAIL: Node.js is required for Persistent Text Chat validation"
  exit 1
fi

# LUKE AI STUDIO Text Chat Context Memory validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-text-chat-memory-manager.cjs
else
  echo "FAIL: Node.js is required for Text Chat Memory validation"
  exit 1
fi

# LUKE AI STUDIO Text Runtime Session Refresh validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-text-runtime-session-refresh.cjs
else
  echo "FAIL: Node.js is required for Text Runtime Session validation"
  exit 1
fi

# LUKE AI STUDIO Text Generation Streaming validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-text-generation-streaming.cjs
else
  echo "FAIL: Node.js is required for Text Generation Streaming validation"
  exit 1
fi

# LUKE AI STUDIO Multi-Model Parallel Generation validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-multi-model-parallel-generation.cjs
else
  echo "FAIL: Node.js is required for Multi-Model Generation validation"
  exit 1
fi

# LUKE AI STUDIO AI Judge Synthesis validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-ai-judge-synthesis.cjs
else
  echo "FAIL: Node.js is required for AI Judge Synthesis validation"
  exit 1
fi

# LUKE AI STUDIO Text Model Feedback validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-text-model-feedback.cjs
else
  echo "FAIL: Node.js is required for Text Model Feedback validation"
  exit 1
fi

# LUKE AI STUDIO Automatic Model Router validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-automatic-model-router.cjs
else
  echo "FAIL: Node.js is required for Automatic Model Router validation"
  exit 1
fi

# LUKE AI STUDIO Runtime Failure Recovery validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-runtime-failure-recovery.cjs
else
  echo "FAIL: Node.js is required for Runtime Failure Recovery validation"
  exit 1
fi

# LUKE AI STUDIO Model Health Circuit Breaker validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-model-health-circuit-breaker.cjs
else
  echo "FAIL: Node.js is required for Model Health validation"
  exit 1
fi

# LUKE AI STUDIO Background Runtime Supervisor validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-runtime-supervisor.cjs
else
  echo "FAIL: Node.js is required for Runtime Supervisor validation"
  exit 1
fi

# LUKE AI STUDIO Runtime Supervisor Dashboard validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-runtime-supervisor-dashboard.cjs
else
  echo "FAIL: Node.js is required for Runtime Supervisor Dashboard validation"
  exit 1
fi

# LUKE AI STUDIO Runtime Auto-Detection validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-runtime-auto-detection.cjs
else
  echo "FAIL: Node.js is required for Runtime Auto-Detection validation"
  exit 1
fi

# LUKE AI STUDIO Runtime Detection Dashboard validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-runtime-detection-dashboard.cjs
else
  echo "FAIL: Node.js is required for Runtime Detection Dashboard validation"
  exit 1
fi

# LUKE AI STUDIO Runtime One-Click Install validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-runtime-one-click-install.cjs
else
  echo "FAIL: Node.js is required for Runtime One-Click Install validation"
  exit 1
fi

# LUKE AI STUDIO Runtime Install Progress validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-runtime-install-progress.cjs
else
  echo "FAIL: Node.js is required for Runtime Install Progress validation"
  exit 1
fi

# LUKE AI STUDIO Storage Destination Manager validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-storage-destination-manager.cjs
else
  echo "FAIL: Node.js is required for Storage Destination Manager validation"
  exit 1
fi

# LUKE AI STUDIO Storage Destination Dashboard validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-storage-destination-dashboard.cjs
else
  echo "FAIL: Node.js is required for Storage Destination Dashboard validation"
  exit 1
fi

# LUKE AI STUDIO Unified Storage Provider Core validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-unified-storage-provider-core.cjs
else
  echo "FAIL: Node.js is required for Unified Storage Provider Core validation"
  exit 1
fi

# LUKE AI STUDIO Storage Keychain and NAS Dashboard validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-storage-keychain-nas-dashboard.cjs
else
  echo "FAIL: Node.js is required for Storage Keychain and NAS Dashboard validation"
  exit 1
fi

# LUKE AI STUDIO S3-Compatible Storage Adapter validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-s3-compatible-storage-adapter.cjs
else
  echo "FAIL: Node.js is required for S3-Compatible Storage Adapter validation"
  exit 1
fi

# LUKE AI STUDIO Cloud Storage Provider Dashboard validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-cloud-storage-provider-dashboard.cjs
else
  echo "FAIL: Node.js is required for Cloud Storage Provider Dashboard validation"
  exit 1
fi

# LUKE AI STUDIO Unified Storage Transfer Queue validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-unified-storage-transfer-queue.cjs
else
  echo "FAIL: Node.js is required for Unified Storage Transfer Queue validation"
  exit 1
fi

# LUKE AI STUDIO Storage Availability Watcher validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-storage-availability-watcher.cjs
else
  echo "FAIL: Node.js is required for Storage Availability Watcher validation"
  exit 1
fi

# LUKE AI STUDIO Storage Health Scoring validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-storage-health-scorer.cjs
else
  echo "FAIL: Node.js is required for Storage Health Scoring validation"
  exit 1
fi

# LUKE AI STUDIO Storage Policy Profiles validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-storage-policy-profiles.cjs
else
  echo "FAIL: Node.js is required for Storage Policy Profiles validation"
  exit 1
fi

# LUKE AI STUDIO Automatic Workload Detection validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-storage-workload-detector.cjs
else
  echo "FAIL: Node.js is required for Automatic Workload Detection validation"
  exit 1
fi

# LUKE AI STUDIO Storage Capacity Management validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-storage-capacity-manager.cjs
else
  echo "FAIL: Node.js is required for Storage Capacity Management validation"
  exit 1
fi

# LUKE AI STUDIO Storage Lifecycle Rules validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-storage-lifecycle-manager.cjs
else
  echo "FAIL: Node.js is required for Storage Lifecycle Rules validation"
  exit 1
fi

# LUKE AI STUDIO Safe Archive Workflow validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-storage-safe-archive-manager.cjs
else
  echo "FAIL: Node.js is required for Safe Archive Workflow validation"
  exit 1
fi

# LUKE AI STUDIO Archive Restore Workflow validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-storage-archive-restore-manager.cjs
else
  echo "FAIL: Node.js is required for Archive Restore Workflow validation"
  exit 1
fi

# LUKE AI STUDIO Storage Integrity Scanner validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-storage-integrity-scanner.cjs
else
  echo "FAIL: Node.js is required for Storage Integrity Scanner validation"
  exit 1
fi

# LUKE AI STUDIO Deep Cloud Integrity Verification
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-storage-deep-cloud-integrity.cjs
else
  echo "FAIL: Node.js is required for Deep Cloud Integrity Verification"
  exit 1
fi

# LUKE AI STUDIO Storage Disaster Recovery Dashboard validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-storage-disaster-recovery-dashboard.cjs
else
  echo "FAIL: Node.js is required for Storage Disaster Recovery Dashboard validation"
  exit 1
fi

# LUKE AI STUDIO Storage Recovery Runbook validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-storage-recovery-runbook-manager.cjs
else
  echo "FAIL: Node.js is required for Storage Recovery Runbook validation"
  exit 1
fi

# LUKE AI STUDIO Storage Recovery Simulation validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-storage-recovery-simulation-manager.cjs
else
  echo "FAIL: Node.js is required for Storage Recovery Simulation validation"
  exit 1
fi

# LUKE AI STUDIO Storage Recovery Readiness Certification validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-storage-recovery-readiness-certifier.cjs
else
  echo "FAIL: Node.js is required for Storage Recovery Readiness Certification validation"
  exit 1
fi

# LUKE AI STUDIO Image-to-Video Runtime Capability validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-image-to-video-runtime-capability-manager.cjs
else
  echo "FAIL: Node.js is required for Image-to-Video Runtime Capability validation"
  exit 1
fi

# LUKE AI STUDIO Image-to-Video Runtime UI Integration
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-image-to-video-runtime-ui-integration.cjs
else
  echo "FAIL: Node.js is required for Image-to-Video Runtime UI Integration validation"
  exit 1
fi

# LUKE AI STUDIO Image-to-Video Offline Worker validation
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-image-to-video-offline-worker.cjs
else
  echo "FAIL: Node.js is required for Image-to-Video Offline Worker validation"
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-image-to-video-job-manager.cjs
else
  echo "FAIL: Node.js is required for Production Image-to-Video Job Manager validation"
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-image-to-video-job-api-integration.cjs
else
  echo "FAIL: Node.js is required for Production Image-to-Video Job API validation"
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-image-to-video-process-runner.cjs
else
  echo "FAIL: Node.js is required for Production Image-to-Video Process Runner validation"
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-image-to-video-job-execution-integration.cjs
else
  echo "FAIL: Node.js is required for Image-to-Video Job Execution Integration validation"
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-image-to-video-production-hardening.cjs
else
  echo "FAIL: Node.js is required for Image-to-Video Production Hardening validation"
  exit 1
fi

# LUKE_AI_I2V_ASYNC_CONTRACT_GATE_V2
if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-image-to-video-async-ui.cjs
else
  echo "FAIL: Node.js is required for Image-to-Video Async UI validation"
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-image-to-video-production-hardening-phase2.cjs
else
  echo "FAIL: Node.js is required for Image-to-Video Production Hardening Phase 2 validation"
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-image-to-video-production-hardening-phase2b.cjs
else
  echo "FAIL: Node.js is required for Image-to-Video Production Hardening Phase 2B validation"
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-image-to-video-prompt-studio.cjs
else
  echo "FAIL: Node.js is required for Automatic Image-to-Video Prompt Studio validation"
  exit 1
fi

I2V_RUNTIME_PYTHON="app/runtimes/image-to-video/venv/bin/python"
I2V_VALIDATION_PYTHON="${LUKE_AI_I2V_VALIDATION_PYTHON:-}"

if [ -n "$I2V_VALIDATION_PYTHON" ] \
  && { [ ! -x "$I2V_VALIDATION_PYTHON" ] \
    || ! "$I2V_VALIDATION_PYTHON" -c 'import imageio_ffmpeg' >/dev/null 2>&1; }; then
  echo "FAIL: Configured Duration Worker validation Python is invalid"
  exit 1
elif [ -n "$I2V_VALIDATION_PYTHON" ]; then
  :
elif [ -x "$I2V_RUNTIME_PYTHON" ]; then
  I2V_VALIDATION_PYTHON="$I2V_RUNTIME_PYTHON"
elif command -v python3 >/dev/null 2>&1 \
  && python3 -c 'import imageio_ffmpeg' >/dev/null 2>&1; then
  I2V_VALIDATION_PYTHON="$(command -v python3)"
fi

if [ -n "$I2V_VALIDATION_PYTHON" ]; then
  "$I2V_VALIDATION_PYTHON" scripts/validation/test_image_to_video_duration_worker.py
else
  echo "FAIL: Python with imageio_ffmpeg is required for Duration Worker validation"
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-image-to-video-duration-strategy.cjs
else
  echo "FAIL: Node.js is required for Image-to-Video Duration Strategy validation"
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-image-to-video-batch-execution.cjs
else
  echo "FAIL: Node.js is required for Image-to-Video Batch Execution validation"
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-image-to-video-batch-controls.cjs
else
  echo "FAIL: Node.js is required for Image-to-Video Batch Controls validation"
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-image-to-video-batch-control-ui.cjs
else
  echo "FAIL: Node.js is required for Image-to-Video Batch Control UI validation"
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-image-to-video-batch-analytics.cjs
else
  echo "FAIL: Node.js is required for Image-to-Video Batch Analytics validation"
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-asset-registry-core.cjs
else
  echo "FAIL: Node.js is required for Asset Registry Core validation"
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-asset-registry-path-upsert.cjs
else
  echo "FAIL: Node.js is required for Asset Registry Path Upsert validation"
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-generated-image-asset-registration.cjs
else
  echo "FAIL: Node.js is required for Generated Image Asset Registration validation"
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-i2v-video-asset-registration.cjs
else
  echo "FAIL: Node.js is required for Completed I2V Asset Registration validation"
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-i2v-asset-relationships.cjs
else
  echo "FAIL: Node.js is required for I2V Asset Relationship validation"
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-asset-library-ui.cjs
else
  echo "FAIL: Node.js is required for Asset Library UI validation"
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-reference-asset-schema.cjs
else
  echo "FAIL: Node.js is required for Reference Asset Schema validation"
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  node scripts/validation/test-reference-upload-asset-registration.cjs
else
  echo "FAIL: Node.js is required for Uploaded Reference Asset Registration validation"
  exit 1
fi
