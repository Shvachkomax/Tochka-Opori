import React, { useState } from "react";

export default function ExpertCabinet() {
  const [expertToken, setExpertToken] = useState(() => {
    try {
      return localStorage.getItem("tochka_council_expert_token") || null;
    } catch { return null; }
  });
  const [expertData, setExpertData] = useState(null);
  const [loginInput, setLoginInput] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [toast, setToast] = useState({ message: "", type: "" });

  function showToast(message, type = "success") {
    setToast({ message, type });
    setTimeout(() => setToast({ message: "", type: "" }), 4000);
  }

  async function doLogin(tokenValue) {
    setLoggingIn(true);
    try {
      const res = await fetch("/api/council", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "validateExpertToken", token: tokenValue }),
      });
      const data = await res.json();
      if (data.ok && data.expert) {
        setExpertData(data.expert);
        setExpertToken(tokenValue);
        localStorage.setItem("tochka_council_expert_token", tokenValue);
      } else {
        showToast(data.error || "Неверный токен", "error");
      }
    } catch { showToast("Ошибка сети", "error"); }
    finally { setLoggingIn(false); }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#F6F0E7", color: "#2E2A25", fontFamily: "Inter, system-ui, sans-serif", padding: 32 }}>
      <div style={{ maxWidth: 800, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src="/logo-tochka-opory-header.png" alt="Точка опоры" style={{ height: 72, display: "block" }} />
            <div>
              <div style={{ fontSize: 24, fontWeight: 800 }}>Экспертный совет</div>
              <div style={{ fontSize: 13, color: "#7A7268" }}>Личный кабинет эксперта</div>
            </div>
          </div>
          {expertData && (
            <button
              onClick={() => { setExpertData(null); setExpertToken(null); localStorage.removeItem("tochka_council_expert_token"); }}
              style={{ border: "1px solid rgba(46,42,37,.15)", borderRadius: 10, background: "transparent", color: "#7A7268", padding: "8px 16px", fontSize: 13, cursor: "pointer" }}
            >
              Выйти
            </button>
          )}
        </div>

        {!expertData ? (
          <div style={{ background: "#fff", border: "1px solid rgba(46,42,37,.1)", borderRadius: 20, padding: 28, maxWidth: 400 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Вход для эксперта</h2>
            <input
              type="text"
              placeholder="Токен доступа"
              value={loginInput}
              onChange={e => setLoginInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && doLogin(loginInput)}
              style={{ width: "100%", border: "1px solid rgba(46,42,37,.15)", borderRadius: 12, background: "#fff", color: "#2E2A25", padding: "12px 14px", fontSize: 14, outline: "none", marginBottom: 12 }}
            />
            <button
              disabled={loggingIn || !loginInput}
              style={{
                width: "100%", border: 0, borderRadius: 14, padding: "14px", fontWeight: 800, fontSize: 15, cursor: "pointer",
                background: loggingIn || !loginInput ? "#ccc" : "#B85C4A", color: "#fff",
              }}
              onClick={() => doLogin(loginInput)}
            >
              {loggingIn ? "Вход..." : "Войти"}
            </button>
          </div>
        ) : (
          <div>
            <div style={{ background: "#fff", border: "1px solid rgba(46,42,37,.1)", borderRadius: 20, padding: 28, marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{expertData.first_name} {expertData.last_name}</h2>
              <div style={{ fontSize: 13, color: "#7A7268", marginBottom: 12 }}>
                {expertData.specialty && <span>{expertData.specialty}</span>}
                {expertData.organization && <span> · {expertData.organization}</span>}
              </div>
              <div style={{ display: "flex", gap: 12, fontSize: 13, color: "#7A7268" }}>
                <span>Статус: <strong style={{ color: expertData.status === "active" ? "#5F7D6C" : "#eab308" }}>{expertData.status}</strong></span>
                {expertData.approved_at && <span>Утверждён: {new Date(expertData.approved_at).toLocaleDateString("ru-RU")}</span>}
              </div>
            </div>

            <div style={{ background: "#fff", border: "1px solid rgba(46,42,37,.1)", borderRadius: 20, padding: 28, marginBottom: 20 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Мои задания</h3>
              <p style={{ fontSize: 13, color: "#7A7268" }}>Раздел находится в разработке. Скоро здесь будут доступны задания для экспертов.</p>
            </div>

            <div style={{ background: "#fff", border: "1px solid rgba(46,42,37,.1)", borderRadius: 20, padding: 28, marginBottom: 20 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Обратная связь</h3>
              <p style={{ fontSize: 13, color: "#7A7268" }}>Раздел находится в разработке.</p>
            </div>

            <div style={{ background: "#fff", border: "1px solid rgba(46,42,37,.1)", borderRadius: 20, padding: 28 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Текущая тема</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#eab308" }}></div>
                <span style={{ fontSize: 14 }}>Тревога — готовится</span>
              </div>
            </div>
          </div>
        )}

        <div style={{ marginTop: 32, fontSize: 12, color: "#7A7268", lineHeight: 1.5 }}>
          Сервис работает в режиме закрытого тестирования. Информация не является медицинской консультацией.
        </div>

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
      </div>
    </div>
  );
}
