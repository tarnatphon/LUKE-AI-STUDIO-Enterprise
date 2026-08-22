import React, { memo, useEffect, useState } from "react";
import { Archive, BriefcaseBusiness, Image, FolderDown, MessageSquare, Mic, Settings, Sparkles, Home, Terminal, ChevronDown, ChevronUp, Trash2, Volume2, Film } from "lucide-react";
import ChatProjects from "./ChatProjects";

function formatSidebarDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const dateStr = date.toLocaleDateString();
  const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${dateStr} ${timeStr}`;
}

function Sidebar({ 
  collapsed = false,
  activeTab, 
  setActiveTab, 
  prefetchWorkspace,
  specs,
  conversations = [],
  activeConversationId,
  setActiveConversationId,
  showHistory,
  setShowHistory,
  onDeleteConversation,
  onMoveConversationToProject,
  speechTranscriptions = [],
  selectedSpeechTranscript,
  setSelectedSpeechTranscript,
  showSpeechHistory,
  setShowSpeechHistory,
  onDeleteSpeechTranscription,
  ttsOutputs = [],
  selectedTtsOutput,
  setSelectedTtsOutput,
  showTtsHistory,
  setShowTtsHistory,
  onDeleteTtsOutput,
  projects = [],
  setProjects,
  activeProjectId,
  setActiveProjectId,
  assistantMode = "chat",
  setAssistantMode,
}) {
  const [chatContextMenu, setChatContextMenu] = useState(null);

  useEffect(() => {
    const closeModeMenu = (event) => {
      if (!event.target.closest?.(".chat-project-context-menu")) setChatContextMenu(null);
    };
    document.addEventListener("mousedown", closeModeMenu);
    return () => document.removeEventListener("mousedown", closeModeMenu);
  }, []);
  const prefetchProps = (tab) => ({
    onPointerEnter: () => prefetchWorkspace?.(tab),
    onFocus: () => prefetchWorkspace?.(tab),
  });

  const navigationProps = (tab) => ({
    role: "link",
    tabIndex: 0,
    "aria-current": activeTab === tab ? "page" : undefined,
    onClick: () => setActiveTab(tab),
    onKeyDown: (event) => {
      if (event.target !== event.currentTarget) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      setActiveTab(tab);
    },
    ...prefetchProps(tab),
  });

  const historyItemProps = (onSelect, isActive, label) => ({
    role: "button",
    tabIndex: 0,
    "aria-current": isActive ? "true" : undefined,
    "aria-label": label,
    onClick: onSelect,
    onKeyDown: (event) => {
      if (event.target !== event.currentTarget) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onSelect();
    },
  });

  return (
    <div className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div>
        {/* Sidebar Header */}
        <button type="button" className="sidebar-logo" onClick={() => setActiveTab("home")} aria-label="LUKE AI Studio home">
          <span className="sidebar-logo-mark"><Sparkles className="sidebar-logo-icon" aria-hidden="true" /></span>
          <span className="sidebar-logo-text"><b>LUKE AI</b><small>STUDIO</small></span>
        </button>
        <div className="sidebar-mode-selector" aria-label="Assistant mode">
          <div className="sidebar-mode-tabs" role="tablist" aria-label="Choose Chat or Work mode">
            <button type="button" role="tab" aria-selected={assistantMode === "chat"} className={assistantMode === "chat" ? "active" : ""} onClick={() => setAssistantMode?.("chat")}>
              <MessageSquare size={18} /><span>Chat</span>
            </button>
            <button type="button" role="tab" aria-selected={assistantMode === "work"} className={assistantMode === "work" ? "active" : ""} onClick={() => setAssistantMode?.("work")}>
              <BriefcaseBusiness size={18} /><span>Work</span>
            </button>
          </div>
          <small>{assistantMode === "work" ? "Projects, files and tools" : "Ask, learn and explore"}</small>
        </div>

        {/* Sidebar Navigation Links (Material 3 style) */}
        <div className="nav-list">
          <div className={`nav-item ${activeTab === "home" ? "active" : ""}`} {...navigationProps("home")}>
            <Home size={20} />
            <span>Home</span>
          </div>

          <div
            className={`nav-item ${activeTab === "generator" ? "active" : ""}`}
            {...navigationProps("generator")}
          >
            <Image size={20} />
            <span>Create Image</span>
          </div>

          <div className={`nav-item ${activeTab === "image-video" ? "active" : ""}`} {...navigationProps("image-video")}>
            <Film size={20} />
            <span>Animate Image</span>
          </div>

          <div className={`nav-item ${activeTab === "assets" ? "active" : ""}`} {...navigationProps("assets")}>
            <Archive size={20} />
            <span>Assets</span>
          </div>

          <div className="nav-item-wrapper" style={{ display: "flex", flexDirection: "column" }}>
            <div
              className={`nav-item ${activeTab === "chat" ? "active" : ""}`}
              {...navigationProps("chat")}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", boxSizing: "border-box" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <MessageSquare size={20} />
                <span>Chat</span>
              </div>
              <button
                aria-expanded={showHistory}
                aria-controls="chat-history-list"
                aria-label={showHistory ? "Hide chat history" : "Show chat history"}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowHistory(!showHistory);
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "inherit",
                  cursor: "pointer",
                  padding: "4px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "50%",
                  transition: "background-color 0.2s"
                }}
                className="history-toggle-arrow"
                title={showHistory ? "Hide Chat History" : "Show Chat History"}
              >
                {showHistory ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            </div>

            {/* Sidebar Chat History List */}
            {showHistory && (
              <div 
                id="chat-history-list"
                aria-label="Chat history"
                className="sidebar-history-list" 
                style={{ 
                  paddingLeft: "14px", 
                  marginTop: "6px", 
                  marginBottom: "6px",
                  display: "flex", 
                  flexDirection: "column", 
                  gap: "4px", 
                  maxHeight: "220px", 
                  overflowY: "auto",
                  borderLeft: "2px solid var(--border-color)"
                }}
              >
                {conversations.length === 0 ? (
                  <div style={{ padding: "8px 12px", fontSize: "0.78rem", color: "var(--md-sys-color-outline)", opacity: 0.8 }}>
                    No saved chats
                  </div>
                ) : (
                  conversations.map((conv) => {
                    const isActive = activeConversationId === conv.id;
                    return (
                      <div
                        key={conv.id}
                        {...historyItemProps(() => {
                          setActiveConversationId(conv.id);
                          setActiveTab("chat");
                        }, isActive, `Open chat ${conv.title}`)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "6px 8px 6px 10px",
                          borderRadius: "var(--md-shape-corner-small)",
                          fontSize: "0.78rem",
                          cursor: "pointer",
                          background: isActive ? "var(--md-sys-color-secondary-container)" : "transparent",
                          color: isActive ? "var(--md-sys-color-on-secondary-container)" : "var(--md-sys-color-on-surface-variant)",
                          border: isActive ? "1px solid var(--md-sys-color-outline-variant)" : "1px solid transparent",
                          transition: "background 0.2s"
                        }}
                        className="sidebar-history-item"
                        title={conv.title}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setChatContextMenu({
                            conversationId: conv.id,
                            x: Math.min(event.clientX, window.innerWidth - 286),
                            y: Math.min(event.clientY, window.innerHeight - Math.min(360, 112 + projects.length * 41)),
                          });
                        }}
                      >
                        <span style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          flex: 1,
                          fontWeight: isActive ? 600 : 400
                        }}>
                          {conv.title}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteConversation(conv.id, e);
                          }}
                          style={{
                            background: "none",
                            border: "none",
                            color: "var(--md-sys-color-outline)",
                            cursor: "pointer",
                            padding: "2px",
                            marginLeft: "6px",
                            display: "flex",
                            alignItems: "center"
                          }}
                          className="sidebar-history-delete"
                          title="Delete Conversation"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          <div className="nav-item-wrapper" style={{ display: "flex", flexDirection: "column" }}>
            <div
              className={`nav-item ${activeTab === "speech" ? "active" : ""}`}
              {...navigationProps("speech")}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", boxSizing: "border-box" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <Mic size={20} />
                <span>Transcribe</span>
              </div>
              <button
                aria-expanded={showSpeechHistory}
                aria-controls="speech-history-list"
                aria-label={showSpeechHistory ? "Hide transcriptions" : "Show transcriptions"}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowSpeechHistory(!showSpeechHistory);
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "inherit",
                  cursor: "pointer",
                  padding: "4px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "50%",
                  transition: "background-color 0.2s"
                }}
                className="history-toggle-arrow"
                title={showSpeechHistory ? "Hide Transcriptions" : "Show Transcriptions"}
              >
                {showSpeechHistory ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            </div>

            {showSpeechHistory && (
              <div
                id="speech-history-list"
                aria-label="Transcription history"
                className="sidebar-history-list"
                style={{
                  paddingLeft: "14px",
                  marginTop: "6px",
                  marginBottom: "6px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                  maxHeight: "220px",
                  overflowY: "auto",
                  borderLeft: "2px solid var(--border-color)"
                }}
              >
                {speechTranscriptions.length === 0 ? (
                  <div style={{ padding: "8px 12px", fontSize: "0.78rem", color: "var(--md-sys-color-outline)", opacity: 0.8 }}>
                    No saved transcriptions
                  </div>
                ) : (
                  speechTranscriptions.map((item) => {
                    const itemId = item.filename || item.metadata || item.textFile;
                    const isActive = selectedSpeechTranscript && (selectedSpeechTranscript.filename || selectedSpeechTranscript.metadata || selectedSpeechTranscript.textFile) === itemId;
                    const title = item.displayName || item.sourceFilename || item.textFile || item.filename || "Transcript";
                    const date = formatSidebarDate(item.modifiedAt || item.createdAt);
                    return (
                      <div
                        key={itemId}
                        {...historyItemProps(() => {
                          setSelectedSpeechTranscript(item);
                          setActiveTab("speech");
                        }, isActive, `Open transcription ${title}`)}
                        style={{
                          display: "flex",
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "7px 8px 7px 10px",
                          borderRadius: "var(--md-shape-corner-small)",
                          fontSize: "0.78rem",
                          cursor: "pointer",
                          background: isActive ? "var(--md-sys-color-secondary-container)" : "transparent",
                          color: isActive ? "var(--md-sys-color-on-secondary-container)" : "var(--md-sys-color-on-surface-variant)",
                          border: isActive ? "1px solid var(--md-sys-color-outline-variant)" : "1px solid transparent",
                          transition: "background 0.2s"
                        }}
                        className="sidebar-history-item"
                        title={title}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: "2px", flex: 1, minWidth: 0 }}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: isActive ? 600 : 400 }}>
                            {title}
                          </span>
                          {date && (
                            <span style={{ fontSize: "0.68rem", opacity: 0.72, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {date}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteSpeechTranscription?.(item, e);
                          }}
                          style={{
                            background: "none",
                            border: "none",
                            color: "var(--md-sys-color-outline)",
                            cursor: "pointer",
                            padding: "2px",
                            marginLeft: "6px",
                            display: "flex",
                            alignItems: "center"
                          }}
                          className="sidebar-history-delete"
                          title="Delete Transcription"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          <div className="nav-item-wrapper" style={{ display: "flex", flexDirection: "column" }}>
            <div
              className={`nav-item ${activeTab === "tts" ? "active" : ""}`}
              {...navigationProps("tts")}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", boxSizing: "border-box" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <Volume2 size={20} />
                <span>Text to Speech</span>
              </div>
              <button
                aria-expanded={showTtsHistory}
                aria-controls="tts-history-list"
                aria-label={showTtsHistory ? "Hide TTS outputs" : "Show TTS outputs"}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowTtsHistory(!showTtsHistory);
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "inherit",
                  cursor: "pointer",
                  padding: "4px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "50%",
                  transition: "background-color 0.2s"
                }}
                className="history-toggle-arrow"
                title={showTtsHistory ? "Hide TTS Outputs" : "Show TTS Outputs"}
              >
                {showTtsHistory ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            </div>

            {showTtsHistory && (
              <div
                id="tts-history-list"
                aria-label="Text to speech history"
                className="sidebar-history-list"
                style={{
                  paddingLeft: "14px",
                  marginTop: "6px",
                  marginBottom: "6px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                  maxHeight: "220px",
                  overflowY: "auto",
                  borderLeft: "2px solid var(--border-color)"
                }}
              >
                {ttsOutputs.length === 0 ? (
                  <div style={{ padding: "8px 12px", fontSize: "0.78rem", color: "var(--md-sys-color-outline)", opacity: 0.8 }}>
                    No saved audio
                  </div>
                ) : (
                  ttsOutputs.map((item) => {
                    const itemId = item.filename || item.metadata || item.audioFile;
                    const isActive = selectedTtsOutput && (selectedTtsOutput.filename || selectedTtsOutput.metadata || selectedTtsOutput.audioFile) === itemId;
                    const title = item.displayName || item.text || item.audioFile || item.filename || "TTS Output";
                    const date = formatSidebarDate(item.modifiedAt || item.createdAt);
                    return (
                      <div
                        key={itemId}
                        {...historyItemProps(() => {
                          setSelectedTtsOutput(item);
                          setActiveTab("tts");
                        }, isActive, `Open audio ${title}`)}
                        style={{
                          display: "flex",
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "7px 8px 7px 10px",
                          borderRadius: "var(--md-shape-corner-small)",
                          fontSize: "0.78rem",
                          cursor: "pointer",
                          background: isActive ? "var(--md-sys-color-secondary-container)" : "transparent",
                          color: isActive ? "var(--md-sys-color-on-secondary-container)" : "var(--md-sys-color-on-surface-variant)",
                          border: isActive ? "1px solid var(--md-sys-color-outline-variant)" : "1px solid transparent",
                          transition: "background 0.2s"
                        }}
                        className="sidebar-history-item"
                        title={title}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: "2px", flex: 1, minWidth: 0 }}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: isActive ? 600 : 400 }}>
                            {title}
                          </span>
                          {date && (
                            <span style={{ fontSize: "0.68rem", opacity: 0.72, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {date}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteTtsOutput?.(item, e);
                          }}
                          style={{
                            background: "none",
                            border: "none",
                            color: "var(--md-sys-color-outline)",
                            cursor: "pointer",
                            padding: "2px",
                            marginLeft: "6px",
                            display: "flex",
                            alignItems: "center"
                          }}
                          className="sidebar-history-delete"
                          title="Delete TTS Output"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          <div
            className={`nav-item ${activeTab === "models" ? "active" : ""}`}
            {...navigationProps("models")}
          >
            <FolderDown size={20} />
            <span>AI Library</span>
          </div>

          <div
            className={`nav-item ${activeTab === "settings" ? "active" : ""}`}
            {...navigationProps("settings")}
          >
            <Settings size={20} />
            <span>Settings</span>
          </div>
        </div>

        {assistantMode === "work" && <ChatProjects
          projects={projects}
          setProjects={setProjects}
          conversations={conversations}
          activeProjectId={activeProjectId}
          setActiveProjectId={setActiveProjectId}
          setActiveConversationId={setActiveConversationId}
          setActiveTab={setActiveTab}
        />}
        {chatContextMenu && (
          <div className="chat-project-context-menu" role="menu" style={{ left: chatContextMenu.x, top: chatContextMenu.y }}>
            <strong>Move to Work project</strong>
            {projects.length === 0 && <span>No projects yet — switch to Work to create one.</span>}
            {projects.map((project) => (
              <button type="button" role="menuitem" key={project.id} onClick={() => {
                onMoveConversationToProject?.(chatContextMenu.conversationId, project.id);
                setAssistantMode?.("work");
                setActiveProjectId(project.id);
                setActiveConversationId(chatContextMenu.conversationId);
                setChatContextMenu(null);
              }}>
                <BriefcaseBusiness size={15} /> {project.name}
              </button>
            ))}
            {conversations.find((conversation) => conversation.id === chatContextMenu.conversationId)?.projectId && (
              <button type="button" role="menuitem" onClick={() => {
                onMoveConversationToProject?.(chatContextMenu.conversationId, null);
                setChatContextMenu(null);
              }}>
                <MessageSquare size={15} /> Move back to Chat
              </button>
            )}
          </div>
        )}
      </div>

      {/* Sidebar Footer with Host Telemetry System Specs */}
      <div className="sidebar-footer">
        <div className="sidebar-specs-header">
          <Terminal size={12} />
          <span>Host Specifications</span>
        </div>
        <div className="sidebar-specs-item" title={specs.cpu_name}>
          CPU: {specs.cpu_name}
        </div>
        <div className="sidebar-specs-item" title={specs.gpu_name}>
          GPU: {specs.gpu_name}
        </div>
        <div className="sidebar-specs-item">
          Memory: {specs.ram_total_gb.toFixed(0)} GB RAM ({specs.cpu_cores_physical} Cores)
        </div>
        <div className="sidebar-specs-os">
          OS: {specs.os_name}
        </div>
      </div>
    </div>
  );
}

export default memo(Sidebar);
