import React, { useRef, useState, useEffect, Component } from "react";
import { normalizeConversationHistory, normalizeSessionDetails, extractUserReport, extractDoctorReport, extractExpertFeedback, buildConversationPairs } from "../lib/conversation.js";
import BodyIntake from "./BodyIntake.jsx";
import BodyDiary from "./BodyDiary.jsx";
import HealthCabinet from "./HealthCabinet.jsx";
import { fetchWithClientToken, getClientToken } from "./lib/clientToken.js";
import { saveBodySession, saveSupportSession, getBodySession, getSupportSession, clearBodySession, withAccessToken } from "./lib/sessionAccess.js";
import ClinicalCouncilAdmin from "./pages/admin/ClinicalCouncilAdmin.jsx";
import ExpertInvitePage from "./pages/expert/ExpertInvitePage.jsx";
import ExpertCabinet from "./pages/expert/ExpertCabinet.jsx";

class AdminErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error("AdminErrorBoundary caught:", error, errorInfo);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, fontFamily: "monospace", minHeight: "100vh", background: "#050817", color: "#fecaca" }}>
          <h2 style={{ color: "#fca5a5", marginBottom: 16 }}>Ошибка в админ-панели</h2>
          <div style={{ background: "rgba(239,68,68,.1)", padding: 16, borderRadius: 12, marginBottom: 16, border: "1px solid rgba(239,68,68,.3)" }}>
            <strong style={{ color: "#fca5a5" }}>{this.state.error?.message || "Неизвестная ошибка"}</strong>
          </div>
          <pre style={{ fontSize: 12, color: "#94a3b8", whiteSpace: "pre-wrap", maxHeight: 400, overflow: "auto", background: "rgba(0,0,0,.3)", padding: 16, borderRadius: 8 }}>
            {this.state.error?.stack || ""}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [mode, setMode] = useState("text");
  const [text, setText] = useState("");
  const [questions, setQuestions] = useState(null);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [phase, setPhase] = useState("input");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("user");
  const [crisisOpen, setCrisisOpen] = useState(false);
  const [crisisText, setCrisisText] = useState("");
  const [crisisContact, setCrisisContact] = useState("");
  const [crisisSubmitting, setCrisisSubmitting] = useState(false);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);

  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [recordingTime, setRecordingTime] = useState(0);
  const [voiceObservations, setVoiceObservations] = useState([]);
  const voiceMsgCounterRef = useRef(0);
  const sessionRef = useRef(null);
  const startSessionPromiseRef = useRef(null);

  const [sessionReviewOpen, setSessionReviewOpen] = useState(false);
  const [patientRating, setPatientRating] = useState(0);
  const [patientUseful, setPatientUseful] = useState("");
  const [patientUnclear, setPatientUnclear] = useState("");
  const [doctorFeedback, setDoctorFeedback] = useState({
    wrongQuestions: "",
    missingQuestions: "",
    badQuestionWording: "",
    correctedUserReport: "",
    correctedDoctorReport: "",
    protocolUpdate: "",
    generalComment: "",
  });

  const [conversationHistory, setConversationHistory] = useState([]);
  const [dialogDepth, setDialogDepth] = useState(0);

  const [sessionModalOpen, setSessionModalOpen] = useState(false);
  const [loadingSession, setLoadingSession] = useState(false);

  // Anonymous Continuation Credential Pass
  const [continuationCode, setContinuationCode] = useState(null);
  const [continuationCodeInput, setContinuationCodeInput] = useState("");
  const [continuationCodeError, setContinuationCodeError] = useState("");
  const [regeneratedCode, setRegeneratedCode] = useState(null);
  const [sessionData, setSessionData] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [publicCode, setPublicCode] = useState(null);
  const [isContinuation, setIsContinuation] = useState(false);
  const [previousPatientReport, setPreviousPatientReport] = useState("");
  const [previousDoctorReport, setPreviousDoctorReport] = useState("");
  const [homeTasks, setHomeTasks] = useState("");
  const [resourceFactors, setResourceFactors] = useState("");
  const [debugInfo, setDebugInfo] = useState(null);
  const [careRecommendation, setCareRecommendation] = useState(null);
  const [showConsultPrep, setShowConsultPrep] = useState(false);
  const [showMessageToClose, setShowMessageToClose] = useState(false);
  const [messageText, setMessageText] = useState("");

  // Support Cabinet MVP
  const [supportCabinet, setSupportCabinet] = useState(null);
  const [cabinetLoading, setCabinetLoading] = useState(false);
  const [followUpAnswers, setFollowUpAnswers] = useState({});
  const [reportSource, setReportSource] = useState(null); // "generated" | "cabinet"
  const [justFinishedSession, setJustFinishedSession] = useState(false);

  const [activeModule, setActiveModule] = useState(() => {
    if (typeof window !== "undefined") {
      const host = window.location.hostname;
      if (host === "health.tochka-opori.online" || host.startsWith("health.")) return "body";
      const params = new URLSearchParams(window.location.search);
      if (params.get("module") === "body") return "body";
    }
    return "support";
  });
  const [usageBalance, setUsageBalance] = useState(null);

  // Body intake state
  const [bodyIntakeStage, setBodyIntakeStage] = useState("idle"); // idle | filling | analyzing | result
  const [bodyIntakeResult, setBodyIntakeResult] = useState(null);
  const [bodyIntakeStep, setBodyIntakeStep] = useState(0); // 0=summary, 1=code, 2=plan, 3=cta

  // Body screen state machine
  const [bodyScreen, setBodyScreen] = useState("landing"); // landing | intake | result | cabinet | diary_edit | diary_result
  const [bodyCabinetData, setBodyCabinetData] = useState(null);
  const [bodyCabinetLoading, setBodyCabinetLoading] = useState(false);

  // Support Toolkit state
  const [supportPlan, setSupportPlan] = useState(null);
  const [showSelfAssessment, setShowSelfAssessment] = useState(false);
  const [canManageWithoutSpecialist, setCanManageWithoutSpecialist] = useState(null);
  const [showSupportToolkit, setShowSupportToolkit] = useState(false);
  const [showSpecialistIntent, setShowSpecialistIntent] = useState(false);
  const [specialistIntentDone, setSpecialistIntentDone] = useState(false);

  const PRACTICES = [
    { id: "breathing", title: "Дыхание 4–6 минут при тревоге", file: "01-breathing.md" },
    { id: "grounding", title: "Заземление 5–4–3–2–1", file: "02-grounding.md" },
    { id: "jaw_relaxation", title: "Мягкое расслабление лица и челюсти", file: "03-jaw-relaxation.md" },
    { id: "sleep_prep", title: "Практика перед сном", file: "04-sleep-prep.md" },
    { id: "neck_shoulders_stretch", title: "Мягкая растяжка шеи и плеч", file: "05-neck-shoulders-stretch.md" },
    { id: "diary", title: "Дневник состояния на 3 дня", file: "06-diary.md" },
    { id: "24h_plan", title: "План 24 часа без ухудшения", file: "07-24h-plan.md" },
  ];

  function downloadPracticeFile(file) {
    const anchor = document.createElement("a");
    anchor.href = `/support-practices/${file}`;
    anchor.download = file;
    anchor.click();
  }

  function downloadBodyIntakeJSON() {
    if (!bodyIntakeResult) return;
    const data = {
      timestamp: new Date().toISOString(),
      session_id: bodyIntakeResult.session_id || null,
      intake: bodyIntakeResult.intake_answers || null,
      bmi: bodyIntakeResult.bmi,
      care_recommendation: bodyIntakeResult.care_recommendation,
      triggered_red_flags: bodyIntakeResult.triggered_red_flags || [],
      red_flag_care_level: bodyIntakeResult.red_flag_care_level || null,
      user_report: bodyIntakeResult.user_report,
      body_plan: bodyIntakeResult.body_plan,
      used_fallback: bodyIntakeResult.used_fallback || false,
      model_used: bodyIntakeResult.model_used || null,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `body-intake-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadReportPDF() {
    const { default: jsPDF } = await import("jspdf");
    const doc = new jsPDF();
    const user = userPart || "—";
    const doctor = doctorPart || "—";
    let y = 20;
    doc.setFontSize(14);
    doc.text("Отчёт для вас", 20, y);
    y += 8;
    doc.setFontSize(10);
    const userLines = doc.splitTextToSize(user.replace(/===USER_REPORT===/g, "").trim(), 170);
    userLines.forEach((line) => {
      if (y > 275) { doc.addPage(); y = 20; }
      doc.text(line, 20, y);
      y += 5;
    });
    y += 10;
    doc.setFontSize(14);
    doc.text("Отчёт для специалиста", 20, y);
    y += 8;
    doc.setFontSize(10);
    const doctorLines = doc.splitTextToSize(doctor.replace(/===DOCTOR_REPORT===/g, "").trim(), 170);
    doctorLines.forEach((line) => {
      if (y > 275) { doc.addPage(); y = 20; }
      doc.text(line, 20, y);
      y += 5;
    });
    doc.save(`otchet-${publicCode || "tochka-opori"}.pdf`);
  }

  function downloadReportDOCX() {
    const user = userPart || "—";
    const doctor = doctorPart || "—";
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Отчёт Точка Опора</title></head>
<body style="font-family:'PT Serif',Georgia,serif;max-width:700px;margin:40px auto;line-height:1.7">
<h1>Отчёт для вас</h1>
${user.replace(/===USER_REPORT===/g, "").trim().split("\n").map(l => `<p>${l}</p>`).join("\n")}
<hr style="margin:30px 0">
<h1>Отчёт для специалиста</h1>
${doctor.replace(/===DOCTOR_REPORT===/g, "").trim().split("\n").map(l => `<p>${l}</p>`).join("\n")}
</body></html>`;
    const blob = new Blob([html], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `otchet-${publicCode || "tochka-opori"}.doc`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function addPracticeToPlan(practiceId) {
    const practice = PRACTICES.find(p => p.id === practiceId);
    if (!practice) return;
    const current = supportPlan?.selected_practices || [];
    if (current.some(p => p.id === practiceId)) return;
    const updated = [...current, { id: practice.id, title: practice.title, selected_at: new Date().toISOString(), downloaded: false }];
    const newPlan = { ...(supportPlan || {}), selected_practices: updated };
    setSupportPlan(newPlan);
    saveSupportPlan(newPlan);
    showToast("Добавлено в план. При следующем разговоре мы спросим, удалось ли попробовать.");
  }

  function saveSupportPlan(plan) {
    const sp = plan || supportPlan;
    if (!sp) return;
    if (publicCode) {
      const updateBody = withAccessToken({
        action: "updateSupportPlan", public_code: publicCode, session_id: sessionId, support_plan: sp,
      }, sessionId);
      fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateBody),
      }).catch(() => {});
    }
    localStorage.setItem("tochka_support_plan", JSON.stringify(sp));
  }

  const [toast, setToast] = useState({ message: "", type: "", key: 0 });

  // Admin panel state
  const [adminPassword, setAdminPassword] = useState("");
  const [adminAuthed, setAdminAuthed] = useState(false);
  const [adminReviews, setAdminReviews] = useState([]);
  const [adminTotal, setAdminTotal] = useState(0);
  const [adminFilter, setAdminFilter] = useState("all");
  const [adminEnv, setAdminEnv] = useState("all");
  const [adminExpertFilter, setAdminExpertFilter] = useState("all");
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminActionLoading, setAdminActionLoading] = useState(null);
  const [editingReview, setEditingReview] = useState(null);
  const [correctionForm, setCorrectionForm] = useState({
    wrong_questions: "", missing_questions: "", bad_question_wording: "",
    corrected_user_report: "", corrected_doctor_report: "",
    protocol_update: "", correction_comment: "",
    voice_accuracy: "", voice_usefulness: "", voice_influenced: "",
    voice_confirmed: [], voice_comment: "",
  });

  // Expert state
  const [expertData, setExpertData] = useState(() => {
    try {
      const saved = localStorage.getItem("tochka_expert");
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const [expertModalOpen, setExpertModalOpen] = useState(false);
  const [expertCodeInput, setExpertCodeInput] = useState("");
  const [expertLoggingIn, setExpertLoggingIn] = useState(false);
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [registerForm, setRegisterForm] = useState({
    name: "", email: "", telegram: "", role: "psychologist", specialty: "", city: "", organization: "",
  });
  const [registerSending, setRegisterSending] = useState(false);
  const [registrationResult, setRegistrationResult] = useState(null); // { access_code, expert }

  // Organization state
  const [organizations, setOrganizations] = useState([]);
  const [orgFormOpen, setOrgFormOpen] = useState(false);
  const [orgForm, setOrgForm] = useState({ name: "", slug: "", type: "private_clinic", city: "", comment: "" });

  const orgTypeLabels = {
    private_clinic: "Частная клиника",
    state_clinic: "Государственная клиника",
    research_institution: "Научное учреждение",
    test: "Тест",
  };
  const [orgFormEditId, setOrgFormEditId] = useState(null);
  const [orgDetail, setOrgDetail] = useState(null);
  const [orgExperts, setOrgExperts] = useState([]);
  const [orgAddExpertOpen, setOrgAddExpertOpen] = useState(false);
  const [orgAddExpertId, setOrgAddExpertId] = useState("");
  const [orgAddExpertRole, setOrgAddExpertRole] = useState("doctor");

  // My patients state (expert panel)
  const [myPatients, setMyPatients] = useState([]);
  const [myPatientsLoading, setMyPatientsLoading] = useState(false);
  const [patientModalOpen, setPatientModalOpen] = useState(false);
  const [patientModalCode, setPatientModalCode] = useState("");

  // Invite link state
  const [inviteLinks, setInviteLinks] = useState([]);
  const [inviteLinkModalOpen, setInviteLinkModalOpen] = useState(false);
  const [inviteLinkLabel, setInviteLinkLabel] = useState("");
  const [inviteLinkCreated, setInviteLinkCreated] = useState(null);

  // Invite token from URL
  const [inviteToken, setInviteToken] = useState(() => {
    try {
      const m = window.location.pathname.match(/^\/(?:start|invite)\/([a-z0-9]+)/i);
      return m ? m[1] : (localStorage.getItem("tochka_invite_token") || null);
    } catch { return null; }
  });
  const [inviteInfo, setInviteInfo] = useState(null);
  const [inviteChecking, setInviteChecking] = useState(false);

  // Validate invite token on mount
  React.useEffect(() => {
    if (inviteToken) {
      localStorage.setItem("tochka_invite_token", inviteToken);
      setInviteChecking(true);
      fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "validateInviteToken", token: inviteToken }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (d.valid && d.invite) {
            setInviteInfo({ valid: true, expert_name: d.invite.expert_name, organization_name: d.invite.organization_name });
          } else {
            setInviteInfo({ valid: false, error: d.error || "Ссылка недействительна" });
          }
        })
        .catch(() => setInviteInfo({ valid: false, error: "Ошибка проверки ссылки" }))
        .finally(() => setInviteChecking(false));
    }
  }, []);

  // Handle ?ref=alena / ?source=alena query params
  React.useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get("ref");
      const source = params.get("source");
      if (ref === "alena" || source === "alena") {
        localStorage.setItem("body_referral_source", "alena_client");
        localStorage.setItem("body_specialist_id", "alena_zhukova");
        localStorage.setItem("body_specialist_name", "Алена Жукова");
      }
    } catch (e) {}
  }, []);

  // Auto-load body cabinet if session exists on mount
  React.useEffect(() => {
    if (activeModule === "body" && bodyScreen === "landing") {
      const saved = getBodySession();
      if (saved.sessionId && saved.accessToken) {
        loadBodyCabinet();
      }
    }
  }, []);

  // Clear body continuation error when screen changes
  React.useEffect(() => {
    setBodyContinuationError("");
  }, [bodyScreen]);

  const [adminReqTab, setAdminReqTab] = useState("reviews");
  const [adminRequests, setAdminRequests] = useState([]);
  const [adminReqFilter, setAdminReqFilter] = useState("pending");

  // Admin crisis requests state
  const [adminCrisisRequests, setAdminCrisisRequests] = useState([]);
  const [adminCrisisFilter, setAdminCrisisFilter] = useState("new");
  const [adminCrisisLoading, setAdminCrisisLoading] = useState(false);
  const [adminCrisisActionLoading, setAdminCrisisActionLoading] = useState(null);
  const [adminDarkMode, setAdminDarkMode] = useState(true);
  const [adminReviewShowTrash, setAdminReviewShowTrash] = useState(false);
  const [deleteConfirmReviewId, setDeleteConfirmReviewId] = useState(null);
  const [deleteConfirmCode, setDeleteConfirmCode] = useState("");
  const [deleteConfirmStep, setDeleteConfirmStep] = useState(0);
  const [deleteConfirmType, setDeleteConfirmType] = useState("soft");

  // Admin role (super / support / body)
  const [adminRole, setAdminRole] = useState(null);
  // Admin sub-page for SPA navigation (null = derive from URL)
  const [adminSubPage, setAdminSubPage] = useState(null);

  // Body intake admin state
  const [bodyIntakeRecords, setBodyIntakeRecords] = useState([]);
  const [bodyIntakeTotal, setBodyIntakeTotal] = useState(0);
  const [bodyIntakeLoading, setBodyIntakeLoading] = useState(false);
  const [bodyIntakeDetail, setBodyIntakeDetail] = useState(null);
  const [bodyIntakeDetailOpen, setBodyIntakeDetailOpen] = useState(false);
  const [bodyIntakeShowDeleted, setBodyIntakeShowDeleted] = useState(false);
  const [bodyIntakeDeleteConfirm, setBodyIntakeDeleteConfirm] = useState(null);
  const [bodyIntakeSourceFilter, setBodyIntakeSourceFilter] = useState("all");

  const [bodyCodeCopied, setBodyCodeCopied] = useState(false);

  // Body diary state
  const [bodyDiarySessionId, setBodyDiarySessionId] = useState(null);
  const [bodyContinuationInput, setBodyContinuationInput] = useState("");
  const [bodyContinuationError, setBodyContinuationError] = useState("");
  const [bodyDiaryOpen, setBodyDiaryOpen] = useState(false);
  const [bodyDiaryResult, setBodyDiaryResult] = useState(null);
  const [bodyDiaryHistory, setBodyDiaryHistory] = useState(null);
  const [bodyDiaryHistoryOpen, setBodyDiaryHistoryOpen] = useState(false);
  const [bodyDiaryHistoryLoading, setBodyDiaryHistoryLoading] = useState(false);
  const [bodyDiaryHistoryDetail, setBodyDiaryHistoryDetail] = useState(null);
  const [bodyDiaryRecords, setBodyDiaryRecords] = useState([]);
  const [bodyDiaryLoading, setBodyDiaryLoading] = useState(false);
  const [bodyDiaryDetail, setBodyDiaryDetail] = useState(null);
  const [bodyDiaryDetailOpen, setBodyDiaryDetailOpen] = useState(false);
  const [bodyDiarySessionFilter, setBodyDiarySessionFilter] = useState("");
  const [bodyAdminTab, setBodyAdminTab] = useState("intake"); // intake | diary | trash | reviews
  const [bodyExpertReviews, setBodyExpertReviews] = useState([]);
  const [bodyExpertReviewsLoading, setBodyExpertReviewsLoading] = useState(false);
  const [bodyExpertReviewFormOpen, setBodyExpertReviewFormOpen] = useState(false);
  const [bodyExpertReviewForm, setBodyExpertReviewForm] = useState(null);
  const [bodyExpertReviewSaving, setBodyExpertReviewSaving] = useState(false);
  const [bodyExportingCases, setBodyExportingCases] = useState(false);

  // Restore body intake result from localStorage
  const [savedBodyResult, setSavedBodyResult] = useState(() => {
    try {
      const raw = localStorage.getItem("body_last_result");
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  });

  // Training table state
  const [trainingSessions, setTrainingSessions] = useState([]);
  const [trainingLoading, setTrainingLoading] = useState(false);
  const [trainingFilter, setTrainingFilter] = useState({ status: "all", expected_case_type: "all", ai_detected_case_type: "all", session_kind: "all", model_used: "all", public_code: "" });
  const [trainingEditId, setTrainingEditId] = useState(null);
  const [trainingEditData, setTrainingEditData] = useState({});
  const [trainingNewRow, setTrainingNewRow] = useState(null);
  const [trainingSessionsError, setTrainingSessionsError] = useState(null);

  // Create training from review state
  const [trainingFormReviewId, setTrainingFormReviewId] = useState(null);
  const [trainingFormData, setTrainingFormData] = useState({ scenario_played: "", expected_case_type: "", session_kind: "initial", expert_comment: "", public_code: "" });
  const [trainingFormPublicCodeAuto, setTrainingFormPublicCodeAuto] = useState(false);

  // Trash / soft-delete state
  const [trainingShowTrash, setTrainingShowTrash] = useState(false);
  const [trainingSelection, setTrainingSelection] = useState(new Set());
  const [trainingTrashConfirm, setTrainingTrashConfirm] = useState(null);
  const [trainingPermanentConfirm, setTrainingPermanentConfirm] = useState(null);
  const [trainingDeletionReason, setTrainingDeletionReason] = useState("");
  const [trainingDeletionReasonCustom, setTrainingDeletionReasonCustom] = useState("");
  const [trainingBulkConfirm, setTrainingBulkConfirm] = useState(null);

  // Expandable review sections state
  const [expandedSections, setExpandedSections] = useState({});
  const [modalData, setModalData] = useState(null);

  // Quality insight state
  const [qualityInsights, setQualityInsights] = useState([]);
  const [qualityStats, setQualityStats] = useState({ new_approved_count: 0, last_analysis_at: null, recommended_to_analyze: false });
  const [qualityLoading, setQualityLoading] = useState(false);
  const [qualityGenerating, setQualityGenerating] = useState(false);
  const [qualitySelectedReviewIds, setQualitySelectedReviewIds] = useState([]);
  const [qualityConfirmOpen, setQualityConfirmOpen] = useState(false);
  const [qualityDetailInsight, setQualityDetailInsight] = useState(null);

  // Session timeline state
  const [timelineData, setTimelineData] = useState(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineCode, setTimelineCode] = useState(null);
  const [timelineCache, setTimelineCache] = useState({});
  const [timelineView, setTimelineView] = useState("list"); // "list" | "detail"
  const [timelineLargeSection, setTimelineLargeSection] = useState(null);
  const [sessionDetailsData, setSessionDetailsData] = useState(null);
  const [sessionDetailsLoading, setSessionDetailsLoading] = useState(false);
  const [sessionDetailsCache, setSessionDetailsCache] = useState({});
  const [sessionDetailsError, setSessionDetailsError] = useState(null);

  const QUALITY_STATUS_LABELS = {
    new: "Новый",
    under_review: "Рассматривается",
    accepted: "Принят к работе",
    partially_accepted: "Принят частично",
    rejected: "Отклонён",
    archived: "Архив",
  };

  const QUALITY_SEVERITY_LABELS = {
    low: "Низкий",
    medium: "Средний",
    high: "Высокий",
    critical: "Критический",
  };

  const SESSION_KIND_LABELS = {
    initial: "Первичная сессия",
    follow_up: "Повторная сессия",
    diary_check: "Проверка дневника",
    support_toolkit_check: "Проверка практик",
    crisis_check: "Срочное обращение",
    doctor_review: "Врачебный разбор",
    other: "Другое",
  };

  const CASE_TYPE_LABELS = {
    anxiety: "Тревога",
    sleep: "Сон",
    depression_like: "Депрессивные признаки",
    grief: "Утрата / горе",
    trauma: "Травматический опыт",
    body_tension: "Телесное напряжение",
    adhd_like: "Нарушение внимания / исполнительные функции",
    substance: "ПАВ / вещества",
    alcohol: "Алкоголь",
    bipolar_red_flags: "Биполярные красные флаги",
    psychosis_red_flags: "Психотические красные флаги",
    acute_psychosis: "Острый психоз",
    suicide_risk: "Суицидальный риск",
    self_harm_risk: "Риск самоповреждения",
    medication_issue: "Вопросы лекарств",
    mixed: "Смешанный случай",
    other: "Другое",
  };

  const STATUS_LABELS = {
    new: "Новый",
    reviewed: "Просмотрен",
    needs_prompt_update: "Нужно обновить промпт",
    approved_for_learning: "Одобрен для обучения",
    rejected: "Отклонён",
    archived: "Архив",
  };

  const sk = (v) => SESSION_KIND_LABELS[v] || v;
  const ct = (v) => CASE_TYPE_LABELS[v] || v;
  const st = (v) => STATUS_LABELS[v] || v;

  function showToast(message, type = "success") {
    setToast({ message, type, key: Date.now() });
  }

  async function handleExpertLogin() {
    const code = expertCodeInput.trim();
    if (!code) return;
    setExpertLoggingIn(true);
    try {
      const res = await fetch("/api/experts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", access_code: code }),
      });
      const data = await res.json();
      if (data.ok && data.expert) {
        setExpertData(data.expert);
        localStorage.setItem("tochka_expert", JSON.stringify(data.expert));
        setExpertModalOpen(false);
        setExpertCodeInput("");
        showToast(`Режим специалиста: ${data.expert.name}`);
      } else {
        showToast(data.error || "Код специалиста не найден", "error");
      }
    } catch {
      showToast("Ошибка подключения", "error");
    } finally {
      setExpertLoggingIn(false);
    }
  }

  function handleExpertLogout() {
    setExpertData(null);
    localStorage.removeItem("tochka_expert");
    showToast("Режим специалиста выключен");
  }

  // ── My Patients (expert panel) ──────────────────────────

  async function loadMyPatients() {
    setPatientModalOpen(true);
    setMyPatientsLoading(true);
    try {
      const body = { action: "listMyPatients" };
      if (expertData) {
        body.expert_code = expertCodeInput || (await getStoredExpertCode()) || "";
      }
      const res = await fetch("/api/experts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        setMyPatients(data.patients || []);
      } else {
        showToast(data.error || "Ошибка загрузки", "error");
      }
    } catch {
      showToast("Ошибка загрузки пациентов", "error");
    } finally {
      setMyPatientsLoading(false);
    }
  }

  function getStoredExpertCode() {
    try {
      const expert = localStorage.getItem("tochka_expert");
      return expert ? JSON.parse(expert)?.access_code || "" : "";
    } catch { return ""; }
  }

  async function handleAssignPatient() {
    const code = patientModalCode.trim().toUpperCase();
    if (!code) return;
    try {
      const body = { action: "assignPatientToExpert", public_code: code };
      if (expertData) {
        body.expert_code = expertCodeInput || (await getStoredExpertCode()) || "";
      }
      const res = await fetch("/api/experts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        showToast("Пациент назначен");
        setPatientModalCode("");
        loadMyPatients();
      } else {
        showToast(data.error || "Ошибка", "error");
      }
    } catch {
      showToast("Ошибка назначения", "error");
    }
  }

  async function handleCreateInviteLink() {
    try {
      const body = { action: "createDoctorInviteLink", label: inviteLinkLabel };
      if (expertData) {
        body.expert_code = expertCodeInput || (await getStoredExpertCode()) || "";
      }
      const res = await fetch("/api/experts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        setInviteLinkCreated(data.invite_link);
        showToast("Ссылка создана");
        setInviteLinkLabel("");
        loadInviteLinks();
      } else {
        showToast(data.error || "Ошибка", "error");
      }
    } catch {
      showToast("Ошибка создания ссылки", "error");
    }
  }

  async function loadInviteLinks() {
    try {
      const body = { action: "listDoctorInviteLinks" };
      if (expertData) {
        body.expert_code = expertCodeInput || (await getStoredExpertCode()) || "";
      }
      const res = await fetch("/api/experts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        setInviteLinks(data.invite_links || []);
      }
    } catch {}
  }

  async function handleDisableInviteLink(linkId) {
    try {
      const body = { action: "disableDoctorInviteLink", link_id: linkId };
      if (expertData) {
        body.expert_code = expertCodeInput || (await getStoredExpertCode()) || "";
      }
      const res = await fetch("/api/experts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        showToast("Ссылка отключена");
        loadInviteLinks();
      } else {
        showToast(data.error || "Ошибка", "error");
      }
    } catch {
      showToast("Ошибка", "error");
    }
  }

  // ── Admin Organizations ─────────────────────────────────

  async function adminLoadOrganizations() {
    try {
      const res = await fetch("/api/experts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "listOrganizations", admin_secret: adminPassword }),
      });
      const data = await res.json();
      if (data.ok) {
        setOrganizations(data.organizations || []);
      }
    } catch {}
  }

  async function handleCreateOrganization() {
    if (!orgForm.name.trim()) { showToast("Укажите название", "error"); return; }
    try {
      const res = await fetch("/api/experts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: orgFormEditId ? "updateOrganization" : "createOrganization",
          admin_secret: adminPassword,
          id: orgFormEditId,
          ...orgForm,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast(orgFormEditId ? "Организация обновлена" : "Организация создана");
        setOrgFormOpen(false);
        setOrgFormEditId(null);
        setOrgForm({ name: "", slug: "", type: "private_clinic", city: "", comment: "" });
        adminLoadOrganizations();
      } else {
        showToast(data.error || "Ошибка", "error");
      }
    } catch {
      showToast("Ошибка", "error");
    }
  }

  async function adminLoadOrganizationExperts(orgId) {
    try {
      const res = await fetch("/api/experts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "listOrganizationExperts", organization_id: orgId, admin_secret: adminPassword }),
      });
      const data = await res.json();
      if (data.ok) {
        setOrgExperts(data.members || []);
      }
    } catch {}
  }

  async function handleAddExpertToOrg() {
    if (!orgDetail?.id || !orgAddExpertId) return;
    try {
      const res = await fetch("/api/experts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "addExpertToOrganization",
          admin_secret: adminPassword,
          organization_id: orgDetail.id,
          expert_id: orgAddExpertId,
          role: orgAddExpertRole,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast("Специалист добавлен");
        setOrgAddExpertOpen(false);
        setOrgAddExpertId("");
        adminLoadOrganizationExperts(orgDetail.id);
      } else {
        showToast(data.error || "Ошибка", "error");
      }
    } catch {
      showToast("Ошибка", "error");
    }
  }

  async function handleRemoveExpertFromOrg(expertId) {
    if (!orgDetail?.id) return;
    try {
      const res = await fetch("/api/experts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "removeExpertFromOrganization",
          admin_secret: adminPassword,
          organization_id: orgDetail.id,
          expert_id: expertId,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast("Специалист удалён");
        adminLoadOrganizationExperts(orgDetail.id);
      } else {
        showToast(data.error || "Ошибка", "error");
      }
    } catch {
      showToast("Ошибка", "error");
    }
  }

  async function adminListAllExperts() {
    try {
      const res = await fetch("/api/experts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "listAllExperts", admin_secret: adminPassword }),
      });
      const data = await res.json();
      return data.experts || [];
    } catch { return []; }
  }

  function resetRegisterForm() {
    setRegisterForm({ name: "", email: "", telegram: "", role: "psychologist", specialty: "", city: "", organization: "" });
  }

  async function handleExpertRegister() {
    const f = registerForm;
    if (!f.name || f.name.trim().length < 2) {
      showToast("Укажите имя (минимум 2 символа)", "error");
      return;
    }

    setRegisterSending(true);
    try {
      const res = await fetch("/api/experts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "register",
          name: f.name.trim(),
          role: f.role,
          specialty: f.specialty ? f.specialty.trim() : "",
        }),
      });
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        showToast(`Ошибка сервера: ${res.status} ${res.statusText}`, "error");
        return;
      }
      if (!res.ok || !data?.ok) {
        showToast(`Ошибка регистрации: ${data?.details || data?.error || res.statusText}`, "error");
        return;
      }
      setRegistrationResult(data);
      setExpertData(data.expert);
      localStorage.setItem("tochka_expert", JSON.stringify(data.expert));
      showToast(`Режим специалиста активирован: ${data.expert.name}`);
    } catch (e) {
      showToast(`Ошибка подключения: ${e?.message || "проверьте, запущен ли сервер"}`, "error");
    } finally {
      setRegisterSending(false);
    }
  }

  async function adminLoadRequests(filterStatus) {
    const st = filterStatus || adminReqFilter;
    try {
      const res = await fetch("/api/experts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "listRequests", status: st, limit: 100 }),
      });
      const data = await res.json();
      if (data.ok) {
        setAdminRequests(data.requests || []);
      }
    } catch {}
  }

  async function adminUpdateRequestStatus(requestId, status) {
    try {
      await fetch("/api/experts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "updateRequestStatus", request_id: requestId, status, admin_secret: adminPassword }),
      });
      showToast("Статус заявки обновлён");
      adminLoadRequests(adminReqFilter);
    } catch {
      showToast("Ошибка обновления", "error");
    }
  }

  const [recordingQuestionIndex, setRecordingQuestionIndex] = useState(null);
  const [questionRecordingTime, setQuestionRecordingTime] = useState(0);
  const [questionTranscribingIndex, setQuestionTranscribingIndex] = useState(null);

  const questionMediaRecorderRef = useRef(null);
  const questionAudioChunksRef = useRef([]);
  const questionTimerRef = useRef(null);

  const crisisMediaRecorderRef = useRef(null);
  const crisisAudioChunksRef = useRef([]);
  const crisisTimerRef = useRef(null);

  const [crisisRecording, setCrisisRecording] = useState(false);
  const [crisisRecordingTime, setCrisisRecordingTime] = useState(0);
  const [crisisTranscribing, setCrisisTranscribing] = useState(false);
  const [crisisVoiceError, setCrisisVoiceError] = useState("");
  const [crisisWarning, setCrisisWarning] = useState("");
  const [crisisConfirmation, setCrisisConfirmation] = useState("");
  const [crisisShowHighRiskWarning, setCrisisShowHighRiskWarning] = useState(false);

  const crisisKeywords = [
    "хочу умереть",
    "покончить с собой",
    "самоубий",
    "суицид",
    "убить себя",
    "не хочу жить",
    "причинить себе вред",
    "порезать",
    "таблетки",
    "повеситься",
    "прыгнуть",
    "навредить кому-то",
    "убить кого-то",
    "угрожают",
    "меня убьют",
    "голоса приказывают",
  ];

  const roleMap = {
    psychiatrist: "Психиатр",
    psychologist: "Психолог",
    psychotherapist: "Психотерапевт",
    clinical_psychologist: "Клинический психолог",
    neurologist: "Невролог",
    other: "Другое",
  };

  function hasCrisisRisk(value) {
    const lower = (value || "").toLowerCase();
    return crisisKeywords.some((keyword) => lower.includes(keyword));
  }

  async function submitCrisisRequest() {
    setCrisisWarning("");
    setCrisisConfirmation("");

    if (hasCrisisRisk(crisisText) && !crisisShowHighRiskWarning) {
      setCrisisShowHighRiskWarning(true);
      setCrisisWarning("Если есть риск причинить вред себе или другому человеку — звоните 112 или 103 и не оставайтесь одни.");
      return;
    }

    if (!crisisContact.trim() && !crisisText.trim()) {
      setCrisisWarning("Опишите ситуацию или укажите контакт для связи. Если опасно прямо сейчас — звоните 112 или 103.");
      return;
    }

    setCrisisSubmitting(true);
    try {
      const res = await fetch("/api/crisis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          crisis_text: crisisText,
          contact: crisisContact,
          public_code: publicCode || null,
          session_id: sessionId || null,
          high_risk_detected: hasCrisisRisk(crisisText),
          risk_markers: hasCrisisRisk(crisisText) ? crisisKeywords.filter(k => (crisisText || "").toLowerCase().includes(k)) : null,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setCrisisConfirmation("Обращение сохранено. Если есть непосредственная угроза жизни или безопасности — не ждите ответа сервиса, звоните 112 или 103.");
      } else {
        setCrisisWarning(data.error || "Не удалось сохранить обращение. Если опасно прямо сейчас — звоните 112 или 103.");
      }
    } catch (e) {
      console.error("submit crisis error", e);
      setCrisisWarning("Не удалось сохранить обращение. Если опасно прямо сейчас — звоните 112 или 103.");
    } finally {
      setCrisisSubmitting(false);
    }
  }

  function continueFromCrisis() {
    setCrisisConfirmation("");
    setCrisisWarning("");

    if (crisisTimerRef.current) {
      clearInterval(crisisTimerRef.current);
    }
    if (crisisMediaRecorderRef.current && crisisRecording) {
      crisisMediaRecorderRef.current.stop();
    }
    if (crisisText.trim()) {
      setText(crisisText);
      setMode("text");
    }
    setCrisisOpen(false);
    setCrisisText("");
    setCrisisContact("");
    setCrisisRecording(false);
    setCrisisRecordingTime(0);
    setCrisisTranscribing(false);
    setCrisisVoiceError("");
    setCrisisWarning("");
    setCrisisShowHighRiskWarning(false);
  }

  function handleCrisisClose() {
    if (crisisTimerRef.current) {
      clearInterval(crisisTimerRef.current);
    }
    if (crisisMediaRecorderRef.current && crisisRecording) {
      crisisMediaRecorderRef.current.stop();
    }
    setCrisisOpen(false);
    setCrisisSubmitting(false);
    setCrisisText("");
    setCrisisContact("");
    setCrisisRecording(false);
    setCrisisRecordingTime(0);
    setCrisisTranscribing(false);
    setCrisisVoiceError("");
    setCrisisWarning("");
    setCrisisConfirmation("");
    setCrisisShowHighRiskWarning(false);
  }

  // Support Cabinet MVP helpers
  async function loadSupportCabinet(enteredCode) {
    const saved = getSupportSession();
    const accessToken = saved.accessToken;

    setCabinetLoading(true);
    setContinuationCodeError("");
    setError("");
    try {
      let cabinetData;
      let usageData;
      let effectiveSessionId;
      let effectiveAccessToken;

      if (accessToken && saved.sessionId) {
        // Same device: use stored access token.
        const body = { action: "getCabinet", sessionId: saved.sessionId, access_token: accessToken };
        const usageBody = { action: "getUsageBalance", sessionId: saved.sessionId, module: "support", access_token: accessToken };
        const [cabinetRes, usageRes] = await Promise.all([
          fetch("/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
          fetch("/api/usage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(usageBody) }),
        ]);
        cabinetData = await cabinetRes.json();
        usageData = await usageRes.json();
        if (!cabinetRes.ok || !cabinetData.ok) {
          throw new Error(cabinetData.error || "Не удалось открыть кабинет");
        }
        effectiveSessionId = cabinetData.session_id || saved.sessionId;
        effectiveAccessToken = accessToken;
      } else if (enteredCode) {
        // Cross-device: exchange continuation code for access token.
        const exchangeRes = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "exchangeContinuationCredential", module: "support", continuation_code: enteredCode }),
        });
        const exchangeData = await exchangeRes.json();
        if (!exchangeRes.ok || !exchangeData.ok) {
          throw new Error(exchangeData.error || "Не удалось открыть разговор. Проверьте код продолжения.");
        }
        cabinetData = exchangeData.cabinet;
        usageData = exchangeData.usage_balance;
        effectiveSessionId = exchangeData.session_id;
        effectiveAccessToken = exchangeData.access_token;
        saveSupportSession(effectiveSessionId, effectiveAccessToken);
      } else {
        // No stored token and no code: show modal.
        setSessionModalOpen(true);
        setCabinetLoading(false);
        return;
      }

      setSupportCabinet({
        ...cabinetData,
        balance: usageData.ok && usageData.visible ? usageData : null,
      });
      setSessionId(effectiveSessionId);
      setPublicCode(cabinetData.public_code || enteredCode || saved.sessionId);
      setPhase("cabinet");
    } catch (e) {
      setContinuationCodeError(e.message || "Не удалось открыть разговор. Проверьте код продолжения.");
      showToast(e.message || "Не удалось открыть разговор. Проверьте код продолжения.", "error");
    } finally {
      setCabinetLoading(false);
    }
  }

  async function loadBodyCabinet(enteredCode) {
    const saved = getBodySession();
    const accessToken = saved.accessToken;

    setBodyCabinetLoading(true);
    setBodyContinuationError("");
    setError("");
    try {
      let cabinetData;
      let effectiveSessionId;
      let effectiveAccessToken;

      if (accessToken && saved.sessionId) {
        const body = { action: "getBodyCabinet", sessionId: saved.sessionId, accessToken };
        const cabinetRes = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        cabinetData = await cabinetRes.json();
        if (!cabinetRes.ok || !cabinetData.ok) {
          throw new Error(cabinetData.error || "Не удалось открыть кабинет");
        }
        effectiveSessionId = saved.sessionId;
        effectiveAccessToken = accessToken;
      } else if (enteredCode) {
        const exchangeRes = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "exchangeContinuationCredential", module: "body", continuation_code: enteredCode }),
        });
        const exchangeData = await exchangeRes.json();
        if (!exchangeRes.ok || !exchangeData.ok) {
          throw new Error(exchangeData.error || "Не удалось открыть профиль. Проверьте код продолжения.");
        }
        effectiveSessionId = exchangeData.session_id;
        effectiveAccessToken = exchangeData.access_token;
        saveBodySession(effectiveSessionId, effectiveAccessToken);

        const cabinetRes = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "getBodyCabinet", sessionId: effectiveSessionId, accessToken: effectiveAccessToken }),
        });
        cabinetData = await cabinetRes.json();
        if (!cabinetRes.ok || !cabinetData.ok) {
          throw new Error(cabinetData.error || "Не удалось загрузить кабинет");
        }
      } else {
        setBodyCabinetLoading(false);
        return;
      }

      setBodyCabinetData(cabinetData);
      setBodyDiarySessionId(effectiveSessionId);
      setBodyScreen("cabinet");
    } catch (e) {
      setBodyContinuationError(e.message || "Не удалось открыть профиль. Проверьте код продолжения.");
      showToast(e.message || "Не удалось открыть профиль.", "error");
    } finally {
      setBodyCabinetLoading(false);
    }
  }

  async function regenerateSupportContinuationCode() {
    const saved = getSupportSession();
    if (!saved.sessionId || !saved.accessToken) {
      showToast("Нужен код доступа к разговору.", "error");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "regenerateContinuationCredential", module: "support", session_id: saved.sessionId, access_token: saved.accessToken }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Не удалось создать новый код продолжения");
      }
      setRegeneratedCode(data.continuation_code);
      setContinuationCode(null);
    } catch (e) {
      showToast(e.message || "Не удалось создать новый код продолжения", "error");
    } finally {
      setLoading(false);
    }
  }

  async function regenerateBodyContinuationCode() {
    const saved = getBodySession();
    if (!saved.sessionId || !saved.accessToken) {
      throw new Error("Нужен код доступа к профилю.");
    }
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "regenerateContinuationCredential", module: "body", session_id: saved.sessionId, access_token: saved.accessToken }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Не удалось создать новый код продолжения");
    }
    return data.continuation_code;
  }

  async function openSupportReport(targetSessionId) {
    const saved = getSupportSession();
    if (!saved.sessionId || !saved.accessToken) {
      showToast("Нужен код доступа к разговору.", "error");
      return;
    }
    const sid = targetSessionId || saved.sessionId;
    setLoading(true);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getReport", sessionId: sid, access_token: saved.accessToken }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Не удалось открыть отчёт");
      }
      const s = data.session;
      setSessionId(s.sessionId || s.session_id);
      setPublicCode(s.publicCode || s.public_code);
      setText(s.patient_input || s.patient_text || "");
      setConversationHistory(s.conversationHistory || s.conversation_history || []);
      setDialogDepth(s.dialogDepth || 0);
      setPreviousPatientReport(s.previousPatientReport || s.user_report || "");
      setPreviousDoctorReport(s.previousDoctorReport || s.doctor_report || "");
      setHomeTasks(s.homeTasks || "");
      setResourceFactors(s.resourceFactors || "");
      setResult(s.ai_result || s.result || `${s.user_report || ""}\n\n===DOCTOR_REPORT===\n\n${s.doctor_report || ""}`);
      setReportSource("cabinet");
      setJustFinishedSession(false);
      if (supportCabinet?.balance) {
        setUsageBalance({ ...supportCabinet.balance, module: "support" });
      }
      setActiveTab("user");
      setPhase("report");
    } catch (e) {
      showToast(e.message || "Не удалось открыть отчёт", "error");
    } finally {
      setLoading(false);
    }
  }

  function startSupportFollowUp() {
    const saved = getSupportSession();
    if (!saved.sessionId || !saved.accessToken) {
      showToast("Нужен код доступа к разговору.", "error");
      return;
    }
    const latest = supportCabinet?.sessions?.[0];
    const latestReport = supportCabinet?.latest_report || {};
    setSessionId(saved.sessionId);
    setPublicCode(latest?.publicCode || supportCabinet?.public_code || saved.sessionId);
    setIsContinuation(true);
    setPreviousPatientReport(latestReport.user_report || "");
    setPreviousDoctorReport(latestReport.doctor_report || "");
    setHomeTasks(latestReport.homeTasks || "");
    setResourceFactors(latestReport.resourceFactors || "");
    setSupportPlan(latestReport.supportPlan || null);
    setConversationHistory([]);
    setDialogDepth(0);
    setAnswers({});
    setQuestions(null);
    setResult(null);
    setFollowUpAnswers({});
    setPhase("followup");
  }

  async function submitFollowUp() {
    const saved = getSupportSession();
    if (!saved.sessionId || !saved.accessToken) {
      showToast("Нужен код доступа к разговору.", "error");
      return;
    }
    const answers = followUpAnswers;
    const required = ["dynamics", "sleep_appetite", "new_concerns", "tried", "help_needed"];
    const missing = required.filter((k) => !answers[k]?.trim());
    if (missing.length > 0) {
      showToast("Ответьте, пожалуйста, на все вопросы.", "error");
      return;
    }

    setLoading(true);
    setError("");
    try {
      // Create a new session for the follow-up, linked to the same owner/wallet
      const createRes = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createFollowUpSession",
          previousSessionId: saved.sessionId,
          access_token: saved.accessToken,
        }),
      });
      const createData = await createRes.json();
      if (!createRes.ok || !createData.ok) {
        throw new Error(createData.error || "Не удалось начать продолжение");
      }

      saveSupportSession(createData.sessionId, createData.access_token);
      setSessionId(createData.sessionId);
      setPublicCode(createData.public_code);
      sessionRef.current = { sessionId: createData.sessionId, accessToken: createData.access_token };

      const followUpText = [
        `Стало легче, тяжелее или примерно так же: ${answers.dynamics}`,
        `Что изменилось в сне, аппетите и обычных делах: ${answers.sleep_appetite}`,
        `Появилось ли что-то новое, что особенно тревожит: ${answers.new_concerns}`,
        `Что из предложенного удалось попробовать: ${answers.tried}`,
        `Какая помощь сейчас была бы наиболее полезна: ${answers.help_needed}`,
      ].join("\n\n");

      setText(followUpText);
      setConversationHistory([]);
      setDialogDepth(0);
      setAnswers({});
      setQuestions(null);
      setResult(null);
      setReportSource("generated");
      setJustFinishedSession(false);

      // Continue via existing analyze flow
      await submitRound(followUpText);
    } catch (e) {
      showToast(e.message || "Не удалось начать продолжение", "error");
    } finally {
      setLoading(false);
    }
  }

  async function ensureStartSession() {
    if (sessionRef.current) {
      return sessionRef.current;
    }
    if (startSessionPromiseRef.current) {
      return startSessionPromiseRef.current;
    }
    startSessionPromiseRef.current = (async () => {
      const mod = activeModule || "support";
      let token;
      try { token = await getClientToken(mod, "analyze"); } catch (e) {
        throw new Error("Не удалось начать разговор. Попробуйте ещё раз.");
      }
      const r = await fetch("/api/start-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
      });
      const d = await r.json();
      if (!d.ok) {
        const code = d.code || (r.status === 401 ? "SESSION_START_401" : r.status === 404 ? "SESSION_START_404" : "SESSION_CREATE_FAILED");
        throw new Error(`Не удалось начать разговор (${code}). Попробуйте ещё раз.`);
      }
      const data = { sessionId: d.session_id, accessToken: d.access_token };
      sessionRef.current = data;
      setSessionId(data.sessionId);
      saveSupportSession(data.sessionId, data.accessToken);
      return data;
    })();
    try {
      return await startSessionPromiseRef.current;
    } finally {
      startSessionPromiseRef.current = null;
    }
  }

  async function startRecording() {
    setVoiceError("");

    try {
      await ensureStartSession();
      const currentSession = sessionRef.current;
      if (!currentSession?.sessionId || !currentSession?.accessToken) {
        setVoiceError("Сессия истекла. Войдите снова по коду продолжения.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());

        const audioBlob = new Blob(audioChunksRef.current, {
          type: "audio/webm",
        });

        setTranscribing(true);

        try {
          const mod = "support";
          let token;
          try { token = await getClientToken(mod, "transcribe"); } catch {}
          const tHeaders = {
            "Content-Type": "audio/webm",
            "X-Session-Id": currentSession.sessionId,
            "X-Module": "support",
            "X-Access-Token": currentSession.accessToken,
          };
          if (token) tHeaders["Authorization"] = `Bearer ${token}`;

          let response = await fetch("/api/transcribe", {
            method: "POST",
            headers: tHeaders,
            body: audioBlob,
          });

          // Retry once on 401 (client token only)
          if (response.status === 401 && token) {
            try { token = await getClientToken(mod, "transcribe"); } catch {}
            tHeaders["Authorization"] = `Bearer ${token}`;
            response = await fetch("/api/transcribe", {
              method: "POST",
              headers: tHeaders,
              body: audioBlob,
            });
          }

          let data;
          const responseText = await response.text();
          try {
            data = JSON.parse(responseText);
          } catch {
            console.error("Transcribe: non-JSON response", response.status, responseText.slice(0, 200));
            throw new Error("Сервер вернул пустой ответ (попробуйте перезапустить сервер)");
          }

          if (!response.ok) {
            throw new Error(data.error || "Не удалось расшифровать голос");
          }

          const transcript = data.text || "";
          setText(transcript);
          if (data.voice_observations) {
            const msgId = `voice-${Date.now()}-${++voiceMsgCounterRef.current}`;
            setVoiceObservations((prev) => {
              if (prev.some((e) => e.messageId === msgId)) return prev;
              return [...prev, {
                messageId: msgId,
                round: 0,
                createdAt: new Date().toISOString(),
                transcript,
                analysis: data.voice_observations,
              }];
            });
          }
          setMode("text");
        } catch (error) {
          setVoiceError(error.message || "Ошибка расшифровки");
        } finally {
          setTranscribing(false);
        }
      };

      recorder.start();
      setRecording(true);
      setRecordingTime(0);

      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => {
          const next = prev + 1;

          if (next >= 60) {
            stopRecording();
            setVoiceError("Запись автоматически остановлена через 60 секунд.");
            return 60;
          }

          return next;
        });
      }, 1000);
    } catch (error) {
      setVoiceError("Не удалось получить доступ к микрофону");
    }
  }

  function stopRecording() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
    }
  }

  async function startQuestionRecording(index) {
    setVoiceError("");

    try {
      await ensureStartSession();
      const currentSession = sessionRef.current;
      if (!currentSession?.sessionId || !currentSession?.accessToken) {
        setVoiceError("Сессия истекла. Войдите снова по коду продолжения.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const recorder = new MediaRecorder(stream);
      questionMediaRecorderRef.current = recorder;
      questionAudioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          questionAudioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());

        if (questionTimerRef.current) {
          clearInterval(questionTimerRef.current);
        }

        const audioBlob = new Blob(questionAudioChunksRef.current, {
          type: "audio/webm",
        });

        setQuestionTranscribingIndex(index);

        try {
          const mod = "support";
          let token;
          try { token = await getClientToken(mod, "transcribe"); } catch {}
          const tHeaders = {
            "Content-Type": "audio/webm",
            "X-Session-Id": currentSession.sessionId,
            "X-Module": "support",
            "X-Access-Token": currentSession.accessToken,
          };
          if (token) tHeaders["Authorization"] = `Bearer ${token}`;

          let response = await fetch("/api/transcribe", {
            method: "POST",
            headers: tHeaders,
            body: audioBlob,
          });

          if (response.status === 401 && token) {
            try { token = await getClientToken(mod, "transcribe"); } catch {}
            tHeaders["Authorization"] = `Bearer ${token}`;
            response = await fetch("/api/transcribe", {
              method: "POST",
              headers: tHeaders,
              body: audioBlob,
            });
          }

          const responseText = await response.text();
          let data;
          try {
            data = JSON.parse(responseText);
          } catch {
            console.error("Transcribe: non-JSON response", response.status, responseText.slice(0, 200));
            throw new Error("Сервер вернул пустой ответ (попробуйте перезапустить сервер)");
          }

          if (!response.ok) {
            throw new Error(data.error || "Не удалось расшифровать голос");
          }

          setAnswers((prev) => ({
            ...prev,
            [index]: data.text || "",
          }));
          if (data.voice_observations) {
            const msgId = `voice-${Date.now()}-${++voiceMsgCounterRef.current}`;
            setVoiceObservations((prev) => {
              if (prev.some((e) => e.messageId === msgId)) return prev;
              return [...prev, {
                messageId: msgId,
                round: dialogDepth,
                createdAt: new Date().toISOString(),
                transcript: data.text || "",
                analysis: data.voice_observations,
              }];
            });
          }
        } catch (error) {
          setVoiceError(error.message || "Ошибка расшифровки");
        } finally {
          setQuestionTranscribingIndex(null);
          setRecordingQuestionIndex(null);
          setQuestionRecordingTime(0);
        }
      };

      recorder.start();
      setRecordingQuestionIndex(index);
      setQuestionRecordingTime(0);

      questionTimerRef.current = setInterval(() => {
        setQuestionRecordingTime((prev) => {
          const next = prev + 1;

          if (next >= 60) {
            stopQuestionRecording();
            return 60;
          }

          return next;
        });
      }, 1000);
    } catch (error) {
      setVoiceError("Не удалось получить доступ к микрофону");
    }
  }

  function stopQuestionRecording() {
    if (questionTimerRef.current) {
      clearInterval(questionTimerRef.current);
    }

    if (questionMediaRecorderRef.current && recordingQuestionIndex !== null) {
      questionMediaRecorderRef.current.stop();
    }
  }

  async function startCrisisRecording() {
    setCrisisVoiceError("");

    try {
      await ensureStartSession().catch(() => {});
      const currentSession = sessionRef.current;
      if (!currentSession?.sessionId || !currentSession?.accessToken) {
        setCrisisVoiceError("Сессия истекла. Войдите снова по коду продолжения.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const recorder = new MediaRecorder(stream);
      crisisMediaRecorderRef.current = recorder;
      crisisAudioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          crisisAudioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());

        if (crisisTimerRef.current) {
          clearInterval(crisisTimerRef.current);
        }

        const audioBlob = new Blob(crisisAudioChunksRef.current, {
          type: "audio/webm",
        });

        setCrisisTranscribing(true);

        try {
          const mod = "support";
          let token;
          try { token = await getClientToken(mod, "transcribe"); } catch {}
          const tHeaders = {
            "Content-Type": "audio/webm",
            "X-Session-Id": currentSession.sessionId,
            "X-Module": "support",
            "X-Access-Token": currentSession.accessToken,
          };
          if (token) tHeaders["Authorization"] = `Bearer ${token}`;

          let response = await fetch("/api/transcribe", {
            method: "POST",
            headers: tHeaders,
            body: audioBlob,
          });

          if (response.status === 401 && token) {
            try { token = await getClientToken(mod, "transcribe"); } catch {}
            tHeaders["Authorization"] = `Bearer ${token}`;
            response = await fetch("/api/transcribe", {
              method: "POST",
              headers: tHeaders,
              body: audioBlob,
            });
          }

          const responseText = await response.text();
          let data;
          try {
            data = JSON.parse(responseText);
          } catch {
            console.error("Transcribe: non-JSON response", response.status, responseText.slice(0, 200));
            throw new Error("Сервер вернул пустой ответ (попробуйте перезапустить сервер)");
          }

          if (!response.ok) {
            throw new Error(data.error || "Не удалось расшифровать голос");
          }

          setCrisisText(data.text || "");
        } catch (error) {
          setCrisisVoiceError(error.message || "Ошибка расшифровки");
        } finally {
          setCrisisTranscribing(false);
          setCrisisRecording(false);
          setCrisisRecordingTime(0);
        }
      };

      recorder.start();
      setCrisisRecording(true);
      setCrisisRecordingTime(0);

      crisisTimerRef.current = setInterval(() => {
        setCrisisRecordingTime((prev) => {
          const next = prev + 1;

          if (next >= 60) {
            stopCrisisRecording();
            return 60;
          }

          return next;
        });
      }, 1000);
    } catch (error) {
      setCrisisVoiceError("Не удалось получить доступ к микрофону");
    }
  }

  function stopCrisisRecording() {
    if (crisisTimerRef.current) {
      clearInterval(crisisTimerRef.current);
    }

    if (crisisMediaRecorderRef.current && crisisRecording) {
      crisisMediaRecorderRef.current.stop();
    }
  }

  async function submitRound(overrideText) {
    const inputText = typeof overrideText === "string" ? overrideText : text;
    if (dialogDepth === 0 && inputText.trim().length < 10) {
      setError("Напишите хотя бы 2–3 предложения.");
      return;
    }

    setLoading(true);
    setError("");
    setQuestions(null);
    if (dialogDepth >= 3 && activeModule === "support") {
      setLoadingMessage("Готовим отчёт…");
      setTimeout(() => {
        if (loading) setLoadingMessage("Подготовка занимает больше времени, чем обычно.");
      }, 40000);
    } else {
      setLoadingMessage("");
    }

    try {
      const mod = activeModule || "support";
      const res = await fetchWithClientToken("/api/analyze", mod, "analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: inputText,
          answers: dialogDepth === 0 ? {} : answers,
          conversationHistory,
          depth: dialogDepth,
          isContinuation,
          previousPatientReport,
          previousDoctorReport,
          homeTasks,
          resourceFactors,
          supportPlan,
          voiceObservations,
          module: mod,
          session_id: sessionId || undefined,
        }),
      });

      if (!res.ok) {
        if (res instanceof Response) {
          const errText = await res.text();
          throw new Error(errText ? JSON.parse(errText).error : "Ошибка");
        }
        throw new Error(res.error || "Не удалось начать разбор. Попробуйте ещё раз.");
      }

      const data = await res.json();

      if (data.type === "questions") {
        const qs = Array.isArray(data.questions)
          ? data.questions.filter(Boolean)
          : [];

        const newHistory = [
          ...conversationHistory,
          ...(dialogDepth > 0
            ? [{ role: "user", answers }]
            : []),
          { role: "assistant", questions: qs },
        ];

        setConversationHistory(newHistory);
        setQuestions(qs.length > 0 ? qs : fallbackQ());
        setAnswers({});
        setDialogDepth((d) => d + 1);
        setPhase("questions");

        // Persist conversation pairs after each answer round
        if (dialogDepth > 0 && sessionId) {
          const pairs = buildConversationPairs(
            [...conversationHistory, { role: "user", answers }],
            { questions, answers, patient_input: inputText }
          );
            if (pairs.length > 0) {
            const pairsBody = withAccessToken({ action: "save_conversation_pairs", sessionId, pairs }, sessionId);
            fetch("/api/session", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(pairsBody),
            }).catch(() => {});
          }
        }
      } else if (data.type === "processing") {
        // Backend is still generating the report. Start polling.
        const sid = sessionId || `session-${Date.now()}`;
        if (!sessionId) setSessionId(sid);
        setLoadingMessage("Отчёт ещё формируется. Подождите немного.");
        await pollReportStatus(sid, (status) => finalizeReportFromStatus(status, inputText));
      } else if (data.type === "final") {
        setResult(data.report || "");
        if (data._debug) setDebugInfo(data._debug);
        if (data.care_recommendation) setCareRecommendation(data.care_recommendation);
        setActiveTab("user");
        setReportSource("generated");
        setJustFinishedSession(true);
        setPhase("report");

        const sid = sessionId || `session-${Date.now()}`;
        if (!sessionId) setSessionId(sid);

        // Backend now saves the report durably. Use tokens/codes from the response.
        if (data.public_code) setPublicCode(data.public_code);
        if (data.access_token) saveSupportSession(sid, data.access_token);
        if (data.continuation_code) setContinuationCode(data.continuation_code);

        // Persist conversation pairs for all rounds (best-effort).
        const finalHistory = [
          ...conversationHistory,
          ...(dialogDepth > 0 ? [{ role: "user", answers }] : []),
        ];
        const finalPairs = buildConversationPairs(finalHistory, { questions, answers, patient_input: inputText });
        if (finalPairs.length > 0) {
          const pairsBody = withAccessToken({ action: "save_conversation_pairs", sessionId: sid, pairs: finalPairs }, sid);
          fetch("/api/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(pairsBody),
          }).catch(() => {});
        }

        // Save case review (local + Supabase)
        const review = {
          case_id: sid, sessionId: sid, publicCode: data.public_code || publicCode || "",
          module: activeModule,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          environment: window.location.hostname.includes("localhost") ? "local" : "vercel",
          patient_input: inputText, questions, answers,
          ai_result: data.report || "", conversationHistory, dialogDepth,
          previousPatientReport: previousPatientReport || "",
          previousDoctorReport: previousDoctorReport || "",
          homeTasks: homeTasks || "", resourceFactors: resourceFactors || "",
          patient_feedback: { rating: 0, useful: "", unclear_or_useless: "" },
          doctor_feedback: { wrongQuestions: "", missingQuestions: "", badQuestionWording: "", correctedUserReport: "", correctedDoctorReport: "", protocolUpdate: "", generalComment: "" },
          voice_observations: voiceObservations || null,
          expert_id: expertData?.id || null,
          expert_name: expertData?.name || null,
          expert_role: expertData?.role || null,
          expert_specialty: expertData?.specialty || null,
        };
        fetch("/api/reviews", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "save", ...review }),
        }).catch(() => {});
      } else {
        throw new Error("Неизвестный тип ответа");
      }
    } catch (e) {
      const msg = e.message || "";
      if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("abort")) {
        // Connection dropped — check backend status before giving up.
        await attemptReportRecovery(sid || sessionId, inputText, data?.report);
      } else if (dialogDepth < 3 || activeModule !== "support") {
        setError("Не удалось начать разбор. Попробуйте ещё раз.");
      } else {
        setError("Не удалось сформировать отчёт. Попробуйте ещё раз.");
      }
    } finally {
      setLoading(false);
      setLoadingMessage("");
    }
  }

  async function getReportStatus(sessionId) {
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "getReportStatus", sessionId }),
    });
    if (!res.ok) return null;
    return await res.json();
  }

  async function pollReportStatus(sessionId, onReady) {
    let attempts = 0;
    const maxAttempts = 60; // ~60 seconds
    while (attempts < maxAttempts) {
      const status = await getReportStatus(sessionId);
      if (!status) {
        await new Promise((r) => setTimeout(r, 1000));
        attempts += 1;
        continue;
      }
      if (status.status === "ready" && status.type === "final") {
        onReady(status);
        return;
      }
      if (status.status === "failed") {
        setError(status.message || "Не удалось сформировать отчёт. Попробуйте ещё раз.");
        setLoading(false);
        return;
      }
      // processing or not_started
      await new Promise((r) => setTimeout(r, 1000));
      attempts += 1;
    }
    setError("Отчёт ещё формируется. Попробуйте обновить страницу через минуту.");
    setLoading(false);
  }

  async function attemptReportRecovery(sessionId, inputText, fallbackReport) {
    if (!sessionId) {
      setError("Не удалось сформировать отчёт. Проверьте соединение и попробуйте ещё раз.");
      return;
    }
    setLoading(true);
    setError("Соединение прервалось. Проверяем, сохранился ли отчёт…");
    const status = await getReportStatus(sessionId);
    if (!status) {
      setError("Не удалось проверить статус отчёта. Попробуйте ещё раз.");
      setLoading(false);
      return;
    }
    if (status.status === "ready" && status.type === "final") {
      finalizeReportFromStatus(status, inputText);
      return;
    }
    if (status.status === "processing" || status.status === "not_started") {
      setError("");
      setLoadingMessage("Отчёт ещё формируется. Подождите немного.");
      await pollReportStatus(sessionId, (readyStatus) => finalizeReportFromStatus(readyStatus, inputText));
      return;
    }
    setError(status.message || "Не удалось сформировать отчёт. Попробуйте ещё раз.");
    setLoading(false);
  }

  function finalizeReportFromStatus(status, inputText) {
    setResult(status.report || "");
    if (status.care_recommendation) setCareRecommendation(status.care_recommendation);
    setActiveTab("user");
    setReportSource("generated");
    setJustFinishedSession(true);
    setPhase("report");
    if (status.public_code) setPublicCode(status.public_code);
    if (status.access_token) saveSupportSession(status.session_id, status.access_token);
    if (status.continuation_code) setContinuationCode(status.continuation_code);
    setSessionId(status.session_id);
    setLoading(false);
    // Save review
    const review = {
      case_id: status.session_id, sessionId: status.session_id, publicCode: status.public_code || "",
      module: activeModule,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      environment: window.location.hostname.includes("localhost") ? "local" : "vercel",
      patient_input: inputText, questions, answers,
      ai_result: status.report || "", conversationHistory, dialogDepth,
      previousPatientReport: previousPatientReport || "",
      previousDoctorReport: previousDoctorReport || "",
      homeTasks: homeTasks || "", resourceFactors: resourceFactors || "",
      patient_feedback: { rating: 0, useful: "", unclear_or_useless: "" },
      doctor_feedback: { wrongQuestions: "", missingQuestions: "", badQuestionWording: "", correctedUserReport: "", correctedDoctorReport: "", protocolUpdate: "", generalComment: "" },
      voice_observations: voiceObservations || null,
      expert_id: expertData?.id || null,
      expert_name: expertData?.name || null,
      expert_role: expertData?.role || null,
      expert_specialty: expertData?.specialty || null,
    };
    fetch("/api/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save", ...review }),
    }).catch(() => {});
  }

  const [loadingMessage, setLoadingMessage] = useState("");

  function fallbackQ() {
    return [
      "Было ли в последние месяцы важное событие, которое могло повлиять на ваше состояние?",
      "Началось ли состояние после конкретного события или постепенно?",
      "Как давно вы замечаете это состояние?",
      "Насколько это влияет на сон, работу или отношения?",
      "Бывали ли мысли, что жить не хочется или причинить себе вред?",
    ];
  }

  function generatePublicCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const part = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    return `ТОЧКА-${part()}-${part()}`;
  }

  function buildCaseReview() {
    const now = new Date().toISOString();
    const sid = sessionId || `session-${Date.now()}`;
    const code = publicCode || generatePublicCode();

    if (!sessionId) setSessionId(sid);
    if (!publicCode) setPublicCode(code);

    return {
      case_id: sid,
      sessionId: sid,
      publicCode: code,
      createdAt: now,
      updatedAt: now,
      environment: window.location.hostname.includes("localhost") ? "local" : "vercel",
      patient_input: text,
      questions,
      answers,
      ai_result: result,
      conversationHistory,
      dialogDepth,
      previousPatientReport: previousPatientReport || "",
      previousDoctorReport: previousDoctorReport || "",
      homeTasks: homeTasks || "",
      resourceFactors: resourceFactors || "",
      expert_id: expertData?.id || null,
      expert_name: expertData?.name || null,
      expert_role: expertData?.role || null,
      expert_specialty: expertData?.specialty || null,
      patient_feedback: {
        rating: patientRating,
        useful: patientUseful,
        unclear_or_useless: patientUnclear,
      },
      doctor_feedback: {
        wrong_questions: doctorFeedback.wrongQuestions,
        missing_questions: doctorFeedback.missingQuestions,
        bad_question_wording: doctorFeedback.badQuestionWording,
        corrected_user_report: doctorFeedback.correctedUserReport,
        corrected_doctor_report: doctorFeedback.correctedDoctorReport,
        protocol_update: doctorFeedback.protocolUpdate,
        general_comment: doctorFeedback.generalComment,
      },
    };
  }

  function downloadCaseReview(caseReview) {
    const blob = new Blob([JSON.stringify(caseReview, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${caseReview.case_id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const userPart = result
    ? result.split("===DOCTOR_REPORT===")[0]
        .replace("===USER_REPORT===", "")
        .trim()
    : "";

  const doctorPart = result
    ? result.split("===DOCTOR_REPORT===")[1]?.trim() || ""
    : "";

  function renderUserReport(text) {
    if (!text) return null;
    const highlightTitles = [
      "Что может помочь сегодня",
      "План до следующего разговора",
      "До следующего разговора",
    ];
    const lines = text.split("\n");
    const sections = [];
    let current = null;
    for (const line of lines) {
      const m = line.match(/^(\d+)\.\s+(.+)/);
      if (m) {
        if (current) sections.push(current);
        current = { num: m[1], title: m[2], lines: [] };
      } else if (current) {
        current.lines.push(line);
      }
    }
    if (current) sections.push(current);

    if (!sections.length) {
      return <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{text}</div>;
    }

    const isHighlighted = (title) =>
      highlightTitles.some((h) => title.toLowerCase().includes(h.toLowerCase()) || h.toLowerCase().includes(title.toLowerCase()));

    return sections.map((s, i) => {
      const hl = isHighlighted(s.title);
      return (
        <div
          key={i}
          style={{
            marginBottom: 12,
            padding: hl ? "14px 18px" : 0,
            borderRadius: hl ? 14 : 0,
            background: hl ? "#E2EBE4" : "transparent",
            border: hl ? "1px solid rgba(125,154,137,.3)" : "none",
          }}
        >
          <div
            style={{
              fontWeight: hl ? 700 : 600,
              fontSize: hl ? 16 : 15,
              color: hl ? "#2E2A25" : "#2E2A25",
              marginBottom: s.lines.some((l) => l.trim()) ? 6 : 0,
            }}
          >
            {s.num}. {s.title}
          </div>
          {s.lines.some((l) => l.trim()) && (
            <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7, color: "#7A7268" }}>
              {s.lines.join("\n").trim()}
            </div>
          )}
        </div>
      );
    });
  }

  function handleBodyIntakeComplete(response) {
    setBodyIntakeResult(response);
    setBodyIntakeStage("result");
    setBodyIntakeStep(0);
    setBodyScreen("result");
    try {
      const sid = response?.session_id || "";
      localStorage.setItem("body_last_session_id", sid);
      localStorage.setItem("body_last_result", JSON.stringify(response));
      localStorage.setItem("body_last_created_at", new Date().toISOString());
      if (response?.continuation_code) {
        setContinuationCode(response.continuation_code);
      }
      if (sid && response?.access_token) {
        saveBodySession(sid, response.access_token);
      }
    } catch (e) {}
  }

  function copyBodyCode() {
    const code = bodyIntakeResult?.continuation_code || continuationCode || bodyIntakeResult?.session_id || localStorage.getItem("body_last_session_id");
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      setBodyCodeCopied(true);
      setTimeout(() => setBodyCodeCopied(false), 2500);
    }).catch(() => {});
  }

  async function continueBodyByCode() {
    const code = bodyContinuationInput.trim();
    if (!code) return;
    await loadBodyCabinet(code);
    setBodyContinuationInput("");
  }

  async function loadBodyDiaryHistory() {
    setBodyDiaryHistoryLoading(true);
    const sid = bodyDiarySessionId || bodyIntakeResult?.session_id || localStorage.getItem("body_last_session_id");
    if (!sid) { setBodyDiaryHistoryLoading(false); return; }
    try {
      const listBody = withAccessToken({ action: "listBodyDailyLogs", session_id: sid }, sid);
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(listBody),
      });
      const data = await res.json();
      if (data.ok) {
        setBodyDiaryHistory(data.logs);
        setBodyDiaryHistoryOpen(true);
      }
    } catch (e) {
      console.error("Failed to load diary history:", e);
    } finally {
      setBodyDiaryHistoryLoading(false);
    }
  }

  function handleReset() {
    setPhase("input");
    setQuestions(null);
    setAnswers({});
    setResult(null);
    setText("");
    setError("");
    setActiveTab("user");
    setSessionReviewOpen(false);
    setPatientRating(0);
    setPatientUseful("");
    setPatientUnclear("");
    setDoctorFeedback({
      wrongQuestions: "",
      missingQuestions: "",
      badQuestionWording: "",
      correctedUserReport: "",
      correctedDoctorReport: "",
      protocolUpdate: "",
      generalComment: "",
    });
    setConversationHistory([]);
    setDialogDepth(0);
    setSessionData(null);
    setSessionId(null);
    setPublicCode(null);
    setIsContinuation(false);
    setPreviousPatientReport("");
    setPreviousDoctorReport("");
    setSupportPlan(null);
    setShowSelfAssessment(false);
    setCanManageWithoutSpecialist(null);
    setShowSupportToolkit(false);
    setShowSpecialistIntent(false);
    setSpecialistIntentDone(false);
    setHomeTasks("");
    setResourceFactors("");
    setDebugInfo(null);
    setCareRecommendation(null);
    setSupportCabinet(null);
    setCabinetLoading(false);
    setFollowUpAnswers({});
    setReportSource(null);
    setJustFinishedSession(false);
    setContinuationCode(null);
    setContinuationCodeInput("");
    setContinuationCodeError("");
    setRegeneratedCode(null);
    setBodyIntakeStage("idle");
    setBodyIntakeResult(null);
    setBodyScreen("landing");
    setBodyCabinetData(null);
    setBodyDiarySessionId(null);
    setBodyContinuationInput("");
    setBodyContinuationError("");
    try {
      localStorage.removeItem("body_last_session_id");
      localStorage.removeItem("body_last_result");
      localStorage.removeItem("body_last_created_at");
      clearBodySession();
    } catch (e) {}
    setSavedBodyResult(null);
    setShowConsultPrep(false);
    setShowMessageToClose(false);
    setMessageText("");
    setRecording(false);
    setTranscribing(false);
    setVoiceError("");
    setRecordingTime(0);
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    setRecordingQuestionIndex(null);
    setQuestionRecordingTime(0);
    setQuestionTranscribingIndex(null);
    if (questionTimerRef.current) {
      clearInterval(questionTimerRef.current);
    }
    setCrisisOpen(false);
    setCrisisSubmitted(false);
    setCrisisText("");
    setCrisisContact("");
    setCrisisRecording(false);
    setCrisisRecordingTime(0);
    setCrisisTranscribing(false);
    setCrisisVoiceError("");
    setCrisisWarning("");
    setCrisisConfirmation("");
    setToast({ message: "", type: "", key: 0 });
    if (crisisTimerRef.current) {
      clearInterval(crisisTimerRef.current);
    }
  }

  async function adminLogin() {
    if (!adminPassword) return;
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", password: adminPassword }),
      });
      const data = await res.json();
      if (data.ok) {
        setAdminAuthed(true);
        setAdminRole(data.role || null);
        if (adminModuleRoute === "body") {
          setBodyIntakeShowDeleted(false);
          adminLoadBodyIntake();
        } else if (adminModuleRoute === "council") {
          // ClinicalCouncilAdmin loads its own data on mount
        } else {
          adminLoadReviews(adminFilter, adminEnv, adminExpertFilter, adminReviewShowTrash);
        }
      } else {
        setAdminRole(null);
        showToast("Неверный пароль", "error");
      }
    } catch {
      showToast("Ошибка подключения", "error");
    }
  }

  async function adminLoadBodyIntake(maxCount = 50) {
    setBodyIntakeLoading(true);
    try {
      const body = {
        action: "listBodyIntake",
        password: adminPassword,
        limit: maxCount,
        showDeleted: bodyIntakeShowDeleted,
      };
      if (bodyIntakeSourceFilter !== "all") {
        body.source = bodyIntakeSourceFilter;
      }
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        setBodyIntakeRecords(data.records || []);
        setBodyIntakeTotal(data.count || 0);
      } else {
        showToast(data.error || "Ошибка загрузки body intake", "error");
      }
    } catch {
      showToast("Ошибка загрузки body intake", "error");
    } finally {
      setBodyIntakeLoading(false);
    }
  }

  async function adminOpenBodyIntakeDetail(id) {
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getBodyIntakeDetail", password: adminPassword, id }),
      });
      const data = await res.json();
      if (data.ok && data.record) {
        setBodyIntakeDetail(data.record);
        setBodyIntakeDetailOpen(true);
      } else {
        showToast(data.error || "Ошибка загрузки деталей", "error");
      }
    } catch {
      showToast("Ошибка загрузки деталей", "error");
    }
  }

  async function adminDeleteBodyIntake(id) {
    setBodyIntakeDeleteConfirm(null);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deleteBodyIntake", password: adminPassword, id }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast("Анкета перемещена в корзину", "success");
        adminLoadBodyIntake();
      } else {
        showToast(data.error || "Ошибка удаления", "error");
      }
    } catch {
      showToast("Ошибка удаления", "error");
    }
  }

  async function adminRestoreBodyIntake(id) {
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restoreBodyIntake", password: adminPassword, id }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast("Анкета восстановлена", "success");
        adminLoadBodyIntake();
      } else {
        showToast(data.error || "Ошибка восстановления", "error");
      }
    } catch {
      showToast("Ошибка восстановления", "error");
    }
  }

  function adminDownloadBodyIntakeJSON(record) {
    const data = {
      timestamp: record.created_at || new Date().toISOString(),
      intake_answers: record.answers || null,
      bmi: record.bmi,
      care_recommendation: record.care_recommendation,
      module: record.module,
      version: record.version,
      session_id: record.session_id,
      body_plan: record.body_plan || null,
      user_report: record.user_report || null,
      triggered_red_flags: record.triggered_red_flags || [],
      red_flag_care_level: record.red_flag_care_level || null,
      used_fallback: record.used_fallback || false,
      model_used: record.model_used || null,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `body-intake-${record.id || "unknown"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function adminLoadBodyDailyLogs(maxCount = 50) {
    setBodyDiaryLoading(true);
    try {
      const body = { action: "listBodyDailyLogs", password: adminPassword, limit: maxCount };
      if (bodyDiarySessionFilter) body.session_id = bodyDiarySessionFilter;
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        setBodyDiaryRecords(data.records || []);
      } else {
        showToast(data.error || "Ошибка загрузки дневников", "error");
      }
    } catch {
      showToast("Ошибка загрузки дневников", "error");
    } finally {
      setBodyDiaryLoading(false);
    }
  }

  async function adminLoadBodyExpertReviews() {
    setBodyExpertReviewsLoading(true);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "listBodyExpertReviews", password: adminPassword }),
      });
      const data = await res.json();
      if (data.ok) {
        setBodyExpertReviews(data.records || []);
      }
    } catch {
      showToast("Ошибка загрузки правок", "error");
    } finally {
      setBodyExpertReviewsLoading(false);
    }
  }

  function adminOpenBodyExpertReviewForm(targetType, targetId, sessionId, sourcePayload, aiOutput) {
    setBodyExpertReviewForm({
      target_type: targetType,
      target_id: targetId,
      session_id: sessionId,
      reviewer_name: "Алена Жукова",
      reviewer_role: "body_expert",
      rating_safety: "ok",
      rating_usefulness: 3,
      rating_practicality: 3,
      rating_tone: 3,
      error_tags: [],
      what_ai_did_well: "",
      what_ai_missed: "",
      corrected_recommendation: "",
      suggested_questions: "",
      expert_comment: "",
      source_payload: sourcePayload || null,
      ai_output: aiOutput || null,
    });
    setBodyExpertReviewFormOpen(true);
  }

  async function adminSaveBodyExpertReview() {
    if (!bodyExpertReviewForm) return;
    setBodyExpertReviewSaving(true);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "saveBodyExpertReview", password: adminPassword, review: bodyExpertReviewForm }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast("Правка сохранена", "success");
        setBodyExpertReviewFormOpen(false);
        adminLoadBodyExpertReviews();
      } else {
        showToast(data.error || "Ошибка сохранения", "error");
      }
    } catch {
      showToast("Ошибка сохранения", "error");
    } finally {
      setBodyExpertReviewSaving(false);
    }
  }

  async function adminExportBodyExpertCases() {
    setBodyExportingCases(true);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "exportBodyExpertCases", password: adminPassword }),
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `body-expert-cases-${new Date().toISOString().split("T")[0]}.jsonl`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      showToast("Ошибка выгрузки", "error");
    } finally {
      setBodyExportingCases(false);
    }
  }

  async function adminOpenBodyDailyLogDetail(id) {
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getBodyDailyLogDetail", password: adminPassword, id }),
      });
      const data = await res.json();
      if (data.ok && data.record) {
        setBodyDiaryDetail(data.record);
        setBodyDiaryDetailOpen(true);
      } else {
        showToast(data.error || "Ошибка загрузки дневника", "error");
      }
    } catch {
      showToast("Ошибка загрузки дневника", "error");
    }
  }

  async function adminDeleteBodyDailyLog(id) {
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deleteBodyDailyLog", password: adminPassword, id }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast("Запись удалена", "success");
        adminLoadBodyDailyLogs();
      } else {
        showToast(data.error || "Ошибка удаления", "error");
      }
    } catch {
      showToast("Ошибка удаления", "error");
    }
  }

  async function loadTrainingSessions() {
    setTrainingLoading(true);
    setTrainingSessionsError(null);
    setTrainingSelection(new Set());
    try {
      const body = { action: "listTrainingSessions", ...trainingFilter, showTrash: trainingShowTrash };
      if (expertData) {
        body.expert_id = expertData.id;
      } else {
        body.admin_secret = adminPassword;
      }
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        setTrainingSessions(data.sessions || []);
        setTrainingSessionsError(null);
      } else {
        const err = data.error || "Ошибка загрузки";
        setTrainingSessionsError(err);
        showToast(err, "error");
      }
    } catch {
      const err = "Ошибка загрузки таблицы тренировок";
      setTrainingSessionsError(err);
      showToast(err, "error");
    } finally {
      setTrainingLoading(false);
    }
  }

  async function saveTrainingSession(row) {
    try {
      const body = { action: "saveTrainingSession", ...row };
      if (expertData) body.expert_id = expertData.id;
      else body.admin_secret = adminPassword;
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        showToast(data.message || "Сохранено");
        if (data.session) {
          setTrainingSessions((prev) => {
            const idx = prev.findIndex((s) => s.id === data.session.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = data.session;
              return next;
            }
            return [data.session, ...prev];
          });
        }
        return data;
      }
      showToast(data.error || "Ошибка", "error");
      return null;
    } catch {
      showToast("Ошибка сохранения", "error");
      return null;
    }
  }

  async function updateTrainingSession(id, updates) {
    try {
      const body = { action: "updateTrainingSession", id, updates };
      if (expertData) body.expert_id = expertData.id;
      else body.admin_secret = adminPassword;
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        setTrainingSessions((prev) => {
          const idx = prev.findIndex((s) => s.id === id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = data.session;
            return next;
          }
          return prev;
        });
        showToast("Сохранено");
      } else {
        showToast(data.error || "Ошибка", "error");
      }
    } catch {
      showToast("Ошибка сохранения", "error");
    }
  }

  async function deleteTrainingSession(id) {
    if (!confirm("Удалить запись?")) return;
    try {
      const body = { action: "deleteTrainingSession", id, admin_secret: adminPassword };
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        setTrainingSessions((prev) => prev.filter((s) => s.id !== id));
        showToast("Перемещено в корзину");
      } else {
        showToast(data.error || "Ошибка", "error");
      }
    } catch {
      showToast("Ошибка удаления", "error");
    }
  }

  async function trashSingleTrainingSession(id) {
    try {
      const reason = trainingDeletionReason === "other" ? trainingDeletionReasonCustom || "other" : trainingDeletionReason;
      const body = { action: "trashTrainingSession", id, admin_secret: adminPassword, expert_name: "admin", deletion_reason: reason };
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        setTrainingSessions((prev) => prev.filter((s) => s.id !== id));
        setTrainingTrashConfirm(null);
        setTrainingDeletionReason("");
        setTrainingDeletionReasonCustom("");
        showToast("Перемещено в корзину");
      } else {
        showToast(data.error || "Ошибка", "error");
      }
    } catch {
      showToast("Ошибка перемещения в корзину", "error");
    }
  }

  async function trashBulkTrainingSessions(ids) {
    try {
      const reason = trainingDeletionReason === "other" ? trainingDeletionReasonCustom || "other" : trainingDeletionReason;
      const body = { action: "trashTrainingSessions", ids, admin_secret: adminPassword, expert_name: "admin", deletion_reason: reason };
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        setTrainingSessions((prev) => prev.filter((s) => !ids.includes(s.id)));
        setTrainingSelection(new Set());
        setTrainingBulkConfirm(null);
        setTrainingDeletionReason("");
        setTrainingDeletionReasonCustom("");
        showToast(`Перемещено в корзину: ${data.count || ids.length}`);
      } else {
        showToast(data.error || "Ошибка", "error");
      }
    } catch {
      showToast("Ошибка перемещения в корзину", "error");
    }
  }

  async function restoreSingleTrainingSession(id) {
    try {
      const body = { action: "restoreTrainingSession", id, admin_secret: adminPassword };
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        setTrainingSessions((prev) => prev.filter((s) => s.id !== id));
        showToast("Восстановлено");
      } else {
        showToast(data.error || "Ошибка", "error");
      }
    } catch {
      showToast("Ошибка восстановления", "error");
    }
  }

  async function restoreBulkTrainingSessions(ids) {
    try {
      const body = { action: "restoreTrainingSessions", ids, admin_secret: adminPassword };
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        setTrainingSessions((prev) => prev.filter((s) => !ids.includes(s.id)));
        setTrainingSelection(new Set());
        setTrainingBulkConfirm(null);
        showToast(`Восстановлено: ${data.count || ids.length}`);
      } else {
        showToast(data.error || "Ошибка", "error");
      }
    } catch {
      showToast("Ошибка восстановления", "error");
    }
  }

  async function permanentDeleteTrainingSession(id) {
    try {
      const body = { action: "permanentlyDeleteTrainingSession", id, admin_secret: adminPassword };
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        setTrainingSessions((prev) => prev.filter((s) => s.id !== id));
        setTrainingTrashConfirm(null);
        showToast("Запись удалена безвозвратно");
      } else {
        showToast(data.error || "Ошибка", "error");
      }
    } catch {
      showToast("Ошибка безвозвратного удаления", "error");
    }
  }

  async function permanentDeleteBulkTrainingSessions(ids) {
    try {
      const body = { action: "permanentlyDeleteTrainingSessions", ids, admin_secret: adminPassword };
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        setTrainingSessions((prev) => prev.filter((s) => !ids.includes(s.id)));
        setTrainingSelection(new Set());
        setTrainingBulkConfirm(null);
        showToast(`Удалено безвозвратно: ${data.count || ids.length}`);
      } else {
        showToast(data.error || "Ошибка", "error");
      }
    } catch {
      showToast("Ошибка безвозвратного удаления", "error");
    }
  }

  async function createTrainingFromReview() {
    if (!trainingFormReviewId) return;
    try {
      const body = {
        action: "createTrainingFromReview",
        review_id: trainingFormReviewId,
        ...trainingFormData,
      };
      if (expertData) body.expert_id = expertData.id;
      else body.admin_secret = adminPassword;
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        showToast(data.message || "Создано");
        setTrainingSessions((prev) => [data.session, ...prev]);
        setTrainingFormReviewId(null);
        setTrainingFormData({ scenario_played: "", expected_case_type: "", session_kind: "initial", expert_comment: "", public_code: "" });
      } else {
        showToast(data.error || "Ошибка", "error");
      }
    } catch {
      showToast("Ошибка создания", "error");
    }
  }

  async function downloadTrainingCsv() {
    try {
      const body = { action: "exportTrainingCsv", ...trainingFilter, showTrash: trainingShowTrash };
      if (expertData) body.expert_id = expertData.id;
      else body.admin_secret = adminPassword;
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${trainingShowTrash ? "training-sessions-trash" : "training-sessions"}-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      showToast("Ошибка выгрузки", "error");
    }
  }

  async function loadQualityStats() {
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getQualityAnalysisStats", admin_secret: adminPassword }),
      });
      const data = await res.json();
      if (data.ok) {
        setQualityStats({
          new_approved_count: data.new_approved_count || 0,
          unanalyzed_review_ids: data.unanalyzed_review_ids || [],
          last_analysis_at: data.last_analysis_at || null,
          last_analysis_review_count: data.last_analysis_review_count || 0,
          recommended_to_analyze: data.recommended_to_analyze || false,
        });
      }
    } catch {
      showToast("Ошибка загрузки статистики", "error");
    }
  }

  async function loadQualityInsights() {
    setQualityLoading(true);
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "listQualityInsights", admin_secret: adminPassword }),
      });
      const data = await res.json();
      if (data.ok) {
        setQualityInsights(data.insights || []);
      } else {
        showToast(data.error || "Ошибка загрузки обзоров", "error");
      }
    } catch {
      showToast("Ошибка загрузки обзоров", "error");
    } finally {
      setQualityLoading(false);
    }
  }

  async function generateQualityInsight() {
    setQualityGenerating(true);
    setQualityConfirmOpen(false);
    try {
      const body = {
        action: "generateQualityInsight",
        admin_secret: adminPassword,
        analysis_type: qualitySelectedReviewIds.length > 0 ? "selected" : "new_approved",
      };
      if (qualitySelectedReviewIds.length > 0) {
        body.review_ids = qualitySelectedReviewIds;
      }
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        showToast(data.message || "Обзор создан");
        setQualitySelectedReviewIds([]);
        await loadQualityStats();
        await loadQualityInsights();
      } else {
        showToast(data.error || "Ошибка создания обзора", "error");
      }
    } catch {
      showToast("Ошибка создания обзора", "error");
    } finally {
      setQualityGenerating(false);
    }
  }

  async function loadQualityInsightDetail(insightId) {
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getQualityInsight", admin_secret: adminPassword, insight_id: insightId }),
      });
      const data = await res.json();
      if (data.ok) {
        setQualityDetailInsight(data.insight);
      } else {
        showToast(data.error || "Ошибка загрузки обзора", "error");
      }
    } catch {
      showToast("Ошибка загрузки обзора", "error");
    }
  }

  async function updateQualityInsightStatus(insightId, status) {
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "updateQualityInsightStatus", admin_secret: adminPassword, insight_id: insightId, status }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast(data.message || "Статус обновлён");
        setQualityInsights((prev) => prev.map((i) => i.id === insightId ? { ...i, status } : i));
        if (qualityDetailInsight && qualityDetailInsight.id === insightId) {
          setQualityDetailInsight((prev) => ({ ...prev, status }));
        }
      } else {
        showToast(data.error || "Ошибка", "error");
      }
    } catch {
      showToast("Ошибка обновления статуса", "error");
    }
  }

  function toggleReviewSelection(reviewId) {
    setQualitySelectedReviewIds((prev) =>
      prev.includes(reviewId) ? prev.filter((id) => id !== reviewId) : [...prev, reviewId]
    );
  }

  function copyOpenCodeTask(insight) {
    if (!insight || !insight.recommendations || insight.recommendations.length === 0) {
      showToast("Нет принятых рекомендаций для копирования", "error");
      return;
    }
    const acceptedRels = insight.recommendations;
    if (acceptedRels.length === 0) {
      showToast("Нет рекомендаций для задания", "error");
      return;
    }
    const lines = [
      "## Задание для OpenCode",
      "",
      "### Найденные проблемы",
    ];
    for (const rel of acceptedRels) {
      lines.push(`- **${rel.title}** (приоритет: ${rel.priority || "средний"}, подтверждающих кейсов: ${rel.case_count || "—"})`);
      if (rel.description) lines.push(`  - Описание: ${rel.description}`);
      if (rel.suggested_change) lines.push(`  - Предлагаемое изменение: ${rel.suggested_change}`);
      if (rel.target_file) lines.push(`  - Файл: ${rel.target_file}`);
      if (rel.risk_of_change) lines.push(`  - Риск: ${rel.risk_of_change}`);
      lines.push("");
    }
    lines.push("### Регрессионные тесты");
    if (insight.regression_tests && insight.regression_tests.length > 0) {
      for (const test of insight.regression_tests) {
        lines.push(`- Сценарий: ${test.scenario || test.scenario || "—"}`);
        if (test.expected_behavior) lines.push(`  - Ожидаемое поведение: ${test.expected_behavior}`);
      }
    } else {
      lines.push("(не указаны)");
    }
    lines.push("");
    lines.push("### Требования");
    lines.push("- Показать diff перед любыми изменениями");
    lines.push("- Не делать автоматический push без проверки");
    lines.push("- Не менять production без явного подтверждения");

    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      showToast("Задание скопировано в буфер обмена");
    }).catch(() => {
      showToast("Ошибка копирования", "error");
    });
  }

  function openTrainingForm(review) {
    const json = getReviewJson(review);
    let code = review.public_code || json.public_code || json.publicCode || json.session?.public_code || json.sessionCode || json.code || "";
    setTrainingFormReviewId(review.id);
    setTrainingFormData({
      scenario_played: "",
      expected_case_type: "",
      session_kind: "initial",
      expert_comment: "",
      public_code: code,
    });
    setTrainingFormPublicCodeAuto(!!code);
  }

  async function adminLoadReviews(filterStatus, filterEnv, expertFilter, showTrash) {
    const st = filterStatus !== undefined ? filterStatus : adminFilter;
    const env = filterEnv !== undefined ? filterEnv : adminEnv;
    const exp = expertFilter !== undefined ? expertFilter : adminExpertFilter;
    const trash = showTrash !== undefined ? showTrash : adminReviewShowTrash;
    setAdminLoading(true);
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", status: st, environment: env, expert_filter: exp, limit: 100, showTrash: trash }),
      });
      const data = await res.json();
      if (data.ok) {
        setAdminReviews(data.reviews || []);
        setAdminTotal(data.count || data.reviews?.length || 0);
      } else {
        const details = data.details || data.error || null;
        showToast(details ? `Ошибка загрузки: ${details}` : "Ошибка загрузки", "error");
      }
    } catch (err) {
      console.error("adminLoadReviews error", err);
      showToast("Ошибка загрузки списка", "error");
    } finally {
      setAdminLoading(false);
    }
  }

  async function adminUpdateStatus(reviewId, status) {
    setAdminActionLoading(reviewId);
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "updateStatus", review_id: reviewId, status, admin_secret: adminPassword }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast(data.message || "Статус обновлён");
        adminLoadReviews();
      } else {
        showToast(data.error || "Ошибка обновления", "error");
      }
    } catch {
      showToast("Ошибка обновления статуса", "error");
    } finally {
      setAdminActionLoading(null);
    }
  }

  function safeObject(value) {
    if (!value) return {};
    if (typeof value === "object" && !Array.isArray(value)) return value;
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      } catch {
        return {};
      }
    }
    return {};
  }

  function getReviewJson(review) {
    return safeObject(review?.json_data);
  }

  function getDoctorCorrection(review) {
    return safeObject(review?.doctor_correction);
  }

  function getCorrectedJson(review) {
    return safeObject(review?.corrected_json);
  }

  function openCorrectionForm(review) {
    try {
      const json = getReviewJson(review);
      const correction = getDoctorCorrection(review);
      const corrected = getCorrectedJson(review);
      const voiceReview = json?.voice_analysis_review || review?.voice_analysis_review || {};

      setCorrectionForm({
        wrong_questions: correction.wrong_questions || json?.doctor_feedback?.wrong_questions || "",
        missing_questions: correction.missing_questions || json?.doctor_feedback?.missing_questions || "",
        bad_question_wording: correction.bad_question_wording || json?.doctor_feedback?.bad_question_wording || "",
        corrected_user_report: corrected.corrected_user_report || correction.corrected_user_report || json?.corrected_user_report || "",
        corrected_doctor_report: corrected.corrected_doctor_report || correction.corrected_doctor_report || json?.corrected_doctor_report || "",
        protocol_update: review?.protocol_update || correction.protocol_update || "",
        correction_comment: review?.correction_comment || correction.correction_comment || "",
        voice_accuracy: voiceReview.accuracy || "",
        voice_usefulness: voiceReview.usefulness || "",
        voice_influenced: voiceReview.influenced_decision || "",
        voice_confirmed: voiceReview.confirmed_features || [],
        voice_comment: voiceReview.comment || "",
      });
      setEditingReview(review?.id);
    } catch (error) {
      console.error("open correction editor failed", error, review);
    }
  }

  function closeCorrectionForm() {
    setEditingReview(null);
  }

  async function adminSaveCorrection(reviewId, newStatus) {
    setAdminActionLoading(reviewId);
    try {
      const voiceReview = {};
      if (correctionForm.voice_accuracy) voiceReview.accuracy = correctionForm.voice_accuracy;
      if (correctionForm.voice_usefulness) voiceReview.usefulness = correctionForm.voice_usefulness;
      if (correctionForm.voice_influenced) voiceReview.influenced_decision = correctionForm.voice_influenced;
      if (correctionForm.voice_confirmed?.length) voiceReview.confirmed_features = correctionForm.voice_confirmed;
      if (correctionForm.voice_comment) voiceReview.comment = correctionForm.voice_comment;
      if (Object.keys(voiceReview).length > 0) {
        voiceReview.reviewed_at = new Date().toISOString();
      }

      const body = {
        review_id: reviewId,
        admin_secret: adminPassword,
        action: "save_correction",
        doctor_correction: {
          wrong_questions: correctionForm.wrong_questions,
          missing_questions: correctionForm.missing_questions,
          bad_question_wording: correctionForm.bad_question_wording,
          corrected_user_report: correctionForm.corrected_user_report,
          corrected_doctor_report: correctionForm.corrected_doctor_report,
        },
        protocol_update: correctionForm.protocol_update,
        correction_comment: correctionForm.correction_comment,
        voice_analysis_review: Object.keys(voiceReview).length > 0 ? voiceReview : undefined,
      };
      if (newStatus) {
        body.status = newStatus;
      }
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, action: "saveCorrection" }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast(data.message || "Сохранено");
        setEditingReview(null);
        adminLoadReviews();
      } else {
        showToast(data.error || "Ошибка сохранения", "error");
      }
    } catch {
      showToast("Ошибка сохранения правок", "error");
    } finally {
      setAdminActionLoading(null);
    }
  }

  function adminDownloadJson(review) {
    const blob = new Blob([JSON.stringify(review.json_data || review, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${review.case_id || review.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function adminDownloadJsonl(status) {
    const st = status || "approved";
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "exportJsonl", admin_secret: adminPassword, status: st }),
      });
      const text = await res.text();
      const blob = new Blob([text], { type: "application/jsonl" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `reviews-${st}-${new Date().toISOString().split("T")[0]}.jsonl`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      showToast("Ошибка экспорта: " + e.message);
    }
  }

  async function adminLoadCrisisRequests(filterStatus) {
    const st = filterStatus !== undefined ? filterStatus : adminCrisisFilter;
    setAdminCrisisLoading(true);
    try {
      const res = await fetch("/api/crisis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", status: st, limit: 100, admin_secret: adminPassword }),
      });
      const data = await res.json();
      if (data.ok) {
        setAdminCrisisRequests(data.requests || []);
      } else {
        console.error("load crisis requests error", data);
      }
    } catch (err) {
      console.error("adminLoadCrisisRequests error", err);
    } finally {
      setAdminCrisisLoading(false);
    }
  }

  async function adminUpdateCrisisStatus(requestId, status) {
    setAdminCrisisActionLoading(requestId);
    try {
      const res = await fetch("/api/crisis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "updateStatus", request_id: requestId, status, admin_secret: adminPassword }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast(data.message || "Статус обновлён");
        adminLoadCrisisRequests(adminCrisisFilter);
      } else {
        showToast(data.error || "Ошибка обновления", "error");
      }
    } catch {
      showToast("Ошибка обновления статуса", "error");
    } finally {
      setAdminCrisisActionLoading(null);
    }
  }

  function adminDownloadCrisisJson(req) {
    const blob = new Blob([JSON.stringify(req, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `crisis-${req.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

      function safeText(value, fallback = "—") {
        if (value === null || value === undefined) return fallback;
        if (typeof value === "string") return value || fallback;
        if (typeof value === "number" || typeof value === "boolean") return String(value);
        try {
          return JSON.stringify(value);
        } catch {
          return fallback;
        }
      }

      function safeReport(value, label) {
        if (value && typeof value === "string" && value.trim()) return value;
        return `${label} не был сохранён`;
      }

  function shortText(value, max = 240) {
    const text = safeText(value, "");
    if (!text) return "—";
    return text.length > max ? text.slice(0, max) + "…" : text;
  }

  function safeDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("ru-RU");
  }

  function shorten(text, max = 100) {
    return shortText(text, max);
  }

   function normalizeReviewDetails(review) {
    return normalizeSessionDetails(review);
  }

  function toggleSection(reviewId, section) {
    const key = `${reviewId}-${section}`;
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function isSectionOpen(reviewId, section) {
    return !!expandedSections[`${reviewId}-${section}`];
  }

  function openModal(title, content) {
    setModalData({ title, content });
  }

  function closeModal() {
    setModalData(null);
    setTimelineData(null);
    setTimelineCode(null);
    setTimelineView("list");
    setSessionDetailsData(null);
    setSessionDetailsError(null);
    setSessionDetailsLoading(false);
  }

  async function loadSessionTimeline(code) {
    if (!code || code === "—") return;
    if (timelineCode === code && timelineData) return; // already loaded

    // Check cache
    if (timelineCache[code]) {
      setTimelineData(timelineCache[code]);
      setTimelineCode(code);
      return;
    }

    setTimelineLoading(true);
    setTimelineCode(code);
    try {
      const body = { action: "getSessionTimeline", public_code: code };
      if (adminPassword) body.admin_secret = adminPassword;
      if (expertData?.expert_id) {
        body.expert_id = expertData.expert_id;
        if (expertData?.access_code) body.expert_code = expertData.access_code;
      }

      const resp = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await resp.json();

      if (result.ok) {
        setTimelineData(result);
        setTimelineCache((prev) => ({ ...prev, [code]: result }));
      } else {
        showToast(result.error || "Не удалось загрузить линию сессий", "error");
        setTimelineData(null);
      }
    } catch (e) {
      showToast("Не удалось загрузить линию сессий", "error");
      setTimelineData(null);
    } finally {
      setTimelineLoading(false);
    }
  }

  async function loadSessionDetails(item) {
    const cacheKey = item.case_review_id || item.session_id || item.training_session_id;
    if (!cacheKey) { showToast("Нет идентификатора сессии", "error"); return; }

    if (sessionDetailsCache[cacheKey]) {
      setSessionDetailsData(sessionDetailsCache[cacheKey]);
      setTimelineView("detail");
      setSessionDetailsError(null);
      return;
    }

    setSessionDetailsLoading(true);
    setSessionDetailsError(null);
    try {
      const body = { action: "getSessionTimelineDetails", public_code: timelineCode };
      if (item.case_review_id) body.case_review_id = item.case_review_id;
      else if (item.session_id) body.session_id = item.session_id;
      else if (item.training_session_id) body.training_session_id = item.training_session_id;
      if (adminPassword) body.admin_secret = adminPassword;
      if (expertData?.expert_id) {
        body.expert_id = expertData.expert_id;
        if (expertData?.access_code) body.expert_code = expertData.access_code;
      }

      const resp = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await resp.json();

      if (result.ok) {
        setSessionDetailsData(result.session);
        setSessionDetailsCache((prev) => ({ ...prev, [cacheKey]: result.session }));
        setTimelineView("detail");
      } else {
        setSessionDetailsError(result.error === "access_denied" ? "У вас нет доступа к этой сессии." : result.error || "Не удалось загрузить сессию. Попробуйте ещё раз.");
        showToast(result.error === "access_denied" ? "У вас нет доступа к этой сессии." : "Не удалось загрузить сессию.", "error");
      }
    } catch (e) {
      setSessionDetailsError("Не удалось загрузить сессию. Попробуйте ещё раз.");
      showToast("Не удалось загрузить сессию.", "error");
    } finally {
      setSessionDetailsLoading(false);
    }
  }

  const SESSION_KIND_LABELS_TIMELINE = {
    initial: "Первичная сессия",
    follow_up: "Повторная сессия",
    diary_check: "Проверка дневника",
    support_toolkit_check: "Проверка практик",
    crisis_check: "Срочное обращение",
    doctor_review: "Врачебный разбор",
    other: "Другое",
  };

  const STATUS_LABELS_TIMELINE = {
    approved: "Одобрено",
    rejected: "Отклонено",
    pending: "Ожидание",
    needs_review: "Нужна доработка",
    local_auto_saved: "Черновик",
    new: "Новый",
    reviewed: "Просмотрен",
    needs_prompt_update: "Нужно обновить промпт",
    approved_for_learning: "Одобрен для обучения",
    archived: "Архив",
  };

  const isAdminPage = typeof window !== "undefined" && window.location.pathname.startsWith("/admin");
  const isTrainingPage = typeof window !== "undefined" && window.location.pathname === "/admin/training";
  const adminModuleRoute = adminSubPage || (typeof window !== "undefined"
    ? window.location.pathname === "/admin/body" ? "body" : window.location.pathname === "/admin/council" ? "council" : "support"
    : "support");
  const isDedicatedSubdomain = typeof window !== "undefined" && (
    window.location.hostname === "health.tochka-opori.online" || window.location.hostname.startsWith("health.") ||
    new URLSearchParams(window.location.search).get("module") === "body"
  );
  const isDev = typeof window !== "undefined" && (
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" || import.meta.env?.DEV
  );
  const showModuleSwitcher = isDev || adminRole === "super";

  // Update document title based on subdomain
  useEffect(() => {
    document.title = isDedicatedSubdomain ? "Опора. Здоровье & Стройность" : "Точка опоры";
  }, [isDedicatedSubdomain]);

  const s = {
    page: {
      minHeight: "100vh",
      background: "#F6F0E7",
      color: "#2E2A25",
      fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
      padding: "32px",
    },
    wrap: { maxWidth: 1200, margin: "0 auto" },
    header: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 80,
    },
    logo: { fontSize: 28, fontWeight: 700, fontFamily: "Georgia, \"PT Serif\", serif" },
    sub: { color: "#7A7268", marginTop: 4, fontSize: 14 },
    crisis: {
      background: "#B85C4A",
      color: "white",
      border: 0,
      borderRadius: 22,
      padding: "14px 22px",
      fontWeight: 700,
      fontSize: 15,
      cursor: "pointer",
    },
    grid: {
      display: "grid",
      gridTemplateColumns: "1.1fr 0.9fr",
      gap: 56,
      alignItems: "start",
    },
    badge: {
      display: "inline-block",
      border: "1px solid rgba(46,42,37,.12)",
      background: "#FFFDF8",
      borderRadius: 999,
      padding: "10px 16px",
      color: "#7A7268",
      marginBottom: 28,
      fontSize: 13,
    },
    h1: {
      fontSize: 68,
      lineHeight: 1.03,
      fontWeight: 900,
      margin: 0,
      letterSpacing: "-0.05em",
      fontFamily: "Georgia, \"PT Serif\", serif",
    },
    p: {
      color: "#7A7268",
      fontSize: 20,
      lineHeight: 1.7,
      maxWidth: 680,
    },
    row: {
      display: "flex",
      gap: 14,
      marginTop: 32,
      flexWrap: "wrap",
    },
    primary: {
      border: 0,
      borderRadius: 22,
      background: "#7D9A89",
      color: "white",
      padding: "16px 24px",
      fontWeight: 700,
      fontSize: 16,
      cursor: "pointer",
    },
    secondary: {
      border: "1px solid rgba(46,42,37,.18)",
      borderRadius: 22,
      background: "#FFFDF8",
      color: "#2E2A25",
      padding: "16px 24px",
      fontWeight: 600,
      fontSize: 15,
      cursor: "pointer",
    },
    card: {
      border: "1px solid rgba(46,42,37,.1)",
      background: "#FFFDF8",
      borderRadius: 36,
      padding: 28,
      boxShadow: "0 4px 24px rgba(46,42,37,.06)",
    },
    inner: {
      background: "#FAF6EF",
      borderRadius: 30,
      padding: 26,
      marginTop: 22,
    },
    textarea: {
      width: "100%",
      minHeight: 180,
      resize: "vertical",
      border: "1px solid rgba(46,42,37,.12)",
      borderRadius: 24,
      background: "#FAF6EF",
      color: "#2E2A25",
      padding: 20,
      fontSize: 16,
      outline: "none",
      boxSizing: "border-box",
    },
    wide: {
      width: "100%",
      marginTop: 18,
      border: 0,
      borderRadius: 24,
      background: "#7D9A89",
      color: "white",
      padding: "18px 22px",
      fontWeight: 700,
      fontSize: 16,
      cursor: "pointer",
    },
    error: {
      marginTop: 16,
      background: "rgba(184,92,74,.1)",
      color: "#B85C4A",
      padding: 16,
      borderRadius: 18,
    },
    result: {
      marginTop: 24,
      border: "1px solid rgba(46,42,37,.1)",
      background: "#FFFDF8",
      borderRadius: 28,
      padding: 24,
    },
    label: { color: "#7A7268", fontSize: 14, marginTop: 18, marginBottom: 6 },
    label2: { color: "#7A7268", fontSize: 14, marginTop: 22, marginBottom: 6 },
    questionCard: {
      background: "#FAF6EF",
      borderRadius: 18,
      padding: 16,
      marginBottom: 14,
    },
    questionText: {
      fontWeight: 700,
      marginBottom: 10,
      lineHeight: 1.5,
    },
    tabs: {
      display: "flex",
      gap: 10,
      marginBottom: 18,
    },
    tab: {
      border: "1px solid rgba(46,42,37,.12)",
      background: "transparent",
      color: "#7A7268",
      borderRadius: 14,
      padding: "10px 16px",
      cursor: "pointer",
    },
    activeTab: {
      border: "1px solid #7D9A89",
      background: "#E2EBE4",
      color: "#2E2A25",
      borderRadius: 14,
      padding: "10px 16px",
      fontWeight: 700,
      cursor: "pointer",
    },
    reportBlock: {
      background: "#FAF6EF",
      borderRadius: 20,
      padding: 20,
    },
    expertBox: {
      marginTop: 24,
      border: "1px solid rgba(46,42,37,.1)",
      background: "#FAF6EF",
      borderRadius: 24,
      padding: 20,
    },
    overlay: {
      position: "fixed",
      top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(46,42,37,.45)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1000,
      padding: 20,
    },
    modal: {
      background: "#FFFDF8",
      borderRadius: 28,
      padding: 28,
      maxWidth: 560,
      width: "100%",
      border: "1px solid rgba(46,42,37,.1)",
      boxShadow: "0 8px 40px rgba(46,42,37,.12)",
    },
    modalTitle: {
      fontSize: 26,
      fontWeight: 900,
      marginBottom: 12,
    },
    modalWarning: {
      background: "rgba(184,92,74,.1)",
      color: "#B85C4A",
      padding: 14,
      borderRadius: 16,
      fontSize: 15,
      lineHeight: 1.5,
      marginBottom: 20,
    },
    crisisTextarea: {
      width: "100%",
      minHeight: 100,
      resize: "vertical",
      border: "1px solid rgba(46,42,37,.12)",
      borderRadius: 16,
      background: "#FAF6EF",
      color: "#2E2A25",
      padding: 14,
      fontSize: 15,
      outline: "none",
      boxSizing: "border-box",
      marginBottom: 14,
    },
    crisisInput: {
      width: "100%",
      border: "1px solid rgba(46,42,37,.12)",
      borderRadius: 16,
      background: "#FAF6EF",
      color: "#2E2A25",
      padding: "14px 14px",
      fontSize: 15,
      outline: "none",
      boxSizing: "border-box",
      marginBottom: 20,
    },
    crisisActions: {
      display: "flex",
      flexDirection: "column",
      gap: 10,
    },
    crisisWarning: {
      marginTop: 14,
      background: "rgba(184,92,74,.08)",
      border: "1px solid rgba(184,92,74,.2)",
      color: "#B85C4A",
      padding: 16,
      borderRadius: 18,
      lineHeight: 1.5,
    },
    crisisConfirmation: {
      marginTop: 14,
      background: "rgba(125,154,137,.12)",
      border: "1px solid rgba(125,154,137,.3)",
      color: "#5F7D6C",
      padding: 16,
      borderRadius: 18,
      lineHeight: 1.5,
    },
    privacyNote: {
      marginBottom: 20,
      background: "rgba(125,154,137,.08)",
      border: "1px solid rgba(125,154,137,.2)",
      color: "#5F7D6C",
      padding: 14,
      borderRadius: 16,
      fontSize: 14,
      lineHeight: 1.5,
    },
    toast: {
      position: "fixed",
      bottom: 24,
      left: "50%",
      transform: "translateX(-50%)",
      zIndex: 2000,
      padding: "14px 24px",
      borderRadius: 16,
      fontWeight: 600,
      fontSize: 15,
      boxShadow: "0 4px 20px rgba(46,42,37,.12)",
      animation: "toastIn 0.3s ease",
      textAlign: "center",
      maxWidth: "calc(100vw - 40px)",
    },
    toastSuccess: {
      background: "#E2EBE4",
      border: "1px solid rgba(125,154,137,.4)",
      color: "#2E2A25",
    },
    toastError: {
      background: "rgba(184,92,74,.1)",
      border: "1px solid rgba(184,92,74,.3)",
      color: "#B85C4A",
    },
    answerInput: {
      width: "100%",
      minHeight: 80,
      resize: "vertical",
      border: "1px solid rgba(46,42,37,.12)",
      borderRadius: 16,
      background: "#FAF6EF",
      color: "#2E2A25",
      padding: 14,
      fontSize: 15,
      outline: "none",
      boxSizing: "border-box",
    },
  };

  if (isAdminPage) {
    const t = adminDarkMode
      ? { bg: "#050817", text: "white", cardBg: "rgba(255,255,255,.03)", cardBorder: "rgba(255,255,255,.08)",
          border: "rgba(255,255,255,.12)", tabBg: "rgba(255,255,255,.06)", tabActive: "white", tabActiveText: "#020617",
          inputBg: "rgba(2,6,23,.55)", inputBorder: "rgba(255,255,255,.12)", inputText: "white",
          accent: "#7bc0e8", muted: "#94a3b8", secondary: "#16213e", secondaryBorder: "#2a3a5c",
          success: "#bbf7d0", error: "#fecaca", highlight: "rgba(59,130,246,.15)",
          badgeApproved: "#14532d", badgeApprovedText: "#bbf7d0",
          badgeRejected: "#7f1d1d", badgeRejectedText: "#fecaca",
          badgePending: "#1e3a5f", badgePendingText: "#93c5fd",
          danger: "#ef4444", dangerBg: "rgba(239,68,68,.1)",
          crisisCard: "rgba(255,255,255,.04)", crisisText: "#e2e8f0", crisisMuted: "#64748b",
          crisisBorder: "rgba(255,255,255,.1)", crisisAccent: "#a5b4fc",
          cardLabel: "#64748b", cardValue: "#e2e8f0",
          filterBg: "rgba(255,255,255,.06)", filterText: "white", filterBorder: "rgba(255,255,255,.12)",
          jsonlBtn: "#16213e", jsonlBtnBorder: "#2a3a5c", jsonlBtnText: "#7bc0e8",
          badgeInProgress: "rgba(59,130,246,.2)", badgeInProgressText: "#93c5fd",
          badgeClosed: "rgba(34,197,94,.2)", badgeClosedText: "#bbf7d0",
          badgeFalseAlarm: "rgba(100,116,139,.2)", badgeFalseAlarmText: "#cbd5e1",
          badgeNew: "rgba(220,38,38,.2)", badgeNewText: "#fecaca",
          badgeHighRisk: "rgba(220,38,38,.2)", badgeHighRiskText: "#fecaca",
          riskMarker: "#fca5a5", riskMarkerBg: "rgba(220,38,38,.15)",
          crisisActionPrimary: "rgba(59,130,246,.2)", crisisActionPrimaryText: "#93c5fd",
          crisisActionSuccess: "rgba(34,197,94,.2)", crisisActionSuccessText: "#bbf7d0",
          crisisActionNeutral: "rgba(100,116,139,.2)", crisisActionNeutralText: "#cbd5e1",
          crisisActionJsonl: "rgba(255,255,255,.06)", crisisActionJsonlText: "#94a3b8",
          crisisActionJsonlBorder: "rgba(255,255,255,.12)",
        }
      : { bg: "#f3f1ec", text: "#1a1a1a", cardBg: "#ffffff", cardBorder: "#dcd8d0",
          border: "#d4cec4", tabBg: "#e6e2da", tabActive: "#2e2a25", tabActiveText: "#ffffff",
          inputBg: "#ffffff", inputBorder: "#d4cec4", inputText: "#1a1a1a",
          accent: "#2563eb", muted: "#6b7280", secondary: "#e8e4dc", secondaryBorder: "#d4cec4",
          success: "#166534", error: "#991b1b", highlight: "rgba(37,99,235,.08)",
          badgeApproved: "#dcfce7", badgeApprovedText: "#166534",
          badgeRejected: "#fee2e2", badgeRejectedText: "#991b1b",
          badgePending: "#dbeafe", badgePendingText: "#1e40af",
          danger: "#dc2626", dangerBg: "rgba(220,38,38,.06)",
          crisisCard: "#ffffff", crisisText: "#374151", crisisMuted: "#6b7280",
          crisisBorder: "#dcd8d0", crisisAccent: "#4f46e5",
          cardLabel: "#6b7280", cardValue: "#1a1a1a",
          filterBg: "#ffffff", filterText: "#1a1a1a", filterBorder: "#d4cec4",
          jsonlBtn: "#e8e4dc", jsonlBtnBorder: "#d4cec4", jsonlBtnText: "#2563eb",
          badgeInProgress: "#dbeafe", badgeInProgressText: "#1e40af",
          badgeClosed: "#dcfce7", badgeClosedText: "#166534",
          badgeFalseAlarm: "#f3f4f6", badgeFalseAlarmText: "#6b7280",
          badgeNew: "#fee2e2", badgeNewText: "#991b1b",
          badgeHighRisk: "#fee2e2", badgeHighRiskText: "#991b1b",
          riskMarker: "#fca5a5", riskMarkerBg: "rgba(220,38,38,.08)",
          crisisActionPrimary: "#dbeafe", crisisActionPrimaryText: "#1e40af",
          crisisActionSuccess: "#dcfce7", crisisActionSuccessText: "#166534",
          crisisActionNeutral: "#f3f4f6", crisisActionNeutralText: "#6b7280",
          crisisActionJsonl: "#f3f4f6", crisisActionJsonlText: "#6b7280",
          crisisActionJsonlBorder: "#d4cec4",
        };

    const detailQualityInsightView = (d, t) => {
      return (
        <div style={{ marginTop: 16, borderTop: `1px solid ${t.cardBorder}`, paddingTop: 16 }}>
          {/* Summary */}
          {d.summary && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: t.cardLabel, fontSize: 11, fontWeight: 700, marginBottom: 6, textTransform: "uppercase" }}>Общий вывод</div>
              <div style={{ color: t.crisisText, fontSize: 13, lineHeight: 1.6 }}>{d.summary}</div>
            </div>
          )}

          {/* Strengths */}
          {d.strengths && d.strengths.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: t.success, fontSize: 11, fontWeight: 700, marginBottom: 8, textTransform: "uppercase" }}>Что работает хорошо</div>
              {d.strengths.map((item, i) => (
                <div key={i} style={{ padding: "8px 12px", border: `1px solid ${t.cardBorder}`, borderRadius: 8, marginBottom: 6, background: t.highlight }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: t.crisisText }}>{item.title}</div>
                  {item.case_count && <div style={{ fontSize: 11, color: t.muted, marginTop: 2 }}>Кейсов: {item.case_count}</div>}
                  {item.description && <div style={{ fontSize: 12, color: t.crisisText, marginTop: 4 }}>{item.description}</div>}
                </div>
              ))}
            </div>
          )}

          {/* Recurring Problems */}
          {d.recurring_problems && d.recurring_problems.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: t.error, fontSize: 11, fontWeight: 700, marginBottom: 8, textTransform: "uppercase" }}>Повторяющиеся проблемы</div>
              {d.recurring_problems.map((item, i) => (
                <div key={i} style={{ padding: "8px 12px", border: `1px solid ${t.error}`, borderRadius: 8, marginBottom: 6, background: t.dangerBg }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: t.crisisText }}>{item.title}</span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                      background: item.severity === "critical" ? t.badgeNew
                        : item.severity === "high" ? t.badgeHighRisk
                        : item.severity === "medium" ? t.badgePending
                        : t.badgeFalseAlarm,
                      color: item.severity === "critical" ? t.badgeNewText
                        : item.severity === "high" ? t.badgeHighRiskText
                        : item.severity === "medium" ? t.badgePendingText
                        : t.badgeFalseAlarmText,
                    }}>
                      {QUALITY_SEVERITY_LABELS[item.severity] || item.severity || "—"}
                    </span>
                  </div>
                  {item.case_count && <div style={{ fontSize: 11, color: t.muted, marginTop: 2 }}>Кейсов: {item.case_count}</div>}
                  {item.description && <div style={{ fontSize: 12, color: t.crisisText, marginTop: 4 }}>{item.description}</div>}
                </div>
              ))}
            </div>
          )}

          {/* Safety Findings */}
          {d.safety_findings && d.safety_findings.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: t.danger, fontSize: 11, fontWeight: 700, marginBottom: 8, textTransform: "uppercase" }}>Безопасность</div>
              {d.safety_findings.map((item, i) => (
                <div key={i} style={{ padding: "8px 12px", border: `1px solid ${t.danger}`, borderRadius: 8, marginBottom: 6, background: t.dangerBg }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: t.crisisText }}>{item.title || item}</div>
                  {item.description && <div style={{ fontSize: 12, color: t.crisisText, marginTop: 4 }}>{item.description}</div>}
                </div>
              ))}
            </div>
          )}

          {/* Missed Domains */}
          {d.missed_domains && d.missed_domains.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: t.error, fontSize: 11, fontWeight: 700, marginBottom: 8, textTransform: "uppercase" }}>Пропущенные домены</div>
              {d.missed_domains.map((item, i) => (
                <div key={i} style={{ padding: "8px 12px", border: `1px solid ${t.cardBorder}`, borderRadius: 8, marginBottom: 6 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: t.crisisText }}>{item.title || item}</div>
                  {item.description && <div style={{ fontSize: 12, color: t.crisisText, marginTop: 4 }}>{item.description}</div>}
                </div>
              ))}
            </div>
          )}

          {/* Language Findings */}
          {d.language_findings && d.language_findings.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: t.accent, fontSize: 11, fontWeight: 700, marginBottom: 8, textTransform: "uppercase" }}>Язык и стиль</div>
              {d.language_findings.map((item, i) => (
                <div key={i} style={{ padding: "8px 12px", border: `1px solid ${t.cardBorder}`, borderRadius: 8, marginBottom: 6 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: t.crisisText }}>{item.title || item}</div>
                  {item.description && <div style={{ fontSize: 12, color: t.crisisText, marginTop: 4 }}>{item.description}</div>}
                </div>
              ))}
            </div>
          )}

          {/* Recommendations */}
          {d.recommendations && d.recommendations.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: t.accent, fontSize: 11, fontWeight: 700, marginBottom: 8, textTransform: "uppercase" }}>Предлагаемые изменения</div>
              {d.recommendations.map((item, i) => (
                <div key={i} style={{ padding: "8px 12px", border: `1px solid ${t.cardBorder}`, borderRadius: 8, marginBottom: 6 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: t.crisisText }}>{item.title}</span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                      background: item.priority === "critical" || item.priority === "high" ? t.badgeNew : t.badgePending,
                      color: item.priority === "critical" || item.priority === "high" ? t.badgeNewText : t.badgePendingText,
                    }}>
                      {item.priority || "—"}
                    </span>
                  </div>
                  {item.case_count && <div style={{ fontSize: 11, color: t.muted, marginTop: 2 }}>Кейсов: {item.case_count}</div>}
                  {item.reason && <div style={{ fontSize: 12, color: t.crisisText, marginTop: 4 }}>{item.reason}</div>}
                  {item.suggested_change && (
                    <div style={{ fontSize: 12, color: t.crisisText, marginTop: 4, padding: "6px 8px", background: t.highlight, borderRadius: 6 }}>
                      <span style={{ fontWeight: 600 }}>Изменение:</span> {item.suggested_change}
                    </div>
                  )}
                  {item.target_file && <div style={{ fontSize: 11, color: t.muted, marginTop: 2 }}>Файл: {item.target_file}</div>}
                  {item.risk_of_change && <div style={{ fontSize: 11, color: t.muted }}>Риск: {item.risk_of_change}</div>}
                </div>
              ))}
            </div>
          )}

          {/* Risk Assessment */}
          {d.risk_of_changes && (
            <div style={{ marginBottom: 16, padding: "8px 12px", border: `1px solid ${t.cardBorder}`, borderRadius: 8 }}>
              <div style={{ color: t.cardLabel, fontSize: 11, fontWeight: 700, marginBottom: 4, textTransform: "uppercase" }}>Риски изменений</div>
              <div style={{ fontSize: 13, color: t.crisisText }}>{d.risk_of_changes}</div>
            </div>
          )}

          {/* Regression Tests */}
          {d.regression_tests && d.regression_tests.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: t.muted, fontSize: 11, fontWeight: 700, marginBottom: 8, textTransform: "uppercase" }}>Регрессионные тесты</div>
              {d.regression_tests.map((item, i) => (
                <div key={i} style={{ padding: "8px 12px", border: `1px solid ${t.cardBorder}`, borderRadius: 8, marginBottom: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: 12, color: t.crisisText }}>{item.scenario}</div>
                  {item.expected_behavior && <div style={{ fontSize: 12, color: t.muted, marginTop: 2 }}>Ожидается: {item.expected_behavior}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    };

    const renderReviewSections = (review, json, t, data) => {
      const { patientText, userReport, doctorReport, doctorFeedbackComment, conversationHistory: rounds } = data;
        const sections = [
        {
          key: "patient",
          label: "Текст пациента",
          hasData: !!patientText,
          summary: shortText(patientText, 200),
          fullContent: patientText,
          noDataMessage: null,
        },
        {
          key: "dialogue",
          label: "Диалог с системой",
          hasData: rounds.length > 0 || (Array.isArray(json.questions) && json.questions.length > 0),
          summary: rounds.length > 0
            ? `Раундов: ${rounds.length}`
            : Array.isArray(json.questions) ? `Вопросов: ${json.questions.length}` : "",
          fullContent: null,
          isDialogue: true,
          noDataMessage: "Текст диалога не был сохранён",
        },
        {
          key: "userReport",
          label: "Отчёт для пациента",
          hasData: !!userReport,
          summary: shortText(userReport, 200),
          fullContent: userReport,
          noDataMessage: "Отчёт для пациента не был сохранён",
        },
        {
          key: "doctorReport",
          label: "Отчёт для специалиста",
          hasData: !!doctorReport,
          summary: shortText(doctorReport, 200),
          fullContent: doctorReport,
          noDataMessage: "Отчёт для специалиста не был сохранён",
        },
        {
          key: "feedback",
          label: "Отзыв специалиста",
          hasData: !!doctorFeedbackComment || Object.keys(data.doctorFeedback || {}).length > 0,
          summary: doctorFeedbackComment
            ? shortText(doctorFeedbackComment, 200)
            : Object.keys(data.doctorFeedback || {}).length > 0 ? "Есть данные обратной связи" : "",
          fullContent: null,
          isFeedback: true,
          feedbackData: data.doctorFeedback,
          noDataMessage: null,
        },
      ];

      return (
        <div style={{ marginBottom: 12 }}>
          {sections.map((sec) => {
            const open = isSectionOpen(review.id, sec.key);
            const canOpen = sec.hasData || sec.isDialogue;
            return (
              <div key={sec.key} style={{ marginBottom: 8, border: `1px solid ${t.cardBorder}`, borderRadius: 12, overflow: "hidden" }}>
                <div
                  onClick={() => canOpen && toggleSection(review.id, sec.key)}
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "10px 14px", cursor: canOpen ? "pointer" : "default",
                    background: open ? t.highlight : "transparent",
                    userSelect: "none",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: canOpen ? t.crisisText : t.muted }}>
                      {sec.label}
                    </span>
                    {!open && sec.hasData && sec.summary && (
                      <span style={{ color: t.cardLabel, fontSize: 12, marginLeft: 8, maxWidth: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {sec.summary}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {!canOpen && <span style={{ color: t.muted, fontSize: 11 }}>{sec.noDataMessage || "Нет сохранённых данных"}</span>}
                    {canOpen && <span style={{ color: t.cardLabel, fontSize: 11, transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }}>▾</span>}
                  </div>
                </div>

                {open && canOpen && (
                  <div style={{ borderTop: `1px solid ${t.cardBorder}`, padding: "12px 14px" }}>
                    {sec.isDialogue ? renderDialogueContent(review, json, t, rounds)
                      : sec.isFeedback ? renderFeedbackContent(review, json, t, data.doctorFeedback, doctorFeedbackComment)
                      : renderTextContent(review, sec, t)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
    };

    const renderTextContent = (review, sec, t) => {
      const text = sec.fullContent || "";
      return (
        <div>
          <div style={{ color: t.crisisText, fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 300, overflowY: "auto" }}>
            {sec.isDialogue ? null : text}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            {text.length > 250 && (
              <button onClick={() => openModal(sec.label, text)} style={{ border: `1px solid ${t.border}`, borderRadius: 8, background: t.tabBg, color: t.text, padding: "6px 12px", fontWeight: 600, fontSize: 11, cursor: "pointer" }}>
                Открыть в большом окне
              </button>
            )}
            {text && (
              <button onClick={() => { navigator.clipboard.writeText(text); showToast("Скопировано"); }} style={{ border: `1px solid ${t.border}`, borderRadius: 8, background: t.tabBg, color: t.text, padding: "6px 12px", fontWeight: 600, fontSize: 11, cursor: "pointer" }}>
                Скопировать
              </button>
            )}
          </div>
        </div>
      );
    };

    const renderDialogueContent = (review, json, t, rounds) => {
      const items = rounds.length > 0 ? rounds : normalizeConversationHistory([], json).rounds;

      const fullText = renderRoundsToText(items);

      return (
        <div>
          {items.length === 0 ? (
            <div style={{ color: t.muted, fontSize: 13 }}>Нет сохранённых данных диалога</div>
          ) : (
            <div style={{ maxHeight: 400, overflowY: "auto" }}>
              {items.map((rnd) => (
                <div key={rnd.round} style={{ marginBottom: 14 }}>
                  <div style={{
                    background: t.cardLabel, color: "white", fontSize: 11, fontWeight: 700,
                    padding: "4px 12px", marginBottom: 8, borderRadius: 4,
                  }}>
                    Раунд {rnd.round}
                  </div>
                  <div style={{
                    marginBottom: 6, padding: "10px 12px",
                    background: "transparent",
                    borderLeft: `3px solid ${t.muted}`,
                    borderRadius: "0 8px 8px 0",
                  }}>
                    <div style={{ fontWeight: 700, fontSize: 12, color: t.muted, marginBottom: 4 }}>Точка опоры</div>
                    <div style={{ color: t.crisisText, fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {rnd.question}
                    </div>
                  </div>
                  <div style={{
                    padding: "10px 12px",
                    background: t.highlight,
                    borderLeft: `3px solid ${t.accent}`,
                    borderRadius: "0 8px 8px 0",
                  }}>
                    <div style={{ fontWeight: 700, fontSize: 12, color: t.accent, marginBottom: 4 }}>Пациент</div>
                    <div style={{ color: t.crisisText, fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {rnd.answer}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    };

    function renderRoundsToText(rounds) {
      return rounds.map((r) => {
        const lines = [];
        lines.push(`[Точка опоры] (раунд ${r.round})`);
        lines.push(r.question);
        lines.push(`[Пациент] (раунд ${r.round})`);
        lines.push(r.answer);
        return lines.join("\n");
      }).join("\n\n---\n\n");
    }

    const renderFeedbackContent = (review, json, t, feedback, feedbackComment) => {
      const df = feedback || {};
      const items = [];
      if (df.wrong_questions) items.push({ label: "Неверные вопросы", value: df.wrong_questions });
      if (df.missing_questions) items.push({ label: "Пропущенные вопросы", value: df.missing_questions });
      if (df.bad_question_wording) items.push({ label: "Некорректные формулировки", value: df.bad_question_wording });
      if (df.corrected_user_report) items.push({ label: "Скорректированный отчёт (пациент)", value: df.corrected_user_report });
      if (df.corrected_doctor_report) items.push({ label: "Скорректированный отчёт (специалист)", value: df.corrected_doctor_report });
      if (df.protocol_update) items.push({ label: "Обновление протокола", value: df.protocol_update });
      if (df.correction_comment) items.push({ label: "Комментарий к правке", value: df.correction_comment });
      if (df.generalComment) items.push({ label: "Общий комментарий", value: df.generalComment });
      if (review?.correction_comment) items.push({ label: "Комментарий администратора", value: review.correction_comment });

      if (items.length === 0 && !feedbackComment) {
        return <div style={{ color: t.muted, fontSize: 13 }}>Нет сохранённых данных обратной связи</div>;
      }

      const fullText = items.map((i) => `${i.label}:\n${i.value}`).join("\n\n---\n\n");

      return (
        <div>
          {feedbackComment && (
            <div style={{ color: t.crisisText, fontSize: 13, lineHeight: 1.6, marginBottom: 8, fontStyle: "italic" }}>{feedbackComment}</div>
          )}
          {items.length > 0 && (
            <div style={{ maxHeight: 400, overflowY: "auto" }}>
              {items.map((item, i) => (
                <div key={i} style={{ marginBottom: 10, padding: "8px 10px", border: `1px solid ${t.cardBorder}`, borderRadius: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: t.cardLabel, marginBottom: 4 }}>{item.label}</div>
                  <div style={{ color: t.crisisText, fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{item.value}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            {items.length > 0 && (
              <button onClick={() => openModal("Отзыв специалиста", fullText)} style={{ border: `1px solid ${t.border}`, borderRadius: 8, background: t.tabBg, color: t.text, padding: "6px 12px", fontWeight: 600, fontSize: 11, cursor: "pointer" }}>
                Открыть в большом окне
              </button>
            )}
            {fullText && (
              <button onClick={() => { navigator.clipboard.writeText(fullText); showToast("Скопировано"); }} style={{ border: `1px solid ${t.border}`, borderRadius: 8, background: t.tabBg, color: t.text, padding: "6px 12px", fontWeight: 600, fontSize: 11, cursor: "pointer" }}>
                Скопировать
              </button>
            )}
          </div>
        </div>
      );
    };

    function formatConversationForCopy(rounds) {
      return renderRoundsToText(rounds || []);
    }

    function formatAnonymizedSession(sd) {
      if (!sd) return "";
      const parts = [];
      const { rounds } = normalizeConversationHistory(sd.conversation_history || []);
      parts.push(`Первичное обращение:\n${sd.patient_text || "—"}`);
      parts.push(`Диалог:\n${rounds.length > 0 ? formatConversationForCopy(rounds) : "Текст диалога не был сохранён"}`);
      parts.push(`Отчёт для пациента:\n${sd.user_report || "Отчёт для пациента не был сохранён"}`);
      parts.push(`Отчёт для специалиста:\n${sd.doctor_report || "Отчёт для специалиста не был сохранён"}`);
      if (sd.correction_comment) parts.push(`Экспертная правка:\n${sd.correction_comment}`);
      const tr = sd.training;
      if (tr) {
        const tlines = [];
        if (tr.scenario_played) tlines.push(`Сценарий: ${tr.scenario_played}`);
        if (tr.expected_case_type) tlines.push(`Ожидаемый тип: ${tr.expected_case_type}`);
        if (tr.ai_detected_case_type) tlines.push(`Распознано: ${tr.ai_detected_case_type}`);
        if (tr.expert_comment) tlines.push(`Комментарий: ${tr.expert_comment}`);
        parts.push(`Оценка тренировки:\n${tlines.join("\n")}`);
      }
      return parts.join("\n\n=====\n\n");
    }

    async function copyToClipboard(text, successMessage) {
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        showToast(successMessage || "Скопировано");
      } catch {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); showToast(successMessage || "Скопировано"); } catch {}
        ta.remove();
      }
    }

    const renderSessionTimelineDetail = (sd, t) => {
      if (!sd) return null;

      const { rounds } = normalizeConversationHistory(sd.conversation_history || []);

      const dialogueText = formatConversationForCopy(rounds);

      const sections = [];

      const addSection = (key, label, content, defaultOpen) => {
        const open = defaultOpen && !!content;
        sections.push(
          <div key={key} style={{ marginBottom: 8, border: `1px solid ${t.cardBorder}`, borderRadius: 12, overflow: "hidden" }}>
            <div
              onClick={() => {
                if (!content) return;
                const k = `tl-${key}`;
                setExpandedSections((prev) => ({ ...prev, [k]: !prev[k] }));
              }}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "10px 14px", cursor: content ? "pointer" : "default",
                background: open ? t.highlight : "transparent",
                userSelect: "none",
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 13, color: content ? t.crisisText : t.muted }}>
                {label}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {!content && <span style={{ color: t.muted, fontSize: 11 }}>Нет сохранённых данных</span>}
                {content && <span style={{ color: t.cardLabel, fontSize: 11, transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }}>▾</span>}
              </div>
            </div>
            {open && content && (
              <div style={{ borderTop: `1px solid ${t.cardBorder}`, padding: "12px 14px" }}>
                <div style={{ color: t.crisisText, fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 400, overflowY: "auto" }}>
                  {content}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  {content.length > 250 && (
                    <button
                      onClick={() => setTimelineLargeSection({ title: label, content })}
                      style={{ border: `1px solid ${t.border}`, borderRadius: 8, background: t.tabBg, color: t.text, padding: "6px 12px", fontWeight: 600, fontSize: 11, cursor: "pointer" }}
                    >
                      Открыть в большом окне
                    </button>
                  )}
                  <button
                    onClick={() => copyToClipboard(content, `${label} скопирован`)}
                    style={{ border: `1px solid ${t.border}`, borderRadius: 8, background: t.tabBg, color: t.text, padding: "6px 12px", fontWeight: 600, fontSize: 11, cursor: "pointer" }}
                  >
                    Скопировать
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      };

      // 1. Patient text
      addSection("patient", "Первичное обращение", sd.patient_text, true);

      // 2. Dialogue
      sections.push(
        <div key="dialogue" style={{ marginBottom: 8, border: `1px solid ${t.cardBorder}`, borderRadius: 12, overflow: "hidden" }}>
          <div
            onClick={() => {
              if (rounds.length === 0) return;
              const k = "tl-dialogue";
              setExpandedSections((prev) => ({ ...prev, [k]: !prev[k] }));
            }}
            style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "10px 14px", cursor: rounds.length > 0 ? "pointer" : "default",
              background: t.highlight,
              userSelect: "none",
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 13, color: rounds.length > 0 ? t.crisisText : t.muted }}>
              Диалог с системой
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {rounds.length === 0 && (
                <span style={{ color: t.muted, fontSize: 11 }}>Нет сохранённых данных</span>
              )}
              {rounds.length > 0 && (
                <span style={{ color: t.cardLabel, fontSize: 11, transform: "rotate(180deg)", transition: "transform .2s" }}>▾</span>
              )}
            </div>
          </div>
          {rounds.length > 0 && (
            <div style={{ borderTop: `1px solid ${t.cardBorder}`, padding: "12px 14px" }}>
              <div style={{ maxHeight: 400, overflowY: "auto" }}>
                {rounds.map((rnd) => (
                  <div key={rnd.round} style={{ marginBottom: 14 }}>
                    <div style={{
                      background: t.cardLabel, color: "white", fontSize: 11, fontWeight: 700,
                      padding: "4px 12px", marginBottom: 8, borderRadius: 4,
                    }}>
                      Раунд {rnd.round}
                    </div>
                    <div style={{
                      marginBottom: 6, padding: "10px 12px",
                      background: "transparent",
                      borderLeft: `3px solid ${t.muted}`,
                      borderRadius: "0 8px 8px 0",
                    }}>
                      <div style={{ fontWeight: 700, fontSize: 12, color: t.muted, marginBottom: 4 }}>Точка опоры</div>
                      <div style={{ color: t.crisisText, fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {rnd.question}
                      </div>
                    </div>
                    <div style={{
                      padding: "10px 12px",
                      background: t.highlight,
                      borderLeft: `3px solid ${t.accent}`,
                      borderRadius: "0 8px 8px 0",
                    }}>
                      <div style={{ fontWeight: 700, fontSize: 12, color: t.accent, marginBottom: 4 }}>Пациент</div>
                      <div style={{ color: t.crisisText, fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {rnd.answer}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                {dialogueText && (
                  <button
                    onClick={() => setTimelineLargeSection({ title: "Диалог с системой", content: dialogueText })}
                    style={{ border: `1px solid ${t.border}`, borderRadius: 8, background: t.tabBg, color: t.text, padding: "6px 12px", fontWeight: 600, fontSize: 11, cursor: "pointer" }}
                  >
                    Открыть в большом окне
                  </button>
                )}
                {dialogueText && (
                  <button
                    onClick={() => copyToClipboard(dialogueText, "Диалог скопирован")}
                    style={{ border: `1px solid ${t.border}`, borderRadius: 8, background: t.tabBg, color: t.text, padding: "6px 12px", fontWeight: 600, fontSize: 11, cursor: "pointer" }}
                  >
                    Скопировать диалог
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      );

      // 3-10: sections using addSection
      addSection("user_report", "Отчёт для пациента", sd.user_report || "Отчёт для пациента не был сохранён", !!sd.user_report);
      if (sd.doctor_correction?.corrected_user_report) {
        addSection("corrected_user", "Исправленная версия (пациент)", sd.corrected_user_report, false);
      }

      addSection("doctor_report", "Отчёт для специалиста", sd.doctor_report || "Отчёт для специалиста не был сохранён", !!sd.doctor_report);
      if (sd.doctor_correction?.corrected_doctor_report) {
        addSection("corrected_doctor", "Исправленная версия (специалист)", sd.corrected_doctor_report, false);
      }

      const df = sd.doctor_feedback || {};
      const feedbackItems = [];
      if (df.wrong_questions) feedbackItems.push({ label: "Неверные вопросы", value: df.wrong_questions });
      if (df.missing_questions) feedbackItems.push({ label: "Пропущенные вопросы", value: df.missing_questions });
      if (df.bad_question_wording) feedbackItems.push({ label: "Некорректные формулировки", value: df.bad_question_wording });
      if (df.generalComment) feedbackItems.push({ label: "Общий комментарий", value: df.generalComment });
      const feedbackText = feedbackItems.map((i) => `${i.label}:\n${i.value}`).join("\n\n---\n\n");
      addSection("feedback", "Отзыв специалиста", feedbackText || df.correction_comment || "", false);

      const correctionParts = [];
      if (sd.correction_comment) correctionParts.push(`Комментарий к правке:\n${sd.correction_comment}`);
      if (sd.protocol_update) correctionParts.push(`Обновление протокола:\n${sd.protocol_update}`);
      if (sd.doctor_correction?.wrong_questions) correctionParts.push(`Неверные вопросы:\n${sd.doctor_correction.wrong_questions}`);
      if (sd.doctor_correction?.missing_questions) correctionParts.push(`Пропущенные вопросы:\n${sd.doctor_correction.missing_questions}`);
      if (sd.doctor_correction?.bad_question_wording) correctionParts.push(`Некорректные формулировки:\n${sd.doctor_correction.bad_question_wording}`);
      addSection("expert_correction", "Экспертная правка", correctionParts.join("\n\n---\n\n"), false);

      const diaryStr = sd.diary
        ? (typeof sd.diary === "string" ? sd.diary : JSON.stringify(sd.diary, null, 2))
        : "";
      addSection("diary", "Дневник состояния", diaryStr, false);

      const spStr = sd.support_plan
        ? (typeof sd.support_plan === "string" ? sd.support_plan : JSON.stringify(sd.support_plan, null, 2))
        : "";
      addSection("support_plan", "Выбранные практики", spStr, false);

      addSection("continuation", "Комментарий по продолжению", sd.continuation_comment, false);

      const tr = sd.training;
      if (tr) {
        const trainingLines = [];
        if (tr.scenario_played) trainingLines.push(`Сценарий: ${tr.scenario_played}`);
        if (tr.expected_case_type) trainingLines.push(`Ожидаемый тип случая: ${tr.expected_case_type}`);
        if (tr.ai_detected_case_type) trainingLines.push(`Что распознала система: ${tr.ai_detected_case_type}`);
        if (tr.ai_detected_secondary_types && tr.ai_detected_secondary_types.length > 0) {
          trainingLines.push(`Вторичные признаки: ${tr.ai_detected_secondary_types.join(", ")}`);
        }
        const qualityFields = [
          ["detection_quality", "Распознавание"],
          ["questions_quality", "Вопросы"],
          ["report_quality", "Отчёт"],
          ["safety_quality", "Safety"],
          ["language_quality", "Язык"],
          ["support_toolkit_quality", "Практики"],
          ["continuation_quality", "Продолжение"],
        ];
        for (const [key, label] of qualityFields) {
          if (tr[key] !== null && tr[key] !== undefined) {
            trainingLines.push(`${label}: ${tr[key]}`);
          }
        }
        const flagFields = [
          ["repeated_questions", "Повторы"],
          ["missed_risk_flags", "Пропущены риски"],
          ["wrong_recommendation", "Неверная рекомендация"],
          ["remembered_context", "Учтён контекст"],
        ];
        for (const [key, label] of flagFields) {
          if (tr[key]) trainingLines.push(`⚠️ ${label}`);
        }
        if (tr.expert_comment) trainingLines.push(`\nКомментарий эксперта:\n${tr.expert_comment}`);
        if (tr.missed_domain) trainingLines.push(`Пропущенная область: ${tr.missed_domain}`);
        if (tr.action_needed) trainingLines.push(`Что исправить: ${tr.action_needed}`);
        addSection("training", "Оценка тренировочной сессии", trainingLines.join("\n"), false);
      }

      // Voice observations block
      const vo = sd.voice_observations || sd.json_data?.voice_observations || null;
      if (vo) {
        const voList = Array.isArray(vo) ? vo : [vo];
        const voiceContent = voList.map((v, vi) => {
          const a = v.analysis || v;
          if (a.status === "insufficient_audio") {
            return `Сообщение ${vi + 1}: Качество записи недостаточно для надёжного описания особенностей речи.`;
          }
          if (a.status === "error" || a.status === "not_available") {
            return null;
          }
          const lines = [];
          if (a.summary) lines.push(a.summary);
          if (a.alternative_explanations?.length) {
            lines.push(`\nВозможные альтернативные объяснения:\n${a.alternative_explanations.map((e) => `- ${e}`).join("\n")}`);
          }
          if (a.suggested_followups?.length) {
            lines.push(`\nЧто стоит уточнить:\n${a.suggested_followups.map((f) => `- ${f}`).join("\n")}`);
          }
          if (a.limitations?.length) {
            lines.push(`\nОграничение:\n${a.limitations.map((l) => `- ${l}`).join("\n")}`);
          }
          return lines.join("\n");
        }).filter(Boolean).join("\n\n---\n\n");

        const voiceLabel = voList.length > 1
          ? "Голосовые признаки"
          : (voList[0]?.analysis?.status === "insufficient_audio" || voList[0]?.status === "insufficient_audio"
              ? "Голосовые признаки — качество записи недостаточно"
              : "Голосовые признаки");

        sections.push(
          <div key="voice" style={{ marginBottom: 8, border: `1px solid ${t.cardBorder}`, borderRadius: 12, overflow: "hidden" }}>
            <div
              onClick={() => {
                const k = "tl-voice";
                setExpandedSections((prev) => ({ ...prev, [k]: !prev[k] }));
              }}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "10px 14px", cursor: "pointer",
                background: t.highlight,
                userSelect: "none",
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 13, color: t.crisisText }}>
                {voiceLabel}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: t.muted, fontSize: 10, border: `1px solid ${t.muted}`, borderRadius: 4, padding: "1px 5px" }}>
                  Экспериментально
                </span>
                <span style={{ color: t.cardLabel, fontSize: 11, transform: expandedSections["tl-voice"] ? "rotate(180deg)" : "none", transition: "transform .2s" }}>▾</span>
              </div>
            </div>
            {expandedSections["tl-voice"] && voiceContent && (
              <div style={{ borderTop: `1px solid ${t.cardBorder}`, padding: "12px 14px" }}>
                <div style={{ color: t.crisisText, fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 400, overflowY: "auto" }}>
                  {voiceContent}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button
                    onClick={() => copyToClipboard(voiceContent, "Голосовые признаки скопированы")}
                    style={{ border: `1px solid ${t.border}`, borderRadius: 8, background: t.tabBg, color: t.text, padding: "6px 12px", fontWeight: 600, fontSize: 11, cursor: "pointer" }}
                  >
                    Скопировать
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      }

      // Care recommendation section
      const storedCareRec = sd.json_data?.care_recommendation || null;
      if (storedCareRec && storedCareRec.level) {
        const levelLabel = { self_support: "Самоподдержка", professional_contact: "Обращение к специалисту", urgent_help: "Срочная помощь" };
        const timeLabel = { today: "Сегодня", within_days: "В ближайшие дни", within_weeks: "В ближайшие недели", routine: "Планово" };
        const levelColor = { self_support: "#5F7D6C", professional_contact: "#7A7268", urgent_help: "#B85C4A" };
        sections.push(
          <div key="care-rec" style={{ marginBottom: 8, border: `1px solid ${t.cardBorder}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: t.highlight, userSelect: "none" }}>
              <span style={{ fontWeight: 700, fontSize: 13, color: levelColor[storedCareRec.level] || t.crisisText }}>
                Маршрутизация: {levelLabel[storedCareRec.level] || storedCareRec.level}
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                {storedCareRec.timeframe && <span style={{ color: t.muted, fontSize: 10, border: `1px solid ${t.muted}`, borderRadius: 4, padding: "1px 5px" }}>{timeLabel[storedCareRec.timeframe] || storedCareRec.timeframe}</span>}
              </div>
            </div>
            <div style={{ borderTop: `1px solid ${t.cardBorder}`, padding: "10px 14px", fontSize: 12, lineHeight: 1.6, color: t.crisisText }}>
              {storedCareRec.specialist_types?.length > 0 && (
                <div style={{ marginBottom: 4 }}><b>Специалист:</b> {storedCareRec.specialist_types.join(", ")}</div>
              )}
              {storedCareRec.reasons?.length > 0 && (
                <div style={{ marginBottom: 4 }}><b>Причины:</b> {storedCareRec.reasons.join(", ")}</div>
              )}
              {storedCareRec.interim_support?.length > 0 && (
                <div style={{ marginBottom: 4 }}><b>Временная опора:</b>
                  <ul style={{ margin: "2px 0 0", paddingLeft: 16 }}>
                    {storedCareRec.interim_support.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              )}
              {storedCareRec.urgent_triggers?.length > 0 && (
                <div><b>Триггеры срочной помощи:</b> {storedCareRec.urgent_triggers.join(", ")}</div>
              )}
            </div>
          </div>
        );
      }

      // Debug info section (raw model response, quality check, etc.)
      const debugData = sd.json_data?._debug || null;
      if (debugData) {
        const debugLines = [];
        if (debugData.prompt_version) debugLines.push(`Prompt version: ${debugData.prompt_version}`);
        if (debugData.quality_check) {
          debugLines.push(`Quality check: ${debugData.quality_check.pass ? "✅ пройдена" : "❌ нарушена"}`);
          if (debugData.quality_check.violations?.length) {
            debugLines.push(`Нарушения: ${debugData.quality_check.violations.join("; ")}`);
          }
        }
        if (debugData.repair?.repairAttempted) {
          debugLines.push(`Repair: ${debugData.repair.repairSucceeded ? "✅ успешно" : "❌ не удался"}`);
        }
        if (debugData.raw_model_response) {
          debugLines.push(`\n--- RAW MODEL RESPONSE ---\n${debugData.raw_model_response}`);
        }

        sections.push(
          <div key="debug" style={{ marginBottom: 8, border: `1px solid ${t.cardBorder}`, borderRadius: 12, overflow: "hidden" }}>
            <div
              onClick={() => {
                const k = "tl-debug";
                setExpandedSections((prev) => ({ ...prev, [k]: !prev[k] }));
              }}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "10px 14px", cursor: "pointer",
                background: t.highlight,
                userSelect: "none",
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 13, color: t.crisisText }}>
                🛠 Техническая информация (raw model response)
              </span>
              <span style={{ color: t.cardLabel, fontSize: 11, transform: expandedSections["tl-debug"] ? "rotate(180deg)" : "none", transition: "transform .2s" }}>▾</span>
            </div>
            {expandedSections["tl-debug"] && (
              <div style={{ borderTop: `1px solid ${t.cardBorder}`, padding: "12px 14px" }}>
                <div style={{ color: t.crisisText, fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 500, overflowY: "auto" }}>
                  {debugLines.join("\n")}
                </div>
              </div>
            )}
          </div>
        );
      }

      // Large section overlay (within detail modal)
      if (timelineLargeSection) {
        return (
          <div>
            <button
              onClick={() => setTimelineLargeSection(null)}
              style={{ border: 0, background: "transparent", color: t.accent, fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0, marginBottom: 12 }}
            >
              ← Назад к сессии
            </button>
            <h4 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 700 }}>{timelineLargeSection.title}</h4>
            <div style={{
              color: t.crisisText, fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word",
              maxHeight: "calc(90vh - 280px)", overflowY: "auto", marginBottom: 12,
            }}>
              {timelineLargeSection.content}
            </div>
            <button
              onClick={() => copyToClipboard(timelineLargeSection.content, `${timelineLargeSection.title} скопирован`)}
              style={{ border: `1px solid ${t.border}`, borderRadius: 10, background: t.tabBg, color: t.text, padding: "10px 18px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
            >
              Скопировать
            </button>
          </div>
        );
      }

      return <div>{sections}</div>;
    };

    function copySessionDetails(sd) {
      if (!sd) return;
      const text = formatAnonymizedSession(sd);
      copyToClipboard(text, "Обезличенная сессия скопирована");
    }

    function Section({ title, children }) {
      return (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: t.text, marginBottom: 8, paddingBottom: 4, borderBottom: `1px solid ${t.border}` }}>
            {title}
          </div>
          {children}
        </div>
      );
    }

    function Field({ label, value, mono }) {
      if (!value || value === "—" || value === "") return null;
      return (
        <div style={{ display: "flex", gap: 8, marginBottom: 4, fontSize: 14, lineHeight: 1.6 }}>
          {label && <span style={{ color: t.muted, minWidth: 130, flexShrink: 0 }}>{label}:</span>}
          <span style={{ color: t.text, fontFamily: mono ? "monospace" : "inherit", fontWeight: mono ? 600 : 400 }}>{value}</span>
        </div>
      );
    }

    function normalizeCare(v, fallback) {
      if (v == null) return fallback || "self_care";
      if (typeof v === "object") return v.level || fallback || "self_care";
      return v;
    }

    function careLabel(level) {
      const n = normalizeCare(level);
      if (n === "urgent_help") return "Срочно";
      if (n === "medical_consultation") return "Врач";
      return "Self-care";
    }

    return (
      <AdminErrorBoundary>
      <div style={{ minHeight: "100vh", background: t.bg, color: t.text, fontFamily: "Inter, system-ui, Arial", padding: 32 }}>
        <style>{`
  * { box-sizing: border-box; }
  @keyframes toastIn {
    from { opacity: 0; transform: translateX(-50%) translateY(20px); }
    to { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
`}</style>

        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 40 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <img src="/logo-tochka-opory-header.png" alt={adminModuleRoute === "body" ? "Опора. Здоровье & Стройность" : "Точка опоры"} style={{ height: 44, width: "auto", display: "block" }} />
              <div>
                <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.2 }}>{adminModuleRoute === "body" ? "Опора. Здоровье & Стройность" : "Точка опоры"}</div>
                <div style={{ fontSize: 14, color: t.muted }}>{adminModuleRoute === "body" ? "Админ-панель / Анкеты здоровья" : adminModuleRoute === "council" ? "Админ-панель / Экспертный совет" : isTrainingPage ? "Таблица тренировок" : "Админ-панель / Отзывы о сессиях"}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                onClick={() => setAdminDarkMode(!adminDarkMode)}
                style={{
                  background: t.tabBg, color: t.text, border: `1px solid ${t.border}`,
                  padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13,
                }}
              >
                {adminDarkMode ? "☀️ Светлая" : "🌙 Тёмная"}
              </button>
              <a href={adminModuleRoute === "body" ? "https://health.tochka-opori.online" : adminModuleRoute === "council" ? "/admin" : "/"} onClick={adminModuleRoute === "council" ? (e) => { e.preventDefault(); setAdminSubPage(null); window.history.pushState({}, "", "/admin"); } : undefined} style={{ color: t.accent, fontSize: 14, textDecoration: "none" }}>← {adminModuleRoute === "council" ? "В панель администратора" : "На главную"}</a>
            </div>
          </div>

          {!adminAuthed ? (
            <div style={{ maxWidth: 400, margin: "60px auto" }}>
              <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 20 }}>Вход в админ-панель</h2>
              <input
                type="password"
                style={{
                  width: "100%", border: `1px solid ${t.inputBorder}`, borderRadius: 16,
                  background: t.inputBg, color: t.inputText, padding: "14px", fontSize: 15,
                  outline: "none", boxSizing: "border-box", marginBottom: 16,
                }}
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && adminLogin()}
                placeholder="Пароль администратора"
              />
              <button
                style={{
                  width: "100%", border: 0, borderRadius: 24, background: t.accent, color: "#fff",
                  padding: "18px 22px", fontWeight: 900, fontSize: 16, cursor: "pointer",
                }}
                onClick={adminLogin}
              >
                Войти
              </button>
            </div>
          ) : adminModuleRoute === "body" ? (
            <>
              {/* Body intake admin header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                <div><div style={{ fontSize: 22, fontWeight: 700 }}>Анкеты здоровья</div><div style={{ fontSize: 13, color: t.muted, marginTop: 2 }}>Первичные анкеты и AI-разборы клиентов</div></div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button
                    onClick={() => adminLoadBodyIntake()}
                    style={{
                      background: t.tabBg, color: t.text, border: `1px solid ${t.border}`,
                      padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13,
                    }}
                  >
                    Обновить
                  </button>
                  <a href="https://health.tochka-opori.online" style={{ color: t.accent, fontSize: 14, textDecoration: "none" }}>← На главную</a>
                </div>
              </div>

              {/* Tabs: Анкеты | Дневники | Корзина */}
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {["intake", "diary", "trash", "reviews"].map(tab => (
            <button
              key={tab}
              style={{
                border: 0, borderRadius: 14, padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer",
                background: bodyAdminTab === tab ? t.tabActive : t.tabBg,
                color: bodyAdminTab === tab ? t.tabActiveText : t.text,
              }}
              onClick={() => {
                setBodyAdminTab(tab);
                setBodyIntakeDetailOpen(false);
                setBodyDiaryDetailOpen(false);
                if (tab === "intake") { setBodyIntakeShowDeleted(false); setBodyIntakeSourceFilter("all"); adminLoadBodyIntake(); }
                else if (tab === "trash") { setBodyIntakeShowDeleted(true); setBodyIntakeSourceFilter("all"); adminLoadBodyIntake(); }
                else if (tab === "diary") { adminLoadBodyDailyLogs(); }
                else if (tab === "reviews") { adminLoadBodyExpertReviews(); }
              }}
            >
              {tab === "intake" ? "Анкеты" : tab === "diary" ? "Дневники" : tab === "trash" ? "Корзина" : "Экспертные правки"}
            </button>
          ))}
              </div>

              {/* Source filter tabs (only for intake tab) */}
              {bodyAdminTab === "intake" && (
                <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
                  {[
                    { key: "all", label: "Все" },
                    { key: "alena_client", label: "Клиенты Алены" },
                    { key: "self_signup", label: "Самостоятельные" },
                    { key: "specialist_referral", label: "По направлению" },
                    { key: "test", label: "Тестовые" },
                  ].map(f => (
                    <button
                      key={f.key}
                      style={{
                        border: 0, borderRadius: 10, padding: "5px 12px", fontWeight: 600, fontSize: 12, cursor: "pointer",
                        background: bodyIntakeSourceFilter === f.key ? t.tabActive : t.tabBg,
                        color: bodyIntakeSourceFilter === f.key ? t.tabActiveText : t.text,
                      }}
                      onClick={() => { setBodyIntakeSourceFilter(f.key); adminLoadBodyIntake(); }}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Body intake table (intake or trash tab) */}
              {(bodyAdminTab === "intake" || bodyAdminTab === "trash") && (
                bodyIntakeLoading ? (
                  <div style={{ textAlign: "center", padding: 40, color: t.muted }}>Загрузка...</div>
                ) : bodyIntakeRecords.length === 0 && !bodyIntakeShowDeleted ? (
                  <div style={{ textAlign: "center", padding: 60, color: t.muted }}>
                    <div style={{ fontSize: 18, marginBottom: 8 }}>Пока нет анкет модуля Здоровье & Стройность</div>
                    <div style={{ fontSize: 14 }}>Заполненные intake-анкеты появятся здесь.</div>
                  </div>
                ) : bodyIntakeRecords.length === 0 && bodyIntakeShowDeleted ? (
                  <div style={{ textAlign: "center", padding: 60, color: t.muted }}>
                    <div style={{ fontSize: 18, marginBottom: 8 }}>Корзина пуста</div>
                    <div style={{ fontSize: 14 }}>Удалённых анкет нет.</div>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 13, color: t.muted, marginBottom: 12 }}>
                      Всего записей: {bodyIntakeTotal}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {bodyIntakeRecords.map((rec) => {
                        const answers = rec.answers || {};
                        const client = rec.client || {};
                        const careLevel = normalizeCare(rec.care_recommendation);
                        const sourceLabel = {
                          alena_client: "Алена",
                          self_signup: "Самост.",
                          specialist_referral: "Направление",
                          test: "Тест",
                        }[rec.source] || rec.source || "—";
                        const sourceColor = {
                          alena_client: "#86a08f",
                          self_signup: "#8d8378",
                          specialist_referral: "#b8946e",
                          test: "#a0a0a0",
                        }[rec.source] || "#8d8378";
                        return (
                        <div
                          key={rec.id}
                          style={{
                            border: `1px solid ${t.cardBorder}`, borderRadius: 16, padding: "16px 20px",
                            background: t.cardBg, cursor: "pointer",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 13, color: t.muted }}>
                                {new Date(rec.created_at).toLocaleString("ru-RU")}
                              </span>
                              <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: `${sourceColor}22`, color: sourceColor }}>
                                {sourceLabel}
                              </span>
                              {rec.specialist_name && (
                                <span style={{ fontSize: 12, color: t.muted, fontStyle: "italic" }}>
                                  → {rec.specialist_name}
                                </span>
                              )}
                            </div>
                            <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                              {rec.triggered_red_flags?.length > 0 && (
                                <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: "rgba(239,68,68,.2)", color: "#fca5a5" }}>
                                  {rec.triggered_red_flags.length} флаг
                                </span>
                              )}
                              {careLevel && (
                                <span style={{
                                  fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6,
                                  background: careLevel === "urgent_help" ? "rgba(239,68,68,.2)" :
                                    careLevel === "medical_consultation" ? "rgba(251,191,36,.2)" : "rgba(34,197,94,.2)",
                                  color: careLevel === "urgent_help" ? "#fca5a5" :
                                    careLevel === "medical_consultation" ? "#fde68a" : "#bbf7d0",
                                }}>
                                  {careLabel(careLevel)}
                                </span>
                              )}
                            </div>
                          </div>

                          <div style={{ fontSize: 15, fontWeight: 600, color: t.text }}>
                            {answers.display_name || client.display_name || "Без имени"}
                          </div>
                          {answers.goal && (
                            <div style={{ fontSize: 12, color: t.muted, marginTop: 1, fontStyle: "italic" }}>
                              Цель: {answers.goal}
                            </div>
                          )}

                          {rec.session_id && (
                            <div style={{ fontSize: 12, color: t.muted, marginTop: 4, fontFamily: "monospace" }}>
                              Код: {rec.session_id}
                            </div>
                          )}

                          {(rec.user_report || answers.user_report) && (
                            <div style={{ fontSize: 13, lineHeight: 1.5, color: t.text, marginTop: 6 }}>
                              {(rec.user_report || answers.user_report || "").slice(0, 200)}
                              {(rec.user_report || answers.user_report || "").length > 200 ? "..." : ""}
                            </div>
                          )}

                          {rec.deleted_at && (
                            <div style={{ fontSize: 11, color: "#ef4444", marginTop: 4 }}>
                              Удалён: {new Date(rec.deleted_at).toLocaleString("ru-RU")} ({rec.deleted_by})
                            </div>
                          )}

                          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                            <button
                              onClick={(e) => { e.stopPropagation(); adminOpenBodyIntakeDetail(rec.id); }}
                              style={{
                                background: t.accent, color: "#fff", border: 0, borderRadius: 8,
                                padding: "6px 14px", fontWeight: 600, fontSize: 12, cursor: "pointer",
                              }}
                            >
                              Открыть
                            </button>
                            {bodyIntakeShowDeleted ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); adminRestoreBodyIntake(rec.id); }}
                                style={{
                                  background: "transparent", color: t.accent, border: `1px solid ${t.accent}`, borderRadius: 8,
                                  padding: "6px 14px", fontWeight: 600, fontSize: 12, cursor: "pointer",
                                }}
                              >
                                Восстановить
                              </button>
                            ) : (
                              <button
                                onClick={(e) => { e.stopPropagation(); setBodyIntakeDeleteConfirm(rec.id); }}
                                style={{
                                  background: "transparent", color: "#ef4444", border: "1px solid #ef4444", borderRadius: 8,
                                  padding: "6px 14px", fontWeight: 600, fontSize: 12, cursor: "pointer",
                                }}
                              >
                                Удалить
                              </button>
                            )}
                            <button
                              onClick={(e) => { e.stopPropagation(); adminDownloadBodyIntakeJSON(rec); }}
                              style={{
                                background: "transparent", color: t.muted, border: `1px solid ${t.border}`, borderRadius: 8,
                                padding: "6px 14px", fontWeight: 600, fontSize: 12, cursor: "pointer",
                              }}
                            >
                              JSON
                            </button>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  </>
                )
              )}

              {/* Body daily logs table (diary tab) */}
              {bodyAdminTab === "diary" && (
                <>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
                    <input
                      type="text"
                      placeholder="Фильтр по session_id"
                      value={bodyDiarySessionFilter}
                      onChange={(e) => setBodyDiarySessionFilter(e.target.value)}
                      style={{
                        flex: 1, height: 36, padding: "0 12px", borderRadius: 8,
                        border: `1px solid ${t.border}`, background: t.inputBg, color: t.inputText,
                        fontSize: 13, outline: "none", fontFamily: "monospace",
                      }}
                    />
                    <button
                      onClick={() => adminLoadBodyDailyLogs()}
                      style={{
                        height: 36, padding: "0 14px", borderRadius: 8, border: 0,
                        background: t.tabBg, color: t.text, fontWeight: 600, fontSize: 13, cursor: "pointer",
                      }}
                    >
                      Поиск
                    </button>
                    <button
                      onClick={() => { setBodyDiarySessionFilter(""); adminLoadBodyDailyLogs(); }}
                      style={{
                        height: 36, padding: "0 14px", borderRadius: 8, border: `1px solid ${t.border}`,
                        background: "transparent", color: t.muted, fontWeight: 500, fontSize: 13, cursor: "pointer",
                      }}
                    >
                      Сбросить
                    </button>
                  </div>

                  {bodyDiaryLoading ? (
                    <div style={{ textAlign: "center", padding: 40, color: t.muted }}>Загрузка...</div>
                  ) : bodyDiaryRecords.length === 0 ? (
                    <div style={{ textAlign: "center", padding: 60, color: t.muted }}>
                      <div style={{ fontSize: 18, marginBottom: 8 }}>Дневников пока нет</div>
                      <div style={{ fontSize: 14 }}>Записи дневника появятся здесь после того, как клиенты начнут их заполнять.</div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {bodyDiaryRecords.map((rec) => (
                        <div
                          key={rec.id}
                          style={{
                            border: `1px solid ${t.cardBorder}`, borderRadius: 16, padding: "14px 18px",
                            background: t.cardBg,
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                            <div style={{ fontSize: 13, color: t.muted }}>
                              {rec.log_date} {rec.created_at ? new Date(rec.created_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : ""}
                            </div>
                            <div style={{ fontSize: 12, color: t.muted, fontFamily: "monospace" }}>
                              {rec.session_id?.slice(0, 12)}…
                            </div>
                          </div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: t.text, marginBottom: 4 }}>
                            Шаги: {rec.steps ?? "—"} | Тренировка: {rec.workout_done ? rec.workout_type || "да" : "нет"} | Калории: {rec.calories ?? "—"}
                          </div>
                          {rec.overeating_level && (
                            <div style={{ fontSize: 12, color: t.muted }}>
                              Переедание: {rec.overeating_level === "severe" ? "выраженно" : rec.overeating_level === "slight" ? "немного" : rec.overeating_level}
                              {rec.sweet_cravings ? ` | Тяга: ${rec.sweet_cravings}` : ""}
                            </div>
                          )}
                          {rec.sleep_hours && (
                            <div style={{ fontSize: 12, color: t.muted }}>
                              Сон: {rec.sleep_hours} ч | Энергия: {rec.energy_level ?? "—"}/10
                            </div>
                          )}
                          {rec.ai_day_summary && (
                            <div style={{ fontSize: 13, color: t.text, marginTop: 4, lineHeight: 1.5, fontStyle: "italic" }}>
                              {rec.ai_day_summary.slice(0, 150)}{rec.ai_day_summary.length > 150 ? "..." : ""}
                            </div>
                          )}
                          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                            <button
                              onClick={() => adminOpenBodyDailyLogDetail(rec.id)}
                              style={{
                                background: t.accent, color: "#fff", border: 0, borderRadius: 8,
                                padding: "6px 14px", fontWeight: 600, fontSize: 12, cursor: "pointer",
                              }}
                            >
                              Открыть
                            </button>
                            <button
                              onClick={() => adminDeleteBodyDailyLog(rec.id)}
                              style={{
                                background: "transparent", color: "#ef4444", border: "1px solid #ef4444", borderRadius: 8,
                                padding: "6px 14px", fontWeight: 600, fontSize: 12, cursor: "pointer",
                              }}
                            >
                              Удалить
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* Reviews tab */}
              {bodyAdminTab === "reviews" && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: t.text }}>
                      Экспертные правки ({bodyExpertReviews.length})
                    </div>
                    <button
                      onClick={adminExportBodyExpertCases}
                      disabled={bodyExportingCases}
                      style={{
                        padding: "10px 18px", borderRadius: 12, border: `1px solid ${t.border}`,
                        background: t.tabBg, color: t.text, fontWeight: 600, fontSize: 13, cursor: "pointer",
                        opacity: bodyExportingCases ? 0.5 : 1,
                      }}
                    >
                      {bodyExportingCases ? "Выгрузка..." : "Скачать кейсы (.jsonl)"}
                    </button>
                  </div>
                  {bodyExpertReviewsLoading ? (
                    <div style={{ textAlign: "center", padding: 40, color: t.muted }}>Загрузка...</div>
                  ) : bodyExpertReviews.length === 0 ? (
                    <div style={{ textAlign: "center", padding: 40, color: t.muted }}>
                      <div style={{ fontSize: 18, marginBottom: 8 }}>Экспертных правок пока нет</div>
                      <div style={{ fontSize: 13 }}>Откройте анкету или дневник и нажмите «Экспертная правка»</div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {bodyExpertReviews.map((r, i) => (
                        <div key={r.id || i} style={{
                          border: `1px solid ${t.cardBorder}`, borderRadius: 16, padding: "14px 18px",
                          background: t.cardBg,
                        }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                            <div style={{ fontSize: 13, color: t.muted }}>
                              {new Date(r.created_at).toLocaleString("ru-RU")} · {r.reviewer_name}
                            </div>
                            <div style={{ fontSize: 12, color: t.muted }}>
                              {r.target_type === "intake" ? "Анкета" : r.target_type === "daily_log" ? "Дневник" : "Тарелка"}
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12, color: t.muted, marginBottom: 4 }}>
                            <span>Безопасность: {r.rating_safety || "—"}</span>
                            <span>Полезность: {r.rating_usefulness ?? "—"}/5</span>
                            <span>Практичность: {r.rating_practicality ?? "—"}/5</span>
                            <span>Тон: {r.rating_tone ?? "—"}/5</span>
                          </div>
                          {Array.isArray(r.error_tags) && r.error_tags.length > 0 && (
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 4 }}>
                              {r.error_tags.map((tag, j) => (
                                <span key={j} style={{
                                  fontSize: 11, padding: "2px 8px", borderRadius: 6,
                                  background: "rgba(239,68,68,.1)", color: "#991b1b",
                                }}>
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                          {r.corrected_recommendation && (
                            <div style={{ fontSize: 13, color: t.text, lineHeight: 1.5, marginTop: 4, fontStyle: "italic" }}>
                              {r.corrected_recommendation.slice(0, 200)}{r.corrected_recommendation.length > 200 ? "..." : ""}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* Expert review form modal */}
              {bodyExpertReviewFormOpen && bodyExpertReviewForm && (
                <div style={{
                  position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 1100,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }} onClick={() => setBodyExpertReviewFormOpen(false)}>
                  <div style={{
                    background: "#ffffff", borderRadius: 20, padding: 28, maxWidth: 600, width: "90%",
                    maxHeight: "85vh", overflowY: "auto",
                  }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: "#2f2925" }}>
                        Экспертная правка
                      </div>
                      <button onClick={() => setBodyExpertReviewFormOpen(false)} style={{ background: "none", border: 0, fontSize: 20, cursor: "pointer", color: "#8d8378" }}>✕</button>
                    </div>

                    <div style={{ fontSize: 13, color: "#5f574f", marginBottom: 16 }}>
                      {bodyExpertReviewForm.target_type === "intake" ? "Анкета здоровья" :
                       bodyExpertReviewForm.target_type === "daily_log" ? "Дневник" : "Анализ тарелки"}
                      {" · "}
                      {bodyExpertReviewForm.session_id}
                    </div>

                    {/* Safety */}
                    <div style={{ marginBottom: 16 }}>
                      <label style={{ display: "block", fontWeight: 600, fontSize: 14, color: "#2f2925", marginBottom: 6 }}>Безопасность</label>
                      <div style={{ display: "flex", gap: 8 }}>
                        {[
                          { value: "ok", label: "Ок" },
                          { value: "questionable", label: "Спорно" },
                          { value: "dangerous", label: "Опасно" },
                        ].map(o => (
                          <button key={o.value} type="button" onClick={() => setBodyExpertReviewForm(prev => ({ ...prev, rating_safety: o.value }))} style={{
                            padding: "8px 16px", borderRadius: 10, border: bodyExpertReviewForm.rating_safety === o.value ? "2px solid #7D9A89" : "1px solid #d8cec1",
                            background: bodyExpertReviewForm.rating_safety === o.value ? "#e8f0ea" : "#ffffff",
                            color: "#2f2925", fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
                          }}>
                            {o.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Ratings */}
                    {["rating_usefulness", "rating_practicality", "rating_tone"].map((key, idx) => (
                      <div key={key} style={{ marginBottom: 14 }}>
                        <label style={{ display: "block", fontWeight: 600, fontSize: 14, color: "#2f2925", marginBottom: 4 }}>
                          {["Полезность", "Практичность", "Тон"][idx]}
                        </label>
                        <div style={{ display: "flex", gap: 6 }}>
                          {[1, 2, 3, 4, 5].map(n => (
                            <button key={n} type="button" onClick={() => setBodyExpertReviewForm(prev => ({ ...prev, [key]: n }))} style={{
                              width: 36, height: 36, borderRadius: 8,
                              border: bodyExpertReviewForm[key] === n ? "2px solid #7D9A89" : "1px solid #d8cec1",
                              background: bodyExpertReviewForm[key] === n ? "#e8f0ea" : "#ffffff",
                              color: "#2f2925", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit",
                            }}>
                              {n}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}

                    {/* Error tags */}
                    <div style={{ marginBottom: 16 }}>
                      <label style={{ display: "block", fontWeight: 600, fontSize: 14, color: "#2f2925", marginBottom: 6 }}>Ошибки</label>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {[
                          "не хватает вопросов", "слишком общий план", "неверная оценка питания",
                          "неверная оценка активности", "неверная оценка сна", "неверная оценка тарелки",
                          "нужно к врачу", "слишком жестко", "слишком мягко", "канцелярит", "другое",
                        ].map(tag => {
                          const checked = bodyExpertReviewForm.error_tags.includes(tag);
                          return (
                            <label key={tag} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14, color: "#5f574f" }}>
                              <input type="checkbox" checked={checked} onChange={() => {
                                setBodyExpertReviewForm(prev => ({
                                  ...prev,
                                  error_tags: checked
                                    ? prev.error_tags.filter(t => t !== tag)
                                    : [...prev.error_tags, tag],
                                }));
                              }} style={{ accentColor: "#86a08f", width: 18, height: 18 }} />
                              {tag}
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    {/* Text fields */}
                    {[
                      { key: "what_ai_did_well", label: "Что AI сделал хорошо" },
                      { key: "what_ai_missed", label: "Что AI упустил" },
                      { key: "corrected_recommendation", label: "Как бы вы сформулировали рекомендацию" },
                      { key: "suggested_questions", label: "Какие вопросы нужно добавить" },
                      { key: "expert_comment", label: "Комментарий эксперта" },
                    ].map(f => (
                      <div key={f.key} style={{ marginBottom: 14 }}>
                        <label style={{ display: "block", fontWeight: 600, fontSize: 14, color: "#2f2925", marginBottom: 4 }}>{f.label}</label>
                        <textarea
                          style={{
                            width: "100%", minHeight: 60, padding: 10, borderRadius: 10,
                            border: "1px solid #d8cec1", fontSize: 14, fontFamily: "inherit",
                            resize: "vertical", outline: "none", boxSizing: "border-box",
                          }}
                          value={bodyExpertReviewForm[f.key] || ""}
                          onChange={e => setBodyExpertReviewForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                        />
                      </div>
                    ))}

                    <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                      <button
                        onClick={adminSaveBodyExpertReview}
                        disabled={bodyExpertReviewSaving}
                        style={{
                          flex: 1, height: 48, borderRadius: 14, border: 0,
                          background: bodyExpertReviewSaving ? "#c4d0c6" : "#7D9A89",
                          color: "#fff", fontWeight: 800, fontSize: 16, cursor: "pointer", fontFamily: "inherit",
                        }}
                      >
                        {bodyExpertReviewSaving ? "Сохраняем..." : "Сохранить правку"}
                      </button>
                      <button
                        onClick={() => setBodyExpertReviewFormOpen(false)}
                        style={{
                          padding: "0 24px", borderRadius: 14, border: "1px solid #d8cec1",
                          background: "#ede7dc", color: "#2f2925", fontWeight: 600, fontSize: 14, cursor: "pointer", fontFamily: "inherit",
                        }}
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Delete confirmation modal */}
              {bodyIntakeDeleteConfirm && (
                <div style={{
                  position: "fixed", inset: 0, background: "rgba(0,0,0,.6)",
                  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
                }} onClick={() => setBodyIntakeDeleteConfirm(null)}>
                  <div style={{
                    background: t.bg, borderRadius: 20, padding: 32, maxWidth: 400, width: "90%",
                  }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Удалить анкету?</div>
                    <div style={{ fontSize: 14, color: t.muted, marginBottom: 24, lineHeight: 1.5 }}>
                      Анкета будет перемещена в корзину. Вы сможете восстановить её позже.
                    </div>
                    <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
                      <button
                        onClick={() => setBodyIntakeDeleteConfirm(null)}
                        style={{
                          background: "transparent", color: t.text, border: `1px solid ${t.border}`, borderRadius: 12,
                          padding: "10px 20px", fontWeight: 600, fontSize: 14, cursor: "pointer",
                        }}
                      >
                        Отмена
                      </button>
                      <button
                        onClick={() => adminDeleteBodyIntake(bodyIntakeDeleteConfirm)}
                        style={{
                          background: "#ef4444", color: "#fff", border: 0, borderRadius: 12,
                          padding: "10px 20px", fontWeight: 600, fontSize: 14, cursor: "pointer",
                        }}
                      >
                        Удалить
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Body intake detail modal — human-readable */}
              {bodyIntakeDetailOpen && bodyIntakeDetail && (
                <div style={{
                  position: "fixed", inset: 0, background: "rgba(0,0,0,.6)",
                  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
                }} onClick={() => setBodyIntakeDetailOpen(false)}>
                  <div style={{
                    background: t.bg, borderRadius: 20, padding: 32, maxWidth: 720, width: "90%",
                    maxHeight: "85vh", overflowY: "auto",
                  }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20, alignItems: "center" }}>
                      <div>
                        <div style={{ fontSize: 20, fontWeight: 700 }}>Анкета здоровья</div>
                        {bodyIntakeDetail.session_id && (
                          <div style={{ fontSize: 14, color: t.muted, fontFamily: "monospace", fontWeight: 600, marginTop: 2 }}>
                            {bodyIntakeDetail.session_id}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => setBodyIntakeDetailOpen(false)}
                        style={{ background: "none", border: 0, color: t.muted, cursor: "pointer", fontSize: 20 }}
                      >
                        ✕
                      </button>
                    </div>

                    {/* 1. General Info */}
                    <Section title="Общая информация">
                      <Field label="Дата" value={new Date(bodyIntakeDetail.created_at).toLocaleString("ru-RU")} />
                      <Field label="Источник" value={bodyIntakeDetail.source || "—"} />
                      <Field label="Специалист" value={bodyIntakeDetail.specialist_name || "—"} />
                      <Field label="Код продолжения" value={bodyIntakeDetail.session_id || "код не создан"} mono />
                      <Field label="Версия" value={bodyIntakeDetail.version || "—"} />
                      <Field label="ID" value={bodyIntakeDetail.id || "—"} mono />
                    </Section>

                    {/* 2. Client Info */}
                    {(() => {
                      const a = bodyIntakeDetail.answers || {};
                      const c = bodyIntakeDetail.client || {};
                      return (
                        <Section title="Информация о клиенте">
                          <Field label="Имя / псевдоним" value={a.display_name || c.display_name || "—"} />
                          <Field label="Пол" value={{ male: "Мужской", female: "Женский", other: "Другой", prefer_not: "Не указан" }[a.sex] || a.sex || "—"} />
                          <Field label="Возраст" value={a.age || "—"} />
                          <Field label="Цель" value={a.goal === "custom" ? a.goal_custom : ({
                            improve_wellbeing: "Улучшить самочувствие",
                            slimness: "Стройность",
                            custom: a.goal_custom || "Свой вариант",
                          })[a.goal] || a.goal || "—"} />
                        </Section>
                      );
                    })()}

                    {/* 3. Key Measurements */}
                    {(() => {
                      const a = bodyIntakeDetail.answers || {};
                      const bmi = bodyIntakeDetail.bmi;
                      return (
                        <Section title="Основные показатели">
                          {bmi && <Field label="ИМТ" value={bmi} />}
                          <Field label="Рост" value={a.height_cm ? `${a.height_cm} см` : "—"} />
                          <Field label="Вес" value={a.weight_kg ? `${a.weight_kg} кг` : "—"} />
                          {a.waist_cm && <Field label="Объём талии" value={`${a.waist_cm} см`} />}
                          <Field label="Активность на работе" value={{
                            sedentary: "Сидячая",
                            light: "Лёгкая",
                            moderate: "Умеренная",
                            heavy: "Тяжёлая",
                          }[a.work_activity_level] || a.work_activity_level || "—"} />
                          <Field label="Шагов в день" value={{
                            less_3000: "Меньше 3000",
                            "3000_6000": "3000–6000",
                            "6000_10000": "6000–10000",
                            more_10000: "Больше 10000",
                          }[a.daily_steps_estimate] || a.daily_steps_estimate || "—"} />
                          <Field label="Сон" value={{
                            less_5: "Меньше 5 ч",
                            "5_6": "5–6 ч",
                            "6_7": "6–7 ч",
                            "7_8": "7–8 ч",
                            more_8: "Больше 8 ч",
                          }[a.sleep_hours_estimate] || a.sleep_hours_estimate || "—"} />
                          <Field label="Питание (главная проблема)" value={{
                            overeating: "Переедание",
                            unhealthy_food: "Нездоровый выбор",
                            irregular: "Нерегулярное",
                            portion_control: "Контроль порций",
                            snacking: "Частые перекусы",
                            other: "Другое",
                          }[a.nutrition_main_problem] || a.nutrition_main_problem || "—"} />
                          {a.health_limitations && <Field label="Ограничения по здоровью" value={a.health_limitations} />}
                        </Section>
                      );
                    })()}

                    {/* 3b. Lifestyle & Nutrition */}
                    {(() => {
                      const a = bodyIntakeDetail.answers || {};
                      const trnTypes = Array.isArray(a.training_types) ? a.training_types.join(", ") : a.training_types;
                      const drinks = Array.isArray(a.daily_drinks) ? a.daily_drinks.join(", ") : a.daily_drinks;
                      const foodOrg = Array.isArray(a.food_organization) ? a.food_organization.join(", ") : a.food_organization;
                      return (
                        <Section title="Образ жизни и питание">
                          <Field label="Тренировки" value={{
                            none: "Нет",
                            irregular: "Нерегулярно",
                            "1_2_week": "1–2 раза в неделю",
                            "3plus_week": "3+ раза в неделю",
                          }[a.training_current] || a.training_current || "—"} />
                          {trnTypes && <Field label="Типы тренировок" value={trnTypes} />}
                          <Field label="Ограничения при нагрузке" value={a.training_limitations || "—"} />
                          <Field label="Время отхода ко сну" value={a.sleep_bedtime || "—"} />
                          <Field label="Время подъёма" value={a.sleep_wake_time || "—"} />
                          <Field label="Разница будни/выходные" value={{
                            no: "Нет",
                            slight: "Небольшая",
                            yes: "Сильная",
                          }[a.sleep_schedule_shift] || a.sleep_schedule_shift || "—"} />
                          <Field label="Напитки" value={drinks || "—"} />
                          <Field label="Воды в день (оценка)" value={a.water_l_estimate ? `${a.water_l_estimate} л` : "—"} />
                          <Field label="Приёмов пищи в день" value={{
                            "1": "1",
                            "2": "2",
                            "3": "3",
                            "4plus": "4+",
                            irregular: "Нерегулярно",
                          }[a.meals_per_day] || a.meals_per_day || "—"} />
                          <Field label="Организация питания" value={foodOrg || "—"} />
                        </Section>
                      );
                    })()}

                    {/* 4. Red Flags */}
                    {(() => {
                      const redFlags = bodyIntakeDetail.triggered_red_flags;
                      const redLabels = {
                        chest_pain: "Боль в груди",
                        severe_dizziness: "Сильное головокружение",
                        unexplained_weight_loss: "Необъяснимая потеря веса",
                        blood_in_stool: "Кровь в стуле",
                        fainting: "Обмороки",
                        none: "Ничего",
                      };
                      const activeFlags = Array.isArray(redFlags) ? redFlags.filter(f => f !== "none") : [];
                      return (
                        <Section title="Красные флаги">
                          {activeFlags.length > 0 ? (
                            <ul style={{ margin: "4px 0 0 0", paddingLeft: 18, color: t.text, fontSize: 14, lineHeight: 1.7 }}>
                              {activeFlags.map(f => (
                                <li key={f}>{redLabels[f] || f}</li>
                              ))}
                            </ul>
                          ) : (
                            <Field label="" value="Не отмечено" />
                          )}
                          {bodyIntakeDetail.red_flag_care_level && (
                            <Field label="Уровень риска" value={{
                              urgent_help: "Срочная помощь",
                              medical_consultation: "Консультация врача",
                            }[bodyIntakeDetail.red_flag_care_level] || bodyIntakeDetail.red_flag_care_level} />
                          )}
                        </Section>
                      );
                    })()}

                    {/* 5. Care Recommendation */}
                    {(() => {
                      const care = bodyIntakeDetail.care_recommendation;
                      const careLevel = normalizeCare(care);
                      const careBg = careLevel === "urgent_help" ? "rgba(239,68,68,.1)" :
                        careLevel === "medical_consultation" ? "rgba(251,191,36,.1)" : "rgba(34,197,94,.1)";
                      const careColor = careLevel === "urgent_help" ? "#991b1b" :
                        careLevel === "medical_consultation" ? "#92400e" : "#166534";
                      const careLabelText = careLevel === "urgent_help" ? "Срочная помощь" :
                        careLevel === "medical_consultation" ? "Консультация врача" : "Self-care";
                      const data = bodyIntakeDetail;
                      return (
                        <Section title="AI-разбор">
                          {data.user_report && (
                            <div style={{ marginBottom: 16 }}>
                              <div style={{ fontWeight: 600, fontSize: 13, color: t.muted, marginBottom: 6, letterSpacing: "0.03em" }}>Отчёт для пользователя</div>
                              <div style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap", background: t.cardBg, padding: 14, borderRadius: 12, border: `1px solid ${t.cardBorder}` }}>
                                {data.user_report}
                              </div>
                            </div>
                          )}
                          {care && (
                            <div style={{ padding: 14, borderRadius: 12, background: careBg, border: `1px solid ${t.cardBorder}` }}>
                              <div style={{ fontWeight: 700, fontSize: 14, color: careColor, marginBottom: 4 }}>Уровень: {careLabelText}</div>
                              {typeof care === "object" && care.reasons?.length > 0 && (
                                <div style={{ fontSize: 13, color: t.text, marginTop: 6 }}>
                                  <strong>Причины:</strong> {care.reasons.join(", ")}
                                </div>
                              )}
                              {typeof care === "object" && care.specialist_types?.length > 0 && (
                                <div style={{ fontSize: 13, color: t.text, marginTop: 4 }}>
                                  <strong>Специалист:</strong> {{
                                    emergency_service: "Скорая помощь",
                                    general_physician: "Терапевт",
                                    nutritionist: "Диетолог",
                                    endocrinologist: "Эндокринолог",
                                    gastroenterologist: "Гастроэнтеролог",
                                    psychologist: "Психолог",
                                    psychotherapist: "Психотерапевт",
                                  }[care.specialist_types[0]] || care.specialist_types.join(", ")}
                                </div>
                              )}
                              {typeof care === "object" && care.interim_support?.length > 0 && (
                                <div style={{ marginTop: 8 }}>
                                  {care.interim_support.map((s, i) => (
                                    <div key={i} style={{ fontSize: 13, color: t.text, paddingLeft: 12, marginTop: 2 }}>
                                      • {s}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          {data.used_fallback && (
                            <div style={{ marginTop: 8, fontSize: 12, color: t.muted, fontStyle: "italic" }}>
                              Использован fallback (модель не дала структурированного ответа)
                            </div>
                          )}
                        </Section>
                      );
                    })()}

                    {/* 6. Body Plan */}
                    {(() => {
                      const plan = bodyIntakeDetail.body_plan || bodyIntakeDetail.answers?.body_plan;
                      if (!plan) return null;
                      const days = plan.days || [];
                      return (
                        <Section title="План на 7 дней">
                          {plan.focus && (
                            <div style={{ fontSize: 14, color: t.muted, fontStyle: "italic", marginBottom: 12 }}>
                              Фокус: {plan.focus}
                            </div>
                          )}
                          {days.map(d => (
                            <div key={d.day} style={{
                              border: `1px solid ${t.cardBorder}`,
                              borderRadius: 12, padding: "12px 16px", marginBottom: 8,
                              background: t.cardBg,
                            }}>
                              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, color: t.text }}>
                                День {d.day}: {d.title}
                              </div>
                              {d.actions?.map((a, i) => (
                                <div key={i} style={{ color: t.muted, fontSize: 13, paddingLeft: 12, marginTop: 2 }}>
                                  • {a}
                                </div>
                              ))}
                              {d.note && (
                                <div style={{ color: t.muted, fontSize: 12, fontStyle: "italic", marginTop: 4 }}>
                                  {d.note}
                                </div>
                              )}
                            </div>
                          ))}
                        </Section>
                      );
                    })()}

                    {/* Deleted info */}
                    {bodyIntakeDetail.deleted_at && (
                      <div style={{ marginBottom: 16, padding: 12, borderRadius: 12, background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.2)", fontSize: 13, color: "#991b1b" }}>
                        Удалён: {new Date(bodyIntakeDetail.deleted_at).toLocaleString("ru-RU")} ({bodyIntakeDetail.deleted_by})
                      </div>
                    )}

                    {/* Raw JSON in details (technical) */}
                    <details style={{ marginBottom: 20 }}>
                      <summary style={{ cursor: "pointer", fontSize: 13, color: t.muted, fontWeight: 600, padding: 8, borderRadius: 8, background: t.cardBg }}>
                        Технические данные
                      </summary>
                      <pre style={{ fontSize: 11, lineHeight: 1.5, whiteSpace: "pre-wrap", background: t.cardBg, padding: 14, borderRadius: 12, border: `1px solid ${t.cardBorder}`, maxHeight: 300, overflowY: "auto", margin: 0 }}>
                        {JSON.stringify(bodyIntakeDetail.answers || {}, null, 2)}
                      </pre>
                    </details>

                    {/* Actions */}
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                      <button
                        onClick={() => adminDownloadBodyIntakeJSON(bodyIntakeDetail)}
                        style={{
                          background: t.accent, color: "#fff", border: 0, borderRadius: 12,
                          padding: "12px 20px", fontWeight: 700, fontSize: 14, cursor: "pointer", flex: 1, minWidth: 140,
                        }}
                      >
                        Скачать JSON
                      </button>
                      <button
                        onClick={() => {
                          const a = bodyIntakeDetail.answers || {};
                          adminOpenBodyExpertReviewForm("intake", bodyIntakeDetail.id, bodyIntakeDetail.session_id, a, {
                            user_report: bodyIntakeDetail.user_report,
                            body_plan: bodyIntakeDetail.body_plan,
                            care_recommendation: bodyIntakeDetail.care_recommendation,
                            bmi: bodyIntakeDetail.bmi,
                            triggered_red_flags: bodyIntakeDetail.triggered_red_flags,
                          });
                        }}
                        style={{
                          background: "#e8f0ea", color: "#2f2925", border: "1px solid #c4d0c6", borderRadius: 12,
                          padding: "12px 20px", fontWeight: 700, fontSize: 14, cursor: "pointer", minWidth: 140,
                        }}
                      >
                        ✏️ Экспертная правка
                      </button>
                      {bodyIntakeDetail.deleted_at ? (
                        <button
                          onClick={() => { adminRestoreBodyIntake(bodyIntakeDetail.id); setBodyIntakeDetailOpen(false); }}
                          style={{
                            background: "transparent", color: t.accent, border: `1px solid ${t.accent}`, borderRadius: 12,
                            padding: "12px 20px", fontWeight: 700, fontSize: 14, cursor: "pointer",
                          }}
                        >
                          Восстановить
                        </button>
                      ) : (
                        <button
                          onClick={() => { setBodyIntakeDetailOpen(false); setBodyIntakeDeleteConfirm(bodyIntakeDetail.id); }}
                          style={{
                            background: "transparent", color: "#ef4444", border: "1px solid #ef4444", borderRadius: 12,
                            padding: "12px 20px", fontWeight: 700, fontSize: 14, cursor: "pointer",
                          }}
                        >
                          Удалить
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Body diary detail modal */}
              {bodyDiaryDetailOpen && bodyDiaryDetail && (
                <div style={{
                  position: "fixed", inset: 0, background: "rgba(0,0,0,.6)",
                  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
                }} onClick={() => setBodyDiaryDetailOpen(false)}>
                  <div style={{
                    background: t.bg, borderRadius: 20, padding: 32, maxWidth: 640, width: "90%",
                    maxHeight: "85vh", overflowY: "auto",
                  }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20, alignItems: "center" }}>
                      <div>
                        <div style={{ fontSize: 20, fontWeight: 700 }}>Запись дневника</div>
                        <div style={{ fontSize: 14, color: t.muted, fontFamily: "monospace", fontWeight: 600, marginTop: 2 }}>
                          {bodyDiaryDetail.session_id} · {bodyDiaryDetail.log_date}
                        </div>
                      </div>
                      <button
                        onClick={() => setBodyDiaryDetailOpen(false)}
                        style={{ background: "none", border: 0, color: t.muted, cursor: "pointer", fontSize: 20 }}
                      >
                        ✕
                      </button>
                    </div>

                    {/* Activity */}
                    <Section title="Активность">
                      <Field label="Шаги" value={bodyDiaryDetail.steps ?? "—"} />
                      <Field label="Тренировка" value={bodyDiaryDetail.workout_done ? (bodyDiaryDetail.workout_type || "Да") : "Нет"} />
                      <Field label="Интенсивность" value={bodyDiaryDetail.workout_intensity || "—"} />
                      <Field label="Минут активности" value={bodyDiaryDetail.activity_minutes ?? "—"} />
                    </Section>

                    {/* Nutrition */}
                    <Section title="Питание">
                      <Field label="Приёмов пищи" value={bodyDiaryDetail.meals_count ?? "—"} />
                      <Field label="Калории (оценка)" value={bodyDiaryDetail.calories ? `${bodyDiaryDetail.calories} ккал` : "—"} />
                      <Field label="Переедание" value={{
                        none: "Нет",
                        slight: "Немного",
                        moderate: "Умеренно",
                        severe: "Выраженно",
                      }[bodyDiaryDetail.overeating_level] || bodyDiaryDetail.overeating_level || "—"} />
                      <Field label="Тяга к сладкому" value={bodyDiaryDetail.sweet_cravings || "—"} />
                      {bodyDiaryDetail.nutrition_comment && (
                        <Field label="Заметки о питании" value={bodyDiaryDetail.nutrition_comment} />
                      )}
                    </Section>

                    {/* Sleep & Health */}
                    <Section title="Сон и самочувствие">
                      <Field label="Часов сна" value={bodyDiaryDetail.sleep_hours ? `${bodyDiaryDetail.sleep_hours} ч` : "—"} />
                      <Field label="Качество сна" value={{
                        terrible: "Ужасное",
                        poor: "Плохое",
                        average: "Среднее",
                        good: "Хорошее",
                        excellent: "Отличное",
                      }[bodyDiaryDetail.sleep_quality] || bodyDiaryDetail.sleep_quality || "—"} />
                      <Field label="Уровень энергии" value={bodyDiaryDetail.energy_level ? `${bodyDiaryDetail.energy_level}/10` : "—"} />
                      <Field label="Настроение" value={bodyDiaryDetail.mood_level ? `${bodyDiaryDetail.mood_level}/10` : "—"} />
                      {bodyDiaryDetail.health_notes && (
                        <Field label="Заметки о самочувствии" value={bodyDiaryDetail.health_notes} />
                      )}
                    </Section>

                    {/* Water */}
                    {bodyDiaryDetail.water_l != null && (
                      <Section title="Вода">
                        <Field label="Воды, литры" value={`${bodyDiaryDetail.water_l} л`} />
                      </Section>
                    )}

                    {/* AI Summary */}
                    {bodyDiaryDetail.ai_day_summary && (
                      <Section title="AI-итог дня">
                        <div style={{
                          fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap",
                          background: t.cardBg, padding: 14, borderRadius: 12,
                          border: `1px solid ${t.cardBorder}`,
                        }}>
                          {bodyDiaryDetail.ai_day_summary}
                        </div>
                      </Section>
                    )}

                    {/* Voice transcript */}
                    {bodyDiaryDetail.voice_transcript && (
                      <Section title="Голосовой ввод (расшифровка)">
                        <div style={{
                          fontSize: 13, lineHeight: 1.5, fontStyle: "italic", color: t.muted,
                          background: t.cardBg, padding: 14, borderRadius: 12,
                          border: `1px solid ${t.cardBorder}`,
                        }}>
                          {bodyDiaryDetail.voice_transcript}
                        </div>
                      </Section>
                    )}

                    {/* Plate photos */}
                    {bodyDiaryDetail.plate_photos?.length > 0 && (
                      <Section title="Фото тарелок">
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                          {bodyDiaryDetail.plate_photos.map((photo, i) => (
                            <img
                              key={i}
                              src={photo}
                              alt={`Фото тарелки ${i + 1}`}
                              style={{
                                width: 120, height: 120, borderRadius: 12,
                                objectFit: "cover", border: `1px solid ${t.cardBorder}`,
                              }}
                            />
                          ))}
                        </div>
                        {bodyDiaryDetail.plate_analysis?.length > 0 && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            {bodyDiaryDetail.plate_analysis.map((a, i) => (
                              <div key={i} style={{ fontSize: 13, lineHeight: 1.5, padding: 12, borderRadius: 10, background: t.cardBg, border: `1px solid ${t.cardBorder}` }}>
                                <div style={{ fontWeight: 700, color: t.text, marginBottom: 6 }}>{a.photo_name || `Фото ${i + 1}`}</div>
                                {a.error ? (
                                  <div style={{ color: "#b5473f" }}>{a.error}</div>
                                ) : (
                                  <>
                                    {a.balance_summary && <div style={{ color: t.text, marginBottom: 4 }}>{a.balance_summary}</div>}
                                    {a.what_is_missing && (
                                      <div style={{ color: t.muted, marginBottom: 4 }}>
                                        Чего не хватает: {Array.isArray(a.what_is_missing) ? a.what_is_missing.join(", ") : a.what_is_missing}
                                      </div>
                                    )}
                                    {a.gentle_suggestion && <div style={{ color: "#7D9A89", fontStyle: "italic", marginBottom: 4 }}>{a.gentle_suggestion}</div>}
                                    {a.confidence && typeof a.confidence === "number" && (
                                      <div style={{ color: t.muted, fontSize: 11 }}>Точность: {Math.round(a.confidence * 100)}%</div>
                                    )}
                                  </>
                                )}
                              </div>
                            ))}
                            <div style={{ fontSize: 11, color: t.muted }}>Примерная оценка по фото, не точный расчёт калорий</div>
                          </div>
                        )}
                        <button
                          onClick={() => {
                            adminOpenBodyExpertReviewForm("plate_analysis", bodyDiaryDetail.id, bodyDiaryDetail.session_id, {
                              plate_photos: bodyDiaryDetail.plate_photos,
                            }, bodyDiaryDetail.plate_analysis);
                          }}
                          style={{
                            marginTop: 10,
                            background: "#f5f0e8", color: "#2f2925", border: "1px solid #d8cec1", borderRadius: 10,
                            padding: "8px 16px", fontWeight: 600, fontSize: 12, cursor: "pointer",
                          }}
                        >
                          ✏️ Экспертная правка по тарелке
                        </button>
                      </Section>
                    )}

                    {/* Raw JSON (technical) */}
                    <details style={{ marginBottom: 16 }}>
                      <summary style={{ cursor: "pointer", fontSize: 13, color: t.muted, fontWeight: 600, padding: 8, borderRadius: 8, background: t.cardBg }}>
                        Технические данные
                      </summary>
                      <pre style={{ fontSize: 11, lineHeight: 1.5, whiteSpace: "pre-wrap", background: t.cardBg, padding: 14, borderRadius: 12, border: `1px solid ${t.cardBorder}`, maxHeight: 300, overflowY: "auto", margin: 0 }}>
                        {JSON.stringify(bodyDiaryDetail, null, 2)}
                      </pre>
                    </details>

                    <div style={{ display: "flex", gap: 10 }}>
                      <button
                        onClick={() => {
                          adminOpenBodyExpertReviewForm("daily_log", bodyDiaryDetail.id, bodyDiaryDetail.session_id, {
                            log_date: bodyDiaryDetail.log_date,
                            steps: bodyDiaryDetail.steps,
                            workout_done: bodyDiaryDetail.workout_done,
                            water_l: bodyDiaryDetail.water_l,
                            sleep_hours: bodyDiaryDetail.sleep_hours,
                            energy_level: bodyDiaryDetail.energy_level,
                            mood_level: bodyDiaryDetail.mood_level,
                            plate_photos: bodyDiaryDetail.plate_photos,
                          }, {
                            ai_day_summary: bodyDiaryDetail.ai_day_summary,
                            ai_focus_tomorrow: bodyDiaryDetail.ai_focus_tomorrow,
                            plate_analysis: bodyDiaryDetail.plate_analysis,
                          });
                        }}
                        style={{
                          background: "#e8f0ea", color: "#2f2925", border: "1px solid #c4d0c6", borderRadius: 12,
                          padding: "10px 18px", fontWeight: 700, fontSize: 13, cursor: "pointer", flex: 1,
                        }}
                      >
                        ✏️ Экспертная правка
                      </button>
                      <button
                        onClick={() => { adminDeleteBodyDailyLog(bodyDiaryDetail.id); setBodyDiaryDetailOpen(false); }}
                        style={{
                          background: "transparent", color: "#ef4444", border: "1px solid #ef4444", borderRadius: 12,
                          padding: "10px 18px", fontWeight: 700, fontSize: 13, cursor: "pointer",
                        }}
                      >
                        Удалить
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : adminModuleRoute === "council" ? (
            <ClinicalCouncilAdmin adminPassword={adminPassword} theme={t} />
          ) : (
            <>
              {/* Tabs */}
              <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
                <button
                  style={{
                    border: 0, borderRadius: 14, padding: "10px 18px", fontWeight: 700, fontSize: 14, cursor: "pointer",
                    background: adminReqTab === "reviews" ? t.tabActive : t.tabBg,
                    color: adminReqTab === "reviews" ? t.tabActiveText : t.text,
                  }}
                  onClick={() => setAdminReqTab("reviews")}
                >
                  Отзывы о сессиях
                </button>
                <button
                  style={{
                    border: 0, borderRadius: 14, padding: "10px 18px", fontWeight: 700, fontSize: 14, cursor: "pointer",
                    background: adminReqTab === "crisis" ? t.tabActive : t.tabBg,
                    color: adminReqTab === "crisis" ? t.tabActiveText : t.text,
                  }}
                  onClick={() => { setAdminReqTab("crisis"); adminLoadCrisisRequests(adminCrisisFilter); }}
                >
                  Срочные обращения
                </button>
                <button
                  style={{
                    border: 0, borderRadius: 14, padding: "10px 18px", fontWeight: 700, fontSize: 14, cursor: "pointer",
                    background: adminReqTab === "requests" ? t.tabActive : t.tabBg,
                    color: adminReqTab === "requests" ? t.tabActiveText : t.text,
                  }}
                  onClick={() => { setAdminReqTab("requests"); adminLoadRequests(adminReqFilter); }}
                >
                  Заявки специалистов
                </button>
                <button
                  style={{
                    border: 0, borderRadius: 14, padding: "10px 18px", fontWeight: 700, fontSize: 14, cursor: "pointer",
                    background: adminReqTab === "training" ? t.tabActive : t.tabBg,
                    color: adminReqTab === "training" ? t.tabActiveText : t.text,
                  }}
                  onClick={() => { setAdminReqTab("training"); loadTrainingSessions(); }}
                >
                  Таблица тренировок
                </button>
                <button
                  style={{
                    border: 0, borderRadius: 14, padding: "10px 18px", fontWeight: 700, fontSize: 14, cursor: "pointer",
                    background: adminReqTab === "quality" ? t.tabActive : t.tabBg,
                    color: adminReqTab === "quality" ? t.tabActiveText : t.text,
                  }}
                  onClick={() => { setAdminReqTab("quality"); loadQualityStats(); loadQualityInsights(); }}
                >
                  Обзоры качества
                </button>
                <button
                  style={{
                    border: 0, borderRadius: 14, padding: "10px 18px", fontWeight: 700, fontSize: 14, cursor: "pointer",
                    background: adminReqTab === "organizations" ? t.tabActive : t.tabBg,
                    color: adminReqTab === "organizations" ? t.tabActiveText : t.text,
                  }}
                  onClick={() => { setAdminReqTab("organizations"); adminLoadOrganizations(); }}
                >
                  Организации
                </button>
                {adminRole === "super" && (
                  <button
                    style={{
                      border: 0, borderRadius: 14, padding: "10px 18px", fontWeight: 700, fontSize: 14, cursor: "pointer",
                      background: t.tabBg, color: t.text,
                    }}
                    onClick={() => { setAdminSubPage("council"); window.history.pushState({}, "", "/admin/council"); }}
                  >
                    Экспертный совет →
                  </button>
                )}
              </div>

              {adminReqTab === "crisis" ? (
                <>
                  <div style={{ color: t.muted, fontSize: 13, lineHeight: 1.5, marginBottom: 16, padding: 16, border: `1px solid ${t.cardBorder}`, borderRadius: 16, background: t.cardBg }}>
                    Сохранение срочных обращений временно отключено в privacy-safe режиме. Обращения не сохраняются в базу данных.
                  </div>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24, alignItems: "center" }}>
                    <select
                      value={adminCrisisFilter}
                      onChange={(e) => { const v = e.target.value; setAdminCrisisFilter(v); adminLoadCrisisRequests(v); }}
                      style={{
                        border: `1px solid ${t.filterBorder}`, borderRadius: 12, background: t.filterBg,
                        color: t.filterText, padding: "10px 16px", fontSize: 14, cursor: "pointer",
                      }}
                    >
                      <option value="new">Новые</option>
                      <option value="in_progress">В работе</option>
                      <option value="closed">Закрытые</option>
                      <option value="false_alarm">Тестовые</option>
                      <option value="all">Все</option>
                    </select>
                    <button
                      style={{
                        border: `1px solid ${t.border}`, borderRadius: 12, background: t.tabBg,
                        color: t.text, padding: "10px 16px", fontWeight: 600, fontSize: 14, cursor: "pointer",
                      }}
                      onClick={() => adminLoadCrisisRequests(adminCrisisFilter)}
                    >
                      {adminCrisisLoading ? "Загрузка..." : `Обновить (${adminCrisisRequests.length})`}
                    </button>
                  </div>

                  {adminCrisisLoading ? (
                    <div style={{ color: t.muted, textAlign: "center", padding: 60 }}>Загрузка...</div>
                  ) : adminCrisisRequests.length === 0 ? (
                    <div style={{ color: t.muted, textAlign: "center", padding: 60 }}>Нет обращений</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                      {adminCrisisRequests.map((req) => (
                        <div key={req.id} style={{
                          border: `1px solid ${t.crisisBorder}`, borderRadius: 20,
                          background: t.crisisCard, padding: 20,
                        }}>
                          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                              <span style={{ color: t.crisisMuted, fontSize: 12 }}>
                                {new Date(req.created_at).toLocaleString("ru-RU")}
                              </span>
                              <span style={{
                                fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 8,
                                background: req.status === "in_progress" ? t.badgeInProgress : req.status === "closed" ? t.badgeClosed : req.status === "false_alarm" ? t.badgeFalseAlarm : t.badgeNew,
                                color: req.status === "in_progress" ? t.badgeInProgressText : req.status === "closed" ? t.badgeClosedText : req.status === "false_alarm" ? t.badgeFalseAlarmText : t.badgeNewText,
                              }}>
                                {req.status === "new" ? "Новое" : req.status === "in_progress" ? "В работе" : req.status === "closed" ? "Закрыто" : req.status === "false_alarm" ? "Тестовое" : req.status}
                              </span>
                              <span style={{ color: t.crisisMuted, fontSize: 12 }}>
                                {req.environment} / {req.source}
                              </span>
                              {req.high_risk_detected && (
                                <span style={{
                                  fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 8,
                                  background: t.badgeHighRisk, color: t.badgeHighRiskText,
                                }}>
                                  Высокий риск
                                </span>
                              )}
                            </div>
                            {req.public_code && (
                              <span style={{ fontWeight: 700, fontSize: 13, color: t.crisisAccent, letterSpacing: 0.5 }}>
                                {req.public_code}
                              </span>
                            )}
                          </div>

                          {req.crisis_text && (
                            <div style={{ marginBottom: 8 }}>
                              <div style={{ color: t.cardLabel, fontSize: 11, marginBottom: 2 }}>Ситуация</div>
                              <div style={{ color: t.crisisText, fontSize: 13, lineHeight: 1.5 }}>{req.crisis_text}</div>
                            </div>
                          )}

                          {req.contact && (
                            <div style={{ marginBottom: 8 }}>
                              <div style={{ color: t.cardLabel, fontSize: 11, marginBottom: 2 }}>Контакт</div>
                              <div style={{ color: t.crisisText, fontSize: 13 }}>{req.contact}</div>
                            </div>
                          )}

                          {req.risk_markers && Array.isArray(req.risk_markers) && req.risk_markers.length > 0 && (
                            <div style={{ marginBottom: 8 }}>
                              <div style={{ color: t.cardLabel, fontSize: 11, marginBottom: 2 }}>Маркеры риска</div>
                              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                                {req.risk_markers.map((m, i) => (
                                  <span key={i} style={{
                                    fontSize: 11, padding: "2px 6px", borderRadius: 4,
                                    background: t.riskMarkerBg, color: t.riskMarker,
                                  }}>{m}</span>
                                ))}
                              </div>
                            </div>
                          )}

                          {req.admin_comment && (
                            <div style={{ marginBottom: 8, color: t.crisisMuted, fontSize: 13, fontStyle: "italic" }}>
                              Комментарий: {req.admin_comment}
                            </div>
                          )}

                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                            {req.status === "new" && (
                              <button
                                disabled={adminCrisisActionLoading === req.id}
                                style={{
                                  border: 0, borderRadius: 12, background: t.crisisActionPrimary, color: t.crisisActionPrimaryText,
                                  padding: "8px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer",
                                  opacity: adminCrisisActionLoading === req.id ? 0.5 : 1,
                                }}
                                onClick={() => adminUpdateCrisisStatus(req.id, "in_progress")}
                              >
                                Взять в работу
                              </button>
                            )}
                            {req.status === "in_progress" && (
                              <button
                                disabled={adminCrisisActionLoading === req.id}
                                style={{
                                  border: 0, borderRadius: 12, background: t.crisisActionSuccess, color: t.crisisActionSuccessText,
                                  padding: "8px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer",
                                  opacity: adminCrisisActionLoading === req.id ? 0.5 : 1,
                                }}
                                onClick={() => adminUpdateCrisisStatus(req.id, "closed")}
                              >
                                Закрыть
                              </button>
                            )}
                            <button
                              disabled={adminCrisisActionLoading === req.id}
                              style={{
                                border: 0, borderRadius: 12, background: t.crisisActionNeutral, color: t.crisisActionNeutralText,
                                padding: "8px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer",
                                opacity: adminCrisisActionLoading === req.id ? 0.5 : 1,
                              }}
                              onClick={() => adminUpdateCrisisStatus(req.id, "false_alarm")}
                            >
                              Ложная/тестовая
                            </button>
                            <button
                              style={{
                                border: `1px solid ${t.crisisActionJsonlBorder}`, borderRadius: 12, background: t.crisisActionJsonl,
                                color: t.crisisActionJsonlText, padding: "8px 14px", fontWeight: 600, fontSize: 12, cursor: "pointer",
                              }}
                              onClick={() => adminDownloadCrisisJson(req)}
                            >
                              Скачать JSON
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : adminReqTab === "requests" ? (
                <>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24, alignItems: "center" }}>
                    <select
                      value={adminReqFilter}
                      onChange={(e) => { const v = e.target.value; setAdminReqFilter(v); adminLoadRequests(v); }}
                      style={{
                        border: `1px solid ${t.filterBorder}`, borderRadius: 12, background: t.filterBg,
                        color: t.filterText, padding: "10px 16px", fontSize: 14, cursor: "pointer",
                      }}
                    >
                      <option value="pending">Ожидают</option>
                      <option value="approved">Одобренные</option>
                      <option value="rejected">Отклонённые</option>
                      <option value="all">Все</option>
                    </select>
                    <button
                      style={{
                        border: `1px solid ${t.border}`, borderRadius: 12, background: t.tabBg,
                        color: t.text, padding: "10px 16px", fontWeight: 600, fontSize: 14, cursor: "pointer",
                      }}
                      onClick={() => adminLoadRequests(adminReqFilter)}
                    >
                      Обновить ({adminRequests.length})
                    </button>
                  </div>

                  {adminRequests.length === 0 ? (
                    <div style={{ color: t.muted, textAlign: "center", padding: 60 }}>Нет заявок</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                      {adminRequests.map((req) => (
                        <div key={req.id} style={{
                          border: `1px solid ${t.crisisBorder}`, borderRadius: 20,
                          background: t.crisisCard, padding: 20,
                        }}>
                          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                              <span style={{ color: t.crisisMuted, fontSize: 12 }}>
                                {new Date(req.created_at).toLocaleString("ru-RU")}
                              </span>
                              <span style={{
                                fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 8,
                                background: req.status === "approved" ? t.badgeClosed : req.status === "rejected" ? t.badgeNew : t.badgePending,
                                color: req.status === "approved" ? t.badgeClosedText : req.status === "rejected" ? t.badgeNewText : t.badgePendingText,
                              }}>
                                {req.status}
                              </span>
                            </div>
                          </div>

                          <div style={{ marginBottom: 8 }}>
                            <span style={{ fontWeight: 700, color: t.crisisText }}>{req.name}</span>
                            <span style={{ color: t.crisisMuted, marginLeft: 8 }}>{req.role}</span>
                          </div>
                          <div style={{ color: t.cardLabel, fontSize: 13, marginBottom: 8 }}>
                            {req.email && <span>Email: {req.email}  </span>}
                            {req.telegram && <span>Telegram: {req.telegram}  </span>}
                            {req.specialty && <span>Специализация: {req.specialty}  </span>}
                            {req.city && <span>Город: {req.city}  </span>}
                            {req.organization && <span>Организация: {req.organization}</span>}
                          </div>
                          {req.comment && (
                            <div style={{ color: t.crisisMuted, fontSize: 13, fontStyle: "italic", marginBottom: 8 }}>
                              "{req.comment}"
                            </div>
                          )}

                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            {req.status !== "approved" && (
                              <button style={{ border: 0, borderRadius: 12, background: t.badgeClosed, color: t.badgeClosedText, padding: "8px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}
                                onClick={() => adminUpdateRequestStatus(req.id, "approved")}>
                                Одобрить
                              </button>
                            )}
                            {req.status !== "rejected" && (
                              <button style={{ border: 0, borderRadius: 12, background: t.badgeNew, color: t.badgeNewText, padding: "8px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}
                                onClick={() => adminUpdateRequestStatus(req.id, "rejected")}>
                                Отклонить
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {/*
                    TODO: "Создать специалиста и сгенерировать код"
                    Добавить кнопку рядом с одобренными заявками для создания записи в experts
                    и генерации access_code. Заполнять вручную.
                  */}
                </>
              ) : adminReqTab === "training" ? (
                <>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24, alignItems: "center" }}>
                  {/* Active / Trash toggle */}
                  <button onClick={() => { setTrainingShowTrash(false); setTrainingSelection(new Set()); loadTrainingSessions(); }} style={{ border: 0, borderRadius: 12, padding: "10px 16px", fontWeight: 700, fontSize: 14, cursor: "pointer", background: !trainingShowTrash ? t.tabActive : t.tabBg, color: !trainingShowTrash ? t.tabActiveText : t.text }}>Активные записи</button>
                  <button onClick={() => { setTrainingShowTrash(true); setTrainingSelection(new Set()); loadTrainingSessions(); }} style={{ border: 0, borderRadius: 12, padding: "10px 16px", fontWeight: 700, fontSize: 14, cursor: "pointer", background: trainingShowTrash ? t.tabActive : t.tabBg, color: trainingShowTrash ? t.tabActiveText : t.text }}>Корзина</button>

                  <select value={trainingFilter.status} onChange={(e) => setTrainingFilter((f) => ({ ...f, status: e.target.value }))} style={{ border: `1px solid ${t.filterBorder}`, borderRadius: 12, background: t.filterBg, color: t.filterText, padding: "10px 16px", fontSize: 14, cursor: "pointer" }}>
                    <option value="all">Все статусы</option>
                    {["new","reviewed","needs_prompt_update","approved_for_learning","rejected","archived"].map((o) => <option key={o} value={o}>{st(o)}</option>)}
                  </select>
                  <select value={trainingFilter.expected_case_type} onChange={(e) => setTrainingFilter((f) => ({ ...f, expected_case_type: e.target.value }))} style={{ border: `1px solid ${t.filterBorder}`, borderRadius: 12, background: t.filterBg, color: t.filterText, padding: "10px 16px", fontSize: 14, cursor: "pointer" }}>
                    <option value="all">Все типы случаев</option>
                    {["anxiety","sleep","depression_like","grief","trauma","body_tension","adhd_like","substance","alcohol","bipolar_red_flags","psychosis_red_flags","acute_psychosis","suicide_risk","self_harm_risk","medication_issue","mixed","other"].map((o) => <option key={o} value={o}>{ct(o)}</option>)}
                  </select>
                  <select value={trainingFilter.session_kind} onChange={(e) => setTrainingFilter((f) => ({ ...f, session_kind: e.target.value }))} style={{ border: `1px solid ${t.filterBorder}`, borderRadius: 12, background: t.filterBg, color: t.filterText, padding: "10px 16px", fontSize: 14, cursor: "pointer" }}>
                    <option value="all">Все типы сессий</option>
                    {["initial","follow_up","diary_check","support_toolkit_check","crisis_check","doctor_review","other"].map((o) => <option key={o} value={o}>{sk(o)}</option>)}
                  </select>
                  <input value={trainingFilter.public_code} onChange={(e) => setTrainingFilter((f) => ({ ...f, public_code: e.target.value }))} placeholder="Код ТОЧКА-XXXX-XXXX" style={{ border: `1px solid ${t.filterBorder}`, borderRadius: 12, background: t.filterBg, color: t.filterText, padding: "10px 16px", fontSize: 14, outline: "none", width: 200 }} />
                  <button onClick={() => loadTrainingSessions()} style={{ border: `1px solid ${t.border}`, borderRadius: 12, background: t.tabBg, color: t.text, padding: "10px 16px", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
                    {trainingLoading ? "Загрузка..." : `Обновить (${trainingSessions.length})`}
                  </button>
                  <button onClick={downloadTrainingCsv} style={{ border: `1px solid ${t.jsonlBtnBorder}`, borderRadius: 12, background: t.jsonlBtn, color: t.jsonlBtnText, padding: "10px 16px", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
                    Скачать CSV
                  </button>
                </div>

                {/* Bulk action bar */}
                {trainingSelection.size > 0 && (
                  <div style={{ marginBottom: 16, padding: "12px 16px", border: `1px solid ${t.accent}`, borderRadius: 12, background: t.highlight, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <span style={{ color: t.text, fontWeight: 700, fontSize: 14 }}>Выбрано: {trainingSelection.size}</span>
                    {trainingShowTrash ? (
                      <>
                        <button onClick={() => setTrainingBulkConfirm("restore")} style={{ border: 0, borderRadius: 10, background: t.accent, color: "#fff", padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Восстановить выбранные</button>
                        <button onClick={() => setTrainingBulkConfirm("permanentDelete")} style={{ border: 0, borderRadius: 10, background: t.error, color: "#fff", padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Удалить выбранные навсегда</button>
                      </>
                    ) : (
                      <button onClick={() => { setTrainingDeletionReason("bulk"); setTrainingBulkConfirm("trash"); }} style={{ border: 0, borderRadius: 10, background: t.error, color: "#fff", padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Удалить выбранные</button>
                    )}
                    <button onClick={() => setTrainingSelection(new Set())} style={{ border: `1px solid ${t.border}`, borderRadius: 10, background: t.tabBg, color: t.text, padding: "8px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Снять выделение</button>
                  </div>
                )}

                {/* Bulk confirm modal */}
                {trainingBulkConfirm && (
                  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
                    <div style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}`, borderRadius: 20, padding: 24, maxWidth: 500, width: "90%" }}>
                      {trainingBulkConfirm === "trash" && (
                        <>
                          <div style={{ fontWeight: 800, fontSize: 18, color: t.crisisText, marginBottom: 12 }}>Переместить в корзину {trainingSelection.size} записей?</div>
                          <div style={{ color: t.muted, fontSize: 14, marginBottom: 16, lineHeight: 1.5 }}>Исходные сессии и экспертные ревью удалены не будут.</div>
                          <div style={{ marginBottom: 16 }}>
                            <select value={trainingDeletionReason} onChange={(e) => setTrainingDeletionReason(e.target.value)} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 10, background: t.inputBg, color: t.inputText, padding: "8px 12px", fontSize: 14, width: "100%", outline: "none" }}>
                              <option value="bulk">Массовое удаление</option>
                              <option value="aborted">Оборванная сессия</option>
                              <option value="duplicate">Дубликат</option>
                              <option value="technical_test">Технический тест</option>
                              <option value="erroneous">Ошибочная запись</option>
                              <option value="insufficient_data">Недостаточно данных</option>
                            </select>
                          </div>
                          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                            <button onClick={() => { setTrainingBulkConfirm(null); setTrainingDeletionReason("") }} style={{ border: `1px solid ${t.border}`, borderRadius: 10, background: t.tabBg, color: t.text, padding: "8px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Отмена</button>
                            <button onClick={() => trashBulkTrainingSessions([...trainingSelection])} style={{ border: 0, borderRadius: 10, background: t.error, color: "#fff", padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Переместить в корзину</button>
                          </div>
                        </>
                      )}
                      {trainingBulkConfirm === "restore" && (
                        <>
                          <div style={{ fontWeight: 800, fontSize: 18, color: t.crisisText, marginBottom: 12 }}>Восстановить {trainingSelection.size} записей?</div>
                          <div style={{ color: t.muted, fontSize: 14, marginBottom: 16 }}>Записи вернутся в активную таблицу.</div>
                          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                            <button onClick={() => setTrainingBulkConfirm(null)} style={{ border: `1px solid ${t.border}`, borderRadius: 10, background: t.tabBg, color: t.text, padding: "8px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Отмена</button>
                            <button onClick={() => restoreBulkTrainingSessions([...trainingSelection])} style={{ border: 0, borderRadius: 10, background: t.accent, color: "#fff", padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Восстановить</button>
                          </div>
                        </>
                      )}
                      {trainingBulkConfirm === "permanentDelete" && (
                        <>
                          <div style={{ fontWeight: 800, fontSize: 18, color: t.error, marginBottom: 12 }}>Безвозвратно удалить {trainingSelection.size} записей?</div>
                          <div style={{ color: t.muted, fontSize: 14, marginBottom: 16, lineHeight: 1.5 }}>
                            Записи будут удалены без возможности восстановления.
                            <br />Исходные сессии и case review останутся в базе.
                          </div>
                          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                            <button onClick={() => setTrainingBulkConfirm(null)} style={{ border: `1px solid ${t.border}`, borderRadius: 10, background: t.tabBg, color: t.text, padding: "8px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Отмена</button>
                            <button onClick={() => permanentDeleteBulkTrainingSessions([...trainingSelection])} style={{ border: 0, borderRadius: 10, background: t.error, color: "#fff", padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Удалить навсегда</button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Single trash confirm */}
                {trainingTrashConfirm && (
                  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
                    <div style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}`, borderRadius: 20, padding: 24, maxWidth: 500, width: "90%" }}>
                      <div style={{ fontWeight: 800, fontSize: 18, color: t.crisisText, marginBottom: 8 }}>Удалить тренировочную запись?</div>
                      <div style={{ color: t.text, fontSize: 14, marginBottom: 8 }}>
                        <div>Код: {trainingTrashConfirm.public_code || "—"}</div>
                        <div>Сценарий: {trainingTrashConfirm.scenario_played || "—"}</div>
                        <div>Тип сессии: {sk(trainingTrashConfirm.session_kind) || "—"}</div>
                      </div>
                      <div style={{ color: t.muted, fontSize: 13, marginBottom: 16, lineHeight: 1.5 }}>Запись переместится в корзину. Исходная сессия и экспертное ревью останутся в базе.</div>
                      <div style={{ marginBottom: 16 }}>
                        <select value={trainingDeletionReason} onChange={(e) => setTrainingDeletionReason(e.target.value)} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 10, background: t.inputBg, color: t.inputText, padding: "8px 12px", fontSize: 14, width: "100%", outline: "none" }}>
                          <option value="">Выберите причину</option>
                          <option value="aborted">Оборванная сессия</option>
                          <option value="duplicate">Дубликат</option>
                          <option value="technical_test">Технический тест</option>
                          <option value="erroneous">Ошибочная запись</option>
                          <option value="insufficient_data">Недостаточно данных</option>
                          <option value="other">Другое</option>
                        </select>
                        {trainingDeletionReason === "other" && (
                          <input placeholder="Опишите причину" value={trainingDeletionReasonCustom || ""} onChange={(e) => setTrainingDeletionReasonCustom(e.target.value)} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 10, background: t.inputBg, color: t.inputText, padding: "8px 12px", fontSize: 14, width: "100%", outline: "none", marginTop: 8 }} />
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                        <button onClick={() => { setTrainingTrashConfirm(null); setTrainingDeletionReason(""); }} style={{ border: `1px solid ${t.border}`, borderRadius: 10, background: t.tabBg, color: t.text, padding: "8px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Отмена</button>
                        <button onClick={() => trashSingleTrainingSession(trainingTrashConfirm.id)} style={{ border: 0, borderRadius: 10, background: t.error, color: "#fff", padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Переместить в корзину</button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Permanent delete confirm */}
                {trainingPermanentConfirm && (
                  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
                    <div style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}`, borderRadius: 20, padding: 24, maxWidth: 500, width: "90%" }}>
                      <div style={{ fontWeight: 800, fontSize: 18, color: t.error, marginBottom: 12 }}>Удалить запись без возможности восстановления?</div>
                      <div style={{ color: t.muted, fontSize: 14, marginBottom: 16, lineHeight: 1.5 }}>
                        Будет окончательно удалена только запись таблицы тренировок.
                        <br />Исходная сессия и case review останутся в базе.
                      </div>
                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                        <button onClick={() => { setTrainingPermanentConfirm(null) }} style={{ border: `1px solid ${t.border}`, borderRadius: 10, background: t.tabBg, color: t.text, padding: "8px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Отмена</button>
                        <button onClick={() => { permanentDeleteTrainingSession(trainingPermanentConfirm.id); setTrainingPermanentConfirm(null); }} style={{ border: 0, borderRadius: 10, background: t.error, color: "#fff", padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Удалить навсегда</button>
                      </div>
                    </div>
                  </div>
                )}

                {!trainingShowTrash && trainingNewRow && (
                  <div style={{ border: `1px solid ${t.accent}`, borderRadius: 16, background: t.cardBg, padding: 16, marginBottom: 16 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10, color: t.text }}>Новая строка</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                      <input placeholder="Код пациента" value={trainingNewRow.public_code || ""} onChange={(e) => setTrainingNewRow((r) => ({ ...r, public_code: e.target.value }))} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 10, background: t.inputBg, color: t.inputText, padding: "8px 12px", fontSize: 13, outline: "none" }} />
                      <select value={trainingNewRow.session_kind || "initial"} onChange={(e) => setTrainingNewRow((r) => ({ ...r, session_kind: e.target.value }))} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 10, background: t.inputBg, color: t.inputText, padding: "8px 12px", fontSize: 13, cursor: "pointer" }}>
                        {["initial","follow_up","diary_check","support_toolkit_check","crisis_check","doctor_review","other"].map((o) => <option key={o} value={o}>{sk(o)}</option>)}
                      </select>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                      <input placeholder="Что играем в этой сессии?" value={trainingNewRow.scenario_played || ""} onChange={(e) => setTrainingNewRow((r) => ({ ...r, scenario_played: e.target.value }))} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 10, background: t.inputBg, color: t.inputText, padding: "8px 12px", fontSize: 13, outline: "none" }} />
                      <select value={trainingNewRow.expected_case_type || ""} onChange={(e) => setTrainingNewRow((r) => ({ ...r, expected_case_type: e.target.value }))} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 10, background: t.inputBg, color: t.inputText, padding: "8px 12px", fontSize: 13, cursor: "pointer" }}>
                        <option value="">Ожидаемый тип случая</option>
                        {["anxiety","sleep","depression_like","grief","trauma","body_tension","adhd_like","substance","alcohol","bipolar_red_flags","psychosis_red_flags","acute_psychosis","suicide_risk","self_harm_risk","medication_issue","mixed","other"].map((o) => <option key={o} value={o}>{ct(o)}</option>)}
                      </select>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={async () => { const r = await saveTrainingSession(trainingNewRow); if (r) setTrainingNewRow(null); }} style={{ border: 0, borderRadius: 10, background: t.accent, color: "#fff", padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Сохранить</button>
                      <button onClick={() => setTrainingNewRow(null)} style={{ border: `1px solid ${t.border}`, borderRadius: 10, background: t.tabBg, color: t.text, padding: "8px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Отмена</button>
                    </div>
                  </div>
                )}

                {!trainingShowTrash && !trainingNewRow && (
                  <button onClick={() => setTrainingNewRow({ session_kind: "initial", status: "new" })} style={{ border: `1px dashed ${t.accent}`, borderRadius: 12, background: "transparent", color: t.accent, padding: "10px 16px", fontWeight: 600, fontSize: 14, cursor: "pointer", marginBottom: 16 }}>
                    + Добавить строку
                  </button>
                )}

                {trainingSessionsError && (
                  <div style={{ color: t.error || "#e74c3c", textAlign: "center", padding: "12px 16px", marginBottom: 12, background: t.dangerBg || "rgba(231,76,60,0.08)", borderRadius: 12, border: `1px solid ${t.badgeNewText || "#e74c3c"}`, fontWeight: 600, fontSize: 14, lineHeight: 1.4 }}>
                    {trainingSessionsError}
                  </div>
                )}

                {trainingLoading ? (
                  <div style={{ color: t.muted, textAlign: "center", padding: 60 }}>Загрузка...</div>
                ) : trainingSessions.length === 0 ? (
                  <div style={{ color: t.muted, textAlign: "center", padding: 60 }}>Нет записей</div>
                ) : (
                  <div style={{ overflowX: "auto", fontSize: 12 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1400 }}>
                      <thead>
                        <tr style={{ background: t.tabBg }}>
                          <th style={{ padding: "8px 6px", borderBottom: `1px solid ${t.border}`, width: 36 }}>
                            <input type="checkbox" checked={trainingSessions.length > 0 && trainingSelection.size === trainingSessions.length} onChange={(e) => { if (e.target.checked) { setTrainingSelection(new Set(trainingSessions.map((s) => s.id))); } else { setTrainingSelection(new Set()); } }} />
                          </th>
                          {trainingShowTrash
                            ? ["Дата удаления","Удалил","Причина","Дата создания","Код пациента","Номер сессии","Тип сессии","Эксперт","Сценарий","Ожидаемый тип случая","Модель","Статус","Краткий вывод"].map((h) => (
                              <th key={h} style={{ padding: "8px 6px", textAlign: "left", fontWeight: 700, color: t.muted, borderBottom: `1px solid ${t.border}`, whiteSpace: "nowrap" }}>{h}</th>
                            ))
                            : ["Дата","Код пациента","Номер сессии","Тип сессии","Эксперт","Сценарий","Ожидаемый тип случая","Что распознала система","Качество распознавания","Модель","Fallback","Вопросы","Отчёт","Safety","Язык","Практики","Продолжение","Повторы","Риски","Рекомендация","Контекст","Статус","Краткий вывод","Проблема","Комментарий","Действие","Продолж."].map((h) => (
                              <th key={h} style={{ padding: "8px 6px", textAlign: "left", fontWeight: 700, color: t.muted, borderBottom: `1px solid ${t.border}`, whiteSpace: "nowrap" }}>{h}</th>
                            ))
                          }
                          <th style={{ padding: "8px 6px", borderBottom: `1px solid ${t.border}`, width: 100 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {trainingSessions.map((s) => {
                          const isEditing = trainingEditId === s.id;
                          const ed = isEditing ? trainingEditData : {};
                          const isSelected = trainingSelection.has(s.id);
                          return (
                            <tr key={s.id} style={{ borderBottom: `1px solid ${t.cardBorder}`, background: isSelected ? t.highlight : "transparent" }}>
                              <td style={{ padding: "6px" }}>
                                <input type="checkbox" checked={isSelected} onChange={() => { const next = new Set(trainingSelection); if (isSelected) next.delete(s.id); else next.add(s.id); setTrainingSelection(next); }} />
                              </td>
                              {trainingShowTrash ? (
                                <>
                                  <td style={{ padding: "6px", color: t.muted, fontSize: 11, whiteSpace: "nowrap" }}>{s.json_data?._deleted?.at ? new Date(s.json_data._deleted.at).toLocaleDateString("ru-RU") : ""}</td>
                                  <td style={{ padding: "6px", color: t.muted, fontSize: 11 }}>{s.json_data?._deleted?.by_expert_name || "—"}</td>
                                  <td style={{ padding: "6px", color: t.muted, fontSize: 11, maxWidth: 120 }}>{s.json_data?._deleted?.reason || "—"}</td>
                                  <td style={{ padding: "6px", color: t.muted, fontSize: 11, whiteSpace: "nowrap" }}>{s.created_at ? new Date(s.created_at).toLocaleDateString("ru-RU") : ""}</td>
                                  <td style={{ padding: "6px", fontWeight: 700, color: t.accent, fontSize: 12, whiteSpace: "nowrap" }}>{s.public_code || "—"}</td>
                                  <td style={{ padding: "6px", color: t.text }}>{s.session_sequence ?? ""}</td>
                                  <td style={{ padding: "6px", color: t.text }}>{sk(s.session_kind) || ""}</td>
                                  <td style={{ padding: "6px", color: t.muted, fontSize: 11 }}>{s.expert_name || s.expert_role || "—"}</td>
                                  <td style={{ padding: "6px", color: t.text }}>{s.scenario_played || ""}</td>
                                  <td style={{ padding: "6px", color: t.text }}>{ct(s.expected_case_type) || ""}</td>
                                  <td style={{ padding: "6px", color: t.muted, fontSize: 11 }}>{s.model_used || "—"}</td>
                                  <td style={{ padding: "6px" }}>
                                    <span style={{
                                      fontSize: 11, fontWeight: 700, padding: "2px 6px", borderRadius: 6,
                                      background: s.status === "approved_for_learning" ? t.badgeClosed : s.status === "rejected" ? t.badgeNew : s.status === "reviewed" ? t.badgeInProgress : t.badgePending,
                                      color: s.status === "approved_for_learning" ? t.badgeClosedText : s.status === "rejected" ? t.badgeNewText : s.status === "reviewed" ? t.badgeInProgressText : t.badgePendingText,
                                    }}>{st(s.status) || "Новый"}</span>
                                  </td>
                                  <td style={{ padding: "6px", maxWidth: 120, color: t.text, fontSize: 11 }}>{s.short_summary || ""}</td>
                                  <td style={{ padding: "6px", whiteSpace: "nowrap" }}>
                                    <button onClick={() => restoreSingleTrainingSession(s.id)} style={{ border: 0, borderRadius: 6, background: t.accent, color: "#fff", padding: "4px 8px", fontWeight: 700, fontSize: 11, cursor: "pointer", marginRight: 4 }}>Восстановить</button>
                                    <button onClick={() => setTrainingPermanentConfirm(s)} style={{ border: 0, borderRadius: 6, background: t.error, color: "#fff", padding: "4px 8px", fontWeight: 700, fontSize: 11, cursor: "pointer" }}>Удалить навсегда</button>
                                  </td>
                                </>
                              ) : (
                                <>
                                  <td style={{ padding: "6px", color: t.muted, fontSize: 11, whiteSpace: "nowrap" }}>{s.created_at ? new Date(s.created_at).toLocaleDateString("ru-RU") : ""}</td>
                                  <td style={{ padding: "6px", fontWeight: 700, color: t.accent, fontSize: 12, whiteSpace: "nowrap" }}>{s.public_code || "—"}</td>
                                  <td style={{ padding: "6px", color: t.text }}>{s.session_sequence ?? ""}</td>
                                  <td style={{ padding: "6px" }}>{isEditing
                                    ? <select value={ed.session_kind || s.session_kind || "initial"} onChange={(e) => setTrainingEditData((d) => ({ ...d, session_kind: e.target.value }))} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 6, background: t.inputBg, color: t.inputText, padding: "4px 6px", fontSize: 11 }}>{["initial","follow_up","diary_check","support_toolkit_check","crisis_check","doctor_review","other"].map((o) => <option key={o} value={o}>{sk(o)}</option>)}</select>
                                    : <span style={{ color: t.text }}>{sk(s.session_kind) || ""}</span>}</td>
                                  <td style={{ padding: "6px", color: t.muted, fontSize: 11 }}>{s.expert_name || (s.expert_role ? s.expert_role : "") || "—"}</td>
                                  <td style={{ padding: "6px" }}>{isEditing
                                    ? <input value={ed.scenario_played ?? s.scenario_played ?? ""} onChange={(e) => setTrainingEditData((d) => ({ ...d, scenario_played: e.target.value }))} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 6, background: t.inputBg, color: t.inputText, padding: "4px 6px", fontSize: 11, width: 100 }} />
                                    : <span style={{ color: t.text }}>{s.scenario_played || ""}</span>}</td>
                                  <td style={{ padding: "6px" }}>{isEditing
                                    ? <select value={ed.expected_case_type ?? s.expected_case_type ?? ""} onChange={(e) => setTrainingEditData((d) => ({ ...d, expected_case_type: e.target.value }))} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 6, background: t.inputBg, color: t.inputText, padding: "4px 6px", fontSize: 11 }}><option value="">—</option>{["anxiety","sleep","depression_like","grief","trauma","body_tension","adhd_like","substance","alcohol","bipolar_red_flags","psychosis_red_flags","acute_psychosis","suicide_risk","self_harm_risk","medication_issue","mixed","other"].map((o) => <option key={o} value={o}>{ct(o)}</option>)}</select>
                                    : <span style={{ color: t.text }}>{ct(s.expected_case_type) || ""}</span>}</td>
                                  <td style={{ padding: "6px" }}>{isEditing
                                    ? <input value={ed.ai_detected_case_type ?? s.ai_detected_case_type ?? ""} onChange={(e) => setTrainingEditData((d) => ({ ...d, ai_detected_case_type: e.target.value }))} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 6, background: t.inputBg, color: t.inputText, padding: "4px 6px", fontSize: 11, width: 80 }} />
                                    : <span style={{ color: t.text }}>{s.ai_detected_case_type || ""}</span>}</td>
                                  <td style={{ padding: "6px" }}>{isEditing
                                    ? <input type="number" min="1" max="5" value={ed.detection_quality ?? s.detection_quality ?? ""} onChange={(e) => setTrainingEditData((d) => ({ ...d, detection_quality: e.target.value ? parseInt(e.target.value) : null }))} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 6, background: t.inputBg, color: t.inputText, padding: "4px 6px", fontSize: 11, width: 50 }} />
                                    : <span style={{ color: s.detection_quality >= 4 ? t.success : s.detection_quality <= 2 ? t.error : t.text }}>{s.detection_quality ?? ""}</span>}</td>
                                  <td style={{ padding: "6px", color: t.muted, fontSize: 11 }}>{s.model_used || "—"}</td>
                                  <td style={{ padding: "6px", color: s.fallback_used ? t.error : t.muted, fontSize: 11 }}>{s.fallback_used ? "Да" : "—"}</td>
                                  <td style={{ padding: "6px" }}>{isEditing
                                    ? <input type="number" min="1" max="5" value={ed.questions_quality ?? s.questions_quality ?? ""} onChange={(e) => setTrainingEditData((d) => ({ ...d, questions_quality: e.target.value ? parseInt(e.target.value) : null }))} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 6, background: t.inputBg, color: t.inputText, padding: "4px 6px", fontSize: 11, width: 50 }} />
                                    : <span style={{ color: s.questions_quality >= 4 ? t.success : s.questions_quality <= 2 ? t.error : t.text }}>{s.questions_quality ?? ""}</span>}</td>
                                  <td style={{ padding: "6px" }}>{isEditing
                                    ? <input type="number" min="1" max="5" value={ed.report_quality ?? s.report_quality ?? ""} onChange={(e) => setTrainingEditData((d) => ({ ...d, report_quality: e.target.value ? parseInt(e.target.value) : null }))} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 6, background: t.inputBg, color: t.inputText, padding: "4px 6px", fontSize: 11, width: 50 }} />
                                    : <span style={{ color: s.report_quality >= 4 ? t.success : s.report_quality <= 2 ? t.error : t.text }}>{s.report_quality ?? ""}</span>}</td>
                                  <td style={{ padding: "6px" }}>{isEditing
                                    ? <input type="number" min="1" max="5" value={ed.safety_quality ?? s.safety_quality ?? ""} onChange={(e) => setTrainingEditData((d) => ({ ...d, safety_quality: e.target.value ? parseInt(e.target.value) : null }))} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 6, background: t.inputBg, color: t.inputText, padding: "4px 6px", fontSize: 11, width: 50 }} />
                                    : <span style={{ color: s.safety_quality >= 4 ? t.success : s.safety_quality <= 2 ? t.error : t.text }}>{s.safety_quality ?? ""}</span>}</td>
                                  <td style={{ padding: "6px" }}>{isEditing
                                    ? <input type="number" min="1" max="5" value={ed.language_quality ?? s.language_quality ?? ""} onChange={(e) => setTrainingEditData((d) => ({ ...d, language_quality: e.target.value ? parseInt(e.target.value) : null }))} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 6, background: t.inputBg, color: t.inputText, padding: "4px 6px", fontSize: 11, width: 50 }} />
                                    : <span style={{ color: s.language_quality >= 4 ? t.success : s.language_quality <= 2 ? t.error : t.text }}>{s.language_quality ?? ""}</span>}</td>
                                  <td style={{ padding: "6px" }}>{isEditing
                                    ? <input type="number" min="1" max="5" value={ed.support_toolkit_quality ?? s.support_toolkit_quality ?? ""} onChange={(e) => setTrainingEditData((d) => ({ ...d, support_toolkit_quality: e.target.value ? parseInt(e.target.value) : null }))} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 6, background: t.inputBg, color: t.inputText, padding: "4px 6px", fontSize: 11, width: 50 }} />
                                    : <span style={{ color: s.support_toolkit_quality >= 4 ? t.success : s.support_toolkit_quality <= 2 ? t.error : t.text }}>{s.support_toolkit_quality ?? ""}</span>}</td>
                                  <td style={{ padding: "6px" }}>{isEditing
                                    ? <input type="number" min="1" max="5" value={ed.continuation_quality ?? s.continuation_quality ?? ""} onChange={(e) => setTrainingEditData((d) => ({ ...d, continuation_quality: e.target.value ? parseInt(e.target.value) : null }))} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 6, background: t.inputBg, color: t.inputText, padding: "4px 6px", fontSize: 11, width: 50 }} />
                                    : <span style={{ color: s.continuation_quality >= 4 ? t.success : s.continuation_quality <= 2 ? t.error : t.text }}>{s.continuation_quality ?? ""}</span>}</td>
                                  <td style={{ padding: "6px", color: s.repeated_questions ? t.error : t.muted, fontSize: 11 }}>{s.repeated_questions ? "Да" : "—"}</td>
                                  <td style={{ padding: "6px", color: s.missed_risk_flags ? t.error : t.muted, fontSize: 11 }}>{s.missed_risk_flags ? "Да" : "—"}</td>
                                  <td style={{ padding: "6px", color: s.wrong_recommendation ? t.error : t.muted, fontSize: 11 }}>{s.wrong_recommendation ? "Да" : "—"}</td>
                                  <td style={{ padding: "6px", color: s.remembered_context ? t.success : t.muted, fontSize: 11 }}>{s.remembered_context ? "Да" : "—"}</td>
                                  <td style={{ padding: "6px" }}>{isEditing
                                    ? <select value={ed.status ?? s.status ?? "new"} onChange={(e) => setTrainingEditData((d) => ({ ...d, status: e.target.value }))} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 6, background: t.inputBg, color: t.inputText, padding: "4px 6px", fontSize: 11 }}>{["new","reviewed","needs_prompt_update","approved_for_learning","rejected","archived"].map((o) => <option key={o} value={o}>{st(o)}</option>)}</select>
                                    : <span style={{
                                        fontSize: 11, fontWeight: 700, padding: "2px 6px", borderRadius: 6,
                                        background: s.status === "approved_for_learning" ? t.badgeClosed : s.status === "rejected" ? t.badgeNew : s.status === "reviewed" ? t.badgeInProgress : t.badgePending,
                                        color: s.status === "approved_for_learning" ? t.badgeClosedText : s.status === "rejected" ? t.badgeNewText : s.status === "reviewed" ? t.badgeInProgressText : t.badgePendingText,
                                      }}>{st(s.status) || "Новый"}</span>}</td>
                                  <td style={{ padding: "6px", maxWidth: 120 }}>{isEditing
                                    ? <input value={ed.short_summary ?? s.short_summary ?? ""} onChange={(e) => setTrainingEditData((d) => ({ ...d, short_summary: e.target.value }))} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 6, background: t.inputBg, color: t.inputText, padding: "4px 6px", fontSize: 11, width: 120 }} />
                                    : <span style={{ color: t.text, fontSize: 11 }}>{s.short_summary || ""}</span>}</td>
                                  <td style={{ padding: "6px", maxWidth: 120 }}>{isEditing
                                    ? <input value={ed.main_problem ?? s.main_problem ?? ""} onChange={(e) => setTrainingEditData((d) => ({ ...d, main_problem: e.target.value }))} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 6, background: t.inputBg, color: t.inputText, padding: "4px 6px", fontSize: 11, width: 120 }} />
                                    : <span style={{ color: t.text, fontSize: 11 }}>{s.main_problem || ""}</span>}</td>
                                  <td style={{ padding: "6px", maxWidth: 120 }}>{isEditing
                                    ? <input value={ed.expert_comment ?? s.expert_comment ?? ""} onChange={(e) => setTrainingEditData((d) => ({ ...d, expert_comment: e.target.value }))} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 6, background: t.inputBg, color: t.inputText, padding: "4px 6px", fontSize: 11, width: 120 }} />
                                    : <span style={{ color: t.text, fontSize: 11 }}>{s.expert_comment || ""}</span>}</td>
                                  <td style={{ padding: "6px", maxWidth: 100 }}>{isEditing
                                    ? <input value={ed.action_needed ?? s.action_needed ?? ""} onChange={(e) => setTrainingEditData((d) => ({ ...d, action_needed: e.target.value }))} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 6, background: t.inputBg, color: t.inputText, padding: "4px 6px", fontSize: 11, width: 100 }} />
                                    : <span style={{ color: t.text, fontSize: 11 }}>{s.action_needed || ""}</span>}</td>
                                  <td style={{ padding: "6px", maxWidth: 100 }}>{isEditing
                                    ? <input value={ed.continuation_comment ?? s.continuation_comment ?? ""} onChange={(e) => setTrainingEditData((d) => ({ ...d, continuation_comment: e.target.value }))} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 6, background: t.inputBg, color: t.inputText, padding: "4px 6px", fontSize: 11, width: 100 }} />
                                    : <span style={{ color: t.text, fontSize: 11 }}>{s.continuation_comment || ""}</span>}</td>
                                  <td style={{ padding: "6px", whiteSpace: "nowrap" }}>
                                    {isEditing ? (
                                      <>
                                        <button onClick={async () => { await updateTrainingSession(s.id, trainingEditData); setTrainingEditId(null); setTrainingEditData({}); }} style={{ border: 0, borderRadius: 6, background: t.accent, color: "#fff", padding: "4px 8px", fontWeight: 700, fontSize: 11, cursor: "pointer", marginRight: 4 }}>Сохранить</button>
                                        <button onClick={() => { setTrainingEditId(null); setTrainingEditData({}); }} style={{ border: `1px solid ${t.border}`, borderRadius: 6, background: t.tabBg, color: t.text, padding: "4px 8px", fontWeight: 600, fontSize: 11, cursor: "pointer" }}>Отмена</button>
                                      </>
                                    ) : (
                                      <>
                                        <button onClick={() => { setTrainingEditId(s.id); setTrainingEditData({}); }} style={{ border: `1px solid ${t.border}`, borderRadius: 6, background: "transparent", color: t.accent, padding: "4px 8px", fontWeight: 600, fontSize: 11, cursor: "pointer", marginRight: 4 }}>✎</button>
                                        <button onClick={() => { setTrainingTrashConfirm(s); setTrainingDeletionReason(""); }} style={{ border: `1px solid ${t.border}`, borderRadius: 6, background: "transparent", color: t.muted, padding: "4px 8px", fontWeight: 600, fontSize: 11, cursor: "pointer" }}>🗑</button>
                                      </>
                                    )}
                                  </td>
                                </>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                </>
              ) : adminReqTab === "quality" ? (
                <>

                {/* Quality insight stats counter */}
                <div style={{ marginBottom: 24, padding: 20, border: `1px solid ${t.cardBorder}`, borderRadius: 16, background: t.cardBg }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                    <div>
                      <h2 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 8px 0" }}>Обзоры качества</h2>
                      <div style={{ color: t.muted, fontSize: 14, lineHeight: 1.6 }}>
                        Система рекомендует формировать обзор после каждых 10 новых одобренных кейсов.
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 36, fontWeight: 900, color: qualityStats.recommended_to_analyze ? t.danger : t.accent }}>
                        {qualityStats.new_approved_count}
                      </div>
                      <div style={{ color: t.muted, fontSize: 13 }}>новых одобренных кейсов</div>
                    </div>
                  </div>

                  {qualityStats.last_analysis_at && (
                    <div style={{ color: t.muted, fontSize: 13, marginTop: 8 }}>
                      Последний обзор: {new Date(qualityStats.last_analysis_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}
                      {qualityStats.last_analysis_review_count > 0 ? ` (${qualityStats.last_analysis_review_count} кейсов)` : ""}
                    </div>
                  )}

                  <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                    <button
                      onClick={() => {
                        if (qualityStats.new_approved_count === 0 && qualitySelectedReviewIds.length === 0) {
                          showToast("Нет кейсов для анализа", "error");
                          return;
                        }
                        setQualityConfirmOpen(true);
                      }}
                      disabled={qualityGenerating}
                      style={{
                        border: 0, borderRadius: 14, padding: "12px 24px", fontWeight: 700, fontSize: 15, cursor: qualityGenerating ? "not-allowed" : "pointer",
                        background: qualityStats.recommended_to_analyze ? t.danger : t.accent,
                        color: qualityStats.recommended_to_analyze ? "#fff" : "#fff",
                        opacity: qualityGenerating ? 0.6 : 1,
                      }}
                    >
                      {qualityGenerating ? "Анализируем..." : qualitySelectedReviewIds.length > 0
                        ? `Сформировать обзор выбранных (${qualitySelectedReviewIds.length})`
                        : "Сформировать обзор новых кейсов"}
                    </button>
                    <button
                      onClick={() => { loadQualityStats(); loadQualityInsights(); }}
                      style={{
                        border: `1px solid ${t.border}`, borderRadius: 12, background: t.tabBg,
                        color: t.text, padding: "10px 16px", fontWeight: 600, fontSize: 14, cursor: "pointer",
                      }}
                    >
                      Обновить
                    </button>
                  </div>

                  {qualityStats.new_approved_count > 0 && qualityStats.new_approved_count < 5 && (
                    <div style={{ color: t.muted, fontSize: 13, marginTop: 8, padding: "8px 12px", border: `1px solid ${t.border}`, borderRadius: 8, background: t.highlight }}>
                      Кейсов пока мало. Выводы могут быть предварительными.
                    </div>
                  )}

                  {qualityStats.recommended_to_analyze && (
                    <div style={{ color: t.danger, fontSize: 15, fontWeight: 700, marginTop: 8, padding: "8px 12px", border: `1px solid ${t.danger}`, borderRadius: 8, background: t.dangerBg }}>
                      Пора сформировать новый обзор
                    </div>
                  )}
                </div>

                {/* Quality insights list */}
                {qualityLoading ? (
                  <div style={{ color: t.muted, textAlign: "center", padding: 40 }}>Загрузка...</div>
                ) : qualityInsights.length === 0 ? (
                  <div style={{ color: t.muted, textAlign: "center", padding: 40 }}>Нет сохранённых обзоров</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    {qualityInsights.map((insight) => {
                      const isDetailView = qualityDetailInsight && qualityDetailInsight.id === insight.id;
                      const d = isDetailView ? qualityDetailInsight : insight;
                      return (
                        <div key={insight.id} style={{
                          border: `1px solid ${t.cardBorder}`, borderRadius: 20,
                          background: t.crisisCard, padding: 20,
                        }}>
                          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                              <span style={{ fontWeight: 700, fontSize: 16 }}>Обзор качества</span>
                              <span style={{ color: t.crisisMuted, fontSize: 13 }}>
                                от {new Date(insight.created_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}
                              </span>
                              <span style={{
                                fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 8,
                                background: insight.status === "accepted" || insight.status === "partially_accepted" ? t.badgeClosed
                                  : insight.status === "rejected" ? t.badgeNew
                                  : insight.status === "under_review" ? t.badgeInProgress
                                  : insight.status === "archived" ? t.badgeFalseAlarm
                                  : t.badgePending,
                                color: insight.status === "accepted" || insight.status === "partially_accepted" ? t.badgeClosedText
                                  : insight.status === "rejected" ? t.badgeNewText
                                  : insight.status === "under_review" ? t.badgeInProgressText
                                  : insight.status === "archived" ? t.badgeFalseAlarmText
                                  : t.badgePendingText,
                              }}>
                                {QUALITY_STATUS_LABELS[insight.status] || insight.status}
                              </span>
                            </div>
                            <div style={{ color: t.crisisMuted, fontSize: 13 }}>
                              {insight.review_count} кейсов
                              {insight.model_used ? ` · ${insight.model_used}` : ""}
                              {insight.fallback_used ? " · fallback" : ""}
                            </div>
                          </div>

                          {!isDetailView && insight.summary && (
                            <div style={{ color: t.crisisText, fontSize: 13, lineHeight: 1.5, marginBottom: 12 }}>
                              {insight.summary.slice(0, 300)}{insight.summary.length > 300 ? "..." : ""}
                            </div>
                          )}

                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button
                              onClick={async () => {
                                if (isDetailView) {
                                  setQualityDetailInsight(null);
                                } else {
                                  await loadQualityInsightDetail(insight.id);
                                }
                              }}
                              style={{
                                border: `1px solid ${t.border}`, borderRadius: 8, background: t.tabBg,
                                color: t.text, padding: "6px 12px", fontWeight: 600, fontSize: 12, cursor: "pointer",
                              }}
                            >
                              {isDetailView ? "Свернуть" : "Подробнее"}
                            </button>
                            <select
                              value={insight.status}
                              onChange={(e) => updateQualityInsightStatus(insight.id, e.target.value)}
                              style={{
                                border: `1px solid ${t.inputBorder}`, borderRadius: 8, background: t.inputBg,
                                color: t.inputText, padding: "6px 12px", fontSize: 12, cursor: "pointer",
                              }}
                            >
                              {["new","under_review","accepted","partially_accepted","rejected","archived"].map((s) => (
                                <option key={s} value={s}>{QUALITY_STATUS_LABELS[s]}</option>
                              ))}
                            </select>
                            <button
                              onClick={() => copyOpenCodeTask(insight)}
                              style={{
                                border: `1px solid ${t.jsonlBtnBorder}`, borderRadius: 8, background: t.jsonlBtn,
                                color: t.jsonlBtnText, padding: "6px 12px", fontWeight: 600, fontSize: 12, cursor: "pointer",
                              }}
                            >
                              Скопировать задание для OpenCode
                            </button>
                          </div>

                          {isDetailView && d && detailQualityInsightView(d, t)}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Confirm dialog */}
                {qualityConfirmOpen && (
                  <div style={{
                    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
                    background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center",
                    justifyContent: "center", zIndex: 1000,
                  }} onClick={() => setQualityConfirmOpen(false)}>
                    <div style={{
                      background: t.cardBg, border: `1px solid ${t.cardBorder}`, borderRadius: 20,
                      padding: 24, maxWidth: 500, width: "90%",
                    }} onClick={(e) => e.stopPropagation()}>
                      <h3 style={{ margin: "0 0 12px", fontSize: 18, fontWeight: 700 }}>Сформировать обзор</h3>
                      <p style={{ color: t.crisisText, fontSize: 14, lineHeight: 1.6, margin: "0 0 16px" }}>
                        {qualitySelectedReviewIds.length > 0
                          ? `В анализ войдут ${qualitySelectedReviewIds.length} выбранных кейсов.`
                          : `В анализ войдут ${qualityStats.new_approved_count} новых одобренных кейсов.`
                        }
                        {qualityStats.new_approved_count > 30 && qualitySelectedReviewIds.length === 0 && (
                          <><br />В этот обзор войдут 30 из {qualityStats.new_approved_count} новых одобренных кейсов. После анализа останется ещё {qualityStats.new_approved_count - 30}.</>
                        )}
                        <br /><br />
                        Это не изменит промпты или production автоматически.
                      </p>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          onClick={generateQualityInsight}
                          disabled={qualityGenerating}
                          style={{
                            flex: 1, border: 0, borderRadius: 12, background: t.accent, color: "#fff",
                            padding: "12px 20px", fontWeight: 700, fontSize: 14, cursor: qualityGenerating ? "not-allowed" : "pointer",
                            opacity: qualityGenerating ? 0.6 : 1,
                          }}
                        >
                          {qualityGenerating ? "Анализируем..." : "Продолжить"}
                        </button>
                        <button
                          onClick={() => setQualityConfirmOpen(false)}
                          style={{
                            flex: 1, border: `1px solid ${t.border}`, borderRadius: 12, background: t.tabBg,
                            color: t.text, padding: "12px 20px", fontWeight: 600, fontSize: 14, cursor: "pointer",
                          }}
                        >
                          Отмена
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                </>
              ) : adminReqTab === "organizations" ? (
                <>
                  <h2 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 20px 0" }}>Организации</h2>

                  <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
                    <button onClick={() => { setOrgFormEditId(null); setOrgForm({ name: "", slug: "", type: "clinic", city: "", comment: "" }); setOrgFormOpen(true); }} style={{ border: 0, borderRadius: 14, padding: "12px 24px", fontWeight: 700, fontSize: 14, cursor: "pointer", background: t.accent, color: "#fff" }}>
                      + Создать организацию
                    </button>
                  </div>

                  {/* Organization cards */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    {organizations.map((org) => (
                      <div key={org.id} style={{ border: `1px solid ${t.cardBorder}`, borderRadius: 20, background: t.cardBg, padding: 20 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 16 }}>{org.name}</div>
                            <div style={{ color: t.muted, fontSize: 13, marginTop: 4 }}>
                              {(orgTypeLabels[org.type] || org.type)} · {org.status}
                              {org.city ? ` · ${org.city}` : ""}
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button onClick={() => { setOrgForm({ name: org.name, slug: org.slug || "", type: org.type, city: org.city || "", comment: org.comment || "" }); setOrgFormEditId(org.id); setOrgFormOpen(true); }} style={{ border: `1px solid ${t.border}`, borderRadius: 10, background: t.tabBg, color: t.text, padding: "6px 12px", fontWeight: 600, fontSize: 12, cursor: "pointer" }}>
                              Редактировать
                            </button>
                            <button onClick={async () => { setOrgDetail(org); adminLoadOrganizationExperts(org.id); }} style={{ border: `1px solid ${t.accent}`, borderRadius: 10, background: t.highlight, color: t.text, padding: "6px 12px", fontWeight: 600, fontSize: 12, cursor: "pointer" }}>
                              Открыть ({org.expert_count} спец., {org.patient_count} пациентов)
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                    {organizations.length === 0 && (
                      <div style={{ color: t.muted, textAlign: "center", padding: 60, fontSize: 14 }}>
                        Нет организаций
                      </div>
                    )}
                  </div>

                  {/* Organization detail */}
                  {orgDetail && (
                    <div style={{ marginTop: 32, border: `1px solid ${t.accent}`, borderRadius: 20, background: t.highlight, padding: 24 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 8 }}>
                        <div>
                          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{orgDetail.name}</h3>
                          <div style={{ color: t.muted, fontSize: 13 }}>{orgDetail.type} · {orgDetail.status} · {orgDetail.city || "город не указан"}</div>
                        </div>
                        <button onClick={() => setOrgDetail(null)} style={{ border: `1px solid ${t.border}`, borderRadius: 10, background: t.tabBg, color: t.text, padding: "6px 12px", fontWeight: 600, fontSize: 12, cursor: "pointer" }}>
                          Закрыть
                        </button>
                      </div>

                      <div style={{ marginBottom: 16 }}>
                        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>Специалисты организации</div>
                        {orgExperts.length === 0 ? (
                          <div style={{ color: t.muted, fontSize: 13 }}>Нет специалистов</div>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {orgExperts.map((m) => (
                              <div key={m.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", border: `1px solid ${t.cardBorder}`, borderRadius: 12, background: t.cardBg, flexWrap: "wrap", gap: 8 }}>
                                <div>
                                  <span style={{ fontWeight: 600, fontSize: 14 }}>{m.experts?.name || "—"}</span>
                                  <span style={{ color: t.muted, fontSize: 12, marginLeft: 8 }}>{m.role} · {m.experts?.specialty || ""}</span>
                                </div>
                                <div style={{ display: "flex", gap: 6 }}>
                                  <span style={{ fontSize: 11, color: t.muted }}>{m.experts?.access_code || ""}</span>
                                  <button onClick={() => handleRemoveExpertFromOrg(m.expert_id)} style={{ border: `1px solid ${t.badgeNewText}`, borderRadius: 8, background: t.dangerBg, color: t.badgeNewText, padding: "4px 8px", fontWeight: 600, fontSize: 11, cursor: "pointer" }}>
                                    Удалить
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        <button onClick={async () => { const experts = await adminListAllExperts(); setOrgAddExpertOpen(true); }} style={{ border: `1px dashed ${t.accent}`, borderRadius: 10, background: "transparent", color: t.accent, padding: "8px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer", marginTop: 12 }}>
                          + Добавить специалиста
                        </button>
                      </div>

                      {/* Add expert modal */}
                      {orgAddExpertOpen && (
                        <div style={{ marginTop: 12, padding: 16, border: `1px solid ${t.cardBorder}`, borderRadius: 16, background: t.cardBg }}>
                          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Добавить специалиста</div>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            <input placeholder="ID специалиста" value={orgAddExpertId} onChange={(e) => setOrgAddExpertId(e.target.value)} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 10, background: t.inputBg, color: t.inputText, padding: "8px 12px", fontSize: 13, outline: "none", width: 200 }} />
                            <select value={orgAddExpertRole} onChange={(e) => setOrgAddExpertRole(e.target.value)} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 10, background: t.inputBg, color: t.inputText, padding: "8px 12px", fontSize: 13, cursor: "pointer" }}>
                              {["owner","admin","supervisor","doctor","assistant","observer"].map((r) => <option key={r} value={r}>{r}</option>)}
                            </select>
                            <button onClick={handleAddExpertToOrg} style={{ border: 0, borderRadius: 10, background: t.accent, color: "#fff", padding: "8px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Добавить</button>
                            <button onClick={() => setOrgAddExpertOpen(false)} style={{ border: `1px solid ${t.border}`, borderRadius: 10, background: t.tabBg, color: t.text, padding: "8px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Отмена</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Create/Edit organization form */}
                  {orgFormOpen && (
                    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
                      <div style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}`, borderRadius: 20, padding: 24, maxWidth: 500, width: "90%" }}>
                        <h3 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 800 }}>{orgFormEditId ? "Редактировать организацию" : "Создать организацию"}</h3>
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                          <input placeholder="Название *" value={orgForm.name} onChange={(e) => setOrgForm((f) => ({ ...f, name: e.target.value }))} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 10, background: t.inputBg, color: t.inputText, padding: "10px 14px", fontSize: 14, outline: "none" }} />
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <label style={{ fontSize: 13, fontWeight: 600, color: t.text }}>Slug / технический адрес</label>
                            <input placeholder="slug-organization" value={orgForm.slug} onChange={(e) => setOrgForm((f) => ({ ...f, slug: e.target.value }))} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 10, background: t.inputBg, color: t.inputText, padding: "10px 14px", fontSize: 14, outline: "none" }} />
                            <div style={{ fontSize: 12, color: t.muted, lineHeight: 1.4 }}>
                              Короткий уникальный идентификатор латиницей, например kazan-clinic или demo-test. Можно оставить пустым — система создаст автоматически.
                            </div>
                          </div>
                          <select value={orgForm.type} onChange={(e) => setOrgForm((f) => ({ ...f, type: e.target.value }))} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 10, background: t.inputBg, color: t.inputText, padding: "10px 14px", fontSize: 14, cursor: "pointer" }}>
                            {Object.entries(orgTypeLabels).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
                          </select>
                          <input placeholder="Город" value={orgForm.city} onChange={(e) => setOrgForm((f) => ({ ...f, city: e.target.value }))} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 10, background: t.inputBg, color: t.inputText, padding: "10px 14px", fontSize: 14, outline: "none" }} />
                          <textarea placeholder="Комментарий" value={orgForm.comment} onChange={(e) => setOrgForm((f) => ({ ...f, comment: e.target.value }))} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 10, background: t.inputBg, color: t.inputText, padding: "10px 14px", fontSize: 14, outline: "none", minHeight: 60, resize: "vertical" }} />
                        </div>
                        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
                          <button onClick={handleCreateOrganization} style={{ border: 0, borderRadius: 10, background: t.accent, color: "#fff", padding: "10px 18px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
                            {orgFormEditId ? "Сохранить" : "Создать"}
                          </button>
                          <button onClick={() => { setOrgFormOpen(false); setOrgFormEditId(null); }} style={{ border: `1px solid ${t.border}`, borderRadius: 10, background: t.tabBg, color: t.text, padding: "10px 18px", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
                            Отмена
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
              <>
              {/* Reviews filters */}
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24, alignItems: "center" }}>
                <select
                  value={adminFilter}
                  onChange={(e) => { const v = e.target.value; setAdminFilter(v); adminLoadReviews(v, adminEnv); }}
                  style={{
                    border: `1px solid ${t.filterBorder}`, borderRadius: 12, background: t.filterBg,
                    color: t.filterText, padding: "10px 16px", fontSize: 14, cursor: "pointer",
                  }}
                >
                  <option value="all">Все</option>
                  <option value="pending">Ожидают</option>
                  <option value="approved">Одобренные</option>
                  <option value="rejected">Отклонённые</option>
                  <option value="needs_review">На доработку</option>
                  <option value="local_auto_saved">Локальные</option>
                </select>
                <select
                  value={adminEnv}
                  onChange={(e) => { const v = e.target.value; setAdminEnv(v); adminLoadReviews(adminFilter, v); }}
                  style={{
                    border: `1px solid ${t.filterBorder}`, borderRadius: 12, background: t.filterBg,
                    color: t.filterText, padding: "10px 16px", fontSize: 14, cursor: "pointer",
                  }}
                >
                  <option value="all">Все</option>
                  <option value="production">Рабочий сайт (Production)</option>
                  <option value="preview">Предпросмотр (Preview)</option>
                  <option value="development">Разработка (Development)</option>
                  <option value="local">Локально (Local)</option>
                </select>
                <select
                  value={adminExpertFilter}
                  onChange={(e) => { const v = e.target.value; setAdminExpertFilter(v); adminLoadReviews(adminFilter, adminEnv, v); }}
                  style={{
                    border: `1px solid ${t.filterBorder}`, borderRadius: 12, background: t.filterBg,
                    color: t.filterText, padding: "10px 16px", fontSize: 14, cursor: "pointer",
                  }}
                >
                  <option value="all">Все отзывы</option>
                  <option value="with_expert">С экспертом</option>
                  <option value="without_expert">Без эксперта</option>
                </select>
                <button
                  style={{
                    border: `1px solid ${t.border}`, borderRadius: 12, background: t.tabBg,
                    color: t.text, padding: "10px 16px", fontWeight: 600, fontSize: 14, cursor: "pointer",
                  }}
                  onClick={() => adminLoadReviews()}
                >
                  {adminLoading ? "Загрузка..." : `Обновить (${adminTotal})`}
                </button>
                <button
                  style={{
                    border: `1px solid ${adminReviewShowTrash ? t.crisisAccent : t.border}`,
                    borderRadius: 12,
                    background: adminReviewShowTrash ? t.crisisAccent : t.tabBg,
                    color: adminReviewShowTrash ? "#fff" : t.text,
                    padding: "10px 16px", fontWeight: 700, fontSize: 14, cursor: "pointer",
                  }}
                  onClick={() => {
                    const next = !adminReviewShowTrash;
                    setAdminReviewShowTrash(next);
                    adminLoadReviews(adminFilter, adminEnv, adminExpertFilter, next);
                  }}
                >
                  {adminReviewShowTrash ? "🗑 Активные" : "🗑 Корзина"}
                </button>
              </div>

              {/* Reviews list */}
              {adminLoading ? (
                <div style={{ color: t.muted, textAlign: "center", padding: 60 }}>Загрузка...</div>
              ) : adminReviews.length === 0 ? (
                <div style={{ color: t.muted, textAlign: "center", padding: 60 }}>Нет записей</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {adminReviews.map((review) => {
                    try {
                    const json = getReviewJson(review);
                    const correction = getDoctorCorrection(review);
                    const corrected = getCorrectedJson(review);
                    const norm = normalizeReviewDetails(review);

                    const patientText = safeText(norm.patientText);
                    const userReport = safeText(norm.userReport);
                    const doctorReport = safeText(norm.doctorReport);
                    const doctorFeedbackComment = safeText(norm.doctorFeedback?.generalComment || "");
                    const rounds = norm.rounds;
                    const status = safeText(json.status, "legacy");
                    const source = safeText(json.source, "—");
                    const environment = safeText(json.environment, "—");
                    const publicCode = safeText(json.public_code || json.publicCode, "—");
                    const expertName = safeText(json.expert_name || "");
                    const expertRole = safeText(json.expert_role || "");
                    const expertSpecialty = safeText(json.expert_specialty || "");
                    const city = safeText(json.city || "");
                    const organization = safeText(json.organization || "");

                    return (
                      <div
                        key={review.id}
                        style={{
                          border: `1px solid ${t.crisisBorder}`, borderRadius: 20,
                          background: t.crisisCard, padding: 20,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            {status === "approved" && (
                              <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: 11, color: t.muted }}>
                                <input
                                  type="checkbox"
                                  checked={qualitySelectedReviewIds.includes(review.id)}
                                  onChange={() => toggleReviewSelection(review.id)}
                                  style={{ cursor: "pointer" }}
                                />
                                В обзор
                              </label>
                            )}
                            <span style={{ color: t.crisisMuted, fontSize: 12 }}>
                              {safeDate(review.created_at)}
                            </span>
                            <span style={{
                              fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 8,
                              background: status === "approved" ? t.badgeClosed : status === "rejected" ? t.badgeNew : status === "needs_review" ? t.badgePending : status === "local_auto_saved" ? t.badgeInProgress : t.badgeFalseAlarm,
                              color: status === "approved" ? t.badgeClosedText : status === "rejected" ? t.badgeNewText : status === "needs_review" ? t.badgePendingText : status === "local_auto_saved" ? t.badgeInProgressText : t.badgeFalseAlarmText,
                            }}>
                              {status}
                            </span>
                            <span style={{ color: t.cardLabel, fontSize: 12 }}>
                              {environment} / {source}
                            </span>
                          </div>
                          {publicCode !== "—" ? (
                            <span
                              onClick={() => loadSessionTimeline(publicCode)}
                              title="Показать все сессии по этому коду"
                              style={{ fontWeight: 700, fontSize: 13, color: t.crisisAccent, letterSpacing: 0.5, cursor: "pointer", textDecoration: "underline dotted", textUnderlineOffset: 3 }}
                            >
                              {publicCode}
                            </span>
                          ) : (
                            <span style={{ fontWeight: 700, fontSize: 13, color: t.muted, letterSpacing: 0.5 }}>
                              Код продолжения не сохранён
                            </span>
                          )}
                        </div>

                        {expertName && (
                          <div style={{ marginBottom: 10, fontSize: 12, color: t.crisisAccent }}>
                            🔬 {expertName}{expertRole ? `, ${expertRole}` : ""}{expertSpecialty ? ` (${expertSpecialty})` : ""}{city ? ` · ${city}` : ""}{organization ? ` · ${organization}` : ""}
                          </div>
                        )}

                        {renderReviewSections(review, json, t, { patientText, userReport, doctorReport, doctorFeedbackComment, conversationHistory: rounds, doctorFeedback: norm.doctorFeedback })}

                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button
                            disabled={!review?.id || adminActionLoading === review.id}
                            style={{
                              border: 0, borderRadius: 12, background: t.badgeClosed, color: t.badgeClosedText,
                              padding: "8px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer",
                              opacity: adminActionLoading === review.id ? 0.5 : 1,
                            }}
                            onClick={() => adminUpdateStatus(review.id, "approved")}
                          >
                            Одобрить
                          </button>
                          <button
                            disabled={!review?.id || adminActionLoading === review.id}
                            style={{
                              border: 0, borderRadius: 12, background: t.badgeNew, color: t.badgeNewText,
                              padding: "8px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer",
                              opacity: adminActionLoading === review.id ? 0.5 : 1,
                            }}
                            onClick={() => adminUpdateStatus(review.id, "rejected")}
                          >
                            Отклонить
                          </button>
                          <button
                            disabled={!review?.id || adminActionLoading === review.id}
                            style={{
                              border: 0, borderRadius: 12, background: t.badgePending, color: t.badgePendingText,
                              padding: "8px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer",
                              opacity: adminActionLoading === review.id ? 0.5 : 1,
                            }}
                            onClick={() => adminUpdateStatus(review.id, "needs_review")}
                          >
                            Требует доработки
                          </button>
                          <button
                            disabled={!review?.id}
                            style={{
                              border: `1px solid ${t.crisisActionJsonlBorder}`, borderRadius: 12, background: t.crisisActionJsonl,
                              color: t.crisisActionJsonlText, padding: "8px 14px", fontWeight: 600, fontSize: 12, cursor: "pointer",
                            }}
                            onClick={() => adminDownloadJson(review)}
                          >
                            Скачать JSON
                          </button>
                          <button
                            disabled={!review?.id}
                            style={{
                              border: `1px solid ${t.crisisActionJsonlBorder}`, borderRadius: 12, background: t.crisisActionJsonl,
                              color: t.crisisAccent, padding: "8px 14px", fontWeight: 600, fontSize: 12, cursor: "pointer",
                            }}
                            onClick={() => {
                              setTrainingFormReviewId(review.id);
                              setTrainingFormData((d) => ({ ...d, public_code: review.public_code || "" }));
                            }}
                          >
                            + В таблицу тренировок
                          </button>
                          <button
                            disabled={!review?.id}
                            style={{
                              border: `1px solid ${t.crisisActionJsonlBorder}`, borderRadius: 12, background: t.crisisActionJsonl,
                              color: t.crisisAccent, padding: "8px 14px", fontWeight: 600, fontSize: 12, cursor: "pointer",
                            }}
                            onClick={() => openCorrectionForm(review)}
                          >
                            Редактировать
                          </button>
                          {!adminReviewShowTrash ? (
                            <button
                              disabled={!review?.id}
                              title="Удалить из отзывов"
                              style={{
                                border: `1px solid ${t.crisisBorder}`, borderRadius: 12, background: t.crisisActionJsonl,
                                color: "#e74c3c", padding: "8px 14px", fontWeight: 600, fontSize: 16, cursor: "pointer",
                                lineHeight: 1,
                              }}
                              onClick={() => {
                                const j = getReviewJson(review);
                                const code = j.public_code || j.publicCode || review.public_code || "—";
                                setDeleteConfirmReviewId(review.id);
                                setDeleteConfirmCode(code);
                                setDeleteConfirmType("soft");
                                setDeleteConfirmStep(1);
                              }}
                            >
                              🗑
                            </button>
                          ) : (
                            <>
                              <button
                                disabled={!review?.id}
                                title="Восстановить"
                                style={{
                                  border: `1px solid ${t.crisisActionJsonlBorder}`, borderRadius: 12, background: t.crisisActionJsonl,
                                  color: t.badgeClosedText, padding: "8px 14px", fontWeight: 600, fontSize: 12, cursor: "pointer",
                                }}
                                onClick={async () => {
                                  setAdminActionLoading(review.id);
                                  try {
                                    const res = await fetch("/api/reviews", {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ action: "restoreReview", review_id: review.id, admin_secret: adminPassword }),
                                    });
                                    const d = await res.json();
                                    showToast(d.message || (d.ok ? "Восстановлено" : d.error), d.ok ? "success" : "error");
                                    if (d.ok) adminLoadReviews();
                                  } catch {
                                    showToast("Ошибка восстановления", "error");
                                  } finally {
                                    setAdminActionLoading(null);
                                  }
                                }}
                              >
                                ↩️ Восстановить
                              </button>
                              <button
                                disabled={!review?.id}
                                title="Удалить безвозвратно"
                                style={{
                                  border: `1px solid ${t.crisisBorder}`, borderRadius: 12, background: t.crisisActionJsonl,
                                  color: "#e74c3c", padding: "8px 14px", fontWeight: 600, fontSize: 12, cursor: "pointer",
                                }}
                                onClick={() => {
                                  const j = getReviewJson(review);
                                  const code = j.public_code || j.publicCode || review.public_code || "—";
                                  setDeleteConfirmReviewId(review.id);
                                  setDeleteConfirmCode(code);
                                  setDeleteConfirmType("permanent");
                                  setDeleteConfirmStep(1);
                                }}
                              >
                                🗑 Удалить запись
                              </button>
                              <button
                                disabled={!review?.id}
                                title="Удалить всю тестовую сессию"
                                style={{
                                  border: `1px solid #e74c3c`, borderRadius: 12,
                                  background: "#e74c3c", color: "#fff",
                                  padding: "8px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer",
                                }}
                                onClick={() => {
                                  const j = getReviewJson(review);
                                  const code = j.public_code || j.publicCode || review.public_code || "—";
                                  setDeleteConfirmReviewId(review.id);
                                  setDeleteConfirmCode(code);
                                  setDeleteConfirmType("full");
                                  setDeleteConfirmStep(1);
                                }}
                              >
                                ☠ Полностью
                              </button>
                            </>
                          )}
                        </div>

                        {/* Delete confirmation dialog */}
                        {deleteConfirmReviewId === review.id && deleteConfirmStep >= 1 && (
                          <div style={{
                            marginTop: 16, border: `2px solid #e74c3c`, borderRadius: 16,
                            background: t.cardBorder, padding: 20, position: "relative",
                          }}>
                            <div style={{ fontWeight: 700, fontSize: 15, color: "#e74c3c", marginBottom: 12 }}>
                              {deleteConfirmType === "soft" ? "🗑 Удаление карточки" :
                               deleteConfirmType === "permanent" ? "🔥 Безвозвратное удаление" :
                               "☠ Удаление всей тестовой сессии"}
                            </div>

                            {deleteConfirmType === "soft" && deleteConfirmStep === 1 && (
                              <>
                                <p style={{ color: t.crisisText, fontSize: 13, lineHeight: 1.5, margin: "0 0 12px" }}>
                                  Карточка отзыва <strong>{deleteConfirmCode}</strong> будет перемещена в корзину.<br />
                                  Исходная сессия и диалог останутся в базе.
                                </p>
                                <div style={{ display: "flex", gap: 8 }}>
                                  <button
                                    style={{ border: 0, borderRadius: 10, background: "#e74c3c", color: "#fff", padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
                                    onClick={async () => {
                                      setAdminActionLoading(review.id);
                                      try {
                                        const res = await fetch("/api/reviews", {
                                          method: "POST",
                                          headers: { "Content-Type": "application/json" },
                                          body: JSON.stringify({ action: "softDeleteReview", review_id: review.id, admin_secret: adminPassword }),
                                        });
                                        const d = await res.json();
                                        showToast(d.message || (d.ok ? "Удалено" : d.error), d.ok ? "success" : "error");
                                        if (d.ok) { setDeleteConfirmReviewId(null); setDeleteConfirmStep(0); adminLoadReviews(); }
                                      } catch { showToast("Ошибка удаления", "error"); }
                                      finally { setAdminActionLoading(null); }
                                    }}
                                  >
                                    Переместить в корзину
                                  </button>
                                  <button
                                    style={{ border: `1px solid ${t.border}`, borderRadius: 10, background: t.tabBg, color: t.text, padding: "8px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
                                    onClick={() => { setDeleteConfirmReviewId(null); setDeleteConfirmStep(0); }}
                                  >
                                    Отмена
                                  </button>
                                </div>
                              </>
                            )}

                            {deleteConfirmType === "permanent" && (
                              <>
                                {deleteConfirmStep === 1 ? (
                                  <>
                                    <p style={{ color: t.crisisText, fontSize: 13, lineHeight: 1.5, margin: "0 0 4px" }}>
                                      Вы уверены, что хотите <strong style={{ color: "#e74c3c" }}>безвозвратно удалить</strong> запись <strong>{deleteConfirmCode}</strong>?
                                    </p>
                                    <p style={{ color: t.muted, fontSize: 12, margin: "0 0 12px" }}>
                                      Будет удалена только эта запись <code>case_review</code>.<br />
                                      Действие нельзя отменить.
                                    </p>
                                    <div style={{ display: "flex", gap: 8 }}>
                                      <button
                                        style={{ border: 0, borderRadius: 10, background: "#e74c3c", color: "#fff", padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
                                        onClick={() => setDeleteConfirmStep(2)}
                                      >
                                        Да, удалить навсегда
                                      </button>
                                      <button
                                        style={{ border: `1px solid ${t.border}`, borderRadius: 10, background: t.tabBg, color: t.text, padding: "8px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
                                        onClick={() => { setDeleteConfirmReviewId(null); setDeleteConfirmStep(0); }}
                                      >
                                        Отмена
                                      </button>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <p style={{ color: t.crisisText, fontSize: 13, lineHeight: 1.5, margin: "0 0 12px" }}>
                                      ⚠️ Последнее подтверждение. Запись <strong>{deleteConfirmCode}</strong> будет удалена безвозвратно. Восстановление невозможно.
                                    </p>
                                    <div style={{ display: "flex", gap: 8 }}>
                                      <button
                                        style={{ border: 0, borderRadius: 10, background: "#e74c3c", color: "#fff", padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
                                        onClick={async () => {
                                          setAdminActionLoading(review.id);
                                          try {
                                            const res = await fetch("/api/reviews", {
                                              method: "POST",
                                              headers: { "Content-Type": "application/json" },
                                              body: JSON.stringify({ action: "permanentDeleteReview", review_id: review.id, admin_secret: adminPassword }),
                                            });
                                            const d = await res.json();
                                            showToast(d.message || (d.ok ? "Удалено" : d.error), d.ok ? "success" : "error");
                                            if (d.ok) { setDeleteConfirmReviewId(null); setDeleteConfirmStep(0); adminLoadReviews(); }
                                          } catch { showToast("Ошибка удаления", "error"); }
                                          finally { setAdminActionLoading(null); }
                                        }}
                                      >
                                        🔥 Подтверждаю безвозвратное удаление
                                      </button>
                                      <button
                                        style={{ border: `1px solid ${t.border}`, borderRadius: 10, background: t.tabBg, color: t.text, padding: "8px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
                                        onClick={() => { setDeleteConfirmReviewId(null); setDeleteConfirmStep(0); }}
                                      >
                                        Отмена
                                      </button>
                                    </div>
                                  </>
                                )}
                              </>
                            )}

                            {deleteConfirmType === "full" && (
                              <>
                                {deleteConfirmStep === 1 ? (
                                  <>
                                    <p style={{ color: t.crisisText, fontSize: 13, lineHeight: 1.5, margin: "0 0 4px" }}>
                                      ⚠️ Вы собираетесь <strong style={{ color: "#e74c3c" }}>полностью удалить тестовую сессию</strong> <strong>{deleteConfirmCode}</strong>.
                                    </p>
                                    <p style={{ color: t.muted, fontSize: 12, margin: "0 0 12px" }}>
                                      Будут удалены: <code>case_review</code>, <code>training_session</code>, <code>session</code>.<br />
                                      Диалог и отчёты восстановить будет невозможно.
                                    </p>
                                    <div style={{ display: "flex", gap: 8 }}>
                                      <button
                                        style={{ border: 0, borderRadius: 10, background: "#e74c3c", color: "#fff", padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
                                        onClick={() => setDeleteConfirmStep(2)}
                                      >
                                        Да, я понимаю. Удалить всё.
                                      </button>
                                      <button
                                        style={{ border: `1px solid ${t.border}`, borderRadius: 10, background: t.tabBg, color: t.text, padding: "8px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
                                        onClick={() => { setDeleteConfirmReviewId(null); setDeleteConfirmStep(0); }}
                                      >
                                        Отмена
                                      </button>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <p style={{ color: "#e74c3c", fontSize: 13, lineHeight: 1.5, margin: "0 0 12px", fontWeight: 700 }}>
                                      ☠️ Последнее предупреждение!<br />
                                      Сессия <strong>{deleteConfirmCode}</strong> будет удалена из всех таблиц.<br />
                                      Восстановление невозможно. Это действие только для администратора.
                                    </p>
                                    <div style={{ display: "flex", gap: 8 }}>
                                      <button
                                        style={{ border: 0, borderRadius: 10, background: "#e74c3c", color: "#fff", padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
                                        onClick={async () => {
                                          setAdminActionLoading(review.id);
                                          try {
                                            const res = await fetch("/api/reviews", {
                                              method: "POST",
                                              headers: { "Content-Type": "application/json" },
                                              body: JSON.stringify({ action: "deleteFullTestSession", review_id: review.id, admin_secret: adminPassword }),
                                            });
                                            const d = await res.json();
                                            if (d.ok) {
                                              showToast(d.message + ` (case_review: ${d.deleted.case_review}, session: ${d.deleted.session}, training: ${d.deleted.training_sessions})`, "success");
                                              setDeleteConfirmReviewId(null);
                                              setDeleteConfirmStep(0);
                                              adminLoadReviews();
                                            } else {
                                              showToast(d.error || "Ошибка", "error");
                                            }
                                          } catch { showToast("Ошибка удаления сессии", "error"); }
                                          finally { setAdminActionLoading(null); }
                                        }}
                                      >
                                        ☠️ Подтверждаю полное удаление
                                      </button>
                                      <button
                                        style={{ border: `1px solid ${t.border}`, borderRadius: 10, background: t.tabBg, color: t.text, padding: "8px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
                                        onClick={() => { setDeleteConfirmReviewId(null); setDeleteConfirmStep(0); }}
                                      >
                                        Отмена
                                      </button>
                                    </div>
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        )}

                        {trainingFormReviewId === review.id && (
                          <div style={{ marginTop: 16, borderTop: `1px solid ${t.cardBorder}`, paddingTop: 16 }}>
                            <div style={{ color: t.crisisText, fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Добавление в таблицу тренировок</div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                              <input placeholder="Код пациента" value={trainingFormData.public_code || ""} onChange={(e) => setTrainingFormData((d) => ({ ...d, public_code: e.target.value }))} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 10, background: t.inputBg, color: t.inputText, padding: "8px 12px", fontSize: 13, outline: "none" }} />
                              <select value={trainingFormData.session_kind || "initial"} onChange={(e) => setTrainingFormData((d) => ({ ...d, session_kind: e.target.value }))} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 10, background: t.inputBg, color: t.inputText, padding: "8px 12px", fontSize: 13, cursor: "pointer" }}>
                                {["initial","follow_up","diary_check","support_toolkit_check","crisis_check","doctor_review","other"].map((o) => <option key={o} value={o}>{sk(o)}</option>)}
                              </select>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                              <input placeholder="Что играем в этой сессии?" value={trainingFormData.scenario_played || ""} onChange={(e) => setTrainingFormData((d) => ({ ...d, scenario_played: e.target.value }))} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 10, background: t.inputBg, color: t.inputText, padding: "8px 12px", fontSize: 13, outline: "none" }} />
                              <select value={trainingFormData.expected_case_type || ""} onChange={(e) => setTrainingFormData((d) => ({ ...d, expected_case_type: e.target.value }))} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 10, background: t.inputBg, color: t.inputText, padding: "8px 12px", fontSize: 13, cursor: "pointer" }}>
                                <option value="">Ожидаемый тип случая</option>
                                {["anxiety","sleep","depression_like","grief","trauma","body_tension","adhd_like","substance","alcohol","bipolar_red_flags","psychosis_red_flags","acute_psychosis","suicide_risk","self_harm_risk","medication_issue","mixed","other"].map((o) => <option key={o} value={o}>{ct(o)}</option>)}
                              </select>
                            </div>
                            <textarea value={trainingFormData.expert_comment || ""} onChange={(e) => setTrainingFormData((d) => ({ ...d, expert_comment: e.target.value }))} placeholder="Комментарий эксперта" style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 10, background: t.inputBg, color: t.inputText, padding: "8px 12px", fontSize: 13, outline: "none", width: "100%", minHeight: 40, marginBottom: 10, resize: "vertical" }} />
                            <div style={{ display: "flex", gap: 8 }}>
                              <button onClick={createTrainingFromReview} style={{ border: 0, borderRadius: 10, background: t.accent, color: "#fff", padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Создать</button>
                              <button onClick={() => setTrainingFormReviewId(null)} style={{ border: `1px solid ${t.border}`, borderRadius: 10, background: t.tabBg, color: t.text, padding: "8px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Отмена</button>
                            </div>
                          </div>
                        )}
                        {editingReview === review.id && (
                          <div style={{ marginTop: 16, borderTop: `1px solid ${t.cardBorder}`, paddingTop: 16 }}>
                            <div style={{ color: t.crisisText, fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Редакция отзыва</div>

                            <input style={{ ...s.crisisInput, marginBottom: 8 }} placeholder="Что было неверно в вопросах?" value={correctionForm?.wrong_questions || ""} onChange={(e) => setCorrectionForm({ ...correctionForm, wrong_questions: e.target.value })} />
                            <input style={{ ...s.crisisInput, marginBottom: 8 }} placeholder="Какие вопросы нужно было добавить?" value={correctionForm?.missing_questions || ""} onChange={(e) => setCorrectionForm({ ...correctionForm, missing_questions: e.target.value })} />
                            <input style={{ ...s.crisisInput, marginBottom: 8 }} placeholder="Какие вопросы были лишними?" value={correctionForm?.bad_question_wording || ""} onChange={(e) => setCorrectionForm({ ...correctionForm, bad_question_wording: e.target.value })} />
                            <textarea style={{ ...s.crisisTextarea, minHeight: 60, marginBottom: 8 }} placeholder="Исправленная версия отчета для пациента" value={correctionForm?.corrected_user_report || ""} onChange={(e) => setCorrectionForm({ ...correctionForm, corrected_user_report: e.target.value })} />
                            <textarea style={{ ...s.crisisTextarea, minHeight: 60, marginBottom: 8 }} placeholder="Исправленная версия отчета для специалиста" value={correctionForm?.corrected_doctor_report || ""} onChange={(e) => setCorrectionForm({ ...correctionForm, corrected_doctor_report: e.target.value })} />
                            <textarea style={{ ...s.crisisTextarea, minHeight: 60, marginBottom: 8 }} placeholder="Предложение для изменения протокола / prompts" value={correctionForm?.protocol_update || ""} onChange={(e) => setCorrectionForm({ ...correctionForm, protocol_update: e.target.value })} />
                            <textarea style={{ ...s.crisisTextarea, minHeight: 60, marginBottom: 12 }} placeholder="Комментарий редактора" value={correctionForm?.correction_comment || ""} onChange={(e) => setCorrectionForm({ ...correctionForm, correction_comment: e.target.value })} />

                            <div style={{ borderTop: `1px solid ${t.cardBorder}`, paddingTop: 12, marginBottom: 12 }}>
                              <div style={{ color: t.crisisText, fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
                                Оценка голосового анализа <span style={{ color: t.muted, fontWeight: 400, fontSize: 11 }}>Экспериментально</span>
                              </div>

                              <div style={{ marginBottom: 8 }}>
                                <div style={{ color: t.muted, fontSize: 11, marginBottom: 4 }}>Точность наблюдений</div>
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                  {[["correct", "Верно"], ["partially_correct", "Частично верно"], ["incorrect", "Неверно"], ["cannot_assess", "Невозможно оценить"]].map(([val, label]) => (
                                    <label key={val} style={{ display: "flex", alignItems: "center", gap: 4, color: t.crisisText, fontSize: 12, cursor: "pointer" }}>
                                      <input type="radio" name="voice_accuracy" checked={correctionForm.voice_accuracy === val} onChange={() => setCorrectionForm({ ...correctionForm, voice_accuracy: val })} />
                                      {label}
                                    </label>
                                  ))}
                                </div>
                              </div>

                              <div style={{ marginBottom: 8 }}>
                                <div style={{ color: t.muted, fontSize: 11, marginBottom: 4 }}>Полезность</div>
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                  {[["useful", "Полезно"], ["mostly_useful", "Скорее полезно"], ["neutral", "Нейтрально"], ["mostly_harmful", "Скорее мешает"], ["harmful", "Мешает"]].map(([val, label]) => (
                                    <label key={val} style={{ display: "flex", alignItems: "center", gap: 4, color: t.crisisText, fontSize: 12, cursor: "pointer" }}>
                                      <input type="radio" name="voice_usefulness" checked={correctionForm.voice_usefulness === val} onChange={() => setCorrectionForm({ ...correctionForm, voice_usefulness: val })} />
                                      {label}
                                    </label>
                                  ))}
                                </div>
                              </div>

                              <div style={{ marginBottom: 8 }}>
                                <div style={{ color: t.muted, fontSize: 11, marginBottom: 4 }}>Повлияло на решение специалиста</div>
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                  {[["yes", "Да"], ["no", "Нет"], ["partially", "Частично"]].map(([val, label]) => (
                                    <label key={val} style={{ display: "flex", alignItems: "center", gap: 4, color: t.crisisText, fontSize: 12, cursor: "pointer" }}>
                                      <input type="radio" name="voice_influenced" checked={correctionForm.voice_influenced === val} onChange={() => setCorrectionForm({ ...correctionForm, voice_influenced: val })} />
                                      {label}
                                    </label>
                                  ))}
                                </div>
                              </div>

                              <div style={{ marginBottom: 8 }}>
                                <div style={{ color: t.muted, fontSize: 11, marginBottom: 4 }}>Подтверждённые признаки</div>
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                  {[["tempo", "Темп"], ["pauses", "Паузы"], ["volume", "Громкость"], ["prosody", "Выразительность"], ["tension", "Напряжение"], ["stability", "Изменчивость"], ["audio_quality", "Качество записи"]].map(([val, label]) => {
                                    const checked = correctionForm.voice_confirmed?.includes(val);
                                    return (
                                      <label key={val} style={{ display: "flex", alignItems: "center", gap: 4, color: t.crisisText, fontSize: 12, cursor: "pointer" }}>
                                        <input type="checkbox" checked={checked} onChange={() => {
                                          const current = correctionForm.voice_confirmed || [];
                                          setCorrectionForm({
                                            ...correctionForm,
                                            voice_confirmed: checked ? current.filter((c) => c !== val) : [...current, val],
                                          });
                                        }} />
                                        {label}
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>

                              <textarea style={{ ...s.crisisTextarea, minHeight: 50 }} placeholder="Комментарий специалиста к анализу звучания речи" value={correctionForm?.voice_comment || ""} onChange={(e) => setCorrectionForm({ ...correctionForm, voice_comment: e.target.value })} />
                            </div>

                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <button
                                disabled={!review?.id || adminActionLoading === review.id}
                                style={{ border: 0, borderRadius: 12, background: t.badgeInProgress, color: t.badgeInProgressText, padding: "8px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer", opacity: adminActionLoading === review.id ? 0.5 : 1 }}
                                onClick={() => adminSaveCorrection(review.id, null)}
                              >
                                Сохранить правки
                              </button>
                              <button
                                disabled={!review?.id || adminActionLoading === review.id}
                                style={{ border: 0, borderRadius: 12, background: t.badgeClosed, color: t.badgeClosedText, padding: "8px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer", opacity: adminActionLoading === review.id ? 0.5 : 1 }}
                                onClick={() => adminSaveCorrection(review.id, "approved")}
                              >
                                Одобрить после правки
                              </button>
                              <button
                                style={{ border: `1px solid ${t.crisisActionJsonlBorder}`, borderRadius: 12, background: t.crisisActionJsonl, color: t.crisisActionJsonlText, padding: "8px 14px", fontWeight: 600, fontSize: 12, cursor: "pointer" }}
                                onClick={closeCorrectionForm}
                              >
                                Отмена
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                    } catch (error) {
                      console.error("review card render error", error, review);
                      return (
                        <div key={review?.id} style={{ border: `1px solid ${t.badgeNew}`, borderRadius: 20, background: t.dangerBg, padding: 20, color: t.badgeNewText, fontSize: 13 }}>
                          <div>Ошибка отображения review {review?.id}</div>
                          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, color: t.muted, marginTop: 6 }}>
                            {String(error?.message || error)}
                          </pre>
                        </div>
                      );
                    }
                  })}
                </div>
              )}

              <button
                onClick={() => adminDownloadJsonl("approved")}
                style={{
                  background: t.jsonlBtn, color: t.jsonlBtnText, border: `1px solid ${t.jsonlBtnBorder}`,
                  padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontSize: 13,
                  marginTop: 8,
                }}
              >
                Экспортировать одобренные в JSONL
              </button>

              {/* Future /admin/experts page placeholder */}
              {/*
                TODO: "Позже добавить список зарегистрированных специалистов, отключение is_active и просмотр их reviews."
              */}
              </>
            )}
          </>
          )}
        </div>

        {modalData && (
          <div style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center",
            justifyContent: "center", zIndex: 3000, padding: 20,
          }} onClick={closeModal}>
            <div style={{
              background: t.cardBg, border: `1px solid ${t.cardBorder}`, borderRadius: 20,
              padding: 24, maxWidth: 800, width: "100%", maxHeight: "90vh",
              display: "flex", flexDirection: "column",
            }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{modalData.title}</h3>
                <button onClick={closeModal} style={{ border: 0, background: "transparent", color: t.muted, fontSize: 22, cursor: "pointer", padding: 4 }}>✕</button>
              </div>
              <div style={{
                flex: 1, overflowY: "auto", color: t.crisisText, fontSize: 14,
                lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word",
              }}>
                {modalData.content}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button
                  onClick={() => { navigator.clipboard.writeText(modalData.content); showToast("Скопировано"); }}
                  style={{ border: `1px solid ${t.border}`, borderRadius: 10, background: t.tabBg, color: t.text, padding: "10px 18px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
                >
                  Скопировать
                </button>
                <button onClick={closeModal} style={{ border: `1px solid ${t.border}`, borderRadius: 10, background: t.tabBg, color: t.text, padding: "10px 18px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
                  Закрыть
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Patient modal (expert — My Patients) */}
        {patientModalOpen && (
          <div style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center",
            justifyContent: "center", zIndex: 3001, padding: 20,
          }} onClick={() => { setPatientModalOpen(false); }}>
            <div style={{
              background: t.cardBg, border: `1px solid ${t.cardBorder}`, borderRadius: 20,
              padding: 24, maxWidth: 700, width: "100%", maxHeight: "90vh",
              display: "flex", flexDirection: "column",
            }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Мои пациенты</h3>
                  {expertData?.membership?.organization_name && (
                    <div style={{ color: t.muted, fontSize: 13, marginTop: 4 }}>{expertData.membership.organization_name}</div>
                  )}
                </div>
                <button onClick={() => setPatientModalOpen(false)} style={{ border: 0, background: "transparent", color: t.muted, fontSize: 22, cursor: "pointer", padding: 4 }}>✕</button>
              </div>

              {/* Assign patient by code */}
              <div style={{ marginBottom: 16, padding: 16, border: `1px solid ${t.cardBorder}`, borderRadius: 16, background: t.highlight }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Добавить пациента по коду</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input placeholder="ТОЧКА-XXXX-XXXX" value={patientModalCode} onChange={(e) => setPatientModalCode(e.target.value)} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 10, background: t.inputBg, color: t.inputText, padding: "8px 12px", fontSize: 13, outline: "none", flex: 1 }} />
                  <button onClick={handleAssignPatient} style={{ border: 0, borderRadius: 10, background: t.accent, color: "#fff", padding: "8px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                    Назначить
                  </button>
                </div>
              </div>

              {/* Create invite link */}
              <div style={{ marginBottom: 16, padding: 16, border: `1px solid ${t.cardBorder}`, borderRadius: 16, background: t.highlight }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Создать ссылку для пациента</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <input placeholder="Метка (например, Пациент 1)" value={inviteLinkLabel} onChange={(e) => setInviteLinkLabel(e.target.value)} style={{ border: `1px solid ${t.inputBorder}`, borderRadius: 10, background: t.inputBg, color: t.inputText, padding: "8px 12px", fontSize: 13, outline: "none", flex: 1 }} />
                  <button onClick={handleCreateInviteLink} style={{ border: 0, borderRadius: 10, background: t.accent, color: "#fff", padding: "8px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                    Создать ссылку
                  </button>
                </div>
                {inviteLinkCreated && (
                  <div style={{ marginTop: 12, padding: 12, border: `1px solid ${t.badgeClosed}`, borderRadius: 10, background: t.cardBg }}>
                    <div style={{ fontSize: 12, color: t.muted, marginBottom: 4 }}>Ссылка создана:</div>
                    <div style={{ fontSize: 13, fontWeight: 700, wordBreak: "break-all", marginBottom: 8 }}>{inviteLinkCreated.url}</div>
                    <button onClick={() => { navigator.clipboard.writeText(inviteLinkCreated.url); showToast("Ссылка скопирована"); }} style={{ border: `1px solid ${t.border}`, borderRadius: 8, background: t.tabBg, color: t.text, padding: "4px 10px", fontSize: 11, cursor: "pointer" }}>
                      Копировать
                    </button>
                  </div>
                )}
              </div>

              {/* Patient list */}
              <div style={{ flex: 1, overflowY: "auto", marginBottom: 16 }}>
                {myPatientsLoading ? (
                  <div style={{ color: t.muted, textAlign: "center", padding: 40, fontSize: 14 }}>Загрузка...</div>
                ) : myPatients.length === 0 ? (
                  <div style={{ color: t.muted, textAlign: "center", padding: 40, fontSize: 14 }}>Нет назначенных пациентов</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {myPatients.map((p) => (
                      <div key={p.id} style={{ padding: "12px 16px", border: `1px solid ${t.cardBorder}`, borderRadius: 14, background: t.cardBg, cursor: "pointer" }}
                        onClick={() => loadSessionTimeline(p.public_code)}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 4 }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 14, color: t.accent, letterSpacing: 0.5 }}>
                              {p.public_code}
                            </div>
                            {p.patient_label && (
                              <div style={{ color: t.muted, fontSize: 12, marginTop: 2 }}>{p.patient_label}</div>
                            )}
                          </div>
                          <div style={{ textAlign: "right", fontSize: 12, color: t.muted }}>
                            <div>Сессий: {p.session_count || 0}</div>
                            {p.last_session_at && (
                              <div>{new Date(p.last_session_at).toLocaleDateString("ru-RU")}</div>
                            )}
                          </div>
                        </div>
                        {(p.last_risk_level || p.last_care_recommendation) && (
                          <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                            {p.last_risk_level && (
                              <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6, background: p.last_risk_level === "high" ? t.dangerBg : p.last_risk_level === "medium" ? t.badgePending : t.badgeClosed, color: p.last_risk_level === "high" ? t.badgeNewText : p.last_risk_level === "medium" ? t.badgePendingText : t.badgeClosedText }}>
                                Риск: {p.last_risk_level}
                              </span>
                            )}
                            {p.last_care_recommendation?.level && (
                              <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6, background: t.badgeInProgress, color: t.badgeInProgressText }}>
                                {p.last_care_recommendation.level}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {(timelineLoading || timelineData) && (
          <div style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center",
            justifyContent: "center", zIndex: 3001, padding: 20,
          }} onClick={() => { closeModal(); }}>
            <div style={{
              background: t.cardBg, border: `1px solid ${t.cardBorder}`, borderRadius: 20,
              padding: 24, maxWidth: 700, width: "100%", maxHeight: "90vh",
              display: "flex", flexDirection: "column",
            }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Линия сессий</h3>
                  {timelineCode && <div style={{ color: t.accent, fontSize: 14, fontWeight: 600, marginTop: 4 }}>{timelineCode}</div>}
                </div>
                <button onClick={() => { closeModal(); }} style={{ border: 0, background: "transparent", color: t.muted, fontSize: 22, cursor: "pointer", padding: 4 }}>✕</button>
              </div>

              <div style={{ flex: 1, overflowY: "auto" }}>
                {timelineLoading && (
                  <div style={{ padding: 32, textAlign: "center", color: t.muted, fontSize: 14 }}>
                    Загружаем линию сессий…
                  </div>
                )}

                {!timelineLoading && timelineData && (
                  <div>
                    <div style={{ color: t.cardLabel, fontSize: 13, marginBottom: 16 }}>
                      Найдено обращений: {timelineData.session_count}
                      {timelineData.single_session_message && (
                        <span style={{ display: "block", marginTop: 4, fontStyle: "italic" }}>{timelineData.single_session_message}</span>
                      )}
                    </div>

                    {timelineData.items && timelineData.items.length > 0 && timelineData.items.map((item, idx) => {
                      const seq = item.display_sequence || idx + 1;
                      const kindLabel = SESSION_KIND_LABELS_TIMELINE[item.session_kind] || item.session_kind || "Сессия";
                      const dateStr = item.created_at ? new Date(item.created_at).toLocaleString("ru-RU", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
                      const statusLabel = STATUS_LABELS_TIMELINE[item.status] || item.status || "—";

                      return (
                        <div key={`${item.session_id || item.case_review_id || item.training_session_id || idx}-${idx}`} style={{
                          marginBottom: 16, border: `1px solid ${t.cardBorder}`, borderRadius: 14, padding: 16,
                          background: t.crisisCard,
                        }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{
                                display: "inline-flex", alignItems: "center", justifyContent: "center",
                                width: 28, height: 28, borderRadius: "50%", background: t.accent, color: "#fff",
                                fontWeight: 700, fontSize: 13,
                              }}>{seq}</span>
                              <span style={{ fontWeight: 700, fontSize: 14 }}>{kindLabel}</span>
                            </div>
                            <span style={{
                              fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 8,
                              background: item.status === "approved" ? t.badgeClosed : item.status === "rejected" ? t.badgeNew : t.badgePending,
                              color: item.status === "approved" ? t.badgeClosedText : item.status === "rejected" ? t.badgeNewText : t.badgePendingText,
                            }}>{statusLabel}</span>
                          </div>

                          <div style={{ color: t.cardLabel, fontSize: 12, marginBottom: 4 }}>{dateStr}</div>

                          {item.interval_after_previous && (
                            <div style={{ color: t.cardLabel, fontSize: 11, marginBottom: 8, fontStyle: "italic" }}>
                              {item.interval_after_previous}
                            </div>
                          )}

                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                            {item.model_used && <span style={{ fontSize: 11, color: t.muted, background: t.tabBg, padding: "2px 8px", borderRadius: 6 }}>{item.model_used}</span>}
                            {item.fallback_used && <span style={{ fontSize: 11, color: t.muted, background: t.tabBg, padding: "2px 8px", borderRadius: 6 }}>fallback</span>}
                            {item.expert_name && <span style={{ fontSize: 11, color: t.muted }}>Эксперт: {item.expert_name}</span>}
                          </div>

                          {item.patient_text_preview && (
                            <div style={{ color: t.crisisText, fontSize: 12, lineHeight: 1.5, marginBottom: 8, maxHeight: 60, overflow: "hidden", textOverflow: "ellipsis" }}>
                              {item.patient_text_preview}
                            </div>
                          )}

                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                            {item.user_report_available && <span style={{ fontSize: 10, color: t.cardLabel }}>📋 Отчёт для пациента</span>}
                            {item.doctor_report_available && <span style={{ fontSize: 10, color: t.cardLabel }}>📋 Отчёт для специалиста</span>}
                            {item.conversation_available && <span style={{ fontSize: 10, color: t.cardLabel }}>💬 Диалог</span>}
                            {item.support_plan_available && <span style={{ fontSize: 10, color: t.cardLabel }}>📋 Практики</span>}
                            {item.diary_available && <span style={{ fontSize: 10, color: t.cardLabel }}>📓 Дневник</span>}
                          </div>

                          {/* Training-specific fields */}
                          {item.source === "training_session" && (
                            <div style={{ background: t.tabBg, borderRadius: 8, padding: 10, marginBottom: 8 }}>
                              {item.scenario_played && <div style={{ fontSize: 11, marginBottom: 2 }}><span style={{ color: t.cardLabel }}>Сценарий:</span> <span style={{ color: t.crisisText }}>{item.scenario_played}</span></div>}
                              {item.expected_case_type && <div style={{ fontSize: 11, marginBottom: 2 }}><span style={{ color: t.cardLabel }}>Ожидаемый тип:</span> <span style={{ color: t.crisisText }}>{item.expected_case_type}</span></div>}
                              {item.ai_detected_case_type && <div style={{ fontSize: 11, marginBottom: 2 }}><span style={{ color: t.cardLabel }}>Распознано:</span> <span style={{ color: t.crisisText }}>{item.ai_detected_case_type}</span></div>}
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                                {item.detection_quality && <span style={{ fontSize: 10, color: t.cardLabel }}>Распознавание: {item.detection_quality}</span>}
                                {item.questions_quality && <span style={{ fontSize: 10, color: t.cardLabel }}>Вопросы: {item.questions_quality}</span>}
                                {item.report_quality && <span style={{ fontSize: 10, color: t.cardLabel }}>Отчёт: {item.report_quality}</span>}
                                {item.safety_quality && <span style={{ fontSize: 10, color: t.cardLabel }}>Safety: {item.safety_quality}</span>}
                              </div>
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                                {item.repeated_questions && <span style={{ fontSize: 10, color: t.badgeNewText }}>Повторы вопросов</span>}
                                {item.missed_risk_flags && <span style={{ fontSize: 10, color: t.badgeNewText }}>Пропущены риски</span>}
                                {item.wrong_recommendation && <span style={{ fontSize: 10, color: t.badgeNewText }}>Неверная рекомендация</span>}
                                {item.remembered_context && <span style={{ fontSize: 10, color: t.badgeClosedText }}>Учтён контекст</span>}
                              </div>
                              {item.expert_comment && (
                                <div style={{ fontSize: 11, marginTop: 4, color: t.crisisText, fontStyle: "italic" }}>{item.expert_comment}</div>
                              )}
                            </div>
                          )}

                          <button
                            onClick={() => loadSessionDetails(item)}
                            disabled={sessionDetailsLoading}
                            style={{
                              border: `1px solid ${t.border}`, borderRadius: 10,
                              background: t.accent, color: "#fff",
                              padding: "8px 16px", fontWeight: 600, fontSize: 12,
                              cursor: sessionDetailsLoading ? "wait" : "pointer",
                              marginTop: 8,
                            }}
                          >
                            {sessionDetailsLoading ? "Загружаем данные сессии…" : "Открыть сессию"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button onClick={() => { closeModal(); }} style={{ border: `1px solid ${t.border}`, borderRadius: 10, background: t.tabBg, color: t.text, padding: "10px 18px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
                  Закрыть
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Session detail view */}
        {timelineData && timelineView === "detail" && sessionDetailsData && (
          <div style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center",
            justifyContent: "center", zIndex: 3002, padding: 20,
          }} onClick={() => { setTimelineView("list"); setSessionDetailsData(null); setSessionDetailsError(null); }}>
            <div style={{
              background: t.cardBg, border: `1px solid ${t.cardBorder}`, borderRadius: 20,
              padding: 24, maxWidth: 800, width: "100%", maxHeight: "90vh",
              display: "flex", flexDirection: "column",
            }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                <div>
                  <button
                    onClick={() => { setTimelineView("list"); setSessionDetailsData(null); setSessionDetailsError(null); }}
                    style={{ border: 0, background: "transparent", color: t.accent, fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0, marginBottom: 8 }}
                  >
                    ← Назад к линии сессий
                  </button>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
                    Сессия{sessionDetailsData.session_sequence ? ` №${sessionDetailsData.session_sequence}` : ""}
                  </h3>
                  <div style={{ color: t.accent, fontSize: 14, fontWeight: 600, marginTop: 2 }}>
                    {SESSION_KIND_LABELS_TIMELINE[sessionDetailsData.session_kind] || sessionDetailsData.session_kind || "Сессия"}
                  </div>
                  {sessionDetailsData.created_at && (
                    <div style={{ color: t.cardLabel, fontSize: 12, marginTop: 2 }}>
                      {new Date(sessionDetailsData.created_at).toLocaleString("ru-RU", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  )}
                </div>
                <button onClick={() => { setTimelineView("list"); setSessionDetailsData(null); setSessionDetailsError(null); }} style={{ border: 0, background: "transparent", color: t.muted, fontSize: 22, cursor: "pointer", padding: 4 }}>✕</button>
              </div>

              <div style={{ flex: 1, overflowY: "auto" }}>
                {renderSessionTimelineDetail(sessionDetailsData, t)}
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button onClick={() => copySessionDetails(sessionDetailsData)} style={{ border: `1px solid ${t.border}`, borderRadius: 10, background: t.tabBg, color: t.text, padding: "10px 18px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
                  Скопировать обезличенную сессию
                </button>
                <button onClick={() => { setTimelineView("list"); }} style={{ border: `1px solid ${t.border}`, borderRadius: 10, background: t.tabBg, color: t.text, padding: "10px 18px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
                  Закрыть
                </button>
              </div>
            </div>
          </div>
        )}

        {toast.message && (
          <div
            key={toast.key}
            style={{
              position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
              zIndex: 3010, padding: "14px 24px", borderRadius: 16, fontWeight: 600, fontSize: 15,
              boxShadow: adminDarkMode ? "0 8px 30px rgba(0,0,0,.5)" : "0 4px 20px rgba(0,0,0,.1)",
              animation: "toastIn 0.3s ease",
              textAlign: "center", maxWidth: "calc(100vw - 40px)",
              ...(toast.type === "error"
                ? { background: t.dangerBg, border: `1px solid ${t.badgeNewText}`, color: t.badgeNewText }
                : { background: t.highlight, border: `1px solid ${t.badgeClosedText}`, color: t.badgeClosedText }),
            }}
          >
            {toast.message}
          </div>
        )}
      </div>
    </AdminErrorBoundary>
    );
  }

  // --- Expert Invite page (/expert-invite/<token>) ---
  if (typeof window !== "undefined" && window.location.pathname.match(/^\/expert-invite\//)) {
    return <ExpertInvitePage />;
  }

  // --- Expert Cabinet page (/expert) ---
  if (typeof window !== "undefined" && window.location.pathname.match(/^\/expert\/?$/)) {
    return <ExpertCabinet />;
  }

  return (
    <div style={s.page} className="app-page">
      <style>{`
  * {
    box-sizing: border-box;
  }

  @keyframes toastIn {
    from { opacity: 0; transform: translateX(-50%) translateY(20px); }
    to { opacity: 1; transform: translateX(-50%) translateY(0); }
  }

  html, body, #root {
    width: 100%;
    max-width: 100%;
    overflow-x: hidden;
  }

    .app-logo {
      height: 96px;
      width: auto;
    }
    @media (max-width: 768px) {
      .app-logo {
        height: 72px;
      }
    }
    @media (max-width: 768px) {
      .app-page {
      padding: 18px !important;
    }

    .app-header {
      flex-direction: column !important;
      align-items: flex-start !important;
      gap: 16px !important;
      margin-bottom: 36px !important;
    }

    .app-grid {
      display: block !important;
    }

    .app-hero-title {
      font-size: 38px !important;
      line-height: 1.08 !important;
      letter-spacing: -0.03em !important;
    }

    .app-hero-text {
      font-size: 17px !important;
      line-height: 1.55 !important;
    }

    .app-actions {
      flex-direction: column !important;
      width: 100% !important;
    }

    .app-actions button {
      width: 100% !important;
    }

    .app-card {
      margin-top: 32px !important;
      padding: 18px !important;
      border-radius: 24px !important;
      width: 100% !important;
      max-width: 100% !important;
    }

    textarea,
    input {
      width: 100% !important;
      max-width: 100% !important;
      font-size: 16px !important;
    }

    button {
      max-width: 100% !important;
      white-space: normal !important;
    }

    .modal {
      width: calc(100vw - 28px) !important;
      max-width: calc(100vw - 28px) !important;
      max-height: calc(100vh - 28px) !important;
      overflow-y: auto !important;
      padding: 18px !important;
    }

    .tabs {
      flex-direction: column !important;
    }

    .tabs button {
      width: 100% !important;
    }

    .report-block {
      overflow-wrap: anywhere !important;
      word-break: break-word !important;
    }
  }
`}</style>
          <div style={s.wrap}>
        <header style={s.header} className="app-header">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img
              src="/logo-tochka-opory-header.png"
              alt={isDedicatedSubdomain ? "Опора. Здоровье & Стройность" : "Точка опоры"}
              className="app-logo"
              style={{ display: "block", flexShrink: 0, objectFit: "contain", height: 96, width: "auto" }}
            />
            <div>
              <div style={s.logo}>{isDedicatedSubdomain ? "Опора. Здоровье & Стройность" : "Точка опоры"}</div>
              {!isDedicatedSubdomain && <div style={s.sub}>Анонимно. Безопасно. Можно просто поговорить.</div>}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {expertData && (
              <div style={{
                background: "#E2EBE4", border: "1px solid rgba(125,154,137,.3)",
                borderRadius: 22, padding: "8px 16px", fontSize: 13, color: "#5F7D6C",
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <span>
                  {expertData.name}, {roleMap[expertData.role] || expertData.role}
                  {expertData.membership?.organization_name && (
                    <span style={{ marginLeft: 6, opacity: 0.7 }}>· {expertData.membership.organization_name}</span>
                  )}
                </span>
                {expertData && (
                  <button
                    onClick={() => loadMyPatients()}
                    style={{
                      background: "none", border: "1px solid rgba(46,42,37,.15)", borderRadius: 10,
                      color: "#5F7D6C", padding: "4px 10px", fontSize: 11, cursor: "pointer",
                    }}
                  >
                    Мои пациенты
                  </button>
                )}
                <button
                  onClick={handleExpertLogout}
                  style={{
                    background: "none", border: "1px solid rgba(46,42,37,.15)", borderRadius: 10,
                    color: "#7A7268", padding: "4px 10px", fontSize: 11, cursor: "pointer",
                  }}
                >
                  Выйти
                </button>
              </div>
            )}
            {!isDedicatedSubdomain && (<>
            <button
              style={{ ...s.secondary, fontSize: 13, padding: "10px 16px" }}
              onClick={() => setExpertModalOpen(true)}
            >
              Для специалистов
            </button>
            <button
              style={s.crisis}
              onClick={() => setCrisisOpen(true)}
            >
              Срочная помощь
            </button>
            </>)}
          </div>
        </header>

        {inviteChecking && (
          <div style={{ maxWidth: 600, margin: "0 auto 20px", padding: "14px 20px", borderRadius: 16, background: t.cardBg, border: `1px solid ${t.cardBorder}`, textAlign: "center", color: t.muted, fontSize: 14 }}>
            Проверка ссылки...
          </div>
        )}
        {inviteInfo && inviteInfo.valid && (
          <div style={{ maxWidth: 600, margin: "0 auto 20px", padding: "14px 20px", borderRadius: 16, background: "rgba(46,125,50,0.08)", border: "1px solid rgba(46,125,50,0.2)", textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#2e7d32", marginBottom: 4 }}>🔗 Вы открыли ссылку специалиста</div>
            <div style={{ fontSize: 13, color: "#4a7c4c", lineHeight: 1.5 }}>
              Разговор останется анонимным, но результат будет доступен специалисту, который дал вам ссылку.
            </div>
          </div>
        )}
        {inviteInfo && !inviteInfo.valid && !inviteChecking && (
          <div style={{ maxWidth: 600, margin: "0 auto 20px", padding: "14px 20px", borderRadius: 16, background: "rgba(255,152,0,0.08)", border: "1px solid rgba(255,152,0,0.2)", textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#e65100", marginBottom: 4 }}>⚠️ {inviteInfo.error || "Ссылка недействительна"}</div>
            <div style={{ fontSize: 13, color: "#bf5f00", lineHeight: 1.5 }}>
              Вы можете начать обычный анонимный разговор.
            </div>
          </div>
        )}

        {(() => {
          const isBodyCabinet = activeModule === "body" && ["cabinet", "diary_edit", "diary_result"].includes(bodyScreen);
          return (
        <main style={isBodyCabinet ? { maxWidth: 1180, margin: "0 auto", padding: "0 16px", width: "100%", boxSizing: "border-box" } : s.grid} className={isBodyCabinet ? "" : "app-grid"}>
          {!isBodyCabinet && (
          <section>
            <h1 style={s.h1} className="app-hero-title">
              {activeModule === "body" ? "Разберёмся с питанием, движением и режимом" : "Найдём точку опоры"}
            </h1>
            <p style={s.p} className="app-hero-text">
              {activeModule === "body"
                ? "Поддержим на пути к здоровому и стройному телу"
                : "Расскажите, что с вами происходит — голосом или текстом. Сервис поможет мягко разобрать состояние, заметить важные признаки и предложить понятный следующий шаг."}
            </p>

            {phase === "input" && (
            <div style={{ ...s.row, flexWrap: "wrap", alignItems: "center" }} className="app-actions">
              {activeModule !== "body" && (
                <button style={s.primary} onClick={async () => {
                  try {
                    await ensureStartSession();
                  } catch (e) {
                    setError(e.message);
                    return;
                  }
                  setMode("voice");
                }}>
                  Рассказать голосом
                </button>
              )}
              {activeModule === "support" && (
                <button
                  style={{ ...s.secondary, marginTop: 0 }}
                  onClick={() => {
                    const saved = getSupportSession();
                    if (saved.sessionId && saved.accessToken) {
                      loadSupportCabinet();
                    } else {
                      setSessionModalOpen(true);
                    }
                  }}
                >
                  {(() => {
                    const saved = getSupportSession();
                    return saved.sessionId && saved.accessToken
                      ? "Продолжить последний разговор"
                      : "Продолжить разговор";
                  })()}
                </button>
              )}
            </div>
            )}

            {activeModule === "body" && bodyScreen === "landing" && (
              <div style={{ marginTop: 16, padding: 16, borderRadius: 14, background: "#f6f0e7", border: "1px solid #d8cec1" }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#2f2925", marginBottom: 8 }}>
                  Уже есть код продолжения?
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="text"
                    placeholder="HEALTH-XXXX-XXX-XXXX-XXXX-XXXX"
                    value={bodyContinuationInput || ""}
                    onChange={(e) => setBodyContinuationInput(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === "Enter" && continueBodyByCode()}
                    style={{
                      flex: 1, height: 44, padding: "0 14px", borderRadius: 12,
                      border: "1px solid #d8cec1", background: "#ffffff",
                      color: "#2f2925", fontSize: 15, outline: "none",
                      fontFamily: "monospace", boxSizing: "border-box",
                    }}
                  />
                  <button
                    onClick={continueBodyByCode}
                    disabled={loading || !bodyContinuationInput.trim()}
                    style={{
                      height: 44, padding: "0 18px", borderRadius: 12, border: 0,
                      background: loading ? "#c4d0c6" : "#7D9A89", color: "#ffffff", fontWeight: 700,
                      fontSize: 14, cursor: loading ? "not-allowed" : "pointer", whiteSpace: "nowrap",
                    }}
                  >
                    {loading ? "Открытие..." : "Продолжить"}
                  </button>
                </div>
                {bodyContinuationError && (
                  <div style={{ color: "#B85C4A", fontSize: 13, marginTop: 8 }}>{bodyContinuationError}</div>
                )}
              </div>
            )}

            {phase === "input" && showModuleSwitcher && (
            <div style={{ ...s.row, marginTop: 8, gap: 6 }} className="app-actions">
              <button
                style={activeModule === "support" ? s.primary : s.secondary}
                onClick={() => { setActiveModule("support"); setBodyIntakeStage("idle"); setBodyIntakeResult(null); }}
              >
                Точка опоры
              </button>
              <button
                style={activeModule === "body" ? s.primary : s.secondary}
                onClick={() => { setActiveModule("body"); setBodyIntakeStage("idle"); setBodyIntakeResult(null); setBodyScreen("landing"); }}
              >
                Здоровье & Стройность
              </button>
            </div>
            )}



            {phase === "input" && (
              activeModule === "body" ? (
                <p style={{ color: "#7A7268", fontSize: 13, marginTop: 24, lineHeight: 1.5 }}>
                  AI-компаньон помогает разобраться с режимом, питанием, активностью и самоконтролем. Не заменяет врача и не назначает лечение.
                </p>
              ) : (
                <>
                  <p style={{ color: "#7A7268", fontSize: 13, marginTop: 24, lineHeight: 1.5 }}>
                    Сервис работает в тестовом режиме, не ставит диагноз и не заменяет консультацию специалиста. Не указывайте персональные данные в тексте обращения.
                  </p>
                  <p style={{ color: "#B85C4A", fontSize: 12, marginTop: 8, lineHeight: 1.4 }}>
                    Если вы чувствуете, что можете причинить вред себе или другому человеку, либо вам нужна срочная психиатрическая помощь — немедленно обратитесь по телефону 112 (или в экстренные службы вашей страны) либо к ближайшему медицинскому учреждению.
                  </p>
                </>
              )
            )}
          </section>
          )}

          {/* Body intake form */}
          {activeModule === "body" && bodyScreen === "intake" && (
            <BodyIntake onComplete={handleBodyIntakeComplete} />
          )}

          {/* Body intake result — step-by-step flow */}
          {activeModule === "body" && bodyScreen === "result" && bodyIntakeResult && (
            <section style={s.card} className="app-card">

              {/* Step 1: Summary */}
              {bodyIntakeStep === 0 && (
                <>
                  <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "Georgia, \"PT Serif\", serif", marginBottom: 16, color: "#2f2925" }}>
                    Ваш первый разбор
                  </div>

                  <div style={{ fontSize: 16, lineHeight: 1.7, whiteSpace: "pre-wrap", color: "#2f2925" }}>
                    {bodyIntakeResult.user_report}
                  </div>

                  {/* Urgent/medical warning — shown on step 1 */}
                  {bodyIntakeResult?.care_recommendation?.level === "medical_consultation" && (
                    <div style={{ marginTop: 20, padding: 16, borderRadius: 14, background: "rgba(251,191,36,.10)", border: "1px solid rgba(251,191,36,.25)" }}>
                      <div style={{ fontWeight: 700, color: "#92400e", marginBottom: 6 }}>Когда лучше обратиться к врачу</div>
                      <div style={{ color: "#78350f", fontSize: 14, lineHeight: 1.6 }}>
                        По вашим данным есть признаки, которые стоит обсудить со специалистом. Рекомендуем записаться к терапевту в ближайшие дни.
                      </div>
                    </div>
                  )}
                  {bodyIntakeResult?.care_recommendation?.level === "urgent_help" && (
                    <div style={{ marginTop: 20, padding: 16, borderRadius: 14, background: "rgba(239,68,68,.12)", border: "1px solid rgba(239,68,68,.3)" }}>
                      <div style={{ fontWeight: 700, color: "#991b1b", marginBottom: 6 }}>Возможно, нужна срочная помощь</div>
                      <div style={{ color: "#7f1d1d", fontSize: 14, lineHeight: 1.6 }}>
                        Если у вас или рядом с вами есть симптомы, которые требуют немедленной помощи — звоните 103 или 112.
                      </div>
                    </div>
                  )}

                  <button onClick={() => setBodyIntakeStep(1)} style={{
                    marginTop: 24, width: "100%", height: 52, borderRadius: 16, border: 0,
                    background: "#5f8b7a", color: "#fff", fontWeight: 800, fontSize: 16, cursor: "pointer", fontFamily: "inherit",
                  }}>
                    Дальше
                  </button>
                </>
              )}

              {/* Step 2: Continuation code */}
              {bodyIntakeStep === 1 && (bodyIntakeResult.continuation_code || bodyIntakeResult.session_id) && (
                <>
                  <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "Georgia, \"PT Serif\", serif", marginBottom: 16, color: "#2f2925" }}>
                    Ваш код продолжения
                  </div>
                  <div style={{ color: "#665c52", fontSize: 14, marginBottom: 16, lineHeight: 1.6 }}>
                    Сохраните этот код. Он открывает ваш профиль, план и дневник на любом устройстве.
                  </div>
                  <div style={{
                    textAlign: "center", padding: 24, borderRadius: 16, background: "#f6f0e7",
                    border: "1px solid #d8cec1", marginBottom: 20,
                  }}>
                    <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "0.06em", color: "#2f2925", fontFamily: "monospace", marginBottom: 12, wordBreak: "break-all" }}>
                      {bodyIntakeResult.continuation_code || bodyIntakeResult.session_id}
                    </div>
                    <button onClick={copyBodyCode} style={{
                      padding: "10px 24px", borderRadius: 12, border: 0,
                      background: bodyCodeCopied ? "#4caf50" : "#7D9A89",
                      color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit",
                    }}>
                      {bodyCodeCopied ? "Код скопирован" : "Скопировать код"}
                    </button>
                  </div>
                  <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                    <button onClick={() => setBodyIntakeStep(0)} style={{
                      flex: 1, height: 48, borderRadius: 14, border: "1px solid #d8cec1",
                      background: "#ede7dc", color: "#2f2925", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit",
                    }}>
                      Назад
                    </button>
                    <button onClick={() => setBodyIntakeStep(2)} style={{
                      flex: 2, height: 48, borderRadius: 14, border: 0,
                      background: "#5f8b7a", color: "#fff", fontWeight: 800, fontSize: 16, cursor: "pointer", fontFamily: "inherit",
                    }}>
                      Продолжить
                    </button>
                  </div>
                </>
              )}

              {/* Step 3: 3-day plan */}
              {bodyIntakeStep === 2 && bodyIntakeResult.body_plan?.days && (
                <>
                  <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "Georgia, \"PT Serif\", serif", marginBottom: 4, color: "#2f2925" }}>
                    План на 3 дня
                  </div>
                  <div style={{ color: "#665c52", fontSize: 14, marginBottom: 20, fontStyle: "italic" }}>
                    {bodyIntakeResult.body_plan.focus}
                  </div>

                  {bodyIntakeResult.body_plan.days.slice(0, 3).map(d => (
                    <div key={d.day} style={{
                      border: "1px solid #d8cec1", borderRadius: 16, padding: "16px 18px",
                      marginBottom: 10, background: "#faf6ef",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: "50%", background: "#5f8b7a",
                          color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                          fontWeight: 700, fontSize: 14, flexShrink: 0,
                        }}>
                          {d.day}
                        </div>
                        <div style={{ fontWeight: 700, fontSize: 16, color: "#2f2925" }}>
                          {d.title}
                        </div>
                      </div>
                      {d.actions?.map((a, i) => (
                        <div key={i} style={{ color: "#5f574f", fontSize: 14, paddingLeft: 14, marginBottom: 3, lineHeight: 1.5 }}>
                          • {a}
                        </div>
                      ))}
                      {d.note && (
                        <div style={{ color: "#665c52", fontSize: 13, fontStyle: "italic", marginTop: 8, lineHeight: 1.5 }}>
                          {d.note}
                        </div>
                      )}
                    </div>
                  ))}

                  <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                    <button onClick={() => setBodyIntakeStep(1)} style={{
                      flex: 1, height: 48, borderRadius: 14, border: "1px solid #d8cec1",
                      background: "#ede7dc", color: "#2f2925", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit",
                    }}>
                      Назад
                    </button>
                    <button onClick={() => setBodyIntakeStep(3)} style={{
                      flex: 2, height: 48, borderRadius: 14, border: 0,
                      background: "#5f8b7a", color: "#fff", fontWeight: 800, fontSize: 16, cursor: "pointer", fontFamily: "inherit",
                    }}>
                      Начать дневник
                    </button>
                  </div>
                </>
              )}

              {/* Step 4: CTA to cabinet */}
              {bodyIntakeStep === 3 && (
                <>
                  <div style={{ textAlign: "center", padding: "20px 0" }}>
                    <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "Georgia, \"PT Serif\", serif", marginBottom: 12, color: "#2f2925" }}>
                      Готовы продолжить?
                    </div>
                    <div style={{ color: "#665c52", fontSize: 15, lineHeight: 1.6, marginBottom: 28 }}>
                      В личном кабинете можно вести дневник, смотреть историю и управлять доступом.
                    </div>
                    <button onClick={() => { loadBodyCabinet(bodyIntakeResult?.continuation_code); }} style={{
                      width: "100%", height: 52, borderRadius: 16, border: 0,
                      background: "#5f8b7a", color: "#fff", fontWeight: 800, fontSize: 16, cursor: "pointer", marginBottom: 12, fontFamily: "inherit",
                    }}>
                      Перейти в личный кабинет
                    </button>
                    <button onClick={() => { setBodyIntakeStage("idle"); setBodyIntakeResult(null); setBodyScreen("landing"); setMode(""); }} style={{
                      width: "100%", height: 48, borderRadius: 14, border: "1px solid #d8cec1",
                      background: "#ede7dc", color: "#2f2925", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit",
                    }}>
                      На главную
                    </button>
                  </div>
                </>
              )}

              {/* Debug — always accessible at bottom via toggle */}
              {(window.location.hostname === "localhost" || import.meta.env?.DEV) && (
                <details style={{ marginTop: 20 }}>
                  <summary style={{ cursor: "pointer", fontSize: 12, color: "#8d8378", fontWeight: 600, padding: 8 }}>
                    Информация для разработки
                  </summary>
                  <pre style={{ fontSize: 11, color: "#5f574f", lineHeight: 1.5, whiteSpace: "pre-wrap", margin: "8px 0 0" }}>
{JSON.stringify({
  module: bodyIntakeResult.module || "body",
  stage: "intake_completed",
  session_id: bodyIntakeResult.session_id || null,
  care_recommendation: bodyIntakeResult.care_recommendation,
  triggered_red_flags: bodyIntakeResult.triggered_red_flags || [],
  red_flag_care_level: bodyIntakeResult.red_flag_care_level || null,
  bmi: bodyIntakeResult.bmi,
  used_fallback: bodyIntakeResult.used_fallback || false,
  model_used: bodyIntakeResult.model_used || null,
}, null, 2)}
                  </pre>
                </details>
              )}

              {/* Detail expand — BMI, care reason, JSON */}
              <details style={{ marginTop: 12 }}>
                <summary style={{ cursor: "pointer", fontSize: 13, color: "#8d8378", fontWeight: 600, padding: 8 }}>
                  Подробнее
                </summary>
                <div style={{ padding: "8px 0" }}>
                  {bodyIntakeResult?.bmi && (
                    <div style={{ padding: 12, borderRadius: 12, background: "#f6f0e7", marginBottom: 10, fontSize: 13, color: "#5f574f", lineHeight: 1.6 }}>
                      По введенным данным ИМТ примерно {bodyIntakeResult.bmi}. Это ориентировочный показатель: он помогает увидеть общую картину, но не заменяет оценку состава тела, объема талии, самочувствия и консультацию специалиста.
                    </div>
                  )}
                  {bodyIntakeResult?.care_recommendation && (
                    <div style={{ padding: 12, borderRadius: 12, background: "#f6f0e7", marginBottom: 10, fontSize: 13, color: "#5f574f", lineHeight: 1.6 }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>Уровень рекомендации</div>
                      {bodyIntakeResult.care_recommendation.level === "self_care" && "В анкете нет признаков, требующих срочной помощи; можно начать с мягкого самонаблюдения."}
                      {bodyIntakeResult.care_recommendation.level === "medical_consultation" && "Есть признаки или ограничения, которые лучше обсудить со специалистом перед нагрузками."}
                      {bodyIntakeResult.care_recommendation.level === "urgent_help" && "Вы отметили симптом, при котором лучше не продолжать программу и обратиться за срочной помощью."}
                    </div>
                  )}
                  <button onClick={downloadBodyIntakeJSON} style={{
                    padding: "8px 18px", borderRadius: 10, border: "1px solid #d8cec1",
                    background: "#ede7dc", color: "#2f2925", fontWeight: 600, fontSize: 12, cursor: "pointer", fontFamily: "inherit",
                  }}>
                    Скачать JSON
                  </button>
                </div>
              </details>
            </section>
          )}

          {/* Health Cabinet */}
          {activeModule === "body" && bodyScreen === "cabinet" && bodyCabinetData && (
            <HealthCabinet
              sessionId={bodyDiarySessionId}
              accessToken={getBodySession().accessToken}
              profile={bodyCabinetData.profile}
              wallet={bodyCabinetData.wallet}
              todayLog={bodyCabinetData.today_log}
              history={bodyCabinetData.history}
              onNewDiary={() => { setBodyScreen("diary_edit"); }}
              onViewDiary={(log) => { setBodyDiaryResult(log); setBodyScreen("diary_result"); }}
              onLogout={() => { clearBodySession(); setBodyScreen("landing"); setBodyCabinetData(null); setBodyDiarySessionId(null); }}
              onRotateCode={regenerateBodyContinuationCode}
            />
          )}

          {/* Body diary form */}
          {activeModule === "body" && bodyScreen === "diary_edit" && bodyDiarySessionId && (
            <BodyDiary
              sessionId={bodyDiarySessionId}
              onComplete={async (result) => {
                await loadBodyCabinet();
                showToast("Дневник сохранён", "success");
              }}
              onCancel={() => setBodyScreen("cabinet")}
            />
          )}

          {/* Body diary result */}
          {activeModule === "body" && bodyScreen === "diary_result" && bodyDiaryResult && (
            <section style={s.card} className="app-card">
              <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 12, color: "#2f2925" }}>
                Итог дня
              </div>
              {bodyDiaryResult.ai_day_summary && (
                <div style={{ fontSize: 15, lineHeight: 1.7, whiteSpace: "pre-wrap", color: "#2f2925", marginBottom: 16 }}>
                  {bodyDiaryResult.ai_day_summary}
                </div>
              )}
              {bodyDiaryResult.ai_focus_tomorrow && (
                <div style={{ padding: 14, borderRadius: 14, background: "#f0f5f1", border: "1px solid #c4d0c6", marginBottom: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#2f2925", marginBottom: 4 }}>Фокус на завтра</div>
                  <div style={{ fontSize: 14, lineHeight: 1.6, color: "#5f574f" }}>
                    {bodyDiaryResult.ai_focus_tomorrow}
                  </div>
                </div>
              )}
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <button onClick={() => { setBodyScreen("diary_edit"); }} style={{
                  padding: "12px 20px", borderRadius: 20, background: "#7D9A89",
                  color: "#fff", fontWeight: 700, border: 0, cursor: "pointer", flex: 1, minWidth: 160,
                }}>
                  Записать ещё день
                </button>
                <button onClick={() => { setBodyScreen("cabinet"); }} style={{
                  padding: "12px 20px", borderRadius: 20, background: "#ede7dc",
                  color: "#2f2925", fontWeight: 600, border: "1px solid #d8cec1", cursor: "pointer",
                }}>
                  В кабинет
                </button>
              </div>
            </section>
          )}

          {/* Diary history modal */}
          {bodyDiaryHistoryOpen && (
            <div style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000,
              display: "flex", alignItems: "center", justifyContent: "center",
            }} onClick={() => setBodyDiaryHistoryOpen(false)}>
              <div style={{
                background: "#ffffff", borderRadius: 20, padding: 28, maxWidth: 640, width: "90%",
                maxHeight: "80vh", overflowY: "auto",
              }} onClick={(e) => e.stopPropagation()}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#2f2925" }}>Мои прошлые дни</div>
                  <button onClick={() => setBodyDiaryHistoryOpen(false)} style={{ background: "none", border: 0, fontSize: 20, cursor: "pointer", color: "#8d8378" }}>✕</button>
                </div>
                {bodyDiaryHistoryDetail ? (
                  <div>
                    <button onClick={() => setBodyDiaryHistoryDetail(null)} style={{
                      background: "none", border: 0, color: "#7D9A89", cursor: "pointer",
                      fontWeight: 600, fontSize: 14, marginBottom: 16, display: "inline-flex", alignItems: "center", gap: 4,
                    }}>
                      ← Назад к списку
                    </button>
                    <div style={{ fontSize: 14, color: "#2f2925", marginBottom: 8 }}>
                      {bodyDiaryHistoryDetail.log_date}
                    </div>
                    {bodyDiaryHistoryDetail.ai_day_summary && (
                      <div style={{ padding: 14, borderRadius: 12, background: "#f6f9f7", marginBottom: 12, fontSize: 14, lineHeight: 1.6 }}>
                        {bodyDiaryHistoryDetail.ai_day_summary}
                      </div>
                    )}
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13, color: "#5f574f" }}>
                      {bodyDiaryHistoryDetail.steps != null && <div>🚶 Шаги: {bodyDiaryHistoryDetail.steps}</div>}
                      {bodyDiaryHistoryDetail.workout_done && <div>💪 Тренировка: {bodyDiaryHistoryDetail.workout_type || "да"}{bodyDiaryHistoryDetail.workout_minutes ? ` (${bodyDiaryHistoryDetail.workout_minutes} мин)` : ""}</div>}
                      {bodyDiaryHistoryDetail.sleep_hours != null && <div>😴 Сон: {bodyDiaryHistoryDetail.sleep_hours} ч</div>}
                      {bodyDiaryHistoryDetail.water_l != null && <div>💧 Вода: {bodyDiaryHistoryDetail.water_l} л</div>}
                      {bodyDiaryHistoryDetail.energy_level != null && <div>⚡ Энергия: {bodyDiaryHistoryDetail.energy_level}/10</div>}
                      {bodyDiaryHistoryDetail.mood_level != null && <div>😊 Настроение: {bodyDiaryHistoryDetail.mood_level}/10</div>}
                    </div>
                  </div>
                ) : (
                  bodyDiaryHistory?.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {bodyDiaryHistory.map((log, i) => (
                        <button key={i} onClick={() => setBodyDiaryHistoryDetail(log)} style={{
                          display: "flex", justifyContent: "space-between", alignItems: "center",
                          padding: "14px 16px", borderRadius: 14, background: "#f6f0e7",
                          border: "1px solid #e8e2d8", cursor: "pointer", width: "100%", textAlign: "left",
                          fontFamily: "inherit", fontSize: 14, color: "#2f2925",
                        }}>
                          <span style={{ fontWeight: 600 }}>{log.log_date}</span>
                          <span style={{ color: "#8d8378", fontSize: 13 }}>
                            {log.ai_day_summary ? "✓ есть итог" : "—"}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div style={{ textAlign: "center", padding: "30px 0", color: "#8d8378" }}>
                      {bodyDiaryHistoryLoading ? "Загрузка..." : "Пока нет записей"}
                    </div>
                  )
                )}
              </div>
            </div>
          )}

          {/* Default support card / body card before intake */}
          {!(activeModule === "body" && bodyScreen !== "landing") && phase !== "cabinet" && phase !== "followup" && (
          <section style={s.card} className="app-card">
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "Georgia, \"PT Serif\", serif" }}>
              {phase === "questions"
                ? `Раунд уточнения ${dialogDepth}`
                : activeModule === "body"
                  ? "Готовы начать?"
                  : "С чего начать?"}
            </div>
            {phase !== "questions" && (
              <div style={{ color: "#7A7268", fontSize: 14, marginTop: 6 }}>
                {activeModule === "body"
                  ? "Заполните короткую анкету — это займёт 2 минуты."
                  : "Опишите состояние своими словами."}
              </div>
            )}

            {activeModule === "body" && localStorage.getItem("body_referral_source") === "alena_client" && bodyScreen === "landing" && (
              <div style={{ marginTop: 16, padding: 14, borderRadius: 14, background: "#e8f0ea", border: "1px solid #c4d0c6" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#2f2925", marginBottom: 2 }}>
                  Вы заполняете анкету по направлению
                </div>
                <div style={{ fontSize: 15, color: "#2f2925", fontWeight: 600 }}>
                  {localStorage.getItem("body_specialist_name") || "Алена Жукова"}
                </div>
              </div>
            )}

            {activeModule === "body" && savedBodyResult && bodyScreen === "landing" && (
              <div style={{ marginTop: 16 }}>
                <button onClick={() => {
                  setBodyIntakeResult(savedBodyResult);
                  setBodyIntakeStage("result");
                  setBodyScreen("result");
                  setBodyIntakeStep(0);
                }} style={{
                  padding: "14px 22px", borderRadius: 20, background: "#7D9A89",
                  color: "#ffffff", fontWeight: 800, fontSize: 15, border: 0, cursor: "pointer", width: "100%",
                }}>
                  Вернуться к последнему плану
                </button>
                <div style={{ color: "#8d8378", fontSize: 12, marginTop: 6, textAlign: "center" }}>
                  У вас уже есть план от {localStorage.getItem("body_last_created_at")
                    ? new Date(localStorage.getItem("body_last_created_at")).toLocaleDateString("ru-RU")
                    : "предыдущего раза"}
                </div>
              </div>
            )}

            <div style={s.inner}>
              {mode === "voice" ? (
                <div style={{ textAlign: "center", padding: "40px 20px" }}>
                  <div style={{ fontSize: 58 }}>🎙</div>
                  <h2 style={{ fontSize: 22, fontWeight: 700 }}>Голосовой режим</h2>

                  <p style={{ color: "#7A7268", lineHeight: 1.6 }}>
                    Нажмите "Начать запись", расскажите о своем состоянии, затем остановите запись.
                    Мы расшифруем голос и перенесем текст в обычное поле.
                  </p>

                  {!recording ? (
                    <button style={s.wide} onClick={startRecording} disabled={transcribing}>
                      {transcribing ? "Расшифровываем..." : "Начать запись"}
                    </button>
                  ) : (
                    <button style={{ ...s.wide, background: "#B85C4A", color: "white" }} onClick={stopRecording}>
                      Остановить и расшифровать
                    </button>
                  )}

                  {voiceError && (
                    <div style={s.error}>
                      {voiceError}
                    </div>
                  )}

                  <div style={{
                    marginTop: 12,
                    color: recordingTime > 45 ? "#B85C4A" : "#7A7268",
                    fontSize: 14
                  }}>
                    {recording
                      ? `Запись: ${recordingTime} сек / 60 сек`
                      : "Максимальная длительность записи — 1 минута"}
                  </div>
                </div>
              ) : phase === "input" ? (
                <>
                  <textarea
                    style={s.textarea}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={isDedicatedSubdomain ? "Например: хочу снизить вес, наладить питание, больше двигаться, лучше спать и понять, с чего начать…" : "Например: последние недели плохо сплю, тревожусь, не могу собраться, стало трудно заниматься обычными делами…"}
                  />
                  <button
                    style={s.wide}
                    onClick={isDedicatedSubdomain ? () => { setBodyIntakeStage("filling"); setBodyScreen("intake"); } : () => submitRound()}
                    disabled={loading}
                  >
                      {loading
                      ? loadingMessage || "Формируем вопросы..."
                      : isDedicatedSubdomain ? "Перейти к анкете" : "Начать разбор"}
                  </button>
                </>
              ) : phase === "questions" ? (
                <>
                  {questions?.map((q, index) => (
                    <div key={index} style={s.questionCard}>
                      <div style={s.questionText}>
                        {index + 1}. {q}
                      </div>

                      <textarea
                        style={s.answerInput}
                        value={answers[index] || ""}
                        onChange={(e) =>
                          setAnswers({
                            ...answers,
                            [index]: e.target.value,
                          })
                        }
                        placeholder="Ваш ответ..."
                      />

                      <button
                        style={{
                          ...s.secondary,
                          marginTop: 10,
                          width: "100%",
                        }}
                        onClick={() =>
                          recordingQuestionIndex === index
                            ? stopQuestionRecording()
                            : startQuestionRecording(index)
                        }
                        disabled={
                          questionTranscribingIndex !== null &&
                          questionTranscribingIndex !== index
                        }
                      >
                        {questionTranscribingIndex === index
                          ? "Расшифровываем..."
                          : recordingQuestionIndex === index
                            ? "Остановить и расшифровать"
                            : "Ответить голосом"}
                      </button>

                      {recordingQuestionIndex === index && (
                        <div
                          style={{
                            marginTop: 8,
                            color:
                              questionRecordingTime > 45
                                ? "#B85C4A"
                                : "#7A7268",
                            fontSize: 14,
                          }}
                        >
                          Запись: {questionRecordingTime} сек / 60 сек
                        </div>
                      )}
                    </div>
                  ))}
                  <button
                    style={s.wide}
                    onClick={() => submitRound()}
                    disabled={loading}
                  >
                    {loading
                      ? loadingMessage || "Анализируем..."
                      : dialogDepth < 3
                        ? "Продолжить уточнение"
                        : "Получить предварительный отчёт"}
                  </button>
                </>
              ) : null}

              {error && <div style={s.error}>{error}</div>}
            </div>

            {phase === "report" && result && (
              <div style={s.result}>
                <h2 style={{ marginTop: 0, fontFamily: "Georgia, \"PT Serif\", serif", fontSize: 22 }}>Результат разбора</h2>

                {continuationCode && justFinishedSession && reportSource === "generated" && (
                  <div style={{
                    background: "#E2EBE4", border: "1px solid rgba(125,154,137,.3)",
                    borderRadius: 16, padding: "18px", marginBottom: 16,
                  }}>
                    <div style={{ fontWeight: 700, fontSize: 16, color: "#2E2A25", marginBottom: 8 }}>
                      Сохраните код продолжения
                    </div>
                    <div style={{ color: "#5F7D6C", fontSize: 14, lineHeight: 1.5, marginBottom: 12 }}>
                      Он понадобится, чтобы вернуться к этому разговору на другом устройстве или после очистки браузера.
                    </div>
                    <div style={{
                      background: "#ffffff", border: "1px solid rgba(125,154,137,.25)",
                      borderRadius: 12, padding: "12px 16px", marginBottom: 14,
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                    }}>
                      <span style={{ fontWeight: 900, fontSize: 16, color: "#2E2A25", letterSpacing: 1, fontFamily: "monospace", wordBreak: "break-all" }}>
                        {continuationCode}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <button
                        style={{ ...s.secondary, flex: 1, minWidth: 140 }}
                        onClick={() => { navigator.clipboard.writeText(continuationCode); showToast("Код скопирован"); }}
                      >
                        Скопировать код
                      </button>
                      <button
                        style={{ ...s.primary, flex: 1, minWidth: 160 }}
                        onClick={() => { setJustFinishedSession(false); loadSupportCabinet(); }}
                      >
                        Перейти в личный кабинет
                      </button>
                    </div>
                  </div>
                )}

                {publicCode && !(justFinishedSession && reportSource === "generated") && (
                  <div style={{
                    background: "#E2EBE4", border: "1px solid rgba(125,154,137,.3)",
                    borderRadius: 16, padding: "12px 16px", marginBottom: 16,
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                  }}>
                    <span style={{ color: "#5F7D6C", fontSize: 13 }}>
                      Код диалога для продолжения:
                    </span>
                    <span style={{ fontWeight: 900, fontSize: 18, color: "#2E2A25", letterSpacing: 1 }}>
                      {publicCode}
                    </span>
                  </div>
                )}

                {usageBalance && usageBalance.visible && (
                  <div style={{ padding: "8px 12px", background: "#f0fdf4", borderRadius: 8, marginBottom: 16, fontSize: 13, color: "#166534" }}>
                    Доступный ресурс: {usageBalance.balance.toLocaleString("ru-RU")} кредитов<br />
                    <span style={{ fontSize: 11, color: "#6b7280" }}>Тестовый баланс. Деньги не списываются.</span>
                  </div>
                )}

                <div style={s.tabs} className="tabs">
                  <button
                    style={activeTab === "user" ? s.activeTab : s.tab}
                    onClick={() => setActiveTab("user")}
                  >
                    Для вас
                  </button>
                  <button
                    style={activeTab === "doctor" ? s.activeTab : s.tab}
                    onClick={() => setActiveTab("doctor")}
                  >
                    Для специалиста
                  </button>
                  <button
                    onClick={downloadReportPDF}
                    style={{ ...s.tab, fontSize: 12, marginLeft: "auto" }}
                    title="Скачать PDF"
                  >
                    📄 PDF
                  </button>
                  <button
                    onClick={downloadReportDOCX}
                    style={{ ...s.tab, fontSize: 12 }}
                    title="Скачать DOCX"
                  >
                    📝 DOCX
                  </button>
                  {expertData && (
                    <button
                      style={{
                        ...s.tab,
                        fontSize: 11,
                        background: activeTab === "debug" ? "#EDE3D8" : "transparent",
                        borderColor: activeTab === "debug" ? "#B8A690" : "rgba(46,42,37,.12)",
                      }}
                      onClick={() => setActiveTab(activeTab === "debug" ? "user" : "debug")}
                    >
                      🛠 Debug
                    </button>
                  )}
                </div>

                <div style={s.reportBlock} className="report-block">
                  {activeTab === "debug" && expertData && debugInfo ? (
                    <div style={{ fontSize: 12, lineHeight: 1.6, color: "#5F5A52" }}>
                      <div style={{ fontWeight: 700, marginBottom: 10, color: "#2E2A25" }}>
                        Техническая информация (только для специалиста)
                      </div>
                      <div style={{ display: "grid", gap: 8 }}>
                        <div><b>Prompt version:</b> {debugInfo.prompt_version || "—"}</div>
                        <div><b>Care level:</b> {debugInfo.care_recommendation?.level || "—"}</div>
                        <div><b>Minimum level (backend):</b> {debugInfo.minimum_level || "—"}</div>
                        <div><b>Quality check:</b> {debugInfo.quality_check?.pass ? "✅ пройдена" : "❌ нарушена"}</div>
                        {debugInfo.quality_check?.violations?.length > 0 && (
                          <div><b>Нарушения:</b> {debugInfo.quality_check.violations.join("; ")}</div>
                        )}
                        <div><b>Repair attempted:</b> {debugInfo.repair?.repairAttempted ? "да" : "нет"}</div>
                        {debugInfo.repair?.repairAttempted && (
                          <div><b>Repair result:</b> {debugInfo.repair.repairSucceeded ? "✅ успешно" : "❌ не удался"}</div>
                        )}
                        <details>
                          <summary style={{ cursor: "pointer", fontWeight: 600, marginTop: 8 }}>Raw model response</summary>
                          <pre style={{ background: "#F5F0E8", padding: 12, borderRadius: 8, marginTop: 6, fontSize: 11, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                            {debugInfo.raw_model_response || "—"}
                          </pre>
                        </details>
                        <details>
                          <summary style={{ cursor: "pointer", fontWeight: 600, marginTop: 4 }}>Parsed user_report</summary>
                          <pre style={{ background: "#F5F0E8", padding: 12, borderRadius: 8, marginTop: 6, fontSize: 11, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                            {debugInfo.parsed_user_report || "—"}
                          </pre>
                        </details>
                        <details>
                          <summary style={{ cursor: "pointer", fontWeight: 600, marginTop: 4 }}>Parsed doctor_report</summary>
                          <pre style={{ background: "#F5F0E8", padding: 12, borderRadius: 8, marginTop: 6, fontSize: 11, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                            {debugInfo.parsed_doctor_report || "—"}
                          </pre>
                        </details>
                        {debugInfo.care_recommendation && (
                          <details>
                            <summary style={{ cursor: "pointer", fontWeight: 600, marginTop: 4 }}>Care recommendation</summary>
                            <pre style={{ background: "#F5F0E8", padding: 12, borderRadius: 8, marginTop: 6, fontSize: 11, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                              {JSON.stringify(debugInfo.care_recommendation, null, 2)}
                            </pre>
                          </details>
                        )}
                        {debugInfo.care_repair && (
                          <div><b>Care repair:</b> {debugInfo.care_repair.repairAttempted ? (debugInfo.care_repair.repairSucceeded ? "✅" : "❌") : "—"}</div>
                        )}
                      </div>
                    </div>
                  ) : activeTab === "user" ? (
                    renderUserReport(userPart)
                  ) : (
                    <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>
                      {doctorPart}
                    </div>
                  )}
                </div>

                {careRecommendation && (
                  <div style={{ marginTop: 20 }}>
                    {/* URGENT_HELP block */}
                    {careRecommendation.level === "urgent_help" && (
                      <div style={{
                        background: "rgba(184,92,74,.12)", border: "2px solid #B85C4A",
                        borderRadius: 18, padding: 20, marginBottom: 16,
                      }}>
                        <div style={{ fontSize: 18, fontWeight: 900, color: "#B85C4A", marginBottom: 10 }}>
                          Нужна срочная помощь
                        </div>
                        <div style={{ color: "#2E2A25", lineHeight: 1.7, fontSize: 14, marginBottom: 16 }}>
                          Здесь нужна срочная помощь сегодня. Пожалуйста, позвоните 112, обратитесь в ближайшее приёмное отделение или попросите близкого помочь вам добраться до помощи. Не оставайтесь сейчас один.
                        </div>
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                          <a href="tel:112" style={{
                            display: "inline-block", background: "#B85C4A", color: "white",
                            borderRadius: 12, padding: "12px 20px", fontWeight: 700, fontSize: 15,
                            textDecoration: "none", cursor: "pointer",
                          }}>
                            Позвонить 112
                          </a>
                          <button style={{
                            border: "1px solid #B85C4A", background: "transparent", color: "#B85C4A",
                            borderRadius: 12, padding: "12px 20px", fontWeight: 600, fontSize: 14,
                            cursor: "pointer",
                          }} onClick={() => {
                            const msg = "Мне сейчас очень тяжело. Побудь со мной на связи, пожалуйста.";
                            navigator.clipboard.writeText(msg);
                            showToast("Сообщение скопировано");
                          }}>
                            Попросить близкого быть рядом
                          </button>
                        </div>
                      </div>
                    )}

                    {/* PROFESSIONAL_CONTACT block */}
                    {careRecommendation.level === "professional_contact" && (
                      <div style={{
                        background: "#F5F0E8", border: "1px solid rgba(46,42,37,.15)",
                        borderRadius: 18, padding: 20, marginBottom: 16,
                      }}>
                        <div style={{ fontSize: 17, fontWeight: 700, color: "#2E2A25", marginBottom: 8 }}>
                          Рекомендуем связаться со специалистом
                        </div>
                        {careRecommendation.timeframe && (
                          <div style={{ fontSize: 13, color: "#7A7268", marginBottom: 12 }}>
                            {careRecommendation.timeframe === "today" ? "Связаться сегодня" :
                             careRecommendation.timeframe === "within_days" ? "Связаться в ближайшие дни" :
                             "Связаться в ближайшее время"}
                          </div>
                        )}
                        {careRecommendation.specialist_types?.length > 0 && (
                          <div style={{ fontSize: 13, color: "#5F7D6C", marginBottom: 14, lineHeight: 1.5 }}>
                            {careRecommendation.specialist_types.map(st => ({
                              psychologist: "психолог", clinical_psychologist: "клинический психолог",
                              psychotherapist: "психотерапевт", psychiatrist: "психиатр",
                              general_physician: "терапевт", neurologist: "невролог",
                              emergency_service: "экстренная служба", crisis_service: "кризисная служба",
                              orthopedist: "ортопед", cardiologist: "кардиолог", gastroenterologist: "гастроэнтеролог",
                            }[st] || st)).join(", ")}
                          </div>
                        )}
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                          <button style={{ ...s.secondary, fontSize: 13, padding: "10px 16px" }} onClick={() => setShowConsultPrep(true)}>
                            Подготовиться к первой консультации
                          </button>
                          <button style={{ ...s.secondary, fontSize: 13, padding: "10px 16px" }} onClick={() => {
                            const msg = "Мне сейчас тяжело. Мне не обязательно нужны советы, но мне важно, чтобы ты побыл(а) со мной на связи сегодня.";
                            setMessageText(msg);
                            setShowMessageToClose(true);
                          }}>
                            Составить сообщение близкому
                          </button>
                          <button style={{ ...s.secondary, fontSize: 13, padding: "10px 16px" }} onClick={() => {
                            setShowSelfAssessment(true);
                            setShowSupportToolkit(true);
                          }}>
                            Продолжить разговор здесь
                          </button>
                          {careRecommendation.level === "professional_contact" && (
                            <button style={{ ...s.secondary, fontSize: 13, padding: "10px 16px", borderColor: "#B85C4A", color: "#B85C4A" }}
                              onClick={() => {
                                showToast("Если состояние ухудшается или есть риск — звоните 112 или 103");
                              }}>
                              Когда нужна срочная помощь
                            </button>
                          )}
                        </div>
                        {careRecommendation.interim_support?.length > 0 && (
                          <div style={{ marginTop: 14, fontSize: 13, color: "#7A7268", lineHeight: 1.6 }}>
                            <div style={{ fontWeight: 600, marginBottom: 4 }}>До консультации:</div>
                            <ul style={{ margin: 0, paddingLeft: 18 }}>
                              {careRecommendation.interim_support.map((s, i) => (
                                <li key={i}>{s}</li>
                              ))}
                            </ul>
                            <div style={{ marginTop: 6, fontStyle: "italic" }}>
                              Эти шаги не заменят профессиональную помощь, но могут помочь пережить ближайшие часы или дни безопаснее.
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* MEDICAL_CONSULTATION block (body module) */}
                    {careRecommendation.level === "medical_consultation" && (
                      <div style={{
                        background: "#F5F0E8", border: "1px solid rgba(46,42,37,.15)",
                        borderRadius: 18, padding: 20, marginBottom: 16,
                      }}>
                        <div style={{ fontSize: 17, fontWeight: 700, color: "#2E2A25", marginBottom: 8 }}>
                          Рекомендуем обратиться к врачу
                        </div>
                        {careRecommendation.timeframe && (
                          <div style={{ fontSize: 13, color: "#7A7268", marginBottom: 12 }}>
                            {careRecommendation.timeframe === "today" ? "Обратиться сегодня" :
                             careRecommendation.timeframe === "within_days" ? "Обратиться в ближайшие дни" :
                             "Обратиться в ближайшее время"}
                          </div>
                        )}
                        {careRecommendation.specialist_types?.length > 0 && (
                          <div style={{ fontSize: 13, color: "#5F7D6C", marginBottom: 14, lineHeight: 1.5 }}>
                            {careRecommendation.specialist_types.map(st => ({
                              psychologist: "психолог", clinical_psychologist: "клинический психолог",
                              psychotherapist: "психотерапевт", psychiatrist: "психиатр",
                              general_physician: "терапевт", neurologist: "невролог",
                              emergency_service: "экстренная служба", crisis_service: "кризисная служба",
                              orthopedist: "ортопед", cardiologist: "кардиолог", gastroenterologist: "гастроэнтеролог",
                            }[st] || st)).join(", ")}
                          </div>
                        )}
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                          <button style={{ ...s.secondary, fontSize: 13, padding: "10px 16px" }} onClick={() => {
                            showToast("Симптомы, требующие срочного внимания: боль в груди, одышка, сильная головная боль, слабость в конечности — звоните 112");
                          }}>
                            Когда нужна срочная помощь
                          </button>
                          <button style={{ ...s.secondary, fontSize: 13, padding: "10px 16px" }} onClick={() => {
                            const msg = "Я сейчас прохожу разбор телесных симптомов. Мне может понадобиться помощь с визитом к врачу в ближайшие дни.";
                            setMessageText(msg);
                            setShowMessageToClose(true);
                          }}>
                            Сообщить близкому
                          </button>
                        </div>
                        {careRecommendation.interim_support?.length > 0 && (
                          <div style={{ marginTop: 14, fontSize: 13, color: "#7A7268", lineHeight: 1.6 }}>
                            <div style={{ fontWeight: 600, marginBottom: 4 }}>До визита к врачу:</div>
                            <ul style={{ margin: 0, paddingLeft: 18 }}>
                              {careRecommendation.interim_support.map((s, i) => (
                                <li key={i}>{s}</li>
                              ))}
                            </ul>
                            <div style={{ marginTop: 6, fontStyle: "italic" }}>
                              Это временные меры, не заменяющие медицинскую консультацию.
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* SELF_SUPPORT / SELF_CARE block */}
                    {(careRecommendation.level === "self_support" || careRecommendation.level === "self_care") && (
                      <div style={{
                        background: "#E2EBE4", border: "1px solid rgba(125,154,137,.3)",
                        borderRadius: 18, padding: 20, marginBottom: 16,
                      }}>
                        <div style={{ fontSize: 17, fontWeight: 700, color: "#2E2A25", marginBottom: 8 }}>
                          Что делать дальше
                        </div>
                        <div style={{ color: "#2E2A25", lineHeight: 1.7, fontSize: 14, marginBottom: 12 }}>
                          Сейчас можно начать с поддержки близких и нескольких простых шагов. Если состояние не начнёт уменьшаться или станет сильнее, стоит обратиться к специалисту.
                        </div>
                        {careRecommendation.interim_support?.length > 0 && (
                          <ul style={{ color: "#5F7D6C", fontSize: 13, lineHeight: 1.6, margin: "0 0 12px", paddingLeft: 18 }}>
                            {careRecommendation.interim_support.map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ul>
                        )}
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                          <button style={{ ...s.secondary, fontSize: 13, padding: "10px 16px" }} onClick={() => {
                            setShowSelfAssessment(true);
                            setShowSupportToolkit(true);
                          }}>
                            Посмотреть поддерживающие практики
                          </button>
                          <button style={{ ...s.secondary, fontSize: 13, padding: "10px 16px", borderColor: "#B85C4A", color: "#B85C4A" }}
                            onClick={() => {
                              showToast("Если состояние ухудшается или есть риск — звоните 112 или 103");
                            }}>
                            Когда нужна срочная помощь
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Consultation prep modal */}
                {showConsultPrep && (
                  <div style={s.overlay} onClick={() => setShowConsultPrep(false)}>
                    <div style={s.modal} onClick={(e) => e.stopPropagation()}>
                      <div style={s.modalTitle}>Подготовиться к первой консультации</div>
                      <p style={{ color: "#7A7268", fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
                        Что важно рассказать специалисту:
                      </p>
                      <div style={{ background: "#FAF6EF", borderRadius: 14, padding: 16, marginBottom: 16, fontSize: 13, lineHeight: 1.7, color: "#2E2A25" }}>
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          <li>Что произошло</li>
                          <li>Как давно это продолжается</li>
                          <li>Что происходит со сном</li>
                          <li>Какие есть телесные симптомы</li>
                          <li>Что изменилось в работе и повседневной жизни</li>
                          <li>Были ли мысли о смерти или самоповреждении</li>
                          <li>Какие лекарства, алкоголь или другие средства используются</li>
                          <li>Кто сейчас может поддержать</li>
                        </ul>
                      </div>
                      <button
                        style={{ ...s.wide, background: "#7D9A89", color: "white" }}
                        onClick={() => {
                          const text = `Что произошло: ${text || "(будет заполнено при разговоре)"}
      Как давно: ${conversationHistory?.length ? "обсуждено в диалоге" : "—"}
      Сон: ${userPart?.match(/сон/i) ? "обсуждался" : "—"}
      Телесные симптомы: ${userPart?.match(/телесн|бол|сердц|голов/i) ? "обсуждались" : "—"}
      Изменения в жизни: ${userPart?.match(/работ|учёб/i) ? "обсуждались" : "—"}
      Мысли о смерти: ${userPart?.match(/смерт|жить/i) ? "обсуждались" : "—"}
      Лекарства/алкоголь: ${userPart?.match(/лекарств|алкоголь/i) ? "обсуждались" : "—"}
      Поддержка: ${userPart?.match(/поддерж|близк/i) ? "обсуждалась" : "—"}`;
                          navigator.clipboard.writeText(text);
                          showToast("Краткое описание скопировано");
                        }}
                      >
                        Скопировать краткое описание
                      </button>
                      <button style={{ ...s.secondary, marginTop: 10 }} onClick={() => setShowConsultPrep(false)}>
                        Закрыть
                      </button>
                    </div>
                  </div>
                )}

                {/* Message to close person modal */}
                {showMessageToClose && (
                  <div style={s.overlay} onClick={() => setShowMessageToClose(false)}>
                    <div style={s.modal} onClick={(e) => e.stopPropagation()}>
                      <div style={s.modalTitle}>Сообщение близкому</div>
                      <textarea
                        style={{ ...s.textarea, minHeight: 100, marginBottom: 16 }}
                        value={messageText}
                        onChange={(e) => setMessageText(e.target.value)}
                      />
                      <button
                        style={{ ...s.wide, background: "#7D9A89", color: "white" }}
                        onClick={() => {
                          navigator.clipboard.writeText(messageText);
                          showToast("Сообщение скопировано");
                        }}
                      >
                        Скопировать сообщение
                      </button>
                      <button style={{ ...s.secondary, marginTop: 10 }} onClick={() => setShowMessageToClose(false)}>
                        Закрыть
                      </button>
                    </div>
                  </div>
                )}

                {activeModule === "support" && !showSelfAssessment && !showSupportToolkit && !showSpecialistIntent && (
                  <div style={{ marginTop: 24, borderTop: "1px solid rgba(46,42,37,.1)", paddingTop: 20 }}>
                    <div style={{ fontSize: 14, color: "#2E2A25", lineHeight: 1.6, marginBottom: 16, fontFamily: "Georgia, \"PT Serif\", serif" }}>
                      Как вам кажется, на этом этапе вы сможете справляться с состоянием без подключения специалиста?
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button style={{ ...s.wide, flex: "1 1 auto", minWidth: 140 }} onClick={() => { setCanManageWithoutSpecialist("yes"); setShowSelfAssessment(true); setShowSupportToolkit(true); }}>
                        Да, пока попробую сам(а)
                      </button>
                      <button style={{ ...s.secondary, flex: "1 1 auto", minWidth: 140 }} onClick={() => { setCanManageWithoutSpecialist("not_sure"); setShowSelfAssessment(true); setShowSupportToolkit(true); }}>
                        Не уверен(а)
                      </button>
                      <button style={{ ...s.secondary, flex: "1 1 auto", minWidth: 140, borderColor: "#B85C4A", color: "#B85C4A" }} onClick={() => { setCanManageWithoutSpecialist("no"); setShowSelfAssessment(true); setShowSpecialistIntent(true); }}>
                        Нет, хочу подключить специалиста
                      </button>
                    </div>
                  </div>
                )}

                {activeModule === "support" && showSpecialistIntent && !specialistIntentDone && (
                  <div style={{ marginTop: 24, background: "#FAF6EF", border: "1px solid rgba(46,42,37,.1)", borderRadius: 14, padding: 20 }}>
                    <div style={{ fontSize: 16, fontWeight: 600, color: "#2E2A25", marginBottom: 12 }}>Запрос на подключение специалиста</div>
                    <p style={{ color: "#7A7268", lineHeight: 1.7, fontSize: 14, margin: "0 0 16px" }}>
                      Эта возможность готовится. Сейчас сервис работает в закрытом тестовом режиме и не является телемедицинской платформой. Мы сохраним отметку в вашей анонимной сессии, чтобы в будущем можно было вернуться к этому шагу.
                    </p>
                    <button
                      style={{ ...s.wide, background: "#7D9A89", color: "white" }}
                      onClick={() => {
                        setSpecialistIntentDone(true);
                        const newPlan = { ...(supportPlan || {}), specialist_request_intent: true, patient_self_assessment: { ...((supportPlan?.patient_self_assessment) || {}), can_manage_without_specialist: canManageWithoutSpecialist } };
                        setSupportPlan(newPlan);
                        saveSupportPlan(newPlan);
                      }}
                    >
                      Отметить, что хочу подключить специалиста
                    </button>
                    {specialistIntentDone && (
                      <div style={{ color: "#5F7D6C", fontSize: 13, marginTop: 12, lineHeight: 1.5, background: "#E2EBE4", borderRadius: 10, padding: 12 }}>
                        Отметка сохранена в вашей анонимной сессии. Если состояние ухудшается или есть риск причинить вред себе или другому человеку — звоните 112 или 103.
                      </div>
                    )}
                  </div>
                )}

                {showSupportToolkit && activeModule === "support" && (
                  <div style={{ marginTop: 24 }}>
                    <div style={{ fontSize: 16, fontWeight: 600, color: "#2E2A25", marginBottom: 12, fontFamily: "Georgia, \"PT Serif\", serif" }}>
                      Что можно попробовать до следующего разговора
                    </div>
                    <p style={{ color: "#7A7268", lineHeight: 1.6, fontSize: 13, margin: "0 0 16px" }}>
                      Это не лечение, не терапия и не замена специалисту. Немедикаментозные поддерживающие практики на 24–72 часа.
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {PRACTICES.map((p) => {
                        const alreadyAdded = supportPlan?.selected_practices?.some(sp => sp.id === p.id);
                        return (
                          <div key={p.id} style={{ border: "1px solid rgba(46,42,37,.1)", borderRadius: 12, padding: "12px 16px", background: "#FAF6EF" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                              <span style={{ fontSize: 14, fontWeight: 600, color: "#2E2A25", flex: 1 }}>{p.title}</span>
                              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                                <button style={{ fontSize: 12, padding: "4px 10px", borderRadius: 8, border: "1px solid rgba(46,42,37,.15)", background: "white", color: "#5F7D6C", cursor: "pointer" }} onClick={() => downloadPracticeFile(p.file)}>
                                  Скачать текст
                                </button>
                                <button
                                  style={{
                                    fontSize: 12, padding: "4px 10px", borderRadius: 8, border: "1px solid rgba(46,42,37,.15)",
                                    background: alreadyAdded ? "#E2EBE4" : "white", color: alreadyAdded ? "#5F7D6C" : "#7D9A89",
                                    cursor: alreadyAdded ? "default" : "pointer", fontWeight: alreadyAdded ? 400 : 600,
                                  }}
                                  disabled={alreadyAdded}
                                  onClick={() => addPracticeToPlan(p.id)}
                                >
                                  {alreadyAdded ? "✓ Добавлено" : "Добавить в мой план"}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <button
                  style={{ ...s.secondary, marginTop: 16 }}
                  onClick={() => setSessionReviewOpen(!sessionReviewOpen)}
                >
                  Оценка сессии
                </button>

                {sessionReviewOpen && (
                  <div style={s.expertBox}>
                    <h3 style={{ margin: "0 0 16px", fontSize: 18, fontFamily: "Georgia, \"PT Serif\", serif" }}>Оценка сессии</h3>

                    <label style={s.label}>Оценка пациентом</label>
                    <div style={{ marginBottom: 6, color: "#7A7268", fontSize: 13 }}>Насколько полезным был разбор? 1–5</div>
                    <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          style={{
                            width: 44, height: 44, borderRadius: 12, border: "1px solid rgba(46,42,37,.12)",
                            background: patientRating === n ? "#7D9A89" : "#FAF6EF",
                            color: patientRating === n ? "white" : "#2E2A25",
                            fontWeight: 800, fontSize: 18, cursor: "pointer",
                          }}
                          onClick={() => setPatientRating(n)}
                        >
                          {n}
                        </button>
                      ))}
                    </div>

                    <label style={s.label}>Что было полезно?</label>
                    <textarea
                      style={s.answerInput}
                      value={patientUseful}
                      onChange={(e) => setPatientUseful(e.target.value)}
                      placeholder="Например: помогло структурировать мысли, стало понятно, к кому обратиться..."
                    />

                    <label style={s.label}>Что было непонятно или бесполезно?</label>
                    <textarea
                      style={s.answerInput}
                      value={patientUnclear}
                      onChange={(e) => setPatientUnclear(e.target.value)}
                      placeholder="Например: вопросы были слишком общими, заключение непонятно..."
                    />

                    <div style={{ borderTop: "1px solid rgba(46,42,37,.1)", margin: "20px 0" }} />

                    <label style={s.label}>Оценка специалистом</label>

                    <label style={s.label2}>Какие вопросы были лишними?</label>
                    <textarea
                      style={s.answerInput}
                      value={doctorFeedback.wrongQuestions}
                      onChange={(e) =>
                        setDoctorFeedback({ ...doctorFeedback, wrongQuestions: e.target.value })
                      }
                      placeholder="Например: вопрос был не связан с жалобой, усиливал тревогу..."
                    />

                    <label style={s.label2}>Каких вопросов не хватило?</label>
                    <textarea
                      style={s.answerInput}
                      value={doctorFeedback.missingQuestions}
                      onChange={(e) =>
                        setDoctorFeedback({ ...doctorFeedback, missingQuestions: e.target.value })
                      }
                      placeholder="Например: не спросил про утрату, вещества, соматические причины..."
                    />

                    <label style={s.label2}>Какие вопросы были сформулированы неверно?</label>
                    <textarea
                      style={s.answerInput}
                      value={doctorFeedback.badQuestionWording}
                      onChange={(e) =>
                        setDoctorFeedback({ ...doctorFeedback, badQuestionWording: e.target.value })
                      }
                      placeholder="Например: вопрос содержал несколько смыслов, подсказывал диагноз..."
                    />

                    <label style={s.label2}>Исправленная версия заключения для пациента</label>
                    <textarea
                      style={s.answerInput}
                      value={doctorFeedback.correctedUserReport}
                      onChange={(e) =>
                        setDoctorFeedback({ ...doctorFeedback, correctedUserReport: e.target.value })
                      }
                      placeholder="Вставьте правильную версию мягкого отчета для пациента..."
                    />

                    <label style={s.label2}>Исправленная карта для специалиста</label>
                    <textarea
                      style={s.answerInput}
                      value={doctorFeedback.correctedDoctorReport}
                      onChange={(e) =>
                        setDoctorFeedback({ ...doctorFeedback, correctedDoctorReport: e.target.value })
                      }
                      placeholder="Вставьте правильную врачебную версию..."
                    />

                    <label style={s.label2}>Какое правило добавить в clinical protocol?</label>
                    <textarea
                      style={s.answerInput}
                      value={doctorFeedback.protocolUpdate}
                      onChange={(e) =>
                        setDoctorFeedback({ ...doctorFeedback, protocolUpdate: e.target.value })
                      }
                      placeholder="Например: если бессонница + тревога, всегда уточнять вещества, утрату и соматику..."
                    />

                    <label style={s.label2}>Общий комментарий специалиста</label>
                    <textarea
                      style={s.answerInput}
                      value={doctorFeedback.generalComment}
                      onChange={(e) =>
                        setDoctorFeedback({ ...doctorFeedback, generalComment: e.target.value })
                      }
                      placeholder="Любые дополнительные замечания..."
                    />

                    <label style={s.label2}>Рекомендации до следующей встречи</label>
                    <textarea
                      style={s.answerInput}
                      value={homeTasks}
                      onChange={(e) => setHomeTasks(e.target.value)}
                      placeholder="Например: вести дневник настроения, попробовать техники релаксации, обратиться к конкретному специалисту..."
                    />

                    <label style={s.label2}>Ресурсные факторы (что помогает / поддерживает)</label>
                    <textarea
                      style={s.answerInput}
                      value={resourceFactors}
                      onChange={(e) => setResourceFactors(e.target.value)}
                      placeholder="Например: поддержка близких, хобби, спорт, стабильный режим..."
                    />

                    <div style={{ display: "flex", gap: 10 }}>
                      <button
                        style={s.wide}
                        onClick={() => {
                          downloadCaseReview(buildCaseReview());
                        }}
                      >
                        Скачать JSON
                      </button>
                      {window.location.hostname.includes("localhost") && (
                        <button
                          style={s.wide}
                          onClick={async () => {
                            try {
                              await fetch("/api/reviews", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ action: "save", ...buildCaseReview() }),
                              });
                              alert("Сохранено локально");
                            } catch {
                              alert("Ошибка локального сохранения");
                            }
                          }}
                        >
                          Сохранить локально
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                  {reportSource === "cabinet" && (
                    <button
                      style={{ ...s.secondary, flex: 1 }}
                      onClick={() => { setPhase("cabinet"); setReportSource(null); }}
                    >
                      ← Назад в кабинет
                    </button>
                  )}
                  <button
                    style={{ ...s.secondary, flex: 1 }}
                    onClick={handleReset}
                  >
                    Начать заново
                  </button>
                </div>
              </div>
            )}
          </section>
          ) /* ends !(body && intake not idle) guard */}

          {/* Support Cabinet MVP */}
          {phase === "cabinet" && supportCabinet && (
            <section style={s.card} className="app-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
                <h2 style={{ margin: 0, fontFamily: "Georgia, \"PT Serif\", serif", fontSize: 24 }}>Ваши разговоры</h2>
                <button
                  style={{ ...s.secondary, fontSize: 13, padding: "10px 16px" }}
                  onClick={() => { setPhase("input"); setSupportCabinet(null); }}
                >
                  На главную
                </button>
              </div>

              <div style={{
                background: "#E2EBE4", border: "1px solid rgba(125,154,137,.3)",
                borderRadius: 16, padding: 18, marginBottom: 24,
              }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 12, color: "#5F7D6C", marginBottom: 4 }}>Код разговора</div>
                    <div style={{ fontWeight: 900, fontSize: 20, color: "#2E2A25", letterSpacing: 1, fontFamily: "monospace" }}>
                      {supportCabinet.public_code || publicCode}
                    </div>
                  </div>
                  <div style={{ width: 1, height: 40, background: "rgba(125,154,137,.3)", flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 12, color: "#5F7D6C", marginBottom: 4 }}>Баланс</div>
                    <div style={{ fontWeight: 700, fontSize: 18, color: "#2E2A25" }}>
                      {supportCabinet.balance?.visible
                        ? `${supportCabinet.balance.balance.toLocaleString("ru-RU")} кредитов`
                        : "—"}
                    </div>
                    <div style={{ fontSize: 12, color: "#7A7268" }}>Тестовый баланс. Деньги не списываются.</div>
                  </div>
                </div>

                {regeneratedCode && (
                  <div style={{ marginTop: 16, padding: 14, background: "#ffffff", borderRadius: 12, border: "1px solid rgba(125,154,137,.25)" }}>
                    <div style={{ fontSize: 12, color: "#5F7D6C", marginBottom: 6 }}>Новый код продолжения (сохраните его, старый больше не действует)</div>
                    <div style={{ fontWeight: 900, fontSize: 16, color: "#2E2A25", letterSpacing: 1, fontFamily: "monospace", wordBreak: "break-all" }}>
                      {regeneratedCode}
                    </div>
                    <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                      <button style={{ ...s.secondary, fontSize: 13 }} onClick={() => { navigator.clipboard.writeText(regeneratedCode); showToast("Код скопирован"); }}>
                        Скопировать
                      </button>
                      <button style={{ ...s.secondary, fontSize: 13 }} onClick={() => setRegeneratedCode(null)}>
                        Скрыть
                      </button>
                    </div>
                  </div>
                )}

                <div style={{ marginTop: 16 }}>
                  <button
                    style={{ ...s.secondary, fontSize: 13, padding: "10px 16px" }}
                    onClick={regenerateSupportContinuationCode}
                  >
                    Создать новый код продолжения
                  </button>
                </div>
              </div>

              {supportCabinet.sessions?.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#2E2A25", marginBottom: 12 }}>Последнее обращение</div>
                  {(() => {
                    const latest = supportCabinet.sessions[0];
                    const dateStr = latest.createdAt
                      ? new Date(latest.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
                      : "—";
                    return (
                      <div style={{
                        background: "#FAF6EF", border: "1px solid rgba(46,42,37,.1)",
                        borderRadius: 16, padding: 18,
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 16, color: "#2E2A25" }}>Обращение №{latest.order}</div>
                            <div style={{ fontSize: 13, color: "#7A7268", marginTop: 2 }}>{dateStr}</div>
                          </div>
                          <div style={{
                            fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 20,
                            background: latest.status === "followup" ? "#EDE3D8" : "#E2EBE4",
                            color: latest.status === "followup" ? "#8B6B4A" : "#5F7D6C",
                          }}>
                            {latest.status === "followup" ? "Продолжение" : "Первое обращение"}
                          </div>
                        </div>
                        <div style={{ fontSize: 14, color: "#5F574F", lineHeight: 1.5, marginBottom: 16 }}>
                          {latest.summary}
                        </div>
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                          <button style={{ ...s.primary, flex: 1, minWidth: 140 }} onClick={startSupportFollowUp}>
                            Продолжить разговор
                          </button>
                          <button style={{ ...s.secondary, flex: 1, minWidth: 140 }} onClick={() => openSupportReport(latest.sessionId)}>
                            Открыть отчёт
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {supportCabinet.sessions?.length > 1 && (
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#2E2A25", marginBottom: 12 }}>История обращений</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {supportCabinet.sessions.slice(1).map((s) => {
                      const dateStr = s.createdAt
                        ? new Date(s.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
                        : "—";
                      return (
                        <div key={s.sessionId} style={{
                          display: "flex", justifyContent: "space-between", alignItems: "center",
                          flexWrap: "wrap", gap: 10,
                          padding: 14, borderRadius: 12, background: "#ffffff",
                          border: "1px solid rgba(46,42,37,.08)",
                        }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 14, color: "#2E2A25" }}>Обращение №{s.order}</div>
                            <div style={{ fontSize: 12, color: "#7A7268", marginTop: 2 }}>{dateStr}</div>
                            <div style={{ fontSize: 13, color: "#5F574F", marginTop: 4, maxWidth: 400 }}>{s.summary}</div>
                          </div>
                          <button style={{ ...s.secondary, fontSize: 13, padding: "8px 14px" }} onClick={() => openSupportReport(s.sessionId)}>
                            Открыть
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Support follow-up form */}
          {phase === "followup" && (
            <section style={s.card} className="app-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
                <h2 style={{ margin: 0, fontFamily: "Georgia, \"PT Serif\", serif", fontSize: 22 }}>Что изменилось с прошлого разговора?</h2>
                <button
                  style={{ ...s.secondary, fontSize: 13, padding: "10px 16px" }}
                  onClick={() => setPhase("cabinet")}
                >
                  Назад
                </button>
              </div>

              {[
                { key: "dynamics", label: "1. Стало легче, тяжелее или примерно так же?", placeholder: "Например: стало немного легше, но к вечеру всё равно тревожно" },
                { key: "sleep_appetite", label: "2. Что изменилось в сне, аппетите и обычных делах?", placeholder: "Например: стал лучше засыпать, аппетит вернулся" },
                { key: "new_concerns", label: "3. Появилось ли что-то новое, что особенно тревожит?", placeholder: "Например: появились мысли, от которых трудно отвлечься" },
                { key: "tried", label: "4. Что из предложенного удалось попробовать?", placeholder: "Например: попробовал дыхание 4-6, записывал сон" },
                { key: "help_needed", label: "5. Какая помощь сейчас была бы наиболее полезна?", placeholder: "Например: хочу понять, стоит ли обратиться к психологу" },
              ].map((q) => (
                <div key={q.key} style={{ marginBottom: 16 }}>
                  <label style={{ ...s.label2, fontWeight: 700, marginBottom: 8, display: "block" }}>{q.label}</label>
                  <textarea
                    style={s.answerInput}
                    value={followUpAnswers[q.key] || ""}
                    onChange={(e) => setFollowUpAnswers({ ...followUpAnswers, [q.key]: e.target.value })}
                    placeholder={q.placeholder}
                    rows={3}
                  />
                </div>
              ))}

              <button
                style={s.wide}
                onClick={submitFollowUp}
                disabled={loading}
              >
                {loading ? "Начинаем разбор..." : "Продолжить разбор"}
              </button>
            </section>
          )}

        </main>
        );
        })()}

        {crisisOpen && (
          <div style={s.overlay} onClick={handleCrisisClose}>
            <div style={s.modal} className="modal" onClick={(e) => e.stopPropagation()}>
                <>
                  <div style={s.modalTitle}>Срочная помощь</div>
                  <div style={s.modalWarning}>
                    Если есть непосредственная угроза жизни или безопасности —
                    звоните <b>112</b> или <b>103</b>.
                  </div>

                  <div style={s.privacyNote}>
                    Пока сервис работает в тестовом режиме и не является экстренной службой. Мы не сохраняем ваш телефон или Telegram и не обещаем обратный звонок.
                  </div>

                  <textarea
                    style={s.crisisTextarea}
                    value={crisisText}
                    onChange={(e) => setCrisisText(e.target.value)}
                    placeholder="Что именно случилось?"
                  />

                  <button
                    style={{
                      ...s.secondary,
                      marginTop: 10,
                      width: "100%",
                    }}
                    onClick={() =>
                      crisisRecording ? stopCrisisRecording() : startCrisisRecording()
                    }
                    disabled={crisisTranscribing}
                  >
                    {crisisTranscribing
                      ? "Расшифровываем..."
                      : crisisRecording
                        ? "Остановить и расшифровать"
                        : "Рассказать голосом"}
                  </button>

                  <div
                    style={{
                      marginTop: 8,
                      color: crisisRecordingTime > 45 ? "#B85C4A" : "#7A7268",
                      fontSize: 14,
                    }}
                  >
                    {crisisRecording
                      ? `Запись: ${crisisRecordingTime} сек / 60 сек`
                      : "Можно описать ситуацию голосом до 1 минуты"}
                  </div>

                  {crisisVoiceError && (
                    <div style={s.error}>{crisisVoiceError}</div>
                  )}

                  <div style={s.crisisActions}>
                    <button style={s.wide} onClick={continueFromCrisis}>
                      Понял, перейти к анонимному разбору
                    </button>
                    <button style={{ ...s.secondary, width: "100%", marginTop: 0 }} onClick={handleCrisisClose}>
                      Закрыть
                    </button>
                  </div>
                  <div style={{ color: "#7A7268", fontSize: 12, marginTop: 12, textAlign: "center", lineHeight: 1.5 }}>
                    Сервис не является экстренной службой. Если опасно прямо сейчас — звоните 112 или 103.
                  </div>
                </>
            </div>
          </div>
        )}

        {sessionModalOpen && (
          <div style={s.overlay} onClick={() => setSessionModalOpen(false)}>
            <div style={s.modal} className="modal" onClick={(e) => e.stopPropagation()}>
              <div style={s.modalTitle}>Вернуться к разговору</div>

              <p style={{ color: "#7A7268", lineHeight: 1.6, marginBottom: 20 }}>
                Введите единый код продолжения вида ТОЧКА-XXXX-XXXX-XXXX-XXXX-XXXX. Он откроет все ваши разговоры на этом устройстве.
              </p>

              <input
                style={s.crisisInput}
                value={continuationCodeInput}
                onChange={(e) => setContinuationCodeInput(e.target.value.toUpperCase())}
                placeholder="Код продолжения"
              />

              {continuationCodeError && (
                <div style={s.error}>{continuationCodeError}</div>
              )}

              <div style={s.crisisActions}>
                <button
                  style={s.wide}
                  disabled={loadingSession || continuationCodeInput.trim().length < 5}
                  onClick={async () => {
                    setLoadingSession(true);
                    try {
                      const code = continuationCodeInput.trim();
                      await loadSupportCabinet(code);
                      setSessionModalOpen(false);
                      setContinuationCodeInput("");
                    } catch (e) {
                      // Error is already shown in the modal.
                    } finally {
                      setLoadingSession(false);
                    }
                  }}
                >
                  {loadingSession ? "Поиск..." : "Продолжить по коду"}
                </button>
                <button
                  style={{ ...s.secondary, width: "100%" }}
                  onClick={() => setSessionModalOpen(false)}
                >
                  Отмена
                </button>
              </div>
            </div>
          </div>
        )}

        {expertModalOpen && (
          <div style={s.overlay} onClick={() => { setExpertModalOpen(false); setShowRegisterForm(false); resetRegisterForm(); setRegistrationResult(null); }}>
            <div style={s.modal} className="modal" onClick={(e) => e.stopPropagation()}>
              {registrationResult ? (
                <>
                  <div style={s.modalTitle}>Режим специалиста активирован</div>
                  <p style={{ color: "#5F7D6C", lineHeight: 1.6, marginBottom: 16, background: "#E2EBE4", padding: "14px 18px", borderRadius: 14, fontSize: 14 }}>
                    Вы зарегистрированы как специалист. Ваш профиль привязан к этому устройству.
                  </p>
                  <div style={{ background: "#FAF6EF", border: "1px solid rgba(46,42,37,.1)", borderRadius: 14, padding: "16px 18px", marginBottom: 16 }}>
                    <div style={{ color: "#7A7268", fontSize: 12, marginBottom: 6 }}>Ваш код специалиста</div>
                    <div style={{ fontSize: 20, fontWeight: 900, color: "#2E2A25", letterSpacing: 1, fontFamily: "monospace" }}>
                      {registrationResult.access_code}
                    </div>
                    <div style={{ color: "#7A7268", fontSize: 12, marginTop: 8 }}>
                      Сохраните этот код. С ним вы сможете войти как специалист с другого устройства.
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button style={s.wide} onClick={() => { navigator.clipboard.writeText(registrationResult.access_code); showToast("Код скопирован"); }}>
                      Скопировать код
                    </button>
                    <button style={{ ...s.secondary, width: "100%" }} onClick={() => { setExpertModalOpen(false); setShowRegisterForm(false); resetRegisterForm(); setRegistrationResult(null); }}>
                      Готово
                    </button>
                  </div>
                </>
              ) : !showRegisterForm ? (
                <>
                  <div style={s.modalTitle}>Кабинет специалиста</div>

                  {/* Block A: existing code */}
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ color: "#2E2A25", fontWeight: 600, fontSize: 14, marginBottom: 10 }}>У меня уже есть код</div>
                    <input
                      style={s.crisisInput}
                      value={expertCodeInput}
                      onChange={(e) => setExpertCodeInput(e.target.value.toUpperCase())}
                      onKeyDown={(e) => e.key === "Enter" && handleExpertLogin()}
                      placeholder="EXPERT-XXXX-XXXX"
                    />
                    <div style={s.crisisActions}>
                      <button
                        style={s.wide}
                        disabled={expertLoggingIn || expertCodeInput.trim().length < 3}
                        onClick={handleExpertLogin}
                      >
                        {expertLoggingIn ? "Поиск..." : "Войти"}
                      </button>
                    </div>
                  </div>

                  {/* Divider */}
                  <div style={{ borderTop: "1px solid rgba(46,42,37,.1)", margin: "16px 0" }} />

                  {/* Block B: first time registration */}
                  <div>
                    <div style={{ color: "#2E2A25", fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Я впервые здесь</div>
                    <p style={{ color: "#7A7268", lineHeight: 1.6, marginBottom: 14, fontSize: 13 }}>
                      Если вы врач, психолог или другой специалист и участвуете в тестировании, заполните короткую форму. Доступ включится сразу.
                    </p>
                    <button
                      style={{ ...s.wide, background: "#FAF6EF", color: "#5F7D6C", border: "1px solid rgba(125,154,137,.3)" }}
                      onClick={() => { setShowRegisterForm(true); resetRegisterForm(); }}
                    >
                      Зарегистрироваться как специалист
                    </button>
                  </div>

                  <button
                    style={{ ...s.secondary, width: "100%" }}
                    onClick={() => setExpertModalOpen(false)}
                  >
                    Отмена
                  </button>
                </>
              ) : (
                <>
                  <div style={s.modalTitle}>Регистрация специалиста</div>
                  <p style={{ color: "#7A7268", lineHeight: 1.6, marginBottom: 16, fontSize: 13 }}>
                    В тестовом режиме используйте имя или псевдоним. Не указывайте данные, которые не хотите сохранять.
                  </p>

                  <input style={s.crisisInput} placeholder="Имя или псевдоним специалиста *" value={registerForm.name} onChange={(e) => setRegisterForm({ ...registerForm, name: e.target.value })} />
                  <select style={{ ...s.crisisInput, cursor: "pointer" }} value={registerForm.role} onChange={(e) => setRegisterForm({ ...registerForm, role: e.target.value })}>
                    <option value="psychiatrist">Психиатр</option>
                    <option value="psychologist">Психолог</option>
                    <option value="psychotherapist">Психотерапевт</option>
                    <option value="clinical_psychologist">Клинический психолог</option>
                    <option value="neurologist">Невролог</option>
                    <option value="other">Другое</option>
                  </select>
                  <input style={s.crisisInput} placeholder="Специализация" value={registerForm.specialty} onChange={(e) => setRegisterForm({ ...registerForm, specialty: e.target.value })} />

                  <div style={s.crisisActions}>
                    <button style={s.wide} disabled={registerSending} onClick={handleExpertRegister}>
                      {registerSending ? "Регистрация..." : "Зарегистрироваться"}
                    </button>
                    <button
                      style={{ ...s.secondary, width: "100%" }}
                      onClick={() => { setShowRegisterForm(false); resetRegisterForm(); }}
                    >
                      Назад
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {toast.message && (
          <div
            key={toast.key}
            style={{
              ...s.toast,
              ...(toast.type === "error" ? s.toastError : s.toastSuccess),
            }}
          >
            {toast.message}
          </div>
        )}

      </div>
    </div>
  );
}
