import React, { useRef, useState } from "react";

function LogoMark({ size = 44 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-label="Точка опоры"
      style={{ display: "block", flexShrink: 0 }}
    >
      {/* Bowl / support — широкая устойчивая чаша */}
      <path d="M4 26 C4 44 44 44 44 26 C44 28 4 28 4 26 Z" fill="#6F8F7B" />
      {/* Bowl inner depth */}
      <path d="M7 28 C7 42 41 42 41 28 C41 29 7 29 7 28 Z" fill="#5A7E68" fillOpacity="0.2" />
      {/* Bowl rim accent */}
      <path d="M4 26 C4 28 44 28 44 26" fill="none" stroke="#8AAB91" strokeWidth="1" strokeOpacity="0.5" />
      {/* Amorphous state — soft outer halo, опирается на чашу */}
      <path d="M24 4 C10 4 4 14 5 22 C6 28 12 33 24 32 C36 33 42 28 43 22 C44 14 38 4 24 4 Z" fill="#A9B8A5" fillOpacity="0.15" />
      {/* Main form */}
      <path d="M24 8 C14 8 8 16 9 22 C10 27 16 31 24 30 C32 31 38 27 39 22 C40 16 34 8 24 8 Z" fill="#A9B8A5" fillOpacity="0.3" />
      {/* Dense core */}
      <path d="M24 14 C16 14 12 19 13 24 C14 28 18 31 24 30 C30 31 34 28 35 24 C36 19 32 14 24 14 Z" fill="#A9B8A5" fillOpacity="0.5" />
      {/* Scatter dots — фрагменты / рассеянные мысли */}
      <circle cx="14" cy="9" r="1.5" fill="#C9D1C2" fillOpacity="0.6" />
      <circle cx="36" cy="11" r="1.3" fill="#C9D1C2" fillOpacity="0.5" />
      <circle cx="28" cy="3" r="1.1" fill="#C9D1C2" fillOpacity="0.4" />
      <circle cx="20" cy="4" r="1" fill="#C9D1C2" fillOpacity="0.45" />
      <circle cx="39" cy="18" r="0.9" fill="#C9D1C2" fillOpacity="0.35" />
      <circle cx="10" cy="17" r="0.8" fill="#C9D1C2" fillOpacity="0.35" />
    </svg>
  );
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

          setText(data.text || "");
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
    try {
      const body = { action: "listTrainingSessions", ...trainingFilter };
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
        showToast("Удалено");
      } else {
        showToast(data.error || "Ошибка", "error");
      }
    } catch {
      showToast("Ошибка удаления", "error");
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
      const body = { action: "exportTrainingCsv", ...trainingFilter };
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
      a.download = `training-sessions-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      showToast("Ошибка выгрузки", "error");
    }
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

      setCorrectionForm({
        wrong_questions: correction.wrong_questions || json?.doctor_feedback?.wrong_questions || "",
        missing_questions: correction.missing_questions || json?.doctor_feedback?.missing_questions || "",
        bad_question_wording: correction.bad_question_wording || json?.doctor_feedback?.bad_question_wording || "",
        corrected_user_report: corrected.corrected_user_report || correction.corrected_user_report || json?.corrected_user_report || "",
        corrected_doctor_report: corrected.corrected_doctor_report || correction.corrected_doctor_report || json?.corrected_doctor_report || "",
        protocol_update: review?.protocol_update || correction.protocol_update || "",
        correction_comment: review?.correction_comment || correction.correction_comment || "",
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

                {trainingNewRow && (
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

                {!trainingNewRow && (
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
                          {["Дата","Код пациента","Номер сессии","Тип сессии","Эксперт","Сценарий","Ожидаемый тип случая","Что распознала система","Качество распознавания","Модель","Fallback","Вопросы","Отчёт","Safety","Язык","Практики","Продолжение","Повторы","Риски","Рекомендация","Контекст","Статус","Краткий вывод","Проблема","Комментарий","Действие","Продолж."].map((h) => (
                            <th key={h} style={{ padding: "8px 6px", textAlign: "left", fontWeight: 700, color: t.muted, borderBottom: `1px solid ${t.border}`, whiteSpace: "nowrap" }}>{h}</th>
                          ))}
                          <th style={{ padding: "8px 6px", borderBottom: `1px solid ${t.border}`, width: 80 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {trainingSessions.map((s) => {
                          const isEditing = trainingEditId === s.id;
                          const ed = isEditing ? trainingEditData : {};
                          return (
                            <tr key={s.id} style={{ borderBottom: `1px solid ${t.cardBorder}` }}>
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
                                  <button onClick={() => { setTrainingEditId(s.id); setTrainingEditData({}); }} style={{ border: `1px solid ${t.border}`, borderRadius: 6, background: "transparent", color: t.accent, padding: "4px 8px", fontWeight: 600, fontSize: 11, cursor: "pointer" }}>✎</button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
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

                    const patientText = safeText(json.patient_input || json.patient_text || json.input || "");
                    const userReport = safeText(json.user_report || "");
                    const doctorReport = safeText(json.doctor_report || "");
                    const doctorFeedbackComment = safeText(json.doctor_feedback?.generalComment || "");
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
                          {publicCode !== "—" && (
                            <span style={{ fontWeight: 700, fontSize: 13, color: t.crisisAccent, letterSpacing: 0.5 }}>
                              {publicCode}
                            </span>
                          )}
                        </div>

                        {expertName && (
                          <div style={{ marginBottom: 10, fontSize: 12, color: t.crisisAccent }}>
                            🔬 {expertName}{expertRole ? `, ${expertRole}` : ""}{expertSpecialty ? ` (${expertSpecialty})` : ""}{city ? ` · ${city}` : ""}{organization ? ` · ${organization}` : ""}
                          </div>
                        )}

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                          <div>
                            <div style={{ color: t.cardLabel, fontSize: 11, marginBottom: 4 }}>PATIENT TEXT</div>
                            <div style={{ color: t.crisisText, fontSize: 13, lineHeight: 1.5 }}>{shortText(patientText, 200)}</div>
                          </div>
                          <div>
                            <div style={{ color: t.cardLabel, fontSize: 11, marginBottom: 4 }}>USER REPORT</div>
                            <div style={{ color: t.crisisText, fontSize: 13, lineHeight: 1.5 }}>{shortText(userReport, 200)}</div>
                          </div>
                          <div>
                            <div style={{ color: t.cardLabel, fontSize: 11, marginBottom: 4 }}>DOCTOR REPORT</div>
                            <div style={{ color: t.crisisText, fontSize: 13, lineHeight: 1.5 }}>{shortText(doctorReport, 200)}</div>
                          </div>
                          <div>
                            <div style={{ color: t.cardLabel, fontSize: 11, marginBottom: 4 }}>DOCTOR FEEDBACK</div>
                            <div style={{ color: t.crisisText, fontSize: 13, lineHeight: 1.5 }}>{shortText(doctorFeedbackComment, 200)}</div>
                          </div>
                        </div>

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

        {toast.message && (
          <div
            key={toast.key}
            style={{
              position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
              zIndex: 2000, padding: "14px 24px", borderRadius: 16, fontWeight: 600, fontSize: 15,
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
            <LogoMark size={40} />
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
