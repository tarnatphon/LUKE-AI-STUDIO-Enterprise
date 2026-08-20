import React, { useState, useEffect, useRef } from "react";
import { X, Copy, Check, Save, Download, FileCode, Play, Trash2 } from "lucide-react";

export default function WorkTab({
  content,
  language,
  onClose,
  onUpdate,
  showAlert,
  showConfirm
}) {
  const [editorContent, setEditorContent] = useState(content || "");
  const [isCopied, setIsCopied] = useState(false);
  const textareaRef = useRef(null);

  useEffect(() => {
    setEditorContent(content);
  }, [content]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(editorContent);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([editorContent], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ext = language === "python" ? "py" : language === "javascript" ? "js" : language === "typescript" ? "ts" : "txt";
    a.href = url;
    a.download = `luke-ai-work.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClear = async () => {
    const ok = await showConfirm({
      title: "Clear Workspace?",
      message: "This will delete all content in the current work tab. This action cannot be undone.",
      confirmLabel: "Clear",
      danger: true
    });
    if (ok) {
      setEditorContent("");
      onUpdate("");
    }
  };

  const handleChange = (e) => {
    const newValue = e.target.value;
    setEditorContent(newValue);
    onUpdate(newValue);
  };

  // Simple line numbering logic
  const lines = editorContent.split("\n");

  return (
    <div className="work-tab-container">
      <header className="work-tab-header">
        <div className="work-tab-title">
          <FileCode size={18} />
          <span>Workspace</span>
          {language && <span className="work-tab-lang-badge">{language}</span>}
        </div>
        <div className="work-tab-actions">
          <button className="work-tab-btn" onClick={handleCopy} title="Copy to clipboard">
            {isCopied ? <Check size={16} color="var(--md-sys-color-success)" /> : <Copy size={16} />}
          </button>
          <button className="work-tab-btn" onClick={handleDownload} title="Download file">
            <Download size={16} />
          </button>
          <button className="work-tab-btn danger" onClick={handleClear} title="Clear content">
            <Trash2 size={16} />
          </button>
          <div className="work-tab-divider" />
          <button className="work-tab-btn close" onClick={onClose} title="Close Workspace">
            <X size={20} />
          </button>
        </div>
      </header>

      <div className="work-tab-editor-wrap">
        <div className="work-tab-gutter">
          {lines.map((_, i) => (
            <div key={i} className="work-tab-line-number">
              {i + 1}
            </div>
          ))}
        </div>
        <textarea
          ref={textareaRef}
          className="work-tab-textarea"
          value={editorContent}
          onChange={handleChange}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />
      </div>
      
      <footer className="work-tab-footer">
        <div className="work-tab-status">
          {lines.length} lines · {editorContent.length} chars
        </div>
        <div className="work-tab-hint">
          Changes are saved to this session automatically.
        </div>
      </footer>
    </div>
  );
}
