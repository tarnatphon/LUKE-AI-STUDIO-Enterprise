import React, { memo } from "react";
import { Trophy, Users, Loader2, Square, ThumbsUp, ThumbsDown, Check, AlertTriangle, Layers, Settings2 } from "lucide-react";

/**
 * Text Model Arena panel.
 *
 * Lets the user pick two or three installed text models, watch every model
 * answer the same prompt at the same time, and keep the answer the evaluator
 * ranked highest (or any other answer they prefer).
 */

const formatScore = (value) => (Number.isFinite(Number(value)) ? `${Math.round(Number(value) * 100)}` : "--");

const statusLabel = (status) => {
  if (status === "loading") return "กำลังโหลด";
  if (status === "generating") return "กำลังตอบ";
  if (status === "completed") return "ตอบเสร็จแล้ว";
  if (status === "stopped") return "หยุดแล้ว";
  if (status === "failed") return "ไม่สำเร็จ";
  return "รอ";
};

function ModelArenaPanel({
  models = [],
  enabled = false,
  onToggle,
  selectedIds = [],
  onToggleModel,
  maximumModels = 3,
  loadedIds = [],
  loadingIds = [],
  running = false,
  results = {},
  evaluation = null,
  warnings = [],
  onPreload,
  onUnloadAll,
  onStop,
  onUseAnswer,
  onRate,
  chosenModelId = null,
  busy = false,
  policy = null,
  onPolicyChange,
}) {
  const selectionFull = selectedIds.length >= maximumModels;

  const cards = evaluation?.responses?.length
    ? evaluation.responses
    : Object.keys(results).map((modelId) => ({
        modelId,
        content: results[modelId]?.content || "",
        status: results[modelId]?.status || "waiting",
        score: null,
        rank: null,
        best: false,
        error: results[modelId]?.error || null,
      }));

  return (
    <section className="chat-arena-panel" aria-label="Text Model Arena">
      <div className="chat-arena-heading">
        <div className="chat-arena-title">
          <Users size={16} />
          <strong>Multi-Model Arena</strong>
          <span>
            ให้หลายโมเดลตอบคำถามเดียวกันพร้อมกัน แล้วเลือกคำตอบที่ดีที่สุด
          </span>
        </div>

        <label className="chat-arena-toggle">
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy}
            onChange={(event) => onToggle?.(event.target.checked)}
          />
          เปิดใช้งาน
        </label>
      </div>

      {enabled && (
        <>
          <div className="chat-arena-models" role="group" aria-label="เลือกโมเดลสำหรับเปรียบเทียบ">
            {models.length === 0 && (
              <span className="chat-arena-empty">
                ยังไม่มีโมเดลข้อความในเครื่อง — ดาวน์โหลดโมเดล GGUF ใน AI Library ก่อน
              </span>
            )}

            {models.map((model) => {
              const filename = model.filename || model.name;
              const selected = selectedIds.includes(filename);
              const disabled = (selectionFull && !selected) || running || busy;
              const loaded = loadedIds.includes(filename);
              const loading = loadingIds.includes(filename);
              return (
                <button
                  key={filename}
                  type="button"
                  className={`chat-arena-chip ${selected ? "selected" : ""}`}
                  onClick={() => !disabled && onToggleModel?.(filename)}
                  disabled={disabled}
                  aria-pressed={selected}
                  title={filename}
                >
                  <span className={`chat-arena-dot ${loaded ? "loaded" : loading ? "loading" : ""}`} />
                  <span className="chat-arena-chip-name">{filename}</span>
                  {model.size ? <span className="chat-arena-chip-size">{model.size}</span> : null}
                </button>
              );
            })}
          </div>

          <div className="chat-arena-actions">
            <span className="chat-arena-count">
              เลือกแล้ว {selectedIds.length}/{maximumModels} โมเดล
            </span>

            <button
              type="button"
              className="m3-btn m3-btn-outlined"
              onClick={() => onPreload?.()}
              disabled={running || selectedIds.length === 0}
              style={{ height: "32px", padding: "0 14px" }}
            >
              <Layers size={14} />
              <span>โหลดโมเดลที่เลือก</span>
            </button>

            <button
              type="button"
              className="m3-btn m3-btn-outlined"
              onClick={() => onUnloadAll?.()}
              disabled={running || loadedIds.length === 0}
              style={{ height: "32px", padding: "0 14px" }}
            >
              <Square size={14} />
              <span>นำออกทั้งหมด</span>
            </button>

            {running && (
              <button
                type="button"
                className="m3-btn m3-btn-error"
                onClick={() => onStop?.()}
                style={{ height: "32px", padding: "0 14px" }}
              >
                <Square size={14} />
                <span>หยุดการเปรียบเทียบ</span>
              </button>
            )}
          </div>

          <div className="chat-arena-settings">
            <Settings2 size={13} />
            <label className="chat-arena-setting">
              <input
                type="checkbox"
                checked={policy?.judge?.enabled !== false}
                disabled={running}
                onChange={(event) => onPolicyChange?.({ judge: { enabled: event.target.checked } })}
              />
              ใช้กรรมการตรวจคำตอบ
            </label>

            <label className="chat-arena-setting">
              สูงสุด
              <select
                value={Number(policy?.selection?.maximumModels || 3)}
                disabled={running}
                onChange={(event) => onPolicyChange?.({ selection: { maximumModels: Number(event.target.value) } })}
              >
                <option value={2}>2 โมเดล</option>
                <option value={3}>3 โมเดล</option>
                <option value={4}>4 โมเดล</option>
              </select>
            </label>
          </div>

          {warnings.length > 0 && (
            <div className="chat-arena-warning" role="status">
              <AlertTriangle size={14} />
              <div>
                {warnings.map((warning) => (
                  <div key={warning.code || warning.message}>{warning.message}</div>
                ))}
              </div>
            </div>
          )}

          {evaluation?.judge?.used && (
            <div className="chat-arena-judge">
              <Trophy size={14} />
              <span>
                ใช้โมเดล{" "}
                <b>{evaluation.judge.judgeModelId || evaluation.judge.winnerModelId || "-"}</b>{" "}
                เป็นกรรมการตรวจคำตอบ
                {evaluation.judge.summary ? ` — ${evaluation.judge.summary}` : ""}
              </span>
            </div>
          )}

          {cards.length > 0 && (
            <div className="chat-arena-results">
              {cards.map((card) => {
                const modelId = card.modelId;
                const isChosen = chosenModelId === modelId;
                return (
                  <article
                    key={modelId}
                    className={`chat-arena-card ${card.best ? "best" : ""} ${isChosen ? "chosen" : ""}`}
                  >
                    <header className="chat-arena-card-head">
                      <div className="chat-arena-card-title">
                        {card.best && (
                          <span className="chat-arena-badge">
                            <Trophy size={12} /> คำตอบที่ดีที่สุด
                          </span>
                        )}
                        {isChosen && !card.best && (
                          <span className="chat-arena-badge chosen">
                            <Check size={12} /> กำลังใช้ในแชท
                          </span>
                        )}
                        {card.rank ? <span className="chat-arena-rank">#{card.rank}</span> : null}
                        <strong title={modelId}>{modelId}</strong>
                      </div>

                      <div className="chat-arena-score">
                        {card.status === "generating" && (
                          <Loader2 size={14} className="spin" aria-label="กำลังสร้างคำตอบ" />
                        )}
                        <span className="chat-arena-score-value">{formatScore(card.score)}</span>
                        <span className="chat-arena-score-unit">/100</span>
                      </div>
                    </header>

                    {typeof card.score === "number" && (
                      <div className="chat-arena-scorebar" aria-hidden="true">
                        <div
                          className="chat-arena-scorebar-fill"
                          style={{ width: `${Math.max(2, Math.min(100, Number(card.score) * 100))}%` }}
                        />
                      </div>
                    )}

                    <div className="chat-arena-meta">
                      {typeof card.durationMs === "number" && (
                        <span>{card.durationMs >= 1000 ? `${(card.durationMs / 1000).toFixed(1)}s` : `${card.durationMs}ms`}</span>
                      )}
                      {card.usage?.completion_tokens ? (
                        <span>
                          {card.durationMs > 0
                            ? `${(card.usage.completion_tokens / (card.durationMs / 1000)).toFixed(1)} tok/s`
                            : `${card.usage.completion_tokens} tokens`}
                        </span>
                      ) : null}
                      {card.basis ? <span>{card.basis}</span> : null}
                    </div>

                    {card.judgeReason ? (
                      <div className="chat-arena-judge-reason">กรรมการ: {card.judgeReason}</div>
                    ) : null}

                    {card.metrics && (
                      <div className="chat-arena-metrics">
                        <span title="ความเกี่ยวข้องกับคำถาม">เกี่ยวข้อง {formatScore(card.metrics.relevance)}</span>
                        <span title="ความครบถ้วน">ครบถ้วน {formatScore(card.metrics.completeness)}</span>
                        <span title="ความชัดเจน">ชัดเจน {formatScore(card.metrics.clarity)}</span>
                        <span title="รายละเอียด">ละเอียด {formatScore(card.metrics.detail)}</span>
                        <span title="ความแตกต่างจากโมเดลอื่น">เฉพาะตัว {formatScore(card.metrics.uniqueness)}</span>
                      </div>
                    )}

                    <div className="chat-arena-card-body">
                      {card.content ? (
                        <div className="chat-arena-answer">{card.content}</div>
                      ) : (
                        <div className="chat-arena-placeholder">
                          {card.error ? card.error : statusLabel(card.status)}
                        </div>
                      )}
                    </div>

                    {card.status === "completed" && card.content ? (
                      <footer className="chat-arena-card-actions">
                        <button
                          type="button"
                          className="m3-btn m3-btn-tonal"
                          onClick={() => onUseAnswer?.(modelId)}
                          disabled={isChosen}
                          style={{ height: "30px", padding: "0 12px" }}
                        >
                          <Check size={14} />
                          <span>{isChosen ? "ใช้คำตอบนี้แล้ว" : "ใช้คำตอบนี้"}</span>
                        </button>

                        <button
                          type="button"
                          className="m3-btn m3-btn-outlined"
                          onClick={() => onRate?.(modelId, "up")}
                          title="คำตอบนี้ดี"
                          style={{ height: "30px", padding: "0 10px" }}
                        >
                          <ThumbsUp size={14} />
                        </button>

                        <button
                          type="button"
                          className="m3-btn m3-btn-outlined"
                          onClick={() => onRate?.(modelId, "down")}
                          title="คำตอบนี้ยังไม่ดี"
                          style={{ height: "30px", padding: "0 10px" }}
                        >
                          <ThumbsDown size={14} />
                        </button>
                      </footer>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default memo(ModelArenaPanel);
