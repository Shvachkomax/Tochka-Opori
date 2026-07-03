import React, { useRef, useState } from "react";

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
  const [sessionCodeInput, setSessionCodeInput] = useState("");
  const [loadingSession, setLoadingSession] = useState(false);
  const [sessionData, setSessionData] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [publicCode, setPublicCode] = useState(null);
  const [isContinuation, setIsContinuation] = useState(false);
  const [previousPatientReport, setPreviousPatientReport] = useState("");
  const [previousDoctorReport, setPreviousDoctorReport] = useState("");
  const [homeTasks, setHomeTasks] = useState("");
  const [resourceFactors, setResourceFactors] = useState("");

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
      fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "updateSupportPlan", public_code: publicCode, session_id: sessionId, support_plan: sp }),
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
  const [adminEnv, setAdminEnv] = useState("production");
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

  // Admin expert requests state
  const [adminReqTab, setAdminReqTab] = useState("reviews");
  const [adminRequests, setAdminRequests] = useState([]);
  const [adminReqFilter, setAdminReqFilter] = useState("pending");

  // Admin crisis requests state
  const [adminCrisisRequests, setAdminCrisisRequests] = useState([]);
  const [adminCrisisFilter, setAdminCrisisFilter] = useState("new");
  const [adminCrisisLoading, setAdminCrisisLoading] = useState(false);
  const [adminCrisisActionLoading, setAdminCrisisActionLoading] = useState(null);
  const [adminDarkMode, setAdminDarkMode] = useState(true);

  // Training table state
  const [trainingSessions, setTrainingSessions] = useState([]);
  const [trainingLoading, setTrainingLoading] = useState(false);
  const [trainingFilter, setTrainingFilter] = useState({ status: "all", expected_case_type: "all", ai_detected_case_type: "all", session_kind: "all", model_used: "all", public_code: "" });
  const [trainingEditId, setTrainingEditId] = useState(null);
  const [trainingEditData, setTrainingEditData] = useState({});
  const [trainingNewRow, setTrainingNewRow] = useState(null);

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

  async function startRecording() {
    setVoiceError("");

    try {
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
          const response = await fetch("/api/transcribe", {
            method: "POST",
            headers: {
              "Content-Type": "audio/webm",
            },
            body: audioBlob,
          });

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
          const response = await fetch("/api/transcribe", {
            method: "POST",
            headers: {
              "Content-Type": "audio/webm",
            },
            body: audioBlob,
          });

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
          const response = await fetch("/api/transcribe", {
            method: "POST",
            headers: {
              "Content-Type": "audio/webm",
            },
            body: audioBlob,
          });

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

  async function submitRound() {
    if (dialogDepth === 0 && text.trim().length < 10) {
      setError("Напишите хотя бы 2–3 предложения.");
      return;
    }

    setLoading(true);
    setError("");
    setQuestions(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
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
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка");

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
      } else if (data.type === "final") {
        setResult(data.report || "");
        setActiveTab("user");
        setPhase("report");

        const sid = sessionId || `session-${Date.now()}`;
        if (!sessionId) setSessionId(sid);

        // Save session to Supabase (works on localhost and Vercel)
        fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "save",
            sessionId: sid,
            patient_text: text,
            conversationHistory: [
              ...conversationHistory,
              ...(dialogDepth > 0 ? [{ role: "user", answers }] : []),
            ],
            user_report: data.report?.split("===DOCTOR_REPORT===")[0]?.replace("===USER_REPORT===", "").trim() || "",
            doctor_report: data.report?.split("===DOCTOR_REPORT===")[1]?.trim() || "",
            riskLevel: null,
            supportPlan: supportPlan,
            dialogDepth,
            previousPatientReport: previousPatientReport || "",
            previousDoctorReport: previousDoctorReport || "",
            homeTasks: homeTasks || "",
            resourceFactors: resourceFactors || "",
            questions,
            answers,
            voiceObservations: voiceObservations || null,
          }),
        })
          .then((r) => r.json())
          .then((result) => {
            if (result.ok) {
              const code = result.publicCode || publicCode || "";
              if (result.publicCode && !publicCode) {
                setPublicCode(result.publicCode);
              }
              if (result.message) showToast(result.message);
              // Save case review (local + Supabase)
              const review = {
                case_id: sid, sessionId: sid, publicCode: code,
                createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
                environment: window.location.hostname.includes("localhost") ? "local" : "vercel",
                patient_input: text, questions, answers,
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
              showToast(result.error || "Ошибка сохранения сессии", "error");
            }
          })
          .catch(() => {
            showToast("Не удалось сохранить сессию. Код продолжения может не сохраниться.", "error");
          });
      } else {
        throw new Error("Неизвестный тип ответа");
      }
    } catch (e) {
      setError(e.message || "Ошибка");
    } finally {
      setLoading(false);
    }
  }

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
        adminLoadReviews(adminFilter, adminEnv, adminExpertFilter);
      } else {
        showToast("Неверный пароль", "error");
      }
    } catch {
      showToast("Ошибка подключения", "error");
    }
  }

  async function loadTrainingSessions() {
    setTrainingLoading(true);
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
      } else {
        showToast(data.error || "Ошибка загрузки", "error");
      }
    } catch {
      showToast("Ошибка загрузки таблицы тренировок", "error");
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

  async function adminLoadReviews(filterStatus, filterEnv, expertFilter) {
    const st = filterStatus !== undefined ? filterStatus : adminFilter;
    const env = filterEnv !== undefined ? filterEnv : adminEnv;
    const exp = expertFilter !== undefined ? expertFilter : adminExpertFilter;
    setAdminLoading(true);
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", status: st, environment: env, expert_filter: exp, limit: 100 }),
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
    const json = getReviewJson(review);
    const j = json || {};

    // Patient text: search broadly
    const patientText =
      review?.patient_text || review?.text || review?.input_text ||
      j.patient_text || j.text || j.input_text || j.original_text ||
      j.patient_input || j.input ||
      j.session?.initial_text || j.session?.patient_text ||
      "";

    // Conversation history: search camelCase + snake_case + nested
    let conversationHistory =
      review?.conversation_history || review?.conversationHistory ||
      j.conversation_history || j.conversationHistory ||
      j.session?.conversation_history || j.session?.conversationHistory ||
      [];

    if (typeof conversationHistory === "string") {
      try { conversationHistory = JSON.parse(conversationHistory); } catch { conversationHistory = []; }
    }
    if (!Array.isArray(conversationHistory)) conversationHistory = [];

    // User report / patient report
    const userReport =
      review?.user_report || review?.patient_report ||
      j.user_report || j.patient_report ||
      j.result?.user_report || j.report?.user_report ||
      j.session?.user_report ||
      "";

    // Doctor report / specialist report
    const doctorReport =
      review?.doctor_report || review?.specialist_report ||
      j.doctor_report || j.specialist_report ||
      j.result?.doctor_report || j.report?.doctor_report ||
      j.session?.doctor_report ||
      "";

    // Try to extract reports from ai_result if present
    if (!userReport && !doctorReport && j.ai_result) {
      try {
        const ai = typeof j.ai_result === "string" ? JSON.parse(j.ai_result) : j.ai_result;
        if (ai && typeof ai === "object") {
          if (!userReport && (ai.user_report || ai.patient_report)) {
            conversationHistory = ai.conversation_history || ai.conversationHistory || conversationHistory;
          }
        }
      } catch {}
    }

    // Doctor feedback
    const doctorFeedback =
      review?.doctor_feedback || review?.expert_feedback || review?.feedback ||
      j.doctor_feedback || j.expert_feedback || j.feedback ||
      {};

    const df = typeof doctorFeedback === "object" && !Array.isArray(doctorFeedback) ? doctorFeedback : {};

    // Build questions/answers into conversation if not already present
    if (conversationHistory.length === 0 && Array.isArray(j.questions)) {
      const qs = j.questions;
      const ans = j.answers || {};
      conversationHistory = qs.map((q, i) => ({
        role: "assistant",
        content: q,
        round: i + 1,
      }));
      const answerEntries = Object.entries(ans);
      answerEntries.forEach(([key, val], i) => {
        conversationHistory.push({
          role: "user",
          content: typeof val === "string" ? val : JSON.stringify(val),
          round: i + 1,
        });
      });
      conversationHistory.sort((a, b) => (a.round || 0) - (b.round || 0));
    }

    return { patientText, conversationHistory, userReport, doctorReport, doctorFeedback: df };
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
      const { patientText, userReport, doctorReport, doctorFeedbackComment, conversationHistory } = data;
      const sections = [
        {
          key: "patient",
          label: "Текст пациента",
          hasData: !!patientText,
          summary: shortText(patientText, 200),
          fullContent: patientText,
        },
        {
          key: "dialogue",
          label: "Диалог с системой",
          hasData: conversationHistory.length > 0 || (Array.isArray(json.questions) && json.questions.length > 0),
          summary: conversationHistory.length > 0
            ? `Сообщений: ${conversationHistory.length}`
            : Array.isArray(json.questions) ? `Вопросов: ${json.questions.length}` : "",
          fullContent: null,
          isDialogue: true,
        },
        {
          key: "userReport",
          label: "Отчёт для пациента",
          hasData: !!userReport,
          summary: shortText(userReport, 200),
          fullContent: userReport,
        },
        {
          key: "doctorReport",
          label: "Отчёт для специалиста",
          hasData: !!doctorReport,
          summary: shortText(doctorReport, 200),
          fullContent: doctorReport,
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
                    {!canOpen && <span style={{ color: t.muted, fontSize: 11 }}>Нет сохранённых данных</span>}
                    {canOpen && <span style={{ color: t.cardLabel, fontSize: 11, transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }}>▾</span>}
                  </div>
                </div>

                {open && canOpen && (
                  <div style={{ borderTop: `1px solid ${t.cardBorder}`, padding: "12px 14px" }}>
                    {sec.isDialogue ? renderDialogueContent(review, json, t, conversationHistory)
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

    const renderDialogueContent = (review, json, t, conversationHistory) => {
      const messages = conversationHistory.length > 0 ? conversationHistory
        : (Array.isArray(json.questions) ? buildDialogueFromQA(json) : []);

      const fullText = messages.map((m) => {
        const role = m.role === "user" ? "Пациент" : "Точка опоры";
        return `[${role}]${m.round ? ` (раунд ${m.round})` : ""}\n${m.content || ""}`;
      }).join("\n\n---\n\n");

      return (
        <div>
          {messages.length === 0 ? (
            <div style={{ color: t.muted, fontSize: 13 }}>Нет сохранённых данных диалога</div>
          ) : (
            <div style={{ maxHeight: 400, overflowY: "auto" }}>
              {messages.map((msg, i) => {
                const isUser = msg.role === "user";
                return (
                  <div key={i} style={{
                    marginBottom: 10, padding: "10px 12px",
                    background: isUser ? t.highlight : "transparent",
                    borderLeft: `3px solid ${isUser ? t.accent : t.muted}`,
                    borderRadius: "0 8px 8px 0",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, fontSize: 12, color: isUser ? t.accent : t.muted }}>
                        {isUser ? "Пациент" : "Точка опоры"}
                      </span>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        {msg.round && <span style={{ color: t.cardLabel, fontSize: 10 }}>раунд {msg.round}</span>}
                        {msg.created_at && <span style={{ color: t.cardLabel, fontSize: 10 }}>{new Date(msg.created_at).toLocaleString("ru-RU")}</span>}
                      </div>
                    </div>
                    <div style={{ color: t.crisisText, fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {msg.content || ""}
                    </div>
                    {msg.type && <div style={{ color: t.cardLabel, fontSize: 10, marginTop: 4 }}>{msg.type}</div>}
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            {messages.length > 0 && (
              <button onClick={() => openModal("Диалог", fullText)} style={{ border: `1px solid ${t.border}`, borderRadius: 8, background: t.tabBg, color: t.text, padding: "6px 12px", fontWeight: 600, fontSize: 11, cursor: "pointer" }}>
                Открыть в большом окне
              </button>
            )}
            {fullText && (
              <button onClick={() => { navigator.clipboard.writeText(fullText); showToast("Скопировано"); }} style={{ border: `1px solid ${t.border}`, borderRadius: 8, background: t.tabBg, color: t.text, padding: "6px 12px", fontWeight: 600, fontSize: 11, cursor: "pointer" }}>
                Скопировать диалог
              </button>
            )}
          </div>
        </div>
      );
    };

    const buildDialogueFromQA = (json) => {
      const msgs = [];
      const qs = json.questions || [];
      const ans = json.answers || {};
      qs.forEach((q, i) => {
        msgs.push({ role: "assistant", content: q, round: i + 1 });
        const answerKey = Object.keys(ans)[i];
        if (answerKey !== undefined) {
          msgs.push({ role: "user", content: typeof ans[answerKey] === "string" ? ans[answerKey] : JSON.stringify(ans[answerKey]), round: i + 1 });
        }
      });
      return msgs;
    };

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

    function getConversationMessageText(msg) {
      if (!msg) return "";
      if (typeof msg === "string") return msg;
      if (typeof msg.content === "string") return msg.content;
      if (Array.isArray(msg.content)) {
        return msg.content.map((part) => {
          if (typeof part === "string") return part;
          return part?.text || part?.content || part?.value || "";
        }).filter(Boolean).join("\n");
      }
      return msg.text || msg.message || msg.value || msg.answer || msg.question || msg.transcript || "";
    }

    function formatConversationForCopy(conversation) {
      return (conversation || [])
        .filter((m) => {
          const role = (m.role || "").toLowerCase();
          return !["system", "developer", "tool", "reasoning"].includes(role);
        })
        .map((m) => {
          const role = m.role === "user" || m.role === "patient" ? "Пациент" : "Точка опоры";
          return `[${role}]${m.round ? ` (раунд ${m.round})` : ""}\n${getConversationMessageText(m)}`;
        })
        .filter(Boolean)
        .join("\n\n---\n\n");
    }

    function formatAnonymizedSession(sd) {
      if (!sd) return "";
      const parts = [];
      parts.push(`Текст пациента:\n${sd.patient_text || "—"}`);
      const ch = sd.conversation_history || [];
      if (ch.length > 0) parts.push(`Диалог:\n${formatConversationForCopy(ch)}`);
      parts.push(`Отчёт для пациента:\n${sd.user_report || "—"}`);
      parts.push(`Отчёт для специалиста:\n${sd.doctor_report || "—"}`);
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

      const conversationHistory = sd.conversation_history || [];
      const normalizedMessages = conversationHistory
        .filter((m) => {
          const role = (m.role || "").toLowerCase();
          return !["system", "developer", "tool", "reasoning"].includes(role);
        })
        .filter((m) => getConversationMessageText(m).trim());

      const dialogueText = formatConversationForCopy(normalizedMessages);

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
      addSection("patient", "Текст пациента", sd.patient_text, true);

      // 2. Dialogue
      sections.push(
        <div key="dialogue" style={{ marginBottom: 8, border: `1px solid ${t.cardBorder}`, borderRadius: 12, overflow: "hidden" }}>
          <div
            onClick={() => {
              if (normalizedMessages.length === 0) return;
              const k = "tl-dialogue";
              setExpandedSections((prev) => ({ ...prev, [k]: !prev[k] }));
            }}
            style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "10px 14px", cursor: normalizedMessages.length > 0 ? "pointer" : "default",
              background: t.highlight,
              userSelect: "none",
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 13, color: normalizedMessages.length > 0 ? t.crisisText : t.muted }}>
              Диалог с системой
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {normalizedMessages.length === 0 && conversationHistory.length > 0 && (
                <span style={{ color: t.muted, fontSize: 11 }}>В этой записи сохранились роли сообщений, но текст диалога отсутствует.</span>
              )}
              {normalizedMessages.length === 0 && conversationHistory.length === 0 && (
                <span style={{ color: t.muted, fontSize: 11 }}>Нет сохранённых данных</span>
              )}
              {normalizedMessages.length > 0 && (
                <span style={{ color: t.cardLabel, fontSize: 11, transform: "rotate(180deg)", transition: "transform .2s" }}>▾</span>
              )}
            </div>
          </div>
          {normalizedMessages.length > 0 && (
            <div style={{ borderTop: `1px solid ${t.cardBorder}`, padding: "12px 14px" }}>
              <div style={{ maxHeight: 400, overflowY: "auto" }}>
                {normalizedMessages.map((msg, i) => {
                  const isUser = msg.role === "user" || msg.role === "patient";
                  return (
                    <div key={i} style={{
                      marginBottom: 10, padding: "10px 12px",
                      background: isUser ? t.highlight : "transparent",
                      borderLeft: `3px solid ${isUser ? t.accent : t.muted}`,
                      borderRadius: "0 8px 8px 0",
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <span style={{ fontWeight: 700, fontSize: 12, color: isUser ? t.accent : t.muted }}>
                          {isUser ? "Пациент" : "Точка опоры"}
                        </span>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          {msg.round && <span style={{ color: t.cardLabel, fontSize: 10 }}>раунд {msg.round}</span>}
                          {msg.created_at && <span style={{ color: t.cardLabel, fontSize: 10 }}>{new Date(msg.created_at).toLocaleString("ru-RU")}</span>}
                        </div>
                      </div>
                      <div style={{ color: t.crisisText, fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {getConversationMessageText(msg)}
                      </div>
                    </div>
                  );
                })}
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
      addSection("user_report", "Отчёт для пациента", sd.user_report, false);
      if (sd.doctor_correction?.corrected_user_report) {
        addSection("corrected_user", "Исправленная версия (пациент)", sd.corrected_user_report, false);
      }

      addSection("doctor_report", "Отчёт для специалиста", sd.doctor_report, false);
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

    return (
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
            <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>{isTrainingPage ? "🧠 Таблица тренировок" : "🧠 Админ-панель / Отзывы о сессиях"}</h1>
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
              <a href="/" style={{ color: t.accent, fontSize: 14, textDecoration: "none" }}>← На главную</a>
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
                                  <td style={{ padding: "6px", color: t.muted, fontSize: 11, whiteSpace: "nowrap" }}>{s.deleted_at ? new Date(s.deleted_at).toLocaleDateString("ru-RU") : ""}</td>
                                  <td style={{ padding: "6px", color: t.muted, fontSize: 11 }}>{s.deleted_by_expert_name || "—"}</td>
                                  <td style={{ padding: "6px", color: t.muted, fontSize: 11, maxWidth: 120 }}>{s.deletion_reason || "—"}</td>
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
                  <option value="production">Production</option>
                  <option value="local">Local</option>
                  <option value="all">Все окружения</option>
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
                    const conversationHistory = norm.conversationHistory;
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

                        {renderReviewSections(review, json, t, { patientText, userReport, doctorReport, doctorFeedbackComment, conversationHistory, doctorFeedback: norm.doctorFeedback })}

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
                        </div>

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
    );
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
              alt="Точка опоры"
              className="app-logo"
              style={{ display: "block", flexShrink: 0, objectFit: "contain", height: 96, width: "auto" }}
            />
            <div>
              <div style={s.logo}>Точка опоры</div>
              <div style={s.sub}>Анонимно. Безопасно. Можно просто поговорить.</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {expertData && (
              <div style={{
                background: "#E2EBE4", border: "1px solid rgba(125,154,137,.3)",
                borderRadius: 22, padding: "8px 16px", fontSize: 13, color: "#5F7D6C",
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <span>{expertData.name}, {roleMap[expertData.role] || expertData.role}</span>
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
          </div>
        </header>

        <main style={s.grid} className="app-grid">
          <section>
            <h1 style={s.h1} className="app-hero-title">
              Найдём точку опоры
            </h1>
            <p style={s.p} className="app-hero-text">
              Расскажите, что с вами происходит — голосом или текстом. Сервис поможет мягко разобрать состояние, заметить важные признаки и предложить понятный следующий шаг.
            </p>

            <div style={s.row} className="app-actions">
              <button style={s.primary} onClick={() => setMode("text")}>
                Начать разговор
              </button>
              <button style={s.secondary} onClick={() => setMode("voice")}>
                Рассказать голосом
              </button>
              <button
                style={{ ...s.secondary, marginTop: 8 }}
                onClick={() => setSessionModalOpen(true)}
              >
                Вернуться к разговору
              </button>
            </div>

            <p style={{ color: "#7A7268", fontSize: 13, marginTop: 24, lineHeight: 1.5 }}>
              Сервис работает в тестовом режиме, не ставит диагноз и не является экстренной службой. Не указывайте персональные данные в тексте обращения.
            </p>
          </section>

          <section style={s.card} className="app-card">
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "Georgia, \"PT Serif\", serif" }}>
              С чего начать?
            </div>
            <div style={{ color: "#7A7268", fontSize: 14, marginTop: 6 }}>
              Опишите состояние своими словами.
            </div>

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
                    placeholder="Например: последние недели плохо сплю, тревожусь, не могу собраться, стало трудно заниматься обычными делами…"
                  />
                  <button
                    style={s.wide}
                    onClick={submitRound}
                    disabled={loading}
                  >
                    {loading
                      ? "Формируем вопросы..."
                      : "Начать разбор"}
                  </button>
                </>
              ) : phase === "questions" ? (
                <>
                  <div style={{ marginBottom: 16, color: "#7A7268" }}>
                    Раунд уточнения {dialogDepth}
                  </div>
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
                    onClick={submitRound}
                    disabled={loading}
                  >
                    {loading
                      ? "Анализируем..."
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

                {publicCode && (
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
                </div>

                <div style={s.reportBlock} className="report-block">
                  {activeTab === "user" ? (
                    renderUserReport(userPart)
                  ) : (
                    <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>
                      {doctorPart}
                    </div>
                  )}
                </div>

                {!showSelfAssessment && !showSupportToolkit && !showSpecialistIntent && (
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

                {showSpecialistIntent && !specialistIntentDone && (
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

                {showSupportToolkit && (
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

                <button
                  style={{ ...s.secondary, width: "100%", marginTop: 20 }}
                  onClick={handleReset}
                >
                  Начать заново
                </button>
              </div>
            )}
          </section>
        </main>

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
                Если вы уже начинали разговор, введите код вида ТОЧКА-XXXX-XXXX. Мы восстановим прошлую сессию и продолжим с того места, где вы остановились.
              </p>

              <input
                style={s.crisisInput}
                value={sessionCodeInput}
                onChange={(e) => setSessionCodeInput(e.target.value.toUpperCase())}
                placeholder="Код продолжения"
              />

              <div style={s.crisisActions}>
                <button
                  style={s.wide}
                  disabled={loadingSession || sessionCodeInput.trim().length < 5}
                  onClick={async () => {
                    setLoadingSession(true);
                    try {
                      const code = sessionCodeInput.trim();

                      let res = await fetch("/api/session", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "load", publicCode: code }),
                      });
                      let data = await res.json();
                      if (!res.ok || !data.ok) {
                        throw new Error(data.error || "Сессия не найдена");
                      }

                      const s = data.session;
                      setSessionId(s.sessionId || s.session_id);
                      setPublicCode(s.publicCode || s.public_code);
                      setText(s.patient_input || s.patient_text || "");
                      setConversationHistory(s.conversationHistory || s.conversation_history || []);
                      setDialogDepth(s.dialogDepth || 0);
                      setPreviousPatientReport(s.user_report || s.previousPatientReport || "");
                      setPreviousDoctorReport(s.doctor_report || s.previousDoctorReport || "");
                      setHomeTasks(s.homeTasks || "");
                      setResourceFactors(s.resourceFactors || "");
                      if (s.supportPlan) {
                        setSupportPlan(s.supportPlan);
                        const sa = s.supportPlan.patient_self_assessment;
                        if (sa?.can_manage_without_specialist) {
                          setCanManageWithoutSpecialist(sa.can_manage_without_specialist);
                          setShowSelfAssessment(true);
                          setShowSupportToolkit(true);
                          if (s.supportPlan.specialist_request_intent) {
                            setShowSpecialistIntent(true);
                            setSpecialistIntentDone(true);
                          }
                        }
                      }

                      // Restore questions/answers if present
                      const savedAnswers = s.answers || {};
                      const savedResult = s.ai_result || s.result || null;
                      const hasResult = !!savedResult || !!s.user_report || !!s.doctor_report;

                      if (hasResult) {
                        setResult(savedResult || `${s.user_report || ""}\n\n===DOCTOR_REPORT===\n\n${s.doctor_report || ""}`);
                        setPhase("report");
                      } else {
                        setResult(null);
                        setAnswers(savedAnswers);
                        setPhase(Object.keys(savedAnswers).length > 0 ? "questions" : "input");
                      }

                      setIsContinuation(true);
                      setSessionModalOpen(false);
                      setSessionCodeInput("");
                      if (data.message) showToast(data.message);
                    } catch (e) {
                      showToast(e.message || "Сессия не найдена. Проверьте код.", "error");
                    } finally {
                      setLoadingSession(false);
                    }
                  }}
                >
                  {loadingSession ? "Поиск..." : "Продолжить по коду"}
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
