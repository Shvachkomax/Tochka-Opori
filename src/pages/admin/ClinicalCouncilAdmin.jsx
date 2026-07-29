import React, { useState, useEffect } from "react";

export default function ClinicalCouncilAdmin({ adminPassword, theme }) {
  const [tab, setTab] = useState("invitations");
  const [invitations, setInvitations] = useState([]);
  const [invitationsCount, setInvitationsCount] = useState(0);
  const [invitationsLoading, setInvitationsLoading] = useState(false);
  const [experts, setExperts] = useState([]);
  const [expertsLoading, setExpertsLoading] = useState(false);
  const [trash, setTrash] = useState([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [inviteForm, setInviteForm] = useState({ first_name: "", last_name: "", email: "", specialty: "", organization: "", notes: "", expires_days: 30 });
  const [inviteSaving, setInviteSaving] = useState(false);
  const [inviteResult, setInviteResult] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [toast, setToast] = useState({ message: "", type: "" });
  const [approvedToken, setApprovedToken] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);

  function showToast(message, type = "success") {
    setToast({ message, type });
    setTimeout(() => setToast({ message: "", type: "" }), 4000);
  }

  async function loadInvitations() {
    setInvitationsLoading(true);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "listCouncilInvitations", password: adminPassword }),
      });
      const data = await res.json();
      if (data.ok) {
        setInvitations(data.records || []);
        setInvitationsCount(data.count || 0);
      }
    } catch {} finally {
      setInvitationsLoading(false);
    }
  }

  async function loadExperts() {
    setExpertsLoading(true);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "listCouncilExperts", password: adminPassword }),
      });
      const data = await res.json();
      if (data.ok) {
        setExperts(data.records || []);
      }
    } catch {} finally {
      setExpertsLoading(false);
    }
  }

  async function loadTrash() {
    setTrashLoading(true);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "listCouncilTrash", password: adminPassword }),
      });
      const data = await res.json();
      if (data.ok) {
        setTrash(data.records || []);
      }
    } catch {} finally {
      setTrashLoading(false);
    }
  }

  useEffect(() => {
    loadInvitations();
  }, []);

  async function doAction(action, id, extra = {}) {
    setActionLoading(action + id);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, password: adminPassword, id, ...extra }),
      });
      const data = await res.json();
      if (data.ok) {
        if (action === "createCouncilInvitation") {
          setInviteResult(data.invitation);
          setInviteForm({ first_name: "", last_name: "", email: "", specialty: "", organization: "", notes: "", expires_days: 30 });
          loadInvitations();
          return data.invitation;
        }
        if (action === "approveCouncilExpert") {
          setApprovedToken({ token: data.access_token, id });
        } else if (action === "rejectCouncilExpert") {
          showToast("Заявка отклонена");
        } else if (action === "revokeCouncilInvitation") {
          showToast("Приглашение отозвано");
        } else if (action === "pauseCouncilExpert") {
          showToast("Эксперт приостановлен");
        } else if (action === "restoreCouncilExpert") {
          showToast("Эксперт восстановлен");
        } else if (action === "trashCouncilInvitation") {
          showToast("Приглашение перемещено в корзину");
        } else if (action === "trashCouncilExpert") {
          showToast("Запись перемещена в корзину");
        } else if (action === "restoreCouncilInvitation" || action === "restoreCouncilExpert") {
          showToast("Запись восстановлена");
          loadTrash();
        } else if (action === "permanentlyDeleteCouncilInvitation") {
          showToast("Приглашение окончательно удалено");
          loadTrash();
          return;
        } else if (action === "permanentlyDeleteCouncilExpert") {
          showToast("Запись окончательно удалена");
          loadTrash();
          return;
        }
        loadInvitations();
        loadExperts();
      } else {
        showToast(data.error || "Ошибка", "error");
      }
    } catch {
      showToast("Ошибка запроса", "error");
    } finally {
      setActionLoading(null);
      setConfirmAction(null);
    }
  }

  function switchTab(newTab) {
    setTab(newTab);
    if (newTab === "invitations") loadInvitations();
    else if (newTab === "trash") loadTrash();
    else loadExperts();
  }

  const tabKeys = ["invitations", "candidates", "experts", "trash"];

  return (
    <>
      {/* Tab switcher */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {tabKeys.map(tabKey => (
          <button
            key={tabKey}
            style={{
              border: 0, borderRadius: 14, padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer",
              background: tab === tabKey ? theme.tabActive : theme.tabBg,
              color: tab === tabKey ? theme.tabActiveText : theme.text,
            }}
            onClick={() => switchTab(tabKey)}
          >
            {tabKey === "invitations" ? "Приглашения" : tabKey === "candidates" ? "Кандидаты" : tabKey === "trash" ? "Корзина" : "Эксперты"}
          </button>
        ))}
      </div>

      {/* Invitations tab */}
      {tab === "invitations" && (
        <div>
          <div style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 20, padding: 24, marginBottom: 20 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Новое приглашение</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <input placeholder="Имя *" value={inviteForm.first_name} onChange={e => setInviteForm({ ...inviteForm, first_name: e.target.value })}
                style={{ border: `1px solid ${theme.inputBorder}`, borderRadius: 12, background: theme.inputBg, color: theme.inputText, padding: "10px 14px", fontSize: 14, outline: "none" }} />
              <input placeholder="Фамилия *" value={inviteForm.last_name} onChange={e => setInviteForm({ ...inviteForm, last_name: e.target.value })}
                style={{ border: `1px solid ${theme.inputBorder}`, borderRadius: 12, background: theme.inputBg, color: theme.inputText, padding: "10px 14px", fontSize: 14, outline: "none" }} />
              <input placeholder="Email" value={inviteForm.email} onChange={e => setInviteForm({ ...inviteForm, email: e.target.value })}
                style={{ border: `1px solid ${theme.inputBorder}`, borderRadius: 12, background: theme.inputBg, color: theme.inputText, padding: "10px 14px", fontSize: 14, outline: "none" }} />
              <input placeholder="Специальность" value={inviteForm.specialty} onChange={e => setInviteForm({ ...inviteForm, specialty: e.target.value })}
                style={{ border: `1px solid ${theme.inputBorder}`, borderRadius: 12, background: theme.inputBg, color: theme.inputText, padding: "10px 14px", fontSize: 14, outline: "none" }} />
              <input placeholder="Организация" value={inviteForm.organization} onChange={e => setInviteForm({ ...inviteForm, organization: e.target.value })}
                style={{ border: `1px solid ${theme.inputBorder}`, borderRadius: 12, background: theme.inputBg, color: theme.inputText, padding: "10px 14px", fontSize: 14, outline: "none" }} />
              <input placeholder="Срок (дней)" type="number" min="1" value={inviteForm.expires_days} onChange={e => setInviteForm({ ...inviteForm, expires_days: parseInt(e.target.value) || 30 })}
                style={{ border: `1px solid ${theme.inputBorder}`, borderRadius: 12, background: theme.inputBg, color: theme.inputText, padding: "10px 14px", fontSize: 14, outline: "none" }} />
            </div>
            <textarea placeholder="Заметка (необязательно)" value={inviteForm.notes} onChange={e => setInviteForm({ ...inviteForm, notes: e.target.value })}
              style={{ width: "100%", border: `1px solid ${theme.inputBorder}`, borderRadius: 12, background: theme.inputBg, color: theme.inputText, padding: "10px 14px", fontSize: 14, outline: "none", resize: "vertical", minHeight: 60, marginBottom: 12 }} />
            <button
              disabled={inviteSaving || !inviteForm.first_name || !inviteForm.last_name}
              style={{
                border: 0, borderRadius: 14, padding: "12px 24px", fontWeight: 700, fontSize: 14, cursor: inviteSaving ? "wait" : "pointer",
                background: inviteSaving || !inviteForm.first_name || !inviteForm.last_name ? theme.tabBg : theme.accent,
                color: inviteSaving || !inviteForm.first_name || !inviteForm.last_name ? theme.muted : "#fff",
              }}
              onClick={async () => {
                setInviteSaving(true);
                await doAction("createCouncilInvitation", null, { ...inviteForm });
                setInviteSaving(false);
              }}
            >
              {inviteSaving ? "Создание..." : "Создать приглашение"}
            </button>
          </div>

          {inviteResult && (
            <div style={{ background: "#E2EBE4", border: "1px solid rgba(125,154,137,.3)", borderRadius: 16, padding: 20, marginBottom: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#5F7D6C", marginBottom: 8 }}>Приглашение создано</div>
              <div style={{ fontSize: 13, color: "#5F7D6C", marginBottom: 4 }}>Код: <strong>{inviteResult.code}</strong></div>
              <div style={{ fontSize: 12, color: "#5F7D6C", marginBottom: 10, wordBreak: "break-all" }}>
                Ссылка: {window.location.origin}/expert-invite/{inviteResult.token}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  style={{ border: 0, borderRadius: 10, padding: "6px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer", background: "#5F7D6C", color: "#fff" }}
                  onClick={() => {
                    navigator.clipboard.writeText(window.location.origin + "/expert-invite/" + inviteResult.token);
                    setTokenCopied(true);
                    setTimeout(() => setTokenCopied(false), 2000);
                  }}
                >
                  {tokenCopied ? "✓ Скопировано" : "Копировать ссылку"}
                </button>
                <button
                  style={{ border: 0, borderRadius: 10, padding: "6px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer", background: "transparent", color: "#5F7D6C", border: "1px solid rgba(125,154,137,.3)" }}
                  onClick={() => setInviteResult(null)}
                >
                  Закрыть
                </button>
              </div>
            </div>
          )}

          <div style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 20, padding: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Приглашения ({invitationsCount})</h3>
            {invitationsLoading ? (
              <div style={{ color: theme.muted, fontSize: 14, padding: 20 }}>Загрузка...</div>
            ) : invitations.length === 0 ? (
              <div style={{ color: theme.muted, fontSize: 14, padding: 20 }}>Нет приглашений</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {invitations.map(inv => (
                  <div key={inv.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderRadius: 14, background: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{inv.invited_first_name} {inv.invited_last_name}</span>
                      <span style={{ marginLeft: 10, fontSize: 12, color: theme.muted }}>{inv.invite_code}</span>
                      {inv.invited_email && <span style={{ marginLeft: 10, fontSize: 12, color: theme.muted }}>· {inv.invited_email}</span>}
                      <div style={{ fontSize: 12, color: theme.muted, marginTop: 2 }}>
                        Статус: <span style={{ fontWeight: 600, color: inv.status === "accepted" ? "#5F7D6C" : inv.status === "revoked" ? "#ef4444" : inv.status === "expired" ? "#eab308" : theme.text }}>{inv.status}</span>
                        {inv.expires_at && <span> · Истекает: {new Date(inv.expires_at).toLocaleDateString("ru-RU")}</span>}
                        <span> · Использований: {inv.use_count}/{inv.max_uses}</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {inv.status !== "revoked" && inv.status !== "accepted" && (
                        <button
                          disabled={actionLoading === "revokeCouncilInvitation" + inv.id}
                          style={{ border: 0, borderRadius: 10, padding: "6px 12px", fontWeight: 700, fontSize: 12, cursor: "pointer", background: "transparent", color: "#ef4444", border: "1px solid #ef4444" }}
                          onClick={() => doAction("revokeCouncilInvitation", inv.id)}
                        >
                          Отозвать
                        </button>
                      )}
                      <button
                        disabled={actionLoading === "trashCouncilInvitation" + inv.id}
                        style={{ border: 0, borderRadius: 10, padding: "6px 12px", fontWeight: 700, fontSize: 12, cursor: "pointer", background: "transparent", color: "#7A7268", border: "1px solid #7A7268" }}
                        onClick={() => setConfirmAction({ action: "trashCouncilInvitation", id: inv.id, message: "Переместить приглашение в корзину? Персональная ссылка перестанет работать." })}
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Candidates tab */}
      {tab === "candidates" && (
        <div>
          <div style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 20, padding: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Кандидаты на рассмотрении ({experts.filter(e => e.status === "pending_review").length})</h3>
            {expertsLoading ? (
              <div style={{ color: theme.muted, fontSize: 14, padding: 20 }}>Загрузка...</div>
            ) : experts.filter(e => e.status === "pending_review").length === 0 ? (
              <div style={{ color: theme.muted, fontSize: 14, padding: 20 }}>Нет кандидатов</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {experts.filter(e => e.status === "pending_review").map(exp => (
                  <div key={exp.id} style={{ padding: "12px 16px", borderRadius: 14, background: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                      <div>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>{exp.first_name} {exp.last_name}</span>
                        {exp.specialty && <span style={{ marginLeft: 10, fontSize: 12, color: theme.muted }}>· {exp.specialty}</span>}
                        {exp.organization && <span style={{ marginLeft: 10, fontSize: 12, color: theme.muted }}>· {exp.organization}</span>}
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          disabled={actionLoading === "approveCouncilExpert" + exp.id}
                          style={{ border: 0, borderRadius: 10, padding: "6px 12px", fontWeight: 700, fontSize: 12, cursor: "pointer", background: "#5F7D6C", color: "#fff" }}
                          onClick={() => doAction("approveCouncilExpert", exp.id)}
                        >
                          {actionLoading === "approveCouncilExpert" + exp.id ? "..." : "Утвердить"}
                        </button>
                        <button
                          disabled={actionLoading === "rejectCouncilExpert" + exp.id}
                          style={{ border: 0, borderRadius: 10, padding: "6px 12px", fontWeight: 700, fontSize: 12, cursor: "pointer", background: "transparent", color: "#ef4444", border: "1px solid #ef4444" }}
                          onClick={() => doAction("rejectCouncilExpert", exp.id)}
                        >
                          {actionLoading === "rejectCouncilExpert" + exp.id ? "..." : "Отклонить"}
                        </button>
                        <button
                          disabled={actionLoading === "trashCouncilExpert" + exp.id}
                          style={{ border: 0, borderRadius: 10, padding: "6px 12px", fontWeight: 700, fontSize: 12, cursor: "pointer", background: "transparent", color: "#7A7268", border: "1px solid #7A7268" }}
                          onClick={() => setConfirmAction({ action: "trashCouncilExpert", id: exp.id, message: "Переместить анкету кандидата в корзину? Её можно будет восстановить." })}
                        >
                          🗑
                        </button>
                      </div>
                    </div>
                    {exp.email && <div style={{ fontSize: 12, color: theme.muted }}>Email: {exp.email}</div>}
                    {exp.professional_note && <div style={{ fontSize: 12, color: theme.muted, marginTop: 4 }}>{exp.professional_note}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Experts tab */}
      {tab === "experts" && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, justifyContent: "flex-end" }}>
            <button
              disabled={expertsLoading}
              style={{ border: 0, borderRadius: 10, padding: "6px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer", background: theme.tabBg, color: theme.text }}
              onClick={() => doAction("exportCouncilExperts", null)}
            >
              Выгрузить JSONL
            </button>
          </div>
          <div style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 20, padding: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Эксперты ({experts.filter(e => e.status === "active" || e.status === "paused").length})</h3>
            {expertsLoading ? (
              <div style={{ color: theme.muted, fontSize: 14, padding: 20 }}>Загрузка...</div>
            ) : experts.filter(e => e.status === "active" || e.status === "paused").length === 0 ? (
              <div style={{ color: theme.muted, fontSize: 14, padding: 20 }}>Нет экспертов</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {experts.filter(e => e.status === "active" || e.status === "paused").map(exp => (
                  <div key={exp.id} style={{ padding: "12px 16px", borderRadius: 14, background: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                      <div>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>{exp.first_name} {exp.last_name}</span>
                        {exp.specialty && <span style={{ marginLeft: 10, fontSize: 12, color: theme.muted }}>· {exp.specialty}</span>}
                        <span style={{ marginLeft: 10, fontSize: 12, color: exp.status === "active" ? "#5F7D6C" : "#eab308", fontWeight: 600 }}>{exp.status}</span>
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        {exp.status === "active" && (
                          <button
                            disabled={actionLoading === "pauseCouncilExpert" + exp.id}
                            style={{ border: 0, borderRadius: 10, padding: "6px 12px", fontWeight: 700, fontSize: 12, cursor: "pointer", background: "transparent", color: "#eab308", border: "1px solid #eab308" }}
                            onClick={() => doAction("pauseCouncilExpert", exp.id)}
                          >
                            {actionLoading === "pauseCouncilExpert" + exp.id ? "..." : "Приостановить"}
                          </button>
                        )}
                        {exp.status === "paused" && (
                          <button
                            disabled={actionLoading === "restoreCouncilExpert" + exp.id}
                            style={{ border: 0, borderRadius: 10, padding: "6px 12px", fontWeight: 700, fontSize: 12, cursor: "pointer", background: "#5F7D6C", color: "#fff" }}
                            onClick={() => doAction("restoreCouncilExpert", exp.id)}
                          >
                            {actionLoading === "restoreCouncilExpert" + exp.id ? "..." : "Восстановить"}
                          </button>
                        )}
                        <button
                          disabled={actionLoading === "trashCouncilExpert" + exp.id}
                          style={{ border: 0, borderRadius: 10, padding: "6px 12px", fontWeight: 700, fontSize: 12, cursor: "pointer", background: "transparent", color: "#7A7268", border: "1px solid #7A7268" }}
                          onClick={() => setConfirmAction({ action: "trashCouncilExpert", id: exp.id, message: "Переместить эксперта в корзину? Доступ в кабинет будет немедленно закрыт." })}
                        >
                          🗑
                        </button>
                      </div>
                    </div>
                    {exp.email && <div style={{ fontSize: 12, color: theme.muted }}>Email: {exp.email}</div>}
                    {exp.approved_at && <div style={{ fontSize: 12, color: theme.muted }}>Утверждён: {new Date(exp.approved_at).toLocaleDateString("ru-RU")}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Trash tab */}
      {tab === "trash" && (
        <div>
          <div style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 20, padding: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Корзина</h3>
            {trashLoading ? (
              <div style={{ color: theme.muted, fontSize: 14, padding: 20 }}>Загрузка...</div>
            ) : trash.length === 0 ? (
              <div style={{ color: theme.muted, fontSize: 14, padding: 20 }}>Корзина пуста</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {trash.map(item => (
                  <div key={item.type + item.id} style={{ padding: "12px 16px", borderRadius: 14, background: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                      <div>
                        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: theme.muted, marginRight: 8 }}>
                          {item.type === "invitation" ? "Приглашение" : item.type === "candidate" ? "Кандидат" : "Эксперт"}
                        </span>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>{item.name}</span>
                        {item.email && <span style={{ marginLeft: 10, fontSize: 12, color: theme.muted }}>· {item.email}</span>}
                        {item.code && <span style={{ marginLeft: 10, fontSize: 12, color: theme.muted }}>· {item.code}</span>}
                        <div style={{ fontSize: 12, color: theme.muted, marginTop: 2 }}>
                          Прежний статус: <span style={{ fontWeight: 600 }}>{item.previous_status}</span>
                          <span> · Удалён: {new Date(item.deleted_at).toLocaleDateString("ru-RU")}</span>
                          {item.deleted_by && <span> · Кем: {item.deleted_by}</span>}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          disabled={actionLoading === "restore" + item.id}
                          style={{ border: 0, borderRadius: 10, padding: "6px 12px", fontWeight: 700, fontSize: 12, cursor: "pointer", background: "#5F7D6C", color: "#fff" }}
                          onClick={() => doAction(item.type === "invitation" ? "restoreCouncilInvitation" : "restoreCouncilExpert", item.id)}
                        >
                          {actionLoading === "restore" + item.id ? "..." : "Восстановить"}
                        </button>
                        <button
                          disabled={actionLoading === "purge" + item.id}
                          style={{ border: 0, borderRadius: 10, padding: "6px 12px", fontWeight: 700, fontSize: 12, cursor: "pointer", background: "transparent", color: "#ef4444", border: "1px solid #ef4444" }}
                          onClick={() => setConfirmAction({
                            action: item.type === "invitation" ? "permanentlyDeleteCouncilInvitation" : "permanentlyDeleteCouncilExpert",
                            id: item.id,
                            destructive: true,
                            message: "Удаление необратимо. Введите УДАЛИТЬ.",
                          })}
                        >
                          Удалить окончательно
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirmation dialog */}
      {confirmAction && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 9000,
          background: "rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{ background: "#fff", border: "1px solid rgba(46,42,37,.1)", borderRadius: 20, padding: 28, maxWidth: 440, width: "90%", boxShadow: "0 8px 30px rgba(0,0,0,.15)" }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>{confirmAction.message}</div>
            {confirmAction.destructive ? (
              <ConfirmDestructive onConfirm={() => doAction(confirmAction.action, confirmAction.id)} onCancel={() => setConfirmAction(null)} actionLoading={actionLoading} theme={theme} />
            ) : (
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button
                  style={{ border: "1px solid rgba(46,42,37,.15)", borderRadius: 12, padding: "10px 20px", fontWeight: 700, fontSize: 13, cursor: "pointer", background: "#fff", color: "#2E2A25" }}
                  onClick={() => setConfirmAction(null)}
                >
                  Отмена
                </button>
                <button
                  style={{ border: 0, borderRadius: 12, padding: "10px 20px", fontWeight: 700, fontSize: 13, cursor: "pointer", background: "#ef4444", color: "#fff" }}
                  onClick={() => doAction(confirmAction.action, confirmAction.id)}
                >
                  {actionLoading ? "..." : "Подтвердить"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {approvedToken && (
        <div style={{
          position: "fixed", top: 24, left: "50%", transform: "translateX(-50%)",
          zIndex: 3020, padding: "16px 24px", borderRadius: 16, fontWeight: 600, fontSize: 14,
          boxShadow: "0 4px 20px rgba(0,0,0,.12)", maxWidth: "calc(100vw - 40px)", width: 500,
          background: "#E2EBE4", border: "1px solid rgba(125,154,137,.3)", color: "#5F7D6C",
        }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Эксперт утверждён. Токен доступа:</div>
          <div style={{ fontFamily: "monospace", fontSize: 13, wordBreak: "break-all", background: "#fff", border: "1px solid rgba(125,154,137,.2)", borderRadius: 10, padding: "8px 12px", marginBottom: 10 }}>
            {approvedToken.token}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              style={{ border: 0, borderRadius: 10, padding: "6px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer", background: "#5F7D6C", color: "#fff" }}
              onClick={() => { navigator.clipboard.writeText(approvedToken.token); }}
            >
              Копировать токен
            </button>
            <button
              style={{ border: "1px solid rgba(125,154,137,.3)", borderRadius: 10, padding: "6px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer", background: "transparent", color: "#5F7D6C" }}
              onClick={() => setApprovedToken(null)}
            >
              Закрыть
            </button>
          </div>
        </div>
      )}

      {toast.message && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          zIndex: 3010, padding: "14px 24px", borderRadius: 16, fontWeight: 600, fontSize: 15,
          boxShadow: "0 4px 20px rgba(0,0,0,.1)", animation: "toastIn 0.3s ease",
          textAlign: "center", maxWidth: "calc(100vw - 40px)",
          ...(toast.type === "error"
            ? { background: "#FEE2E2", border: "1px solid #FCA5A5", color: "#991B1B" }
            : { background: "#E2EBE4", border: "1px solid rgba(125,154,137,.3)", color: "#5F7D6C" }),
        }}>
          {toast.message}
        </div>
      )}
    </>
  );
}

function ConfirmDestructive({ onConfirm, onCancel, actionLoading, theme }) {
  const [text, setText] = useState("");
  const expected = "УДАЛИТЬ";

  return (
    <div>
      <div style={{ fontSize: 13, color: "#7A7268", marginBottom: 12 }}>
        Введите <strong>{expected}</strong> для подтверждения:
      </div>
      <input
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={expected}
        style={{ width: "100%", border: "1px solid rgba(46,42,37,.15)", borderRadius: 12, background: "#fff", color: "#2E2A25", padding: "10px 14px", fontSize: 14, outline: "none", marginBottom: 16, boxSizing: "border-box" }}
      />
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button
          style={{ border: "1px solid rgba(46,42,37,.15)", borderRadius: 12, padding: "10px 20px", fontWeight: 700, fontSize: 13, cursor: "pointer", background: "#fff", color: "#2E2A25" }}
          onClick={onCancel}
        >
          Отмена
        </button>
        <button
          disabled={text !== expected || actionLoading}
          style={{
            border: 0, borderRadius: 12, padding: "10px 20px", fontWeight: 700, fontSize: 13, cursor: text === expected ? "pointer" : "not-allowed",
            background: text === expected ? "#ef4444" : "#ccc", color: "#fff",
          }}
          onClick={onConfirm}
        >
          {actionLoading ? "..." : "Удалить окончательно"}
        </button>
      </div>
    </div>
  );
}