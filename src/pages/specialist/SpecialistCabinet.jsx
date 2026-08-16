import React, { useState, useEffect, useCallback, useRef } from "react";

// ── Styles ────────────────────────────────────────────────

const S = {
  page: { minHeight: "100vh", background: "#F6F0E7", color: "#2E2A25", fontFamily: "Inter, system-ui, sans-serif", padding: 32 },
  card: { background: "#fff", border: "1px solid rgba(46,42,37,.1)", borderRadius: 20, padding: 28, marginBottom: 20 },
  input: { width: "100%", border: "1px solid rgba(46,42,37,.15)", borderRadius: 12, background: "#fff", color: "#2E2A25", padding: "12px 14px", fontSize: 14, outline: "none" },
  btn: { width: "100%", border: 0, borderRadius: 14, padding: "14px", fontWeight: 800, fontSize: 15, cursor: "pointer", color: "#fff" },
  btnDisabled: { background: "#ccc", cursor: "default" },
  btnPrimary: { background: "#B85C4A" },
  btnSecondary: { width: "auto", border: "1px solid rgba(46,42,37,.15)", borderRadius: 10, background: "transparent", color: "#7A7268", padding: "8px 16px", fontSize: 13, cursor: "pointer" },
  label: { fontSize: 13, color: "#7A7268", marginBottom: 6, display: "block" },
  small: { fontSize: 12, color: "#7A7268", lineHeight: 1.5 },
  radio: { display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", border: "1px solid rgba(46,42,37,.12)", borderRadius: 12, cursor: "pointer", fontSize: 14, marginBottom: 8 },
  radioActive: { border: "2px solid #B85C4A", background: "rgba(184,92,74,.04)" },
  moduleRow: { display: "flex", gap: 10, marginBottom: 20 },
  moduleBtn: { flex: 1, border: "1px solid rgba(46,42,37,.12)", borderRadius: 12, padding: "12px 14px", background: "#fff", cursor: "pointer", fontSize: 14, textAlign: "center" },
  moduleBtnActive: { border: "2px solid #B85C4A", background: "rgba(184,92,74,.04)", fontWeight: 700 },
  divider: { borderTop: "1px solid rgba(46,42,37,.08)", margin: "20px 0" },
};

// ── Component ─────────────────────────────────────────────

export default function SpecialistCabinet() {
  const [auth, setAuth] = useState(null); // { expert, memberships }
  const [loading, setLoading] = useState(true);
  const [loginCode, setLoginCode] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [toast, setToast] = useState({ message: "", type: "" });

  // Working context (NOT secrets — sessionStorage is fine)
  const [orgId, setOrgId] = useState(() => {
    try { return sessionStorage.getItem("specialist_org_id") || null; } catch { return null; }
  });
  const [module, setModule] = useState(() => {
    try { return sessionStorage.getItem("specialist_module") || "support"; } catch { return "support"; }
  });

  const showToast = useCallback((message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast({ message: "", type: "" }), 4000);
  }, []);

  // Client registry state
  const [clients, setClients] = useState([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientsError, setClientsError] = useState(null);

  // Client detail state
  const [selectedClient, setSelectedClient] = useState(null); // client_ref
  const [clientDetail, setClientDetail] = useState(null);
  const [clientDetailLoading, setClientDetailLoading] = useState(false);
  const [clientDetailError, setClientDetailError] = useState(null);
  const [clientTab, setClientTab] = useState("overview"); // overview | sessions | dynamics | analysis

  // Professional analysis state
  const [profAnalysis, setProfAnalysis] = useState(null);
  const [profAnalysisLoading, setProfAnalysisLoading] = useState(false);

  // Stale-response guard: only the latest detail request result is applied
  const detailGenerationRef = useRef(0);
  // Refresh key: incremented on re-click to force re-fetch even for same client_ref
  const [detailRefreshKey, setDetailRefreshKey] = useState(0);

  // ── Session restore on mount ─────────────────────────────

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/specialist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ action: "me" }),
        });
        const data = await res.json();
        if (!cancelled && data.ok) {
          setAuth({ expert: data.expert, memberships: data.memberships });
          // Validate persisted org_id against current memberships
          if (orgId) {
            const valid = data.memberships.some((m) => m.organization_id === orgId);
            if (!valid) {
              setOrgId(null);
              try { sessionStorage.removeItem("specialist_org_id"); } catch {}
            }
          }
          // Validate persisted module against allowed_modules
          const allowed = data.expert?.allowed_modules || ["support"];
          const stored = sessionStorage.getItem("specialist_module") || "support";
          if (!allowed.includes(stored)) {
            const fallback = allowed[0] || "support";
            setModule(fallback);
            try { sessionStorage.setItem("specialist_module", fallback); } catch {}
            clearSelectedClientDetail();
          }
        }
      } catch {}
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch clients when auth + context are available ─────

  useEffect(() => {
    if (!auth) return;
    let cancelled = false;
    const controller = new AbortController();

    // Clear old results and selected client immediately when context changes
    setClients([]);
    setClientsLoading(true);
    setClientsError(null);
    setSelectedClient(null);
    setClientDetail(null);
    setProfAnalysis(null);
    setClientTab("overview");

    (async () => {
      try {
        const res = await fetch("/api/specialist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          signal: controller.signal,
          body: JSON.stringify({ action: "listClients", organization_id: orgId, module }),
        });
        const data = await res.json();
        if (!cancelled) {
          if (data.ok) {
            setClients(data.clients || []);
          } else {
            setClientsError(data.error || "Ошибка загрузки");
            setClients([]);
          }
        }
      } catch (e) {
        if (!cancelled && e.name !== "AbortError") {
          setClientsError("Ошибка сети");
          setClients([]);
        }
      }
      if (!cancelled) setClientsLoading(false);
    })();

    return () => { cancelled = true; controller.abort(); };
  }, [auth, orgId, module]);

  // ── Fetch client detail when selected ─────────────────────

  useEffect(() => {
    if (!auth || !selectedClient) {
      setClientDetail(null);
      return;
    }
    const generation = ++detailGenerationRef.current;
    let cancelled = false;
    const controller = new AbortController();

    const detailAction = module === "body" ? "getBodyClientOverview" : "getClientOverview";

    (async () => {
      setClientDetailLoading(true);
      setClientDetailError(null);
      try {
        const res = await fetch("/api/specialist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          signal: controller.signal,
          body: JSON.stringify({ action: detailAction, client_ref: selectedClient, organization_id: orgId, module }),
        });
        const data = await res.json();
        if (!cancelled && generation === detailGenerationRef.current) {
          if (data.ok) {
            setClientDetail(data);
            setClientDetailError(null);
          } else {
            // Revoked/expired/forbidden access — show controlled error, clear sensitive content
            setClientDetail(null);
            setClientDetailError(data.error || "Доступ к клиенту больше недоступен.");
          }
        }
      } catch (e) {
        if (!cancelled && e.name !== "AbortError" && generation === detailGenerationRef.current) {
          setClientDetailError("Ошибка сети");
          setClientDetail(null);
        }
      }
      if (!cancelled && generation === detailGenerationRef.current) {
        setClientDetailLoading(false);
      }
    })();

    return () => { cancelled = true; controller.abort(); };
  }, [auth, selectedClient, orgId, module, detailRefreshKey]);

  // ── Fetch professional analysis when analysis tab selected ──

  useEffect(() => {
    if (!auth || !selectedClient || clientTab !== "analysis") {
      setProfAnalysis(null);
      return;
    }
    const generation = ++detailGenerationRef.current;
    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      setProfAnalysisLoading(true);
      try {
        const res = await fetch("/api/specialist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          signal: controller.signal,
          body: JSON.stringify({ action: "getClientProfessionalAnalysis", client_ref: selectedClient, organization_id: orgId, module }),
        });
        const data = await res.json();
        if (!cancelled && generation === detailGenerationRef.current) {
          setProfAnalysis(data.ok ? data : null);
        }
      } catch (e) {
        if (!cancelled && e.name !== "AbortError" && generation === detailGenerationRef.current) {
          setProfAnalysis(null);
        }
      }
      if (!cancelled && generation === detailGenerationRef.current) setProfAnalysisLoading(false);
    })();

    return () => { cancelled = true; controller.abort(); };
  }, [auth, selectedClient, orgId, module, clientTab]);

  // ── Login ────────────────────────────────────────────────

  async function doLogin() {
    if (!loginCode || loggingIn) return;
    setLoggingIn(true);
    try {
      const res = await fetch("/api/specialist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "login", access_code: loginCode }),
      });
      const data = await res.json();
      if (data.ok) {
        setAuth({ expert: data.expert, memberships: data.memberships });
        // Validate stored module against allowed_modules
        const allowed = data.expert?.allowed_modules || ["support"];
        const stored = sessionStorage.getItem("specialist_module") || "support";
        if (!allowed.includes(stored)) {
          const fallback = allowed[0] || "support";
          setModule(fallback);
          try { sessionStorage.setItem("specialist_module", fallback); } catch {}
        }
        setLoginCode("");
        showToast("Вход выполнен");
      } else {
        showToast(data.error || "Неверный код", "error");
      }
    } catch {
      showToast("Ошибка сети", "error");
    }
    setLoggingIn(false);
  }

  // ── Logout ───────────────────────────────────────────────

  async function doLogout() {
    try {
      await fetch("/api/specialist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "logout" }),
      });
    } catch {}
    setAuth(null);
    setOrgId(null);
    setModule("support");
    try {
      sessionStorage.removeItem("specialist_org_id");
      sessionStorage.removeItem("specialist_module");
    } catch {}
  }

  // ── Context selection ────────────────────────────────────

  // Immediately clear all sensitive detail state — must not depend on useEffect timing
  function clearSelectedClientDetail() {
    setSelectedClient(null);
    setClientDetail(null);
    setClientDetailError(null);
    setProfAnalysis(null);
    setClientTab("overview");
    detailGenerationRef.current++;
  }

  function selectOrg(id) {
    clearSelectedClientDetail();
    setOrgId(id);
    try { sessionStorage.setItem("specialist_org_id", id || ""); } catch {}
  }

  function selectModule(m) {
    const allowed = auth?.expert?.allowed_modules || ["support"];
    if (!allowed.includes(m)) return; // refuse forbidden module
    clearSelectedClientDetail();
    setModule(m);
    try { sessionStorage.setItem("specialist_module", m); } catch {}
  }

  // ── Loading state ────────────────────────────────────────

  if (loading) {
    return (
      <div style={S.page}>
        <div style={{ maxWidth: 800, margin: "0 auto", paddingTop: 80, textAlign: "center", color: "#7A7268" }}>
          Загрузка...
        </div>
      </div>
    );
  }

  // ── Login screen ─────────────────────────────────────────

  if (!auth) {
    return (
      <div style={S.page}>
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
            <img src="/logo-tochka-opory-header.png" alt="Точка опоры" style={{ height: 72, display: "block" }} />
            <div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>Кабинет специалиста</div>
            </div>
          </div>

          <div style={{ ...S.card, maxWidth: 400 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Вход</h2>
            <label style={S.label}>Код специалиста</label>
            <input
              type="password"
              placeholder="Код специалиста"
              value={loginCode}
              onChange={(e) => setLoginCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doLogin()}
              style={{ ...S.input, marginBottom: 12 }}
              autoComplete="off"
            />
            <button
              disabled={loggingIn || !loginCode}
              style={{ ...S.btn, ...(loggingIn || !loginCode ? S.btnDisabled : S.btnPrimary) }}
              onClick={doLogin}
            >
              {loggingIn ? "Вход..." : "Войти"}
            </button>
            <p style={{ ...S.small, marginTop: 12 }}>
              Код используется только для входа в кабинет.
            </p>
          </div>

          <div style={S.small}>Сервис работает в режиме закрытого тестирования. Информация не является медицинской консультацией.</div>
        </div>

        {toast.message && <Toast message={toast.message} type={toast.type} />}
      </div>
    );
  }

  // ── Authenticated cabinet ────────────────────────────────

  const { expert, memberships } = auth;
  const orgName = orgId
    ? memberships.find((m) => m.organization_id === orgId)?.organization_name || "Организация"
    : "Частная практика";

  return (
    <div style={S.page}>
      <div style={{ maxWidth: 800, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src="/logo-tochka-opory-header.png" alt="Точка опоры" style={{ height: 72, display: "block" }} />
            <div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>Кабинет специалиста</div>
            </div>
          </div>
          <button style={S.btnSecondary} onClick={doLogout}>Выйти</button>
        </div>

        {/* Identity card */}
        <div style={S.card}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{expert.name}</div>
          <div style={{ fontSize: 13, color: "#7A7268" }}>
            {expert.specialty && <span>{expert.specialty}</span>}
            {expert.city && <span> · {expert.city}</span>}
          </div>
        </div>

        {/* Context selection */}
        <div style={S.card}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Рабочее пространство</div>

          {/* Organization */}
          <label style={S.label}>Организация</label>
          <div
            style={{ ...S.radio, ...(!orgId ? S.radioActive : { cursor: "pointer" }) }}
            onClick={() => selectOrg(null)}
          >
            <div style={{ width: 16, height: 16, borderRadius: "50%", border: `2px solid ${!orgId ? "#B85C4A" : "#ccc"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {!orgId && <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#B85C4A" }} />}
            </div>
            Частная практика
          </div>
          {memberships.map((m) => (
            <div
              key={m.membership_id}
              style={{ ...S.radio, ...(orgId === m.organization_id ? S.radioActive : {}) }}
              onClick={() => selectOrg(m.organization_id)}
            >
              <div style={{ width: 16, height: 16, borderRadius: "50%", border: `2px solid ${orgId === m.organization_id ? "#B85C4A" : "#ccc"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {orgId === m.organization_id && <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#B85C4A" }} />}
              </div>
              {m.organization_name || "Организация"}
            </div>
          ))}

          {/* Module */}
          <label style={{ ...S.label, marginTop: 16 }}>Направление</label>
          {(() => {
            const allowed = auth?.expert?.allowed_modules || ["support"];
            if (allowed.length <= 1) {
              // Single module — show as non-interactive label
              const label = allowed[0] === "body" ? "Здоровье & Стройность" : "Точка Опоры";
              return (
                <div style={{ ...S.moduleBtn, ...S.moduleBtnActive, cursor: "default", opacity: 0.85 }} data-testid="module-single">
                  {label}
                </div>
              );
            }
            // Multi-module — show switcher
            return (
              <div style={S.moduleRow}>
                <div
                  style={{ ...S.moduleBtn, ...(module === "support" ? S.moduleBtnActive : {}) }}
                  onClick={() => selectModule("support")}
                  data-testid="module-support"
                >
                  Точка Опоры
                </div>
                <div
                  style={{ ...S.moduleBtn, ...(module === "body" ? S.moduleBtnActive : {}) }}
                  onClick={() => selectModule("body")}
                  data-testid="module-body"
                >
                  Здоровье & Стройность
                </div>
              </div>
            );
          })()}
        </div>

        {/* Client detail or Client list */}
        {selectedClient ? (
          module === "body" ? (
            <HealthClientDetail
              detail={clientDetail}
              loading={clientDetailLoading}
              error={clientDetailError}
              onBack={clearSelectedClientDetail}
            />
          ) : (
            <ClientDetail
              detail={clientDetail}
              loading={clientDetailLoading}
              error={clientDetailError}
              tab={clientTab}
              onTabChange={setClientTab}
              onBack={clearSelectedClientDetail}
              profAnalysis={profAnalysis}
              profAnalysisLoading={profAnalysisLoading}
            />
          )
        ) : (
          <div style={S.card}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Мои клиенты</div>
            <div style={S.divider} />

            {clientsLoading ? (
              <p style={{ fontSize: 13, color: "#7A7268" }}>Загрузка...</p>
            ) : clientsError ? (
              <p style={{ fontSize: 13, color: "#991B1B" }}>{clientsError}</p>
            ) : clients.length === 0 ? (
              <p style={{ fontSize: 13, color: "#7A7268" }}>
                В этом рабочем пространстве пока нет закреплённых клиентов.
              </p>
            ) : (
              <div>
                {clients.map((c) => (
                  <div
                    key={c.client_ref}
                    onClick={() => { setSelectedClient(c.client_ref); setDetailRefreshKey((k) => k + 1); }}
                    style={{ padding: "12px 0", borderBottom: "1px solid rgba(46,42,37,.06)", cursor: "pointer" }}
                  >
                    <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 2 }}>
                      {c.display_name}
                    </div>
                    <div style={{ fontSize: 12, color: "#7A7268" }}>
                      {c.relationship === "primary" ? "Основной специалист" : "Совместный доступ"}
                      {c.last_activity_at && (
                        <span> · Последняя активность: {new Date(c.last_activity_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={S.small}>Сервис работает в режиме закрытого тестирования. Информация не является медицинской консультацией.</div>
      </div>

      {toast.message && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}

// ── Client Detail Card ────────────────────────────────────

function ClientDetail({ detail, loading, error, tab, onTabChange, onBack, profAnalysis, profAnalysisLoading }) {
  const tabs = [
    { id: "overview", label: "Обзор" },
    { id: "sessions", label: "Сессии" },
    { id: "dynamics", label: "Динамика" },
    { id: "analysis", label: "AI-анализ" },
  ];

  if (loading) {
    return (
      <div style={S.card}>
        <button onClick={onBack} style={{ ...S.btnSecondary, marginBottom: 16 }}>← Мои клиенты</button>
        <p style={{ fontSize: 13, color: "#7A7268" }}>Загрузка...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={S.card}>
        <button onClick={onBack} style={{ ...S.btnSecondary, marginBottom: 16 }}>← Мои клиенты</button>
        <p style={{ fontSize: 13, color: "#991B1B" }}>{error}</p>
      </div>
    );
  }

  if (!detail) return null;

  const { client, overview, sessions } = detail;
  const hasSessions = overview.session_count > 0;
  const safetyLabel = {
    self_support: "Нет новых срочных сигналов",
    self_care: "Нет новых срочных сигналов",
    professional_contact: "Требует внимания",
    urgent_help: "Срочный сигнал",
    medical_consultation: "Требует внимания",
  };

  return (
    <div style={S.card}>
      <button onClick={onBack} style={{ ...S.btnSecondary, marginBottom: 16 }}>← Мои клиенты</button>

      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{client.display_name}</div>
      <div style={{ fontSize: 12, color: "#7A7268", marginBottom: 16 }}>
        {client.relationship === "primary" ? "Основной специалист" : "Совместный доступ"}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => onTabChange(t.id)}
            style={{
              padding: "6px 14px", borderRadius: 10, border: 0, fontSize: 13, fontWeight: 600, cursor: "pointer",
              background: tab === t.id ? "#B85C4A" : "rgba(46,42,37,.04)",
              color: tab === t.id ? "#fff" : "#7A7268",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {tab === "overview" && overview && (
        <div>
          <div style={{ display: "flex", gap: 20, marginBottom: 16, fontSize: 13, color: "#7A7268" }}>
            <div>
              <div style={{ fontWeight: 600, color: "#2E2A25" }}>{overview.session_count}</div>
              {hasSessions ? "сессий" : "Сессий пока нет"}
            </div>
            <div>
              <div style={{ fontWeight: 600, color: "#2E2A25" }}>
                {overview.first_activity_at ? new Date(overview.first_activity_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) : "—"}
              </div>
              первая активность
            </div>
            <div>
              <div style={{ fontWeight: 600, color: "#2E2A25" }}>
                {overview.last_activity_at ? new Date(overview.last_activity_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) : "—"}
              </div>
              последняя активность
            </div>
          </div>

          {/* Safety block */}
          <div style={{
            padding: "12px 16px", borderRadius: 12, marginBottom: 16,
            background: !hasSessions ? "#F3F4F6" : overview.safety.has_active_flags ? "#FEE2E2" : "#E8F0EA",
            border: `1px solid ${!hasSessions ? "#E5E7EB" : overview.safety.has_active_flags ? "#FCA5A5" : "rgba(125,154,137,.3)"}`,
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, color: !hasSessions ? "#6B7280" : overview.safety.has_active_flags ? "#991B1B" : "#5F7D6C" }}>
              Безопасность
            </div>
            <div style={{ fontSize: 13, color: !hasSessions ? "#6B7280" : overview.safety.has_active_flags ? "#991B1B" : "#5F7D6C" }}>
              {hasSessions ? (safetyLabel[overview.safety.level] || "Не определено") : "Данных о безопасности пока нет"}
            </div>
          </div>
        </div>
      )}

      {/* Sessions tab */}
      {tab === "sessions" && sessions && (
        <div>
          {sessions.length === 0 ? (
            <p style={{ fontSize: 13, color: "#7A7268" }}>У клиента пока нет завершённых сессий.</p>
          ) : (
            <div>
              {sessions.map((s) => (
                <div key={s.session_ref} style={{ padding: "12px 0", borderBottom: "1px solid rgba(46,42,37,.06)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>
                      {s.started_at ? new Date(s.started_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }) : "—"}
                    </div>
                    <SafetyBadge level={s.safety_level} />
                  </div>
                  {s.short_summary && (
                    <p style={{ fontSize: 13, color: "#7A7268", margin: 0, lineHeight: 1.5 }}>{s.short_summary}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Dynamics tab */}
      {tab === "dynamics" && (
        <div>
          {sessions && sessions.length > 0 ? (
            <div>
              {sessions.map((s) => (
                <div key={s.session_ref} style={{ padding: "10px 0", borderBottom: "1px solid rgba(46,42,37,.06)", display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <div style={{ fontSize: 13, color: "#7A7268", minWidth: 90, flexShrink: 0 }}>
                    {s.started_at ? new Date(s.started_at).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) : "—"}
                  </div>
                  <div style={{ flex: 1 }}>
                    <SafetyBadge level={s.safety_level} />
                    {s.short_summary && (
                      <p style={{ fontSize: 12, color: "#7A7268", margin: "4px 0 0", lineHeight: 1.4 }}>{s.short_summary}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 13, color: "#7A7268" }}>Динамика будет доступна после накопления данных.</p>
          )}
        </div>
      )}

      {/* AI-анализ tab */}
      {tab === "analysis" && (
        <div>
          {profAnalysisLoading ? (
            <p style={{ fontSize: 13, color: "#7A7268" }}>Загрузка...</p>
          ) : profAnalysis?.latest_analysis ? (
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Профессиональный анализ</div>

              {/* Latest analysis */}
              <div style={{ padding: "12px 16px", borderRadius: 12, border: "1px solid rgba(46,42,37,.1)", marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: "#7A7268", marginBottom: 4 }}>
                  {profAnalysis.latest_analysis.date ? new Date(profAnalysis.latest_analysis.date).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }) : "—"}
                  {profAnalysis.latest_analysis.status === "ready" && " · Отчёт готов"}
                  {profAnalysis.latest_analysis.status === "processing" && " · Формируется..."}
                  {profAnalysis.latest_analysis.status === "failed" && " · Ошибка формирования"}
                </div>

                {profAnalysis.latest_analysis.doctor_report ? (
                  <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                    {profAnalysis.latest_analysis.doctor_report}
                  </div>
                ) : (
                  <p style={{ fontSize: 13, color: "#7A7268", fontStyle: "italic" }}>
                    Профессиональный анализ для этой сессии пока не сформирован.
                  </p>
                )}
              </div>

              {/* Safety */}
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Безопасность</div>
              <div style={{ padding: "10px 16px", borderRadius: 12, marginBottom: 16, background: "#F3F4F6" }}>
                <SafetyBadge level={profAnalysis.latest_analysis.safety?.level} />
              </div>

              {/* Voice observations */}
              {profAnalysis.voice_observations?.length > 0 && (
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Наблюдения по голосу</div>
                  {profAnalysis.voice_observations.map((vo, idx) => (
                    <div key={idx} style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(46,42,37,.08)", marginBottom: 8, fontSize: 12, color: "#7A7268" }}>
                      <div style={{ marginBottom: 4 }}>
                        {vo.date ? new Date(vo.date).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) : "—"}
                      </div>
                      {vo.summary && <div style={{ marginBottom: 4 }}>{vo.summary}</div>}
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {vo.tempo && <span>Темп: {vo.tempo}</span>}
                        {vo.pauses && <span>Паузы: {vo.pauses}</span>}
                        {vo.volume && <span>Громкость: {vo.volume}</span>}
                        {vo.prosody && <span>Просодия: {vo.prosody}</span>}
                        {vo.tension && <span>Напряжение: {vo.tension}</span>}
                        {vo.stability && <span>Стабильность: {vo.stability}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {profAnalysis.voice_observations?.length === 0 && (
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Наблюдения по голосу</div>
                  <p style={{ fontSize: 13, color: "#7A7268" }}>Наблюдений по голосу нет.</p>
                </div>
              )}

              <p style={{ fontSize: 11, color: "#9CA3AF", marginTop: 16, fontStyle: "italic" }}>
                AI-анализ помогает специалисту ориентироваться в материалах и не является самостоятельным диагнозом.
              </p>
            </div>
          ) : (
            <p style={{ fontSize: 13, color: "#7A7268" }}>
              Профессиональный анализ пока недоступен.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Health Client Detail Card (Body module, read-only) ────

function HealthClientDetail({ detail, loading, error, onBack }) {
  const [tab, setTab] = React.useState("overview");

  const tabs = [
    { id: "overview", label: "Обзор" },
    { id: "diary", label: "Дневник" },
    { id: "nutrition", label: "Питание" },
    { id: "activity", label: "Активность" },
    { id: "weight", label: "Вес и параметры" },
    { id: "summaries", label: "AI-сводки" },
    { id: "requests", label: "Запросы" },
  ];

  if (loading) {
    return (
      <div style={S.card} data-testid="health-client-detail">
        <button onClick={onBack} style={{ ...S.btnSecondary, marginBottom: 16 }} data-testid="health-back-btn">← Мои клиенты</button>
        <p style={{ fontSize: 13, color: "#7A7268" }}>Загрузка...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={S.card} data-testid="health-client-detail">
        <button onClick={onBack} style={{ ...S.btnSecondary, marginBottom: 16 }} data-testid="health-back-btn">← Мои клиенты</button>
        <p style={{ fontSize: 13, color: "#991B1B" }} data-testid="health-detail-error">{error}</p>
      </div>
    );
  }

  if (!detail) return null;

  const { client, overview, recent_days, plate_summary, weekly_summaries, insights, service_requests } = detail;

  return (
    <div style={S.card} data-testid="health-client-detail">
      <button onClick={onBack} style={{ ...S.btnSecondary, marginBottom: 16 }} data-testid="health-back-btn">← Мои клиенты</button>

      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }} data-testid="health-client-name">{client.display_name}</div>
      <div style={{ fontSize: 12, color: "#7A7268", marginBottom: 16 }}>
        {client.relationship === "primary" ? "Основной специалист" : "Совместный доступ"}
        <span style={{ marginLeft: 8, padding: "2px 8px", borderRadius: 6, background: "rgba(184,92,74,.08)", fontSize: 11, fontWeight: 600, color: "#B85C4A" }}>Здоровье</span>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "6px 12px", borderRadius: 10, border: 0, fontSize: 12, fontWeight: 600, cursor: "pointer",
              background: tab === t.id ? "#B85C4A" : "rgba(46,42,37,.04)",
              color: tab === t.id ? "#fff" : "#7A7268",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Обзор ──────────────────────────────────────── */}
      {tab === "overview" && (
        <div data-testid="health-overview">
          {overview.goal && (
            <div style={{ padding: "10px 14px", borderRadius: 12, background: "#F8F6F2", marginBottom: 12 }} data-testid="health-overview-goal">
              <div style={{ fontSize: 12, color: "#7A7268", marginBottom: 2 }}>Цель</div>
              <div style={{ fontSize: 14 }}>{overview.goal}</div>
            </div>
          )}

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16, fontSize: 13, color: "#7A7268" }}>
            <div data-testid="health-overview-diary-days">
              <div style={{ fontWeight: 600, color: "#2E2A25" }}>{overview.diary_days}</div>
              {overview.diary_days === 1 ? "день" : "дней"} в дневнике
            </div>
            <div data-testid="health-overview-last-activity">
              <div style={{ fontWeight: 600, color: "#2E2A25" }}>
                {overview.last_activity_at ? new Date(overview.last_activity_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) : "—"}
              </div>
              последняя активность
            </div>
            {overview.latest_weight_kg && (
              <div data-testid="health-overview-weight">
                <div style={{ fontWeight: 600, color: "#2E2A25" }}>{overview.latest_weight_kg} кг</div>
                последний вес
              </div>
            )}
            {overview.latest_steps && (
              <div data-testid="health-overview-steps">
                <div style={{ fontWeight: 600, color: "#2E2A25" }}>{overview.latest_steps.toLocaleString()}</div>
                шагов
              </div>
            )}
            {overview.latest_sleep_hours && (
              <div>
                <div style={{ fontWeight: 600, color: "#2E2A25" }}>{overview.latest_sleep_hours} ч</div>
                сон
              </div>
            )}
          </div>

          {overview.active_request_count > 0 && (
            <div style={{ padding: "10px 14px", borderRadius: 12, background: "#FEF3C7", border: "1px solid #FDE68A", marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: "#92400E" }}>
                Открытых запросов: {overview.active_request_count}
              </div>
            </div>
          )}

          {insights && insights.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Наблюдения</div>
              {insights.map((ins, idx) => (
                <div key={idx} style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(46,42,37,.08)", marginBottom: 6, fontSize: 13 }}>
                  {ins.title && <div style={{ fontWeight: 600, marginBottom: 2 }}>{ins.title}</div>}
                  <div style={{ color: "#7A7268" }}>{ins.insight_text}</div>
                </div>
              ))}
            </div>
          )}

          {!overview.diary_days && !overview.active_request_count && (!insights || insights.length === 0) && (
            <p style={{ fontSize: 13, color: "#7A7268" }}>Данных пока нет.</p>
          )}
        </div>
      )}

      {/* ── Дневник ────────────────────────────────────── */}
      {tab === "diary" && (
        <div>
          {!recent_days || recent_days.length === 0 ? (
            <p style={{ fontSize: 13, color: "#7A7268" }}>Дневник пока не заполнен.</p>
          ) : (
            <div>
              {recent_days.map((day) => (
                <div key={day.log_date} style={{ padding: "12px 0", borderBottom: "1px solid rgba(46,42,37,.06)" }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
                    {new Date(day.log_date + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}
                  </div>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 13, color: "#7A7268" }}>
                    {day.weight_kg && <span>Вес: {day.weight_kg} кг</span>}
                    {day.steps && <span>Шаги: {day.steps.toLocaleString()}</span>}
                    {day.sleep_hours && <span>Сон: {day.sleep_hours} ч</span>}
                    {day.mood_level && <span>Настроение: {day.mood_level}/5</span>}
                    {day.energy_level && <span>Энергия: {day.energy_level}/5</span>}
                    {day.workout_done && <span>Тренировка: {day.workout_type || "да"}{day.workout_minutes ? ` (${day.workout_minutes} мин)` : ""}</span>}
                    {day.meals_count && <span>Приёмов пищи: {day.meals_count}</span>}
                    {day.calories && <span>Калории: {day.calories}</span>}
                    {day.water_l && <span>Вода: {day.water_l} л</span>}
                  </div>
                  {day.ai_day_summary && (
                    <div style={{ marginTop: 6, fontSize: 12, color: "#7A7268", fontStyle: "italic" }}>
                      <span style={{ fontWeight: 600, fontStyle: "normal", color: "#B85C4A" }}>AI-сводка для клиента: </span>
                      {day.ai_day_summary}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Питание ────────────────────────────────────── */}
      {tab === "nutrition" && (
        <div>
          <div style={{ fontSize: 12, color: "#7A7268", marginBottom: 12, fontStyle: "italic" }}>
            Анализ питания приблизительный и основан на фото тарелки.
          </div>
          {!plate_summary || plate_summary.total_plates === 0 ? (
            <p style={{ fontSize: 13, color: "#7A7268" }}>Данных о питании пока нет.</p>
          ) : (
            <div>
              <div style={{ fontSize: 13, color: "#7A7268", marginBottom: 12 }}>Всего проанализировано тарелок: {plate_summary.total_plates}</div>
              {plate_summary.recent_plates.map((plate, idx) => (
                <div key={idx} style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(46,42,37,.08)", marginBottom: 8 }}>
                  <div style={{ fontSize: 12, color: "#7A7268", marginBottom: 4 }}>
                    {new Date(plate.log_date + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}
                    {plate.meal_type && ` · ${plate.meal_type}`}
                  </div>
                  {plate.balance_summary && <div style={{ fontSize: 13, marginBottom: 4 }}>{plate.balance_summary}</div>}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12, color: "#7A7268" }}>
                    {plate.vegetables_assessment && <span>Овощи: {plate.vegetables_assessment}</span>}
                    {plate.protein_assessment && <span>Белок: {plate.protein_assessment}</span>}
                    {plate.carbohydrate_assessment && <span>Углеводы: {plate.carbohydrate_assessment}</span>}
                  </div>
                  {plate.gentle_suggestion && (
                    <div style={{ marginTop: 4, fontSize: 12, color: "#5F7D6C" }}>{plate.gentle_suggestion}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Активность ─────────────────────────────────── */}
      {tab === "activity" && (
        <div>
          {!recent_days || recent_days.length === 0 ? (
            <p style={{ fontSize: 13, color: "#7A7268" }}>Данных об активности пока нет.</p>
          ) : (
            <div>
              {recent_days.filter((d) => d.workout_done || d.steps).map((day) => (
                <div key={day.log_date} style={{ padding: "10px 0", borderBottom: "1px solid rgba(46,42,37,.06)" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                    {new Date(day.log_date + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}
                  </div>
                  <div style={{ display: "flex", gap: 12, fontSize: 13, color: "#7A7268" }}>
                    {day.steps && <span>Шаги: {day.steps.toLocaleString()}</span>}
                    {day.workout_done && <span>Тренировка: {day.workout_type || "да"}</span>}
                    {day.workout_minutes && <span>Длительность: {day.workout_minutes} мин</span>}
                    {day.workout_intensity && <span>Интенсивность: {day.workout_intensity}</span>}
                  </div>
                </div>
              ))}
              {recent_days.every((d) => !d.workout_done && !d.steps) && (
                <p style={{ fontSize: 13, color: "#7A7268" }}>Данных об активности пока нет.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Вес и параметры ────────────────────────────── */}
      {tab === "weight" && (
        <div>
          {!recent_days || recent_days.length === 0 ? (
            <p style={{ fontSize: 13, color: "#7A7268" }}>Данных о весе пока нет.</p>
          ) : (
            <div>
              {recent_days.filter((d) => d.weight_kg || d.waist_cm).map((day) => (
                <div key={day.log_date} style={{ padding: "10px 0", borderBottom: "1px solid rgba(46,42,37,.06)", display: "flex", gap: 16, fontSize: 13 }}>
                  <div style={{ color: "#7A7268", minWidth: 100 }}>
                    {new Date(day.log_date + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}
                  </div>
                  <div>
                    {day.weight_kg && <span style={{ fontWeight: 600 }}>{day.weight_kg} кг</span>}
                    {day.waist_cm && <span style={{ marginLeft: 12, color: "#7A7268" }}>Талия: {day.waist_cm} см</span>}
                  </div>
                </div>
              ))}
              {recent_days.every((d) => !d.weight_kg && !d.waist_cm) && (
                <p style={{ fontSize: 13, color: "#7A7268" }}>Данных о весе пока нет.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── AI-сводки ──────────────────────────────────── */}
      {tab === "summaries" && (
        <div>
          {(!weekly_summaries || weekly_summaries.length === 0) && (!recent_days || recent_days.every((d) => !d.ai_day_summary)) ? (
            <p style={{ fontSize: 13, color: "#7A7268" }}>Сводки пока не сформированы.</p>
          ) : (
            <div>
              {/* Daily AI summaries */}
              {recent_days && recent_days.some((d) => d.ai_day_summary) && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Ежедневные AI-сводки</div>
                  <div style={{ fontSize: 11, color: "#7A7268", marginBottom: 8, fontStyle: "italic" }}>
                    AI-сводка для клиента — не является заключением специалиста
                  </div>
                  {recent_days.filter((d) => d.ai_day_summary).map((day) => (
                    <div key={day.log_date} style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(46,42,37,.08)", marginBottom: 8 }}>
                      <div style={{ fontSize: 12, color: "#7A7268", marginBottom: 4 }}>
                        {new Date(day.log_date + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}
                      </div>
                      <div style={{ fontSize: 13, lineHeight: 1.5 }}>{day.ai_day_summary}</div>
                      {day.ai_positive_observation && (
                        <div style={{ fontSize: 12, color: "#5F7D6C", marginTop: 4 }}>+ {day.ai_positive_observation}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Weekly summaries */}
              {weekly_summaries && weekly_summaries.length > 0 && (
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Недельные итоги</div>
                  <div style={{ fontSize: 11, color: "#7A7268", marginBottom: 8, fontStyle: "italic" }}>
                    AI-сводка для клиента — не является заключением специалиста
                  </div>
                  {weekly_summaries.map((ws, idx) => (
                    <div key={idx} style={{ padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(46,42,37,.08)", marginBottom: 12 }}>
                      <div style={{ fontSize: 12, color: "#7A7268", marginBottom: 6 }}>
                        {new Date(ws.period_start + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}
                        {" — "}
                        {new Date(ws.period_end + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}
                        {ws.source_days ? ` · ${ws.source_days} дн.` : ""}
                      </div>
                      {ws.user_summary && (
                        <div style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 8 }}>{ws.user_summary}</div>
                      )}
                      {ws.positive_changes && ws.positive_changes.length > 0 && (
                        <div style={{ fontSize: 12, color: "#5F7D6C", marginBottom: 4 }}>
                          <span style={{ fontWeight: 600 }}>Успехи:</span> {ws.positive_changes.join("; ")}
                        </div>
                      )}
                      {ws.patterns && ws.patterns.length > 0 && (
                        <div style={{ fontSize: 12, color: "#7A7268", marginBottom: 4 }}>
                          <span style={{ fontWeight: 600 }}>Паттерны:</span> {ws.patterns.join("; ")}
                        </div>
                      )}
                      {ws.next_week_focus && ws.next_week_focus.length > 0 && (
                        <div style={{ fontSize: 12, color: "#B85C4A", marginTop: 6 }}>
                          <span style={{ fontWeight: 600 }}>Фокус на следующую неделю:</span> {ws.next_week_focus.join("; ")}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Запросы ────────────────────────────────────── */}
      {tab === "requests" && (
        <div>
          {!service_requests || service_requests.length === 0 ? (
            <p style={{ fontSize: 13, color: "#7A7268" }}>Запросов специалисту пока нет.</p>
          ) : (
            <div>
              {service_requests.map((sr) => {
                const typeLabels = {
                  text_question: "Онлайн-вопрос",
                  phone_call: "Телефонный звонок",
                  video_call: "Видеоконсультация",
                  offline_visit: "Очная консультация",
                  diary_review: "Разбор дневника",
                  labs_medications_review: "Разбор анализов и препаратов",
                  other: "Другой запрос",
                };
                const statusLabels = {
                  submitted: "Новый",
                  accepted: "Принят",
                  needs_clarification: "Уточнение",
                  scheduled: "Запланирован",
                  answered: "Отвечен",
                  completed: "Завершён",
                  cancelled: "Отменён",
                };
                return (
                  <div key={sr.request_ref} style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(46,42,37,.08)", marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{typeLabels[sr.request_type] || sr.request_type}</div>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6, background: "#F3F4F6", color: "#6B7280" }}>
                        {statusLabels[sr.status] || sr.status}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: "#7A7268" }}>
                      {new Date(sr.created_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}
                      {sr.due_at && ` · Срок: ${new Date(sr.due_at).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}`}
                      {sr.scheduled_at && ` · Назначено: ${new Date(sr.scheduled_at).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}`}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SafetyBadge({ level }) {
  const colors = {
    self_support: { bg: "#E8F0EA", text: "#5F7D6C" },
    self_care: { bg: "#E8F0EA", text: "#5F7D6C" },
    professional_contact: { bg: "#FEF3C7", text: "#92400E" },
    urgent_help: { bg: "#FEE2E2", text: "#991B1B" },
    medical_consultation: { bg: "#FEF3C7", text: "#92400E" },
  };
  const c = colors[level] || { bg: "#F3F4F6", text: "#6B7280" };
  const labels = {
    self_support: "Норма",
    self_care: "Норма",
    professional_contact: "Внимание",
    urgent_help: "Срочно",
    medical_consultation: "Внимание",
  };
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6, background: c.bg, color: c.text }}>
      {labels[level] || level}
    </span>
  );
}

// ── Toast ─────────────────────────────────────────────────

function Toast({ message, type }) {
  return (
    <div style={{
      position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
      zIndex: 3010, padding: "14px 24px", borderRadius: 16, fontWeight: 600, fontSize: 15,
      boxShadow: "0 4px 20px rgba(0,0,0,.1)", animation: "toastIn 0.3s ease",
      textAlign: "center", maxWidth: "calc(100vw - 40px)",
      ...(type === "error"
        ? { background: "#FEE2E2", border: "1px solid #FCA5A5", color: "#991B1B" }
        : { background: "#E2EBE4", border: "1px solid rgba(125,154,137,.3)", color: "#5F7D6C" }),
    }}>
      {message}
    </div>
  );
}
