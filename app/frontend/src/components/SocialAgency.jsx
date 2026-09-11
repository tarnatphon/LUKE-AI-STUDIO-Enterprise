import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Megaphone, Settings, MoreVertical, Trash2, Clock, RefreshCw, Play, Pause } from "lucide-react";
import "../social-agency.css";
import { api, postJson, clientMonthlyCounts, hasActiveWork, timeUntil, currentMonth } from "../social-agency/lib.js";
import CalendarTab from "../social-agency/CalendarTab.jsx";
import WorkflowTab from "../social-agency/WorkflowTab.jsx";
import RunsTab from "../social-agency/RunsTab.jsx";
import OverviewTab from "../social-agency/OverviewTab.jsx";
import { EntryDrawer, ConnectorsDrawer } from "../social-agency/drawers.jsx";
import { AddClientModal, ConfirmModal } from "../social-agency/modals.jsx";

const TABS = [
  { id: "overview", label: "ภาพรวม" },
  { id: "calendar", label: "ปฏิทิน" },
  { id: "workflow", label: "Workflow" },
  { id: "runs", label: "อนุมัติ & การรัน" },
];

export default function SocialAgency({ onCreateImage, onCreateVideo, onOpenChat }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("calendar");
  const [drawerEntryId, setDrawerEntryId] = useState(null);
  const [connectors, setConnectors] = useState(null);
  const [connectorsOpen, setConnectorsOpen] = useState(false);
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [workflowEntryId, setWorkflowEntryId] = useState(null);
  const [styleEntryId, setStyleEntryId] = useState(null);
  const [clientMenu, setClientMenu] = useState(null);
  const railRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api("/api/social-agency/state");
      setState(data.state);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll fast while workflows are in-flight, slow otherwise (scheduler indicator stays fresh)
  const working = hasActiveWork(state);
  useEffect(() => {
    const id = setInterval(refresh, working ? 2500 : 30000);
    return () => clearInterval(id);
  }, [refresh, working]);

  // close the client ⋯ menu on any click
  useEffect(() => {
    if (!clientMenu) return;
    const close = () => setClientMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [clientMenu]);

  const activeClient = useMemo(
    () => state?.clients?.find((c) => c.id === state.activeClientId) || null,
    [state]
  );
  const counts = useMemo(() => clientMonthlyCounts(activeClient, currentMonth()), [activeClient]);
  const drawerEntry = useMemo(
    () => (activeClient?.calendar || []).find((e) => e.id === drawerEntryId) || null,
    [activeClient, drawerEntryId]
  );
  const nextPostIn = useMemo(
    () => (state?.scheduler ? timeUntil(state.scheduler.nextPostAt, Date.parse(state.serverNow || new Date().toISOString())) : null),
    [state]
  );

  const withBusy = (fn) => async (...args) => {
    setBusy(true);
    try {
      return await fn(...args);
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const switchClient = async (id) => {
    if (id === state?.activeClientId) return;
    setDrawerEntryId(null);
    setWorkflowEntryId(null);
    try {
      const data = await postJson(`/api/social-agency/clients/${encodeURIComponent(id)}/activate`, {});
      setState(data.state);
    } catch (err) {
      setError(err.message);
    }
  };

  const addClient = async (form) => {
    const data = await postJson("/api/social-agency/clients", form);
    setState(data.state);
  };

  const deleteClient = async (id) => {
    const data = await postJson(`/api/social-agency/clients/${encodeURIComponent(id)}`, {}, "DELETE");
    setState(data.state);
  };

  const runNow = withBusy(async (entryId) => {
    await postJson("/api/social-agency/run", { clientId: activeClient.id, entryId });
  });

  const approve = withBusy(async (entryId) => {
    await postJson("/api/social-agency/approve", { clientId: activeClient.id, entryId });
  });

  const reject = withBusy(async (entryId) => {
    await postJson("/api/social-agency/reject", { clientId: activeClient.id, entryId });
    setDrawerEntryId(null);
  });

  const reschedule = withBusy(async (entryId, date, time) => {
    const patch = { date };
    if (time) patch.time = time;
    await postJson(`/api/social-agency/calendar/${encodeURIComponent(entryId)}?clientId=${encodeURIComponent(activeClient.id)}`, patch, "PATCH");
    setDrawerEntryId(null);
  });

  const deleteEntry = withBusy(async (entryId) => {
    await api(`/api/social-agency/calendar/${encodeURIComponent(entryId)}?clientId=${encodeURIComponent(activeClient.id)}`, { method: "DELETE" });
    setDrawerEntryId(null);
  });

  const createEntry = withBusy(async (form) => {
    await postJson("/api/social-agency/calendar?clientId=" + encodeURIComponent(activeClient.id), { entry: form });
  });

  const autoPlan = async (month, postsPerWeek) => {
    const data = await postJson("/api/social-agency/auto-plan", { clientId: activeClient.id, month, postsPerWeek });
    return data.preview;
  };

  const applyPlan = withBusy(async (clientId, month, slots) => {
    await postJson("/api/social-agency/auto-plan/apply", { clientId, month, slots });
  });

  const saveConnectors = async (form) => {
    const data = await postJson(`/api/social-agency/connectors?clientId=${encodeURIComponent(activeClient.id)}`, { connectors: form, settings: form.settings }, "PUT");
    setConnectors(data.connectors);
    refresh();
  };

  const testConnector = async (platform, fields) => {
    const data = await postJson(`/api/social-agency/connectors/${encodeURIComponent(platform)}/test?clientId=${encodeURIComponent(activeClient.id)}`, { fields });
    return data.result;
  };

  const saveRoles = withBusy(async (roles) => {
    const data = await postJson(`/api/social-agency/clients/${encodeURIComponent(activeClient.id)}`, { researcherRoles: roles }, "PATCH");
    refresh();
    return data.client;
  });

  const openConnectors = async () => {
    try {
      const data = await api(`/api/social-agency/connectors?clientId=${encodeURIComponent(activeClient.id)}`);
      setConnectors(data.connectors);
      setConnectorsOpen(true);
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleScheduler = withBusy(async () => {
    const running = state.scheduler?.running;
    await postJson(`/api/social-agency/scheduler/${running ? "stop" : "start"}`, {});
  });

  const openInWorkflow = async (clientId, entryId) => {
    setDrawerEntryId(null);
    if (clientId && clientId !== state.activeClientId) await switchClient(clientId);
    setWorkflowEntryId(entryId);
    setTab("workflow");
  };

  if (!state) {
    return (
      <section className="sa-shell loading">
        <p>{error || "กำลังโหลดข้อมูลเอเจนซี…"} {error ? <button className="sa-btn ghost sm" onClick={refresh}><RefreshCw size={13} /> ลองใหม่</button> : null}</p>
      </section>
    );
  }

  return (
    <section className="sa-shell">
      <aside className="sa-rail" ref={railRef}>
        <header className="sa-rail-head">
          <div>
            <b>ลูกค้า (Clients)</b>
            <span className="sa-muted">{state.clients.length} ราย</span>
          </div>
          <button className="sa-btn primary sm" onClick={() => setAddClientOpen(true)} disabled={busy}>
            <Plus size={14} /> เพิ่มลูกค้า
          </button>
        </header>
        <div className="sa-rail-list">
          {state.clients.map((client) => {
            const c = clientMonthlyCounts(client, currentMonth());
            const isActive = client.id === state.activeClientId;
            return (
              <div key={client.id} className={`sa-client-card ${isActive ? "active" : ""}`}>
                <button className="sa-client-main" onClick={() => switchClient(client.id)}>
                  <span className="sa-client-avatar">{(client.name || "?").trim().charAt(0).toUpperCase()}</span>
                  <span className="sa-client-info">
                    <b>{client.name}</b>
                    <small>{client.industry}</small>
                    <small className="sa-client-mini">📅 {c.scheduled} คิวเดือนนี้{c.awaiting ? ` · ⚠️ ${c.awaiting}` : ""}</small>
                  </span>
                </button>
                <button
                  className="sa-icon-btn sm client-menu-trigger"
                  aria-label="เมนูลูกค้า"
                  onClick={(e) => {
                    e.stopPropagation();
                    setClientMenu(clientMenu === client.id ? null : client.id);
                  }}
                >
                  <MoreVertical size={14} />
                </button>
                {clientMenu === client.id && (
                  <div className="sa-client-menu" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="danger"
                      disabled={state.clients.length <= 1}
                      onClick={() => {
                        setClientMenu(null);
                        setConfirm({
                          message: `ลบลูกค้า "${client.name}" หรือไม่?`,
                          detail: "สินค้า คอนเทนต์ ปฏิทิน ประวัติการรัน และ connector ของลูกค้านี้จะถูกลบทั้งหมด (ลบได้เมื่อเหลือมากกว่า 1 ราย)",
                          confirmLabel: "ลบลูกค้า",
                          onConfirm: () => deleteClient(client.id),
                        });
                      }}
                    >
                      <Trash2 size={13} /> ลบลูกค้า
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <footer className="sa-rail-foot">
          <span className="sa-muted">เอเจนซี AI ครบวงจร · ทำงานในเครื่อง</span>
        </footer>
      </aside>

      <div className="sa-main">
        <header className="sa-header">
          <div className="sa-header-title">
            <Megaphone size={18} />
            <div>
              <h2>{activeClient?.name}</h2>
              <span className="sa-muted">{activeClient?.industry} · โทน {activeClient?.tone} · {activeClient?.products?.length || 0} สินค้า</span>
            </div>
          </div>
          <div className="sa-header-chips">
            <span className="sa-chip-stat"><b>{counts.scheduled}</b> คิวไว้แล้ว</span>
            <span className="sa-chip-stat warn"><b>{counts.awaiting}</b> รออนุมัติ</span>
            <span className="sa-chip-stat ok"><b>{counts.published}</b> เผยแพร่แล้ว</span>
            <span className="sa-chip-stat err"><b>{counts.failed}</b> ล้มเหลว/พลาด</span>
          </div>
          <div className="sa-header-right">
            <span className={`sa-scheduler ${state.scheduler?.running ? "on" : ""}`}>
              <Clock size={13} />
              {state.scheduler?.running
                ? nextPostIn
                  ? `Scheduler ทำงานอยู่ · โพสต์ถัดไปใน ${nextPostIn}`
                  : "Scheduler ทำงานอยู่ · รอคิวถัดไป"
                : "Scheduler หยุดอยู่"}
            </span>
            <button
              className="sa-icon-btn"
              title={state.scheduler?.running ? "หยุด Scheduler ชั่วคราว" : "เริ่ม Scheduler"}
              onClick={toggleScheduler}
              disabled={busy}
            >
              {state.scheduler?.running ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button className="sa-icon-btn" title="Connectors & การตั้งค่าของลูกค้านี้" onClick={openConnectors}>
              <Settings size={16} />
            </button>
          </div>
        </header>

        {error && <p className="sa-error-banner" role="alert">{error} <button className="sa-btn ghost sm" onClick={() => setError("")}>ปิด</button></p>}

        <nav className="sa-tabs">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
              {t.label}
              {t.id === "runs" && counts.awaiting > 0 && <span className="sa-tab-badge">{counts.awaiting}</span>}
            </button>
          ))}
        </nav>

        <div className="sa-content">
          {tab === "calendar" && (
            <CalendarTab
              state={state}
              activeClient={activeClient}
              busy={busy}
              onOpenEntry={(id) => setDrawerEntryId(id)}
              onRunNow={runNow}
              onReschedule={reschedule}
              onDeleteEntry={(id) =>
                setConfirm({
                  message: "ลบรายการนี้ออกจากปฏิทินหรือไม่?",
                  detail: "คอนเทนต์และประวัติการรันของช่องเวลานี้จะหายไปด้วย",
                  confirmLabel: "ลบรายการ",
                  onConfirm: () => deleteEntry(id),
                })
              }
              onCreateEntry={createEntry}
              onAutoPlan={autoPlan}
              onApplyPlan={applyPlan}
            />
          )}
          {tab === "workflow" && (
            <WorkflowTab
              state={state}
              activeClient={activeClient}
              selectedEntryId={workflowEntryId}
              onSelectEntry={setWorkflowEntryId}
              onOpenEntry={(id) => setDrawerEntryId(id)}
              onSaveRoles={saveRoles}
            />
          )}
          {tab === "runs" && (
            <RunsTab
              state={state}
              activeClient={activeClient}
              busy={busy}
              onApprove={approve}
              onReject={reject}
              onOpenEntry={(id) => setDrawerEntryId(id)}
              onOpenInWorkflow={openInWorkflow}
            />
          )}
        </div>
      </div>

      {drawerEntry && activeClient && (
        <EntryDrawer
          entry={drawerEntry}
          client={activeClient}
          busy={busy}
          onClose={() => setDrawerEntryId(null)}
          onRunNow={runNow}
          onApprove={approve}
          onReject={reject}
          onReschedule={(entryId, date, time) => reschedule(entryId, date, time)}
          onDelete={(id) =>
            setConfirm({
              message: "ลบรายการนี้ออกจากปฏิทินหรือไม่?",
              detail: "คอนเทนต์และประวัติการรันของช่องเวลานี้จะหายไปด้วย",
              confirmLabel: "ลบรายการ",
              onConfirm: () => deleteEntry(id),
            })
          }
          onOpenInWorkflow={(id) => openInWorkflow(activeClient.id, id)}
          onCreateImage={onCreateImage}
          onCreateVideo={onCreateVideo}
          onOpenChat={onOpenChat}
        />
      )}

      {connectorsOpen && activeClient && (
        <ConnectorsDrawer
          client={activeClient}
          connectors={connectors}
          busy={busy}
          onClose={() => setConnectorsOpen(false)}
          onSave={saveConnectors}
          onTest={testConnector}
        />
      )}

      {addClientOpen && <AddClientModal onClose={() => setAddClientOpen(false)} onCreate={addClient} />}

      {confirm && (
        <ConfirmModal
          message={confirm.message}
          detail={confirm.detail}
          confirmLabel={confirm.confirmLabel}
          onConfirm={confirm.onConfirm}
          onClose={() => setConfirm(null)}
        />
      )}
    </section>
  );
}
il={confirm.detail}
          confirmLabel={confirm.confirmLabel}
          onConfirm={confirm.onConfirm}
          onClose={() => setConfirm(null)}
        />
      )}
    </section>
  );
}
