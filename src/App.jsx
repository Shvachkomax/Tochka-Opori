Warning: truncated output (original token count: 182326)
Total output lines: 13011

import InformationFlow from "./InformationFlow.jsx";
import React, { useRef, useState, useEffect, Component } from "react";
import { createVoiceRecording, isUsableVoiceBlob } from "./lib/voiceRecording.js";
import { appendVoiceText } from "./supportVoice.js";
import { normalizeConversationHistory, normalizeSessionDetails, extractUserReport, extractDoctorReport, extractExpertFeedback, buildConversationPairs } from "../lib/conversation.js";
import BodyIntake from "./BodyIntake.jsx";
import BodyDiary from "./BodyDiary.jsx";
import HealthCabinet from "./HealthCabinet.jsx";
import BodyOnboarding from "./BodyOnboarding.jsx";
import BodyDayView from "./BodyDayView.jsx";
import BodyHealthContext from "./BodyHealthContext.jsx";
import BodyServiceRequests from "./BodyServiceRequests.jsx";
import MedicationCard from "./MedicationCard.jsx";
import PatientMedicationOrders from "./PatientMedicationOrders.jsx";
import { fetchWithClientToken, getClientToken } from "./lib/clientToken.js";
import { saveBodySession, saveBodyDisplayResult, saveSupportSession, getBodySession, getSupportSession, clearBodySession, clearSupportSession, withAccessToken, withSessionAccess } from "./lib/sessionAccess.js";
import ClinicalCouncilAdmin from "./pages/admin/ClinicalCouncilAdmin.jsx";
import ExpertInvitePage from "./pages/expert/ExpertInvitePage.jsx";
import ExpertCabinet from "./pages/expert/ExpertCabinet.jsx";
import SpecialistCabinet from "./pages/specialist/SpecialistCabinet.jsx";
import { APP_BRAND } from "./lib/appBrand.js";

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
  const [crisisMode, setCrisisMode] = useState(false);
  const [crisisBlock, setCrisisBlock] = useState(null);
  const [result, setResult] = useState(null);
  const [phase, setPhase] = useState("input");
  const [supportScreen, setSupportScreen] = useState("landing");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("user");
  const [crisisOpen, setCrisisOpen] = useState(false);
  const [aboutProjectOpen, setAboutProjectOpen] = useState(false);
  const [crisisText, setCrisisText] = useState("");
  const [crisisContact, setCrisisContact] = useState("");
  const [crisisSubmitting, setCrisisSubmitting] = useState(false);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);

  const quickChatContainerRef = useRef(null);
  const quickChatInputRef = useRef(null);

  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [recordingTime, setRecordingTime] = useState(0);
  const [voiceObservations, setVoiceObservations] = useState([]);
  const voiceMsgCounterRef = useRef(0);
  const sessionRef = useRef(null);
  const startSessionPromiseRef = useRef(null);

  // Support cabinet speech-to-text input uses the same transcribe endpoint,
  // but keeps its recorder state separate from intake/question/crisis flows.
  const cabinetVoiceRecorderRef = useRef(null);
  const cabinetVoiceStreamRef = useRef(null);
  const cabinetVoiceChunksRef = useRef([]);
  const cabinetVoiceTimerRef = useRef(null);
  const cabinetVoiceIgnoreStopRef = useRef(false);
  const [cabinetVoiceRecording, setCabinetVoiceRecording] = useState(false);
  const [cabinetVoiceTranscribing, setCabinetVoiceTranscribing] = useState(false);
  const [cabinetVoiceTarget, setCabinetVoiceTarget] = useState(null);
  const [cabinetVoiceTime, setCabinetVoiceTime] = useState(0);
  const [cabinetVoiceError, setCabinetVoiceError] = useState("");

  useEffect(() => () => {
    cabinetVoiceIgnoreStopRef.current = true;
    if (cabinetVoiceTimerRef.current) clearInterval(cabinetVoiceTimerRef.current);
    cabinetVoiceStreamRef.current?.getTracks().forEach((track) => track.stop());
    if (cabinetVoiceRecorderRef.current?.state === "recording") {
      cabinetVoiceRecorderRef.current.stop();
    }
  }, []);

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


  // Support Cabinet MVP
  const [supportCabinet, setSupportCabinet] = useState(null);
  const [patientInvitations, setPatientInvitations] = useState([]);
  const [patientInvitationsLoading, setPatientInvitationsLoading] = useState(false);
  const [patientInviteModalOpen, setPatientInviteModalOpen] = useState(false);
  const [patientInviteCreated, setPatientInviteCreated] = useState(null);
  const [matchRequestSending, setMatchRequestSending] = useState(false);
  const [cabinetLoading, setCabinetLoading] = useState(false);
  const [followUpAnswers, setFollowUpAnswers] = useState({});
  const [reportSource, setReportSource] = useState(null); // "generated" | "cabinet"
  const [justFinishedSession, setJustFinishedSession] = useState(false);
  // Support Cabinet expanded features
  const [supportViewingSession, setSupportViewingSession] = useState(null);
  const [supportViewingSessionData, setSupportViewingSessionData] = useState(null);
  const [supportSessionLoading, setSupportSessionLoading] = useState(false);
  const [supportNewRequestOpen, setSupportNewRequestOpen] = useState(false);
  const [supportRequestSessionId, setSupportRequestSessionId] = useState(null);
  const [supportNewRequest, setSupportNewRequest] = useState({ service_code: "", reason: "", message: "", preferred_date: "", time_from: "", time_to: "", comment: "" });
  const [supportRequestSubmitting, setSupportRequestSubmitting] = useState(false);
  const [accessExpanded, setAccessExpanded] = useState(false);
  const [profileExpanded, setProfileExpanded] = useState(false);
  // Daily check-in state
  const [checkinToday, setCheckinToday] = useState(null);
  const [checkinHistory, setCheckinHistory] = useState([]);
  const [checkinWellbeing, setCheckinWellbeing] = useState(null);
  const [checkinAnxiety, setCheckinAnxiety] = useState(null);
  const [checkinComment, setCheckinComment] = useState("");
  const [checkinSaving, setCheckinSaving] = useState(false);
  // Practices state
  const [supportPractices, setSupportPractices] = useState([]);
  const [practiceDetailKey, setPracticeDetailKey] = useState(null);
  // Quick chat state
  const [quickChatMessages, setQuickChatMessages] = useState([]);
  const [quickChatInput, setQuickChatInput] = useState("");
  const [quickChatLoading, setQuickChatLoading] = useState(false);
  const [quickChatExpanded, setQuickChatExpanded] = useState(false);
  const [quickChatShowHistory, setQuickChatShowHistory] = useState(false);
  const [quickChatScrolledUp, setQuickChatScrolledUp] = useState(false);
  const [quickChatHasNewResponse, setQuickChatHasNewResponse] = useState(false);
  // Follow-up answered topics for AI dedup
  const [followupAnsweredTopics, setFollowupAnsweredTopics] = useState(null);
  // Display name
  const [supportDisplayName, setSupportDisplayName] = useState(null);
  const [displayNameInput, setDisplayNameInput] = useState("");

  const [activeModule, setActiveModule] = useState(() => {
    if (!APP_BRAND.isSupportPilot && typeof window !== "undefined") {
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
    { id: "breathing", title: "Дыхание 4–6 минут при тревоге", file: "01-breathing.md", description: "Медленное дыхание с более длинным выдохом, чтобы немного снизить телесное напряжение.", duration: "3–5 минут", category: "breathing" },
    { id: "grounding", title: "Заземление 5–4–3–2–1", file: "02-grounding.md", description: "Техника заземления через органы чувств для возвращения в настоящий момент.", duration: "5 минут", category: "grounding" },
    { id: "jaw_relaxation", title: "Мягкое расслабление лица и челюсти", file: "03-jaw-relaxation.md", description: "Снятие напряжения с лица, челюсти и шеи.", duration: "3–5 минут", category: "grounding" },
    { id: "sleep_prep", title: "Практика перед сном", file: "04-sleep-prep.md", description: "Мягкая подготовка ко сну при тревоге или бессоннице.", duration: "10–15 минут", category: "sleep" },
    { id: "neck_shoulders_stretch", title: "Мягкая растяжка шеи и плеч", file: "05-neck-shoulders-stretch.md", description: "Снятие мышечного напряжения в верхней части тела.", duration: "5 минут", category: "activity" },
    { id: "diary", title: "Дневник состояния на 3 дня", file: "06-diary.md", description: "Краткие ежедневные записи для отслеживания изменений.", duration: "5 минут в день", category: "journaling" },
    { id: "24h_plan", title: "План 24 часа без ухудшения", file: "07-24h-plan.md", description: "Пошаговый план на ближайшие сутки.", duration: "—", category: "routine" },
    { id: "short_walk", title: "Короткая прогулка", file: null, description: "Прогулка на свежем воздухе для смены обстановки и лёгкой физической активности.", duration: "15–30 минут", category: "activity" },
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
    saveSupportPractice(practiceId);
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
  const toastTimerRef = useRef(null);

  // Auto-dismiss toast after 3 seconds
  useEffect(() => {
    if (toast.message) {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => {
        setToast({ message: "", type: "", key: 0 });
      }, 3000);
    }
    return () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); };
  }, [toast.key]);

  function clearToast() {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message: "", type: "", key: 0 });
  }

  // Navigate to body cabinet from any workspace screen
  function goToBodyCabinet() {
    if (activeModule !== "body") return;
    if (bodyScreen === "cabinet") return; // Already there
    // Confirm if in diary_edit with unsaved changes
    if (bodyScreen === "diary_edit") {
      if (!window.confirm("Вернуться в кабинет? Несохранённые изменения могут потеряться.")) return;
    }
    clearToast();
    setBodyDiaryDayData(null);
    setBodyScreen("cabinet");
  }

  // Support navigation: go to landing (no logout)
  function goToSupportLanding() {
    setSupportScreen("landing");
    setPhase("input");
    setSupportNewRequestOpen(false);
    setSupportViewingSession(null);
    setSupportViewingSessionData(null);
  }

  // Support navigation: go to cabinet
  function goToSupportCabinet() {
    setSupportScreen("cabinet");
    setPhase("cabinet");
    setSupportNewRequestOpen(false);
    setSupportViewingSession(null);
    setSupportViewingSessionData(null);
  }

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
  const [inviteSpecialistAuth, setInviteSpecialistAuth] = useState({ loading: false, authenticated: false, error: null });
  const [onboardingForm, setOnboardingForm] = useState({ name: "", contact_email: "", contact_phone: "", comment: "" });
  const [onboardingSubmitting, setOnboardingSubmitting] = useState(false);

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
            setInviteInfo({ valid: true, ...d.invite });
            if (d.invite.direction === "patient_to_specialist") {
              setInviteSpecialistAuth({ loading: true, authenticated: false, error: null });
              fetch("/api/specialist", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({ action: "me" }),
              })
                .then(async (response) => ({ response, data: await response.json() }))
                .then(({ response, data }) => {
                  if (data.ok) {
                    setInviteSpecialistAuth({ loading: false, authenticated: true, error: null });
                  } else if (response.status === 401 || response.status === 403) {
                    setInviteSpecialistAuth({ loading: false, authenticated: false, error: null });
                  } else {
                    setInviteSpecialistAuth({ loading: false, authenticated: false, error: "Не удалось проверить вход специалиста." });
                  }
                })
                .catch(() => setInviteSpecialistAuth({ loading: false, authenticated: false, error: "Не удалось проверить вход специалиста." }));
            }
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
  const [bodyDiaryDayData, setBodyDiaryDayData] = useState(null);
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

  // Admin specialist onboarding/match state
  const [onboardingRequests, setOnboardingRequests] = useState([]);
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [matchRequests, setMatchRequests] = useState([]);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchExpertSelector, setMatchExpertSelector] = useState(null); // request id being assigned
  const [matchExpertList, setMatchExpertList] = useState([]);
  const [matchAssigning, setMatchAssigning] = useState(false);
  const [bodyExportingCases, setBodyExportingCases] = useState(false);
  // Body client assignment
  const [bodyAssignments, setBodyAssignments] = useState([]);
  const [bodyAssignmentsLoading, setBodyAssignmentsLoading] = useState(false);
  const [bodyExperts, setBodyExperts] = useState([]);
  const [bodyAssignTarget, setBodyAssignTarget] = useState(null); // body_client_ref being assigned
  const [bodyAssignExpertId, setBodyAssignExpertId] = useState("");
  const [bodyAssignOrgId, setBodyAssignOrgId] = useState(null);
  const [bodyAssignSaving, setBodyAssignSaving] = useState(false);
  const [bodyAssignIsReassign, setBodyAssignIsReassign] = useState(false);
  const [bodyAssignExpertOrgs, setBodyAssignExpertOrgs] = useState([]);

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
 …162326 tokens truncated…tionCode}
                      >
                        Создать новый код продолжения
                      </button>
                    </div>
                  )}
                </div>

              </section>
            );
          })()}

          {/* Support Session View */}
          {phase === "session_view" && supportViewingSessionData && (() => {
            const s_data = supportViewingSessionData;
            const sessionDate = s_data.createdAt ? new Date(s_data.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
            return (
              <section style={{ width: "100%" }} className="app-card-support">
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 15, fontWeight: 600, color: "#2E2A25" }}>Разговор от {sessionDate}</span>
                  </div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <button style={{ ...s.secondary, fontSize: 13, padding: "8px 14px" }} onClick={goToSupportCabinet}>
                      ← В кабинет
                    </button>
                  </div>
                </div>

                {/* Client-safe content only */}
                {s_data.patient_input && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, color: "#7A7268", marginBottom: 6, fontWeight: 600 }}>Ваше обращение</div>
                    <div style={{ fontSize: 14, color: "#5F574F", lineHeight: 1.6, padding: "12px 16px", background: "#FAF6EF", borderRadius: 12 }}>
                      {s_data.patient_input.slice(0, 500)}{s_data.patient_input.length > 500 ? "…" : ""}
                    </div>
                  </div>
                )}

                {s_data.user_report && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, color: "#7A7268", marginBottom: 6, fontWeight: 600 }}>Отчёт</div>
                    <div style={{ fontSize: 14, color: "#2E2A25", lineHeight: 1.7, padding: "16px", background: "#fff", borderRadius: 12, border: "1px solid rgba(46,42,37,.08)" }}>
                      {s_data.user_report.split("\n").map((line, i) => <div key={i}>{line || <br />}</div>)}
                    </div>
                  </div>
                )}

                {s_data.supportPlan?.care_recommendation && (() => {
                  const nextStep = getCareNextStep(s_data.supportPlan.care_recommendation);
                  return (
                    <div style={{
                      background: nextStep.urgent ? "rgba(184,92,74,.12)" : "#E2EBE4",
                      border: nextStep.urgent ? "2px solid #B85C4A" : "1px solid rgba(125,154,137,.3)",
                      borderRadius: 14, padding: 16, marginBottom: 16,
                    }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: nextStep.urgent ? "#B85C4A" : "#2E2A25", marginBottom: 4 }}>
                        {nextStep.text}
                      </div>
                      <div style={{ fontSize: 13, color: nextStep.urgent ? "#8B4A3A" : "#5F7D6C" }}>
                        {nextStep.description}
                      </div>
                    </div>
                  );
                })()}

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
                  <button style={{ ...s.primary, flex: 1, minWidth: 140 }} onClick={startSupportFollowUp}>
                    Продолжить разговор
                  </button>
                  <button style={{ ...s.secondary, flex: 1, minWidth: 140 }} onClick={() => openSupportRequestForSession(s_data.sessionId)}>
                    Связаться со специалистом
                  </button>
                </div>
              </section>
            );
          })()}

          {/* Shared: Support New Request Modal */}
          {supportNewRequestOpen && (
            <div style={{
              position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
              background: "rgba(0,0,0,.4)", zIndex: 1000,
              display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
            }} onClick={(e) => { if (e.target === e.currentTarget) setSupportNewRequestOpen(false); }}>
              <div style={{
                background: "#fff", borderRadius: 18, padding: 24, maxWidth: 520, width: "100%",
                maxHeight: "90vh", overflowY: "auto", boxShadow: "0 8px 32px rgba(0,0,0,.15)",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                  <h3 style={{ margin: 0, fontFamily: "Georgia, serif", fontSize: 18 }}>Запрос специалисту</h3>
                  <button style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#7A7268" }} onClick={() => setSupportNewRequestOpen(false)}>&times;</button>
                </div>
                {APP_BRAND.isSupportPilot && (
                  <div style={{ marginBottom: 16, padding: 12, borderRadius: 10, background: "#F8FAF8", color: "#5F574F", fontSize: 12, lineHeight: 1.5 }}>
                    Отправляя запрос, вы разрешаете связанному со своим кабинетом специалисту увидеть эту предварительную сводку и контекст выбранного разговора. До отправки запроса эти сведения врачу не передаются.
                  </div>
                )}

                <label style={{ ...s.label, fontWeight: 700 }}>Услуга</label>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
                  {[
                    { code: "short_followup", label: "Короткий follow-up", credits: 10000 },
                    { code: "therapy_review", label: "Разбор терапии / повторная консультация по лечению", credits: 20000 },
                    { code: "written_consultation", label: "Письменная консультация", credits: 25000 },
                    { code: "phone_consultation", label: "Телефонный разговор со специалистом", credits: 30000 },
                    { code: "urgent_contact", label: "Срочная связь со специалистом", credits: 40000 },
                    { code: "online_consultation", label: "Онлайн-консультация", credits: 50000 },
                    { code: "offline_consultation", label: "Очная консультация", credits: 75000 },
                  ].map((opt) => (
                    <button key={opt.code} style={{
                      padding: "10px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer", textAlign: "left",
                      border: `1px solid ${supportNewRequest.service_code === opt.code ? "#7D9A89" : "rgba(46,42,37,.15)"}`,
                      background: supportNewRequest.service_code === opt.code ? "#E2EBE4" : "#fff",
                      color: supportNewRequest.service_code === opt.code ? "#5F7D6C" : "#2E2A25",
                    }} onClick={() => setSupportNewRequest({ ...supportNewRequest, service_code: opt.code })}>
                      <span>{opt.label}</span>
                      <span style={{ float: "right", fontSize: 12, color: "#7D9A89" }}>{opt.credits.toLocaleString("ru-RU")} кредитов</span>
                    </button>
                  ))}
                </div>

                <label style={{ ...s.label, fontWeight: 700 }}>Причина</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
                  {[
                    { value: "discuss_report", label: "Обсудить отчёт" },
                    { value: "follow_up", label: "Продолжение" },
                    { value: "new_concern", label: "Новая проблема" },
                    { value: "other", label: "Другое" },
                  ].map((opt) => (
                    <button key={opt.value} style={{
                      padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                      border: `1px solid ${supportNewRequest.reason === opt.value ? "#7D9A89" : "rgba(46,42,37,.15)"}`,
                      background: supportNewRequest.reason === opt.value ? "#E2EBE4" : "#fff",
                      color: supportNewRequest.reason === opt.value ? "#5F7D6C" : "#2E2A25",
                    }} onClick={() => setSupportNewRequest({ ...supportNewRequest, reason: opt.value })}>
                      {opt.label}
                    </button>
                  ))}
                </div>

                <label style={s.label}>Сообщение</label>
                <textarea
                  style={{ ...s.answerInput, minHeight: 80 }}
                  value={supportNewRequest.message}
                  onChange={(e) => setSupportNewRequest({ ...supportNewRequest, message: e.target.value })}
                  placeholder="Опишите, что хотите обсудить со специалистом..."
                />

                {(supportNewRequest.service_code === "phone_consultation" || supportNewRequest.service_code === "urgent_contact" || supportNewRequest.service_code === "online_consultation" || supportNewRequest.service_code === "offline_consultation") && (
                  <>
                    <label style={s.label}>Предпочтительная дата</label>
                    <input
                      type="date"
                      style={s.answerInput}
                      value={supportNewRequest.preferred_date}
                      onChange={(e) => setSupportNewRequest({ ...supportNewRequest, preferred_date: e.target.value })}
                    />
                    <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                      <div style={{ flex: 1 }}>
                        <label style={s.label}>С</label>
                        <input type="time" style={s.answerInput} value={supportNewRequest.time_from} onChange={(e) => setSupportNewRequest({ ...supportNewRequest, time_from: e.target.value })} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={s.label}>До</label>
                        <input type="time" style={s.answerInput} value={supportNewRequest.time_to} onChange={(e) => setSupportNewRequest({ ...supportNewRequest, time_to: e.target.value })} />
                      </div>
                    </div>
                  </>
                )}

                <label style={s.label}>Комментарий (необязательно)</label>
                <textarea
                  style={{ ...s.answerInput, minHeight: 50 }}
                  value={supportNewRequest.comment}
                  onChange={(e) => setSupportNewRequest({ ...supportNewRequest, comment: e.target.value })}
                  placeholder="Дополнительные пожелания..."
                />

                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <button
                    style={{ ...s.wide, opacity: supportRequestSubmitting ? 0.6 : 1 }}
                    disabled={supportRequestSubmitting}
                    onClick={submitSupportServiceRequest}
                  >
                    {supportRequestSubmitting ? "Отправка..." : "Отправить запрос"}
                  </button>
                  <button style={s.secondary} onClick={() => setSupportNewRequestOpen(false)}>
                    Отмена
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Patient invite specialist modal */}
          {patientInviteModalOpen && (
            <div style={{
              position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
              background: "rgba(0,0,0,.4)", zIndex: 1000,
              display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
            }} onClick={(e) => { if (e.target === e.currentTarget) setPatientInviteModalOpen(false); }}>
              <div style={{
                background: "#fff", borderRadius: 18, padding: 24, maxWidth: 480, width: "100%",
                maxHeight: "90vh", overflowY: "auto", boxShadow: "0 8px 32px rgba(0,0,0,.15)",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                  <h3 style={{ margin: 0, fontFamily: "Georgia, serif", fontSize: 18 }}>Пригласить специалиста</h3>
                  <button style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#7A7268" }} onClick={() => setPatientInviteModalOpen(false)}>&times;</button>
                </div>

                {patientInviteCreated ? (
                  <div style={{ padding: 12, borderRadius: 12, border: "1px solid #E2EBE4", background: "#F8FAF8" }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#2E2A25", marginBottom: 8 }}>Приглашение создано</div>
                    <div style={{ fontSize: 13, color: "#5F574F", marginBottom: 8, wordBreak: "break-all" }}>
                      Ссылка: {patientInviteCreated.url}
                    </div>
                    <button onClick={() => { navigator.clipboard?.writeText(patientInviteCreated.url); showToast("Скопировано"); }} style={{ ...s.primary, marginBottom: 8, fontSize: 13, padding: "8px 14px" }}>
                      Скопировать ссылку
                    </button>
                    <div style={{ fontSize: 12, color: "#7A7268" }}>
                      Срок действия: 14 дней. Отправьте эту ссылку вашему специалисту.
                    </div>
                    <button onClick={() => setPatientInviteModalOpen(false)} style={{ ...s.secondary, marginTop: 12, fontSize: 13 }}>
                      Готово
                    </button>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 13, color: "#5F574F", marginBottom: 16 }}>
                      Создайте ссылку и отправьте вашему специалисту. После того как специалист подключится, он появится в вашем кабинете.
                    </div>
                    <div style={{ fontSize: 13, color: "#7A7268", marginBottom: 16, padding: 12, background: "#FAF6EF", borderRadius: 10 }}>
                      Если у вашего специалиста уже есть аккаунт в системе, он сможет принять приглашение сразу. Если нет — потребуется одобрение администратора.
                    </div>
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <button onClick={createPatientInvitation} style={{ ...s.primary, fontSize: 13, padding: "10px 16px" }}>
                        Создать ссылку
                      </button>
                      <button onClick={() => setPatientInviteModalOpen(false)} style={{ ...s.secondary, fontSize: 13 }}>
                        Отмена
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Support follow-up form */}
          {phase === "followup" && (
            <section style={{ width: "100%" }} className="app-card-support">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: "#2E2A25" }}>Продолжение разговора</span>
                </div>
                <button
                  style={{ ...s.secondary, fontSize: 13, padding: "10px 16px" }}
                  onClick={goToSupportCabinet}
                >
                  ← В кабинет
                </button>
              </div>

              {[
                { key: "dynamics", label: "Стало легче, тяжелее или примерно так же?", placeholder: "Например: стало немного легше, но к вечеру всё равно тревожно" },
                { key: "new_concerns", label: "Появилось ли что-то новое, что особенно беспокоит?", placeholder: "Например: появились мысли, от которых трудно отвлечься" },
                { key: "tried", label: "Что из предложенного раньше удалось попробовать?", placeholder: "Например: попробовал дыхание 4-6, записывал сон" },
              ].map((q) => (
                <div key={q.key} style={{ marginBottom: 16 }}>
                  <label style={{ ...s.label2, fontWeight: 700, marginBottom: 8, display: "block" }}>{q.label}</label>
                  {q.key === "tried" && supportPractices.length > 0 && (
                    <div style={{ marginBottom: 8, padding: "10px 14px", background: "#E2EBE4", borderRadius: 10, fontSize: 13, color: "#5F7D6C" }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>Ранее предложенные практики:</div>
                      {supportPractices.filter(p => p.status === "active").slice(0, 3).map(p => (
                        <div key={p.practice_key} style={{ marginBottom: 2 }}>— {p.title}</div>
                      ))}
                    </div>
                  )}
                  <textarea
                    style={s.answerInput}
                    value={followUpAnswers[q.key] || ""}
                     onChange={(e) => setFollowUpAnswers({ ...followUpAnswers, [q.key]: e.target.value })}
                     placeholder={q.placeholder}
                     rows={3}
                   />
                   {renderSupportCabinetVoice(q.key, "Ответить голосом")}
                 </div>
              ))}

              <div style={{ marginBottom: 20 }}>
                <label style={{ ...s.label2, fontWeight: 700, marginBottom: 8, display: "block" }}>
                  Что ещё вы хотите рассказать или спросить?
                </label>
                <div style={{ fontSize: 13, color: "#7A7268", marginBottom: 8 }}>
                  Можно написать о чём угодно — о состоянии, сне, отношениях, работе, тревоге или просто задать вопрос.
                </div>
                <textarea
                  style={{ ...s.answerInput, minHeight: 120 }}
                  value={followUpAnswers.free_text || ""}
                  onChange={(e) => setFollowUpAnswers({ ...followUpAnswers, free_text: e.target.value })}
                   placeholder="Напишите здесь всё, что хотите..."
                   rows={5}
                   onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submitFollowUp(); } }}
                 />
                 {renderSupportCabinetVoice("free_text", "Ответить голосом")}
               </div>

              <button
                style={s.wide}
                onClick={submitFollowUp}
                disabled={loading}
              >
                {loading ? "Начинаем разговор..." : "Продолжить разговор"}
              </button>
            </section>
          )}

        </main>
        );
        })()}

        {aboutProjectOpen && (
          <div style={s.overlay} onClick={() => setAboutProjectOpen(false)}>
            <div
              style={{
                ...s.modal,
                position: "relative",
                maxWidth: activeModule === "support" ? 640 : 640,
                maxHeight: "calc(100vh - 40px)",
                overflowY: "auto",
              }}
              className="modal"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                aria-label="Закрыть"
                onClick={() => setAboutProjectOpen(false)}
                style={{
                  position: "absolute",
                  top: 18,
                  right: 20,
                  border: 0,
                  background: "transparent",
                  color: "#7A7268",
                  fontSize: 28,
                  lineHeight: 1,
                  cursor: "pointer",
                  padding: 4,
                }}
              >
                ×
              </button>

              <div style={{ ...s.modalTitle, paddingRight: 40 }}>О проекте</div>

              {activeModule === "body" ? (
                <div style={{ color: "#2E2A25", fontSize: 16, lineHeight: 1.65 }}>
                  <p style={{ margin: "18px 0" }}>
                    Есть много приложений, которые помогают похудеть и поддерживать форму. В Health мы предлагаем поддержку ИИ-компаньона и специалистов — нутрициологов и эндокринологов, которых можно подключить в любой момент.
                  </p>
                  <p style={{ margin: "18px 0" }}>
                    Здесь вы найдете помощь с питанием, повседневными привычками и активностью — чтобы вести здоровый образ жизни, обрести спортивную форму и поддерживать желаемые пропорции тела.
                  </p>
                </div>
              ) : (
                <div style={{ color: "#2E2A25", fontSize: 16, lineHeight: 1.65 }}>
                  <p style={{ margin: "18px 0" }}>
                    Вам тяжело? Вы чувствуете тревогу, тоску, растерянность? Переживаете утрату, расставание или другой сложный период?
                  </p>
                  <p style={{ margin: "18px 0", fontWeight: 700 }}>
                    Поговорите с нами об этом.
                  </p>
                  <p style={{ margin: "18px 0" }}>
                    Начните с небольшого шага — голосом или текстом расскажите, что с вами происходит и что беспокоит сейчас.
                  </p>
                  <p style={{ margin: "18px 0" }}>
                    Мы зададим несколько уточняющих вопросов и поможем бережно разобраться в вашем состоянии: понять, на что стоит обратить внимание и куда двигаться дальше.
                  </p>
                  <p style={{ margin: "18px 0" }}>
                    Первый разговор может остаться анонимным — вы сами решаете, продолжать ли его.
                  </p>
                  <p style={{ margin: "18px 0" }}>
                    А если вам нужна дальнейшая помощь, мы поможем найти подходящего специалиста и организовать сопровождение.
                  </p>
                  <p style={{ margin: "18px 0" }}>
                    Захотите вернуться к разговору — <strong>сохраните свой анонимный код доступа.</strong> По нему вы сможете продолжить диалог.
                  </p>
                  <p style={{ margin: "18px 0" }}>
                    Хотите общаться здесь со своим врачом? Мы подготовим ссылку. Отправьте её врачу — когда он примет приглашение, вы сможете общаться в сервисе.
                  </p>
                  <p style={{ margin: "18px 0", fontWeight: 700 }}>
                    Не нужно заранее знать, как правильно сформулировать проблему. Просто начните говорить. Диалог подскажет следующие вопросы.
                  </p>
                </div>
              )}

              <button
                type="button"
                style={{ ...s.primary, marginTop: 4 }}
                onClick={() => setAboutProjectOpen(false)}
              >
                Понятно
              </button>
            </div>
          </div>
        )}

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
              {APP_BRAND.isSupportPilot && (
                <p style={{ color: "#7A7268", lineHeight: 1.6, marginTop: -12, marginBottom: 16, fontSize: 13 }}>
                  Если у вас остался короткий код из старой версии, откройте беседу на устройстве, где она уже доступна, и создайте новый код рядом с кнопкой «Продолжить разговор». Новый код можно использовать на другом устройстве.
                </p>
              )}

              <input
                style={s.crisisInput}
                value={continuationCodeInput}
                onChange={(e) => setContinuationCodeInput(e.target.value.toUpperCase())}
                placeholder="Код продолжения"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && continuationCodeInput.trim().length >= 5 && !loadingSession) {
                    e.preventDefault();
                    loadSupportCabinet(continuationCodeInput.trim())
                      .then((opened) => { if (opened) { setSessionModalOpen(false); setContinuationCodeInput(""); } })
                      .catch(() => {});
                  }
                }}
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
                      const opened = await loadSupportCabinet(code);
                      if (opened) {
                        setSessionModalOpen(false);
                        setContinuationCodeInput("");
                      }
                    } catch (e) {
                      // Error is already shown in the modal.
                    } finally {
                      setLoadingSession(false);
                    }
                  }}
                >
                  {loadingSession ? "Поиск..." : "Продолжить по коду"}
                </button>
              </div>
                <button
                  style={{ ...s.secondary, width: "100%" }}
                  onClick={() => setSessionModalOpen(false)}
                >
                  Отмена
                </button>
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
