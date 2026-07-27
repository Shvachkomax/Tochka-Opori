import React, { useState, useEffect } from "react";

export default function ExpertInvitePage() {
  const [token, setToken] = useState(() => {
    try {
      const m = window.location.pathname.match(/^\/expert-invite\/([a-zA-Z0-9]+)/);
      return m ? m[1] : null;
    } catch { return null; }
  });
  const [pageData, setPageData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [formFields, setFormFields] = useState({
    first_name: "", last_name: "", email: "", phone: "", specialty: "", position: "", organization: "", professional_note: "", public_name_consent: false,
  });
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    fetch("/api/council", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "validateInviteToken", token }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.ok && data.invitation) {
          setPageData(data.invitation);
        } else {
          setError(data.error || "Приглашение недействительно");
        }
      })
      .catch(() => setError("Ошибка проверки приглашения"))
      .finally(() => setLoading(false));
  }, [token]);

  if (!token) return null;

  return (
    <div style={{ minHeight: "100vh", background: "#F6F0E7", color: "#2E2A25", fontFamily: "Inter, system-ui, sans-serif", padding: 32 }}>
      <div style={{ maxWidth: 600, margin: "0 auto" }}>
        <div style={{ marginBottom: 32 }}>
          <img src="/logo-tochka-opory-header.png" alt="Точка опоры" style={{ height: 72, display: "block" }} />
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>Экспертный совет</h1>
        <p style={{ fontSize: 14, color: "#7A7268", marginBottom: 24 }}>Приглашение в Expert Clinical Council</p>

        {loading && (
          <div style={{ fontSize: 14, color: "#7A7268", padding: 20 }}>Проверка приглашения...</div>
        )}
        {error && (
          <div style={{ background: "#FEE2E2", border: "1px solid #FECACA", borderRadius: 16, padding: 20, color: "#991B1B", fontSize: 14 }}>
            {error}
          </div>
        )}
        {success && (
          <div style={{ background: "#E2EBE4", border: "1px solid rgba(125,154,137,.3)", borderRadius: 16, padding: 20, color: "#5F7D6C", fontSize: 14 }}>
            Заявка отправлена. Ожидайте подтверждения администратора.
          </div>
        )}
        {pageData && !success && (
          <div style={{ background: "#fff", border: "1px solid rgba(46,42,37,.1)", borderRadius: 20, padding: 28 }}>
            <div style={{ fontSize: 14, color: "#7A7268", marginBottom: 16 }}>
              {pageData.first_name && <span>Приглашаем: <strong>{pageData.first_name} {pageData.last_name}</strong></span>}
              {pageData.specialty && <span style={{ marginLeft: 8 }}>· {pageData.specialty}</span>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", gap: 12 }}>
                <input placeholder="Имя *" value={formFields.first_name} onChange={e => setFormFields({ ...formFields, first_name: e.target.value })}
                  style={{ flex: 1, border: "1px solid rgba(46,42,37,.15)", borderRadius: 12, background: "#fff", color: "#2E2A25", padding: "12px 14px", fontSize: 14, outline: "none" }} />
                <input placeholder="Фамилия *" value={formFields.last_name} onChange={e => setFormFields({ ...formFields, last_name: e.target.value })}
                  style={{ flex: 1, border: "1px solid rgba(46,42,37,.15)", borderRadius: 12, background: "#fff", color: "#2E2A25", padding: "12px 14px", fontSize: 14, outline: "none" }} />
              </div>
              <input placeholder="Email *" type="email" value={formFields.email} onChange={e => setFormFields({ ...formFields, email: e.target.value })}
                style={{ border: "1px solid rgba(46,42,37,.15)", borderRadius: 12, background: "#fff", color: "#2E2A25", padding: "12px 14px", fontSize: 14, outline: "none" }} />
              <input placeholder="Телефон (необязательно)" value={formFields.phone} onChange={e => setFormFields({ ...formFields, phone: e.target.value })}
                style={{ border: "1px solid rgba(46,42,37,.15)", borderRadius: 12, background: "#fff", color: "#2E2A25", padding: "12px 14px", fontSize: 14, outline: "none" }} />
              <input placeholder="Специальность" value={formFields.specialty} onChange={e => setFormFields({ ...formFields, specialty: e.target.value })}
                style={{ border: "1px solid rgba(46,42,37,.15)", borderRadius: 12, background: "#fff", color: "#2E2A25", padding: "12px 14px", fontSize: 14, outline: "none" }} />
              <input placeholder="Должность" value={formFields.position} onChange={e => setFormFields({ ...formFields, position: e.target.value })}
                style={{ border: "1px solid rgba(46,42,37,.15)", borderRadius: 12, background: "#fff", color: "#2E2A25", padding: "12px 14px", fontSize: 14, outline: "none" }} />
              <input placeholder="Организация" value={formFields.organization} onChange={e => setFormFields({ ...formFields, organization: e.target.value })}
                style={{ border: "1px solid rgba(46,42,37,.15)", borderRadius: 12, background: "#fff", color: "#2E2A25", padding: "12px 14px", fontSize: 14, outline: "none" }} />
              <textarea placeholder="Профессиональная заметка (необязательно)" value={formFields.professional_note} onChange={e => setFormFields({ ...formFields, professional_note: e.target.value })}
                style={{ border: "1px solid rgba(46,42,37,.15)", borderRadius: 12, background: "#fff", color: "#2E2A25", padding: "12px 14px", fontSize: 14, outline: "none", resize: "vertical", minHeight: 80 }} />
              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, color: "#7A7268", cursor: "pointer" }}>
                <input type="checkbox" checked={formFields.public_name_consent} onChange={e => setFormFields({ ...formFields, public_name_consent: e.target.checked })}
                  style={{ marginTop: 2, width: 18, height: 18 }} />
                <span>Разрешаю упоминание моего имени в списке экспертов (необязательно)</span>
              </label>
              <button
                disabled={saving || !formFields.first_name || !formFields.last_name || !formFields.email}
                style={{
                  border: 0, borderRadius: 14, padding: "14px 24px", fontWeight: 800, fontSize: 15, cursor: saving ? "wait" : "pointer",
                  background: saving || !formFields.first_name || !formFields.last_name || !formFields.email ? "#ccc" : "#B85C4A",
                  color: "#fff", marginTop: 8,
                }}
                onClick={async () => {
                  setSaving(true);
                  try {
                    const res = await fetch("/api/council", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "acceptInvite", token, ...formFields }),
                    });
                    const data = await res.json();
                    if (data.ok) {
                      setSuccess(true);
                    } else {
                      setError(data.error || "Ошибка отправки");
                    }
                  } catch {
                    setError("Ошибка сети");
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving ? "Отправка..." : "Отправить заявку"}
              </button>
            </div>
          </div>
        )}
        <div style={{ marginTop: 32, fontSize: 12, color: "#7A7268", lineHeight: 1.5 }}>
          Сервис работает в режиме закрытого тестирования. Информация не является медицинской консультацией.
        </div>
      </div>
    </div>
  );
}
