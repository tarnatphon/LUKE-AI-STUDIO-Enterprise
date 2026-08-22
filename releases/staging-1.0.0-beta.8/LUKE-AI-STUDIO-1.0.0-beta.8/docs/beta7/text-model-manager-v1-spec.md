# LUKE AI STUDIO — Text Model Manager V1

## Product Rules

### One-click download

Every downloadable model shown in the Model Library must contain a trusted,
machine-resolvable download source. Pressing Download or Update must start the
download inside LUKE AI STUDIO. The application must not send the user to a
website to search for the file.

### Download selection and queue

- A user may select up to three text models in one batch.
- The queue downloads only one model at a time by default.
- The next item starts only after download, verification and persistence of
  the current item have completed.
- Pause, resume, cancel, retry, skip and queue reordering are required.
- Queue state must survive application and operating-system restarts.

### Storage policy

1. Use the user-selected Preferred Download Location.
2. If that destination is unavailable, use Local Staging.
3. When the preferred External Drive returns, offer to transfer pending files.
4. Verify size and SHA256 after copying.
5. Ask separately before deleting the Local copy.
6. Never delete Local files without explicit confirmation.

### Model update policy

- Check available model versions automatically.
- Display Update Available inside the existing model card.
- Updates are optional and must not overwrite the active version immediately.
- Download and install the new version side-by-side.
- Verify and test the new version before offering activation.
- Preserve the previous version for rollback.
- Ask before deleting an older version.

### Hardware selection

The manager must inspect:

- Total and available RAM
- VRAM or Apple unified memory
- CPU architecture
- GPU/Metal support
- Available disk space
- Runtime compatibility

The system recommends an appropriate quantization automatically while still
allowing advanced users to choose another compatible variant.

### Chat persistence

- Automatically save every conversation and message.
- Restore the latest conversation after refresh or application restart.
- Preserve model, system prompt, generation settings, attachments and
  multi-model evaluation results.
- Use incremental storage and recovery journaling.

### Continuous conversation

The user experience must not stop when model context or RAM becomes limited.

The system must:

1. Persist raw conversation history.
2. Create rolling summaries before context exhaustion.
3. Store durable conversation memory.
4. unload/reload the model safely when required.
5. rebuild the next context from recent messages, summaries and relevant
   memories.
6. continue the same conversation without requiring a new chat.

### Multi-model evaluation

- Send one prompt to two or more selected models.
- Select parallel or sequential execution based on available resources.
- Record latency, token speed, RAM/VRAM use and completion status.
- Detect duplicate or semantically equivalent content.
- Preserve individual answers.
- Produce a combined answer containing the strongest non-duplicated points.
- Explicitly show disagreements and uncertain claims.
