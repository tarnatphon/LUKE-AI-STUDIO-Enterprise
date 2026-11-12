import React, { memo, useMemo, useState } from "react";
import { Sparkles, Sliders, ChevronDown, Cpu, Wand2, Info, Type } from "lucide-react";
import { describePromptLength } from "../../../../scripts/server/image-prompt-budget.cjs";
import "../components/Generator.css";

/**
 * The quality face of the image workspace.
 *
 * Three presets, one line of honest numbers, and — behind a single chevron — the
 * full set for anyone who wants it. Before this, every knob was on screen at
 * once while the request quietly ignored half of them; now the simple view is
 * the whole story for most runs and nothing is lost for the rest.
 *
 * Two rules it keeps:
 *   - It never invents a number. Everything it shows comes from the plan the
 *     request is built from (`resolveImagePlan`), which comes from the same
 *     shared module the server publishes.
 *   - Switching preset writes the plan's numbers into the real constraints
 *     (`applyQualityPreset`), so the sliders below move to what the preset
 *     means. A preset that only changed a label would be a lie.
 */

const PRESET_INFO = {
  draft: {
    label: "Draft",
    hint: "Half the steps, no second pass. For finding the prompt.",
    icon: "⚡",
  },
  balanced: {
    label: "Balanced",
    hint: "The model's own steps, plus a high-res pass if this machine can afford it.",
    icon: "◐",
  },
  best: {
    label: "Best",
    hint: "More steps and a bigger second pass. Slower, and the one to use for a final image.",
    icon: "✦",
  },
};

const SAMPLERS = [
  { id: "dpm++2m", label: "DPM++ 2M (recommended for most)" },
  { id: "euler_a", label: "Euler a (creative, softer)" },
  { id: "euler", label: "Euler (FLUX / SD3)" },
  { id: "dpm++2s_a", label: "DPM++ 2S a" },
  { id: "dpm++2mv2", label: "DPM++ 2M v2" },
  { id: "heun", label: "Heun (slow, smooth)" },
  { id: "dpm2", label: "DPM2" },
  { id: "lcm", label: "LCM (distilled models)" },
  { id: "res_multistep", label: "Res Multistep" },
  { id: "ipndm", label: "iPNDM" },
  { id: "er_sde", label: "ER SDE" },
  { id: "ddim_trailing", label: "DDIM trailing" },
];

const SCHEDULERS = [
  { id: "karras", label: "Karras", hint: "SD 1.5 / SDXL photoreal" },
  { id: "simple", label: "Simple", hint: "FLUX / SD 3.x" },
  { id: "discrete", label: "Discrete", hint: "the model's default" },
  { id: "exponential", label: "Exponential" },
  { id: "sgm_uniform", label: "SGM uniform", hint: "SD 3.x" },
  { id: "ays", label: "Align Your Steps" },
  { id: "gits", label: "GITS" },
  { id: "kl_optimal", label: "KL optimal" },
  { id: "lcm", label: "LCM" },
  { id: "smoothstep", label: "Smoothstep" },
  { id: "bong_tangent", label: "Bong tangent" },
];

function QualityPanel({
  plan,
  constraints,
  setConstraints,
  activeModel,
  specs,
  negativePrompt,
  setNegativePrompt,
  prompt = "",
  onPreset,
  disabled = false,
  tier,
}) {
  const [open, setOpen] = useState(false);
  const machine = specs?.recommended_image_settings;

  // Two kinds of edit, and they are not the same promise.
  //
  // `aspect` is not one of the preset's numbers: Draft/Balanced/Best decide how
  // hard the model works, the shape decides what canvas it works on. Picking a
  // shape must not relabel the user's choice as "custom", because the numbers on
  // screen still are the preset's.
  //
  // Steps / CFG / sampler / scheduler / clip skip / hires ARE the preset's
  // numbers, so changing one means the label would be a lie. It also has to pin
  // them, or the next model switch would re-apply the family's numbers over a
  // hand edit.
  const update = (key, value) => {
    setConstraints((prev) => (
      key === "aspect"
        ? { ...prev, aspect: value }
        : { ...prev, [key]: value, qualityPinned: true, qualityPreset: "custom" }
    ));
  };

  const currentPreset = constraints?.qualityPreset === "custom" ? null : (constraints?.qualityPreset || "auto");

  // The prompt's length against what the model can attend to. This is the least
  // visible quality lever there is: past one CLIP chunk the tail is split into a
  // second chunk and attended separately, so it is not ignored — it is heard
  // more quietly, which reads exactly like being ignored.
  const promptLength = useMemo(
    () => (String(prompt || "").trim() ? describePromptLength(prompt, plan.family) : null),
    [prompt, plan.family]
  );
  const effectivePreset = plan.preset;

  const chips = useMemo(() => {
    const list = [
      { label: `${plan.width}×${plan.height}`, title: "Resolution" },
      { label: `${plan.steps} steps`, title: "Sampling steps" },
      { label: `CFG ${plan.cfgScale}`, title: "Guidance scale" },
      { label: plan.sampler, title: "Sampler" },
      { label: plan.scheduler, title: "Scheduler" },
    ];
    if (plan.hires?.enabled) {
      list.push({ label: `hi-res ×${plan.hires.scale}`, title: `Second pass: ${plan.hires.upscaler} at denoise ${plan.hires.denoise}` });
    }
    if (plan.clipSkip > 0) list.push({ label: `clip skip ${plan.clipSkip}`, title: "CLIP skip" });
    return list;
  }, [plan]);

  return (
    <div className="quality-panel">
      <div className="quality-head">
        <div className="quality-head-title">
          <Sparkles size={16} />
          <span>Quality</span>
          <span className="quality-family-badge" title="Detected from the checkpoint's filename">
            {plan.familyLabel}
          </span>
          {machine?.tier && (
            <span className="quality-machine-badge" title={machine.note || "From this machine's hardware tier"}>
              <Cpu size={12} />
              {String(machine.tier)} machine
            </span>
          )}
        </div>
        <button
          type="button"
          className="quality-details-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <Sliders size={14} />
          <span>{open ? "Hide" : "Fine-tune"}</span>
          <ChevronDown size={14} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
        </button>
      </div>

      {/* The simple face: three choices. */}
      <div className="quality-presets" role="group" aria-label="Quality preset">
        {["draft", "balanced", "best"].map((id) => {
          const info = PRESET_INFO[id];
          const active = currentPreset === "auto" ? effectivePreset === id : currentPreset === id;
          return (
            <button
              key={id}
              type="button"
              className={`quality-preset ${active ? "active" : ""}`}
              onClick={() => onPreset(id)}
              disabled={disabled || !activeModel}
              title={info.hint}
            >
              <span className="quality-preset-icon" aria-hidden="true">{info.icon}</span>
              <span className="quality-preset-label">{info.label}</span>
            </button>
          );
        })}
        <span className="quality-preset-hint">
          {currentPreset === null
            ? "Custom settings"
            : PRESET_INFO[currentPreset === "auto" ? effectivePreset : currentPreset]?.hint}
        </span>
      </div>

      {/* The honest numbers, always visible — no knob required to know what runs. */}
      <div className="quality-chips">
        {chips.map((chip) => (
          <span key={chip.label} className="quality-chip" title={chip.title}>{chip.label}</span>
        ))}
        {plan.tier === "low" && (
          <span className="quality-chip quality-chip-warn" title={machine?.note}>
            no second pass on this machine
          </span>
        )}
      </div>

      {/* Shape. A hosted model reads "wide shot" out of the sentence; a
          diffusion model cannot, so the canvas has to be a control. */}
      <div className="quality-shapes" role="group" aria-label="Image shape">
        {(plan.shapes || []).map((shape) => {
          const active = plan.aspect === shape.id;
          const ratio = shape.units[0] / shape.units[1];
          // A proportional glyph, so the row reads before it is read.
          const boxW = ratio >= 1 ? 16 : Math.round(16 * ratio);
          const boxH = ratio >= 1 ? Math.round(16 / ratio) : 16;
          return (
            <button
              key={shape.id}
              type="button"
              className={`quality-shape ${active ? "active" : ""}`}
              onClick={() => update("aspect", shape.id)}
              disabled={disabled}
              aria-pressed={active}
              title={`${shape.label} — ${shape.units[0]}:${shape.units[1]}`}
            >
              <span className="quality-shape-glyph" aria-hidden="true">
                <span style={{ width: `${boxW}px`, height: `${boxH}px` }} />
              </span>
              <span className="quality-shape-label">{shape.label}</span>
            </button>
          );
        })}
      </div>

      {/* The prompt's length against what the model can attend to. This is the
          least visible quality lever there is: past one CLIP chunk the tail of
          the prompt is split into a second chunk and attended separately, so it
          is not ignored — it is heard more quietly, which reads as being ignored. */}
      {promptLength && (
        <div
          className={`quality-prompt-length quality-prompt-${promptLength.status}`}
          title={promptLength.hint}
        >
          <Type size={12} />
          <span>
            {promptLength.words} words · {promptLength.hint}
          </span>
        </div>
      )}

      {open && (
        <div className="quality-details">
          <div className="quality-details-grid">
            <div className="quality-field">
              <label htmlFor="qp-steps">Steps</label>
              <input
                id="qp-steps"
                type="number"
                min="1"
                max="100"
                value={plan.steps}
                onChange={(e) => update("steps", Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 1)))}
                disabled={disabled}
              />
              <span className="quality-field-hint">More steps add detail up to a point, then only time.</span>
            </div>

            <div className="quality-field">
              <label htmlFor="qp-cfg">CFG scale</label>
              <input
                id="qp-cfg"
                type="number"
                min="1"
                max="20"
                step="0.5"
                value={plan.cfgScale}
                onChange={(e) => update("cfgScale", Math.max(0.5, Math.min(20, parseFloat(e.target.value) || 1)))}
                disabled={disabled}
              />
              <span className="quality-field-hint">Higher follows the prompt harder and burns contrast.</span>
            </div>

            <div className="quality-field">
              <label htmlFor="qp-sampler">Sampler</label>
              <select
                id="qp-sampler"
                value={plan.sampler}
                onChange={(e) => update("sampler", e.target.value)}
                disabled={disabled}
              >
                {SAMPLERS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>

            <div className="quality-field">
              <label htmlFor="qp-scheduler">Scheduler</label>
              <select
                id="qp-scheduler"
                value={plan.scheduler}
                onChange={(e) => update("scheduler", e.target.value)}
                disabled={disabled}
              >
                {SCHEDULERS.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}{s.hint ? ` — ${s.hint}` : ""}</option>
                ))}
              </select>
            </div>

            <div className="quality-field">
              <label htmlFor="qp-clip">CLIP skip</label>
              <input
                id="qp-clip"
                type="number"
                min="1"
                max="12"
                value={plan.clipSkip > 0 ? plan.clipSkip : ""}
                placeholder="model default"
                onChange={(e) => update("clipSkip", parseInt(e.target.value, 10) || -1)}
                disabled={disabled}
              />
              <span className="quality-field-hint">2 is the SD 1.5 convention; newer models want the default.</span>
            </div>

            <div className="quality-field">
              <label htmlFor="qp-hires">High-res second pass</label>
              <label className="quality-checkbox">
                <input
                  id="qp-hires"
                  type="checkbox"
                  checked={plan.hires?.enabled === true}
                  onChange={(e) => update("hiresFix", e.target.checked)}
                  disabled={disabled || plan.tier === "low"}
                />
                <span>
                  {plan.tier === "low"
                    ? "Not offered on this machine"
                    : plan.hires?.enabled
                      ? `×${plan.hires.scale}, ${plan.hires.steps} steps, denoise ${plan.hires.denoise}`
                      : "Off"}
                </span>
              </label>
              <span className="quality-field-hint">
                A second sampling pass at a higher resolution. This is what adds the fine detail a single pass cannot.
              </span>
            </div>

            <div className="quality-field quality-field-wide">
              <label htmlFor="qp-negative">Negative prompt</label>
              <textarea
                id="qp-negative"
                rows={2}
                value={negativePrompt}
                placeholder={plan.negativePrompt || "leave empty to use the model family's defaults"}
                onChange={(e) => setNegativePrompt(e.target.value)}
                disabled={disabled}
              />
              <span className="quality-field-hint">
                What to keep out of the image. Empty means the defaults for {plan.familyLabel} are used
                {plan.negativePrompt ? `: “…${plan.negativePrompt.slice(0, 80)}${plan.negativePrompt.length > 80 ? "…" : ""}”` : " (this family ignores negatives)"}.
              </span>
            </div>
          </div>

          {plan.notes?.length > 0 && (
            <div className="quality-notes">
              <Info size={13} />
              <div>
                {plan.notes.map((note) => <div key={note}>· {note}</div>)}
              </div>
            </div>
          )}

          {constraints?.qualityPinned && (
            <button
              type="button"
              className="m3-btn m3-btn-tonal quality-reset"
              onClick={() => onPreset("auto")}
              disabled={disabled || !activeModel}
            >
              <Wand2 size={14} />
              <span>Back to Auto (this machine)</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(QualityPanel);
