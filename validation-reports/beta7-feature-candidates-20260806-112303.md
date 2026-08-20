# LUKE AI STUDIO Beta 7 Feature Candidates

Generated: 2026-08-06 11:23:13
Branch: feat/beta7-foundation
Base version: 1.0.0-beta.6
Base commit: 02e8eb5

## Discovery Summary

- TODO or FIXME findings: 1
- UI placeholder findings: 92
- Potential unmatched API endpoints: 0
- Existing automated test files: 1

## Recommended Beta 7 Feature Order

### 1. Runtime Dependency Manager

Create a user-friendly runtime manager that detects missing optional dependencies, explains what is missing in Thai, installs approved components safely, verifies checksums and supports rollback.

Reason: Beta 6 backend health still reports optional Portable Node.js and npm as unavailable in the source workspace even though release packaging includes them.

### 2. Health Dashboard

Add a visual System Health page showing Node.js, npm, image runtime, video runtime, speech runtime, model storage, available disk space and writable folders.

### 3. Runtime Installation Tests

Add automated tests for dependency detection, install success, checksum failure, interrupted installation and rollback.

### 4. Download Destination Settings

Add a persistent download destination setting with external-drive availability detection and safe fallback when the selected drive is disconnected.

Default preferred destination:

```text
/Volumes/EXTERNAL Drive/ai/ai-downloads
```

### 5. Storage and Cleanup Manager

Show model, cache, output and temporary file sizes, with safe cleanup controls that never delete active models or user projects.

## Selected First Feature

**Beta 7 Runtime Dependency Manager Foundation**

Initial scope:

- Runtime status API
- Dependency catalog
- Safe installation state machine
- SHA256 verification
- Download progress
- Cancellation
- Rollback
- External-drive path support
- Thai and English status messages
- Automated validation tests
