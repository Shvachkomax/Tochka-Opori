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
  const [crisisSubmitted, setCrisisSubmitted] = useState(false);

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

  function showToast(message, type = "success") {
    setToast({ message, type, key: Date.now() });
  }

  async function handleExpertLogin() {
    const code = expertCodeInput.trim();
    if (!code) return;
    setExpertLoggingIn(true);
    try {
      const res = await fetch("/api/expert-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_code: code }),
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
    if (f.name.trim().length < 2) { showToast("Укажите имя (минимум 2 символа)", "error"); return; }

    setRegisterSending(true);
    try {
      const res = await fetch("/api/register-expert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f),
      });
      const data = await res.json();
      if (data.ok) {
        setRegistrationResult(data);
        setExpertData(data.expert);
        localStorage.setItem("tochka_expert", JSON.stringify(data.expert));
        showToast(`Режим специалиста активирован: ${data.expert.name}`);
      } else {
        showToast(data.error || "Ошибка регистрации", "error");
      }
    } catch {
      showToast("Ошибка подключения", "error");
    } finally {
      setRegisterSending(false);
    }
  }

  async function adminLoadRequests(filterStatus) {
    const st = filterStatus || adminReqFilter;
    try {
      const res = await fetch("/api/list-expert-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: st, limit: 100 }),
      });
      const data = await res.json();
      if (data.ok) {
        setAdminRequests(data.requests || []);
      }
    } catch {}
  }

  async function adminUpdateRequestStatus(requestId, status) {
    try {
      await fetch("/api/update-expert-request-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: requestId, status, admin_secret: adminPassword }),
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

  function hasCrisisRisk(value) {
    const lower = (value || "").toLowerCase();
    return crisisKeywords.some((keyword) => lower.includes(keyword));
  }

  function submitCrisisRequest() {
    setCrisisWarning("");

    if (!crisisContact.trim()) {
      setCrisisWarning("Укажите телефон или Telegram для связи. Если есть непосредственная опасность — звоните 112 или 103.");
      return;
    }

    setCrisisConfirmation("Заявка принята. Ожидайте связи. Если ситуация опасна прямо сейчас — не ждите ответа сервиса, звоните 112 или 103.");
  }

  function continueFromCrisis() {
    setCrisisConfirmation("");

    if (hasCrisisRisk(crisisText)) {
      setCrisisWarning("Похоже, ситуация может быть срочной. Пожалуйста, не оставайтесь один. Позвоните 112 или 103 прямо сейчас. Если рядом есть близкий человек — попросите его быть рядом с вами.");
      return;
    }

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
  }

  function handleCrisisClose() {
    if (crisisTimerRef.current) {
      clearInterval(crisisTimerRef.current);
    }
    if (crisisMediaRecorderRef.current && crisisRecording) {
      crisisMediaRecorderRef.current.stop();
    }
    setCrisisOpen(false);
    setCrisisSubmitted(false);
    setCrisisText("");
    setCrisisContact("");
    setCrisisRecording(false);
    setCrisisRecordingTime(0);
    setCrisisTranscribing(false);
    setCrisisVoiceError("");
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

          const data = await response.json();

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

          const data = await response.json();

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

          const data = await response.json();

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
        fetch("/api/save-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: sid,
            patient_text: text,
            conversationHistory: [
              ...conversationHistory,
              ...(dialogDepth > 0 ? [{ role: "user", answers }] : []),
            ],
            user_report: data.report?.split("===DOCTOR_REPORT===")[0]?.replace("===USER_REPORT===", "").trim() || "",
            doctor_report: data.report?.split("===DOCTOR_REPORT===")[1]?.trim() || "",
            riskLevel: null,
            supportPlan: null,
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
              fetch("/api/save-review", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(review),
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
            background: hl ? "rgba(99,102,241,.12)" : "transparent",
            border: hl ? "1px solid rgba(99,102,241,.3)" : "none",
          }}
        >
          <div
            style={{
              fontWeight: hl ? 700 : 600,
              fontSize: hl ? 16 : 15,
              color: hl ? "#c7d2fe" : "#e2e8f0",
              marginBottom: s.lines.some((l) => l.trim()) ? 6 : 0,
            }}
          >
            {s.num}. {s.title}
          </div>
          {s.lines.some((l) => l.trim()) && (
            <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7, color: "#94a3b8" }}>
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
      const res = await fetch("/api/admin-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: adminPassword }),
      });
      const data = await res.json();
      if (data.ok) {
        setAdminAuthed(true);
        adminLoadReviews(adminFilter, adminEnv);
      } else {
        showToast("Неверный пароль", "error");
      }
    } catch {
      showToast("Ошибка подключения", "error");
    }
  }

  async function adminLoadReviews(filterStatus, filterEnv, expertFilter) {
    const st = filterStatus || adminFilter;
    const env = filterEnv !== undefined ? filterEnv : adminEnv;
    const exp = expertFilter !== undefined ? expertFilter : adminExpertFilter;
    setAdminLoading(true);
    try {
      const res = await fetch("/api/list-reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: st, environment: env, expert_filter: exp, limit: 100 }),
      });
      const data = await res.json();
      if (data.ok) {
        setAdminReviews(data.reviews || []);
        setAdminTotal(data.total || 0);
      } else {
        showToast(data.error || "Ошибка загрузки", "error");
      }
    } catch {
      showToast("Ошибка загрузки списка", "error");
    } finally {
      setAdminLoading(false);
    }
  }

  async function adminUpdateStatus(reviewId, status) {
    setAdminActionLoading(reviewId);
    try {
      const res = await fetch("/api/update-review-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ review_id: reviewId, status, admin_secret: adminPassword }),
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
      const res = await fetch("/api/update-review-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

  function shorten(text, max = 100) {
    if (!text) return "—";
    return text.length > max ? text.slice(0, max) + "…" : text;
  }

  const isAdminPage = typeof window !== "undefined" && window.location.pathname.startsWith("/admin");

  if (isAdminPage) {
    return (
      <div style={{ minHeight: "100vh", background: "#050817", color: "white", fontFamily: "Inter, system-ui, Arial", padding: 32 }}>
        <style>{`
  * { box-sizing: border-box; }
  @keyframes toastIn {
    from { opacity: 0; transform: translateX(-50%) translateY(20px); }
    to { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
`}</style>

        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 40 }}>
            <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>🧠 Админ-панель / Отзывы о сессиях</h1>
            <a href="/" style={{ color: "#94a3b8", fontSize: 14 }}>← На главную</a>
          </div>

          {!adminAuthed ? (
            <div style={{ maxWidth: 400, margin: "60px auto" }}>
              <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 20 }}>Вход в админ-панель</h2>
              <input
                type="password"
                style={{
                  width: "100%", border: "1px solid rgba(255,255,255,.12)", borderRadius: 16,
                  background: "rgba(2,6,23,.55)", color: "white", padding: "14px", fontSize: 15,
                  outline: "none", boxSizing: "border-box", marginBottom: 16,
                }}
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && adminLogin()}
                placeholder="Пароль администратора"
              />
              <button
                style={{
                  width: "100%", border: 0, borderRadius: 24, background: "white", color: "#020617",
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
                    background: adminReqTab === "reviews" ? "white" : "rgba(255,255,255,.06)",
                    color: adminReqTab === "reviews" ? "#020617" : "white",
                  }}
                  onClick={() => setAdminReqTab("reviews")}
                >
                  Отзывы о сессиях
                </button>
                <button
                  style={{
                    border: 0, borderRadius: 14, padding: "10px 18px", fontWeight: 700, fontSize: 14, cursor: "pointer",
                    background: adminReqTab === "requests" ? "white" : "rgba(255,255,255,.06)",
                    color: adminReqTab === "requests" ? "#020617" : "white",
                  }}
                  onClick={() => { setAdminReqTab("requests"); adminLoadRequests(adminReqFilter); }}
                >
                  Заявки специалистов
                </button>
              </div>

              {adminReqTab === "requests" ? (
                <>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24, alignItems: "center" }}>
                    <select
                      value={adminReqFilter}
                      onChange={(e) => { const v = e.target.value; setAdminReqFilter(v); adminLoadRequests(v); }}
                      style={{
                        border: "1px solid rgba(255,255,255,.12)", borderRadius: 12, background: "rgba(255,255,255,.06)",
                        color: "white", padding: "10px 16px", fontSize: 14, cursor: "pointer",
                      }}
                    >
                      <option value="pending">Ожидают</option>
                      <option value="approved">Одобренные</option>
                      <option value="rejected">Отклонённые</option>
                      <option value="all">Все</option>
                    </select>
                    <button
                      style={{
                        border: "1px solid rgba(255,255,255,.18)", borderRadius: 12, background: "rgba(255,255,255,.06)",
                        color: "white", padding: "10px 16px", fontWeight: 600, fontSize: 14, cursor: "pointer",
                      }}
                      onClick={() => adminLoadRequests(adminReqFilter)}
                    >
                      Обновить ({adminRequests.length})
                    </button>
                  </div>

                  {adminRequests.length === 0 ? (
                    <div style={{ color: "#94a3b8", textAlign: "center", padding: 60 }}>Нет заявок</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                      {adminRequests.map((req) => (
                        <div key={req.id} style={{
                          border: "1px solid rgba(255,255,255,.1)", borderRadius: 20,
                          background: "rgba(255,255,255,.04)", padding: 20,
                        }}>
                          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                              <span style={{ color: "#94a3b8", fontSize: 12 }}>
                                {new Date(req.created_at).toLocaleString("ru-RU")}
                              </span>
                              <span style={{
                                fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 8,
                                background: req.status === "approved" ? "rgba(34,197,94,.2)" : req.status === "rejected" ? "rgba(220,38,38,.2)" : "rgba(234,179,8,.2)",
                                color: req.status === "approved" ? "#bbf7d0" : req.status === "rejected" ? "#fecaca" : "#fde68a",
                              }}>
                                {req.status}
                              </span>
                            </div>
                          </div>

                          <div style={{ marginBottom: 8 }}>
                            <span style={{ fontWeight: 700, color: "#e2e8f0" }}>{req.name}</span>
                            <span style={{ color: "#94a3b8", marginLeft: 8 }}>{req.role}</span>
                          </div>
                          <div style={{ color: "#64748b", fontSize: 13, marginBottom: 8 }}>
                            {req.email && <span>Email: {req.email}  </span>}
                            {req.telegram && <span>Telegram: {req.telegram}  </span>}
                            {req.specialty && <span>Специализация: {req.specialty}  </span>}
                            {req.city && <span>Город: {req.city}  </span>}
                            {req.organization && <span>Организация: {req.organization}</span>}
                          </div>
                          {req.comment && (
                            <div style={{ color: "#94a3b8", fontSize: 13, fontStyle: "italic", marginBottom: 8 }}>
                              "{req.comment}"
                            </div>
                          )}

                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            {req.status !== "approved" && (
                              <button style={{ border: 0, borderRadius: 12, background: "rgba(34,197,94,.2)", color: "#bbf7d0", padding: "8px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}
                                onClick={() => adminUpdateRequestStatus(req.id, "approved")}>
                                Одобрить
                              </button>
                            )}
                            {req.status !== "rejected" && (
                              <button style={{ border: 0, borderRadius: 12, background: "rgba(220,38,38,.2)", color: "#fecaca", padding: "8px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}
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
              ) : (
              <>
              {/* Reviews filters */}
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24, alignItems: "center" }}>
                <select
                  value={adminFilter}
                  onChange={(e) => { const v = e.target.value; setAdminFilter(v); adminLoadReviews(v, adminEnv); }}
                  style={{
                    border: "1px solid rgba(255,255,255,.12)", borderRadius: 12, background: "rgba(255,255,255,.06)",
                    color: "white", padding: "10px 16px", fontSize: 14, cursor: "pointer",
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
                    border: "1px solid rgba(255,255,255,.12)", borderRadius: 12, background: "rgba(255,255,255,.06)",
                    color: "white", padding: "10px 16px", fontSize: 14, cursor: "pointer",
                  }}
                >
                  <option value="production">Production</option>
                  <option value="local">Local</option>
                  <option value="">Все окружения</option>
                </select>
                <select
                  value={adminExpertFilter}
                  onChange={(e) => { const v = e.target.value; setAdminExpertFilter(v); adminLoadReviews(adminFilter, adminEnv, v); }}
                  style={{
                    border: "1px solid rgba(255,255,255,.12)", borderRadius: 12, background: "rgba(255,255,255,.06)",
                    color: "white", padding: "10px 16px", fontSize: 14, cursor: "pointer",
                  }}
                >
                  <option value="all">Все отзывы</option>
                  <option value="with_expert">С экспертом</option>
                  <option value="without_expert">Без эксперта</option>
                </select>
                <button
                  style={{
                    border: "1px solid rgba(255,255,255,.18)", borderRadius: 12, background: "rgba(255,255,255,.06)",
                    color: "white", padding: "10px 16px", fontWeight: 600, fontSize: 14, cursor: "pointer",
                  }}
                  onClick={adminLoadReviews}
                >
                  {adminLoading ? "Загрузка..." : `Обновить (${adminTotal})`}
                </button>
              </div>

              {/* Reviews list */}
              {adminLoading ? (
                <div style={{ color: "#94a3b8", textAlign: "center", padding: 60 }}>Загрузка...</div>
              ) : adminReviews.length === 0 ? (
                <div style={{ color: "#94a3b8", textAlign: "center", padding: 60 }}>Нет записей</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {adminReviews.map((review) => {
                    try {
                    const j = getReviewJson(review);
                    return (
                      <div
                        key={review.id}
                        style={{
                          border: "1px solid rgba(255,255,255,.1)", borderRadius: 20,
                          background: "rgba(255,255,255,.04)", padding: 20,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            <span style={{ color: "#94a3b8", fontSize: 12 }}>
                              {review.created_at ? new Date(review.created_at).toLocaleString("ru-RU") : "—"}
                            </span>
                            <span style={{
                              fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 8,
                              background: j.status === "approved" ? "rgba(34,197,94,.2)" : j.status === "rejected" ? "rgba(220,38,38,.2)" : j.status === "needs_review" ? "rgba(234,179,8,.2)" : j.status === "local_auto_saved" ? "rgba(99,102,241,.2)" : "rgba(255,255,255,.1)",
                              color: j.status === "approved" ? "#bbf7d0" : j.status === "rejected" ? "#fecaca" : j.status === "needs_review" ? "#fde68a" : j.status === "local_auto_saved" ? "#c7d2fe" : "#94a3b8",
                            }}>
                              {j.status || "unknown"}
                            </span>
                            <span style={{ color: "#64748b", fontSize: 12 }}>
                              {j.environment || "—"} / {j.source || "—"}
                            </span>
                          </div>
                          {review.public_code && (
                            <span style={{ fontWeight: 700, fontSize: 13, color: "#a5b4fc", letterSpacing: 0.5 }}>
                              {review.public_code}
                            </span>
                          )}
                        </div>

                        {j.expert_name && (
                          <div style={{ marginBottom: 10, fontSize: 12, color: "#a5b4fc" }}>
                            🔬 {j.expert_name}{j.expert_role ? `, ${j.expert_role}` : ""}{j.expert_specialty ? ` (${j.expert_specialty})` : ""}{j.city ? ` · ${j.city}` : ""}{j.organization ? ` · ${j.organization}` : ""}
                          </div>
                        )}

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                          <div>
                            <div style={{ color: "#64748b", fontSize: 11, marginBottom: 4 }}>PATIENT TEXT</div>
                            <div style={{ color: "#e2e8f0", fontSize: 13, lineHeight: 1.5 }}>{shorten(j.patient_input || j.patient_text || "", 200)}</div>
                          </div>
                          <div>
                            <div style={{ color: "#64748b", fontSize: 11, marginBottom: 4 }}>USER REPORT</div>
                            <div style={{ color: "#e2e8f0", fontSize: 13, lineHeight: 1.5 }}>{shorten(j.user_report || "", 200)}</div>
                          </div>
                          <div>
                            <div style={{ color: "#64748b", fontSize: 11, marginBottom: 4 }}>DOCTOR REPORT</div>
                            <div style={{ color: "#e2e8f0", fontSize: 13, lineHeight: 1.5 }}>{shorten(j.doctor_report || "", 200)}</div>
                          </div>
                          <div>
                            <div style={{ color: "#64748b", fontSize: 11, marginBottom: 4 }}>DOCTOR FEEDBACK</div>
                            <div style={{ color: "#e2e8f0", fontSize: 13, lineHeight: 1.5 }}>
                              {j.doctor_feedback?.generalComment ? shorten(j.doctor_feedback.generalComment, 200) : "—"}
                            </div>
                          </div>
                        </div>

                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button
                            disabled={adminActionLoading === review.id}
                            style={{
                              border: 0, borderRadius: 12, background: "rgba(34,197,94,.2)", color: "#bbf7d0",
                              padding: "8px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer",
                              opacity: adminActionLoading === review.id ? 0.5 : 1,
                            }}
                            onClick={() => adminUpdateStatus(review.id, "approved")}
                          >
                            Одобрить
                          </button>
                          <button
                            disabled={adminActionLoading === review.id}
                            style={{
                              border: 0, borderRadius: 12, background: "rgba(220,38,38,.2)", color: "#fecaca",
                              padding: "8px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer",
                              opacity: adminActionLoading === review.id ? 0.5 : 1,
                            }}
                            onClick={() => adminUpdateStatus(review.id, "rejected")}
                          >
                            Отклонить
                          </button>
                          <button
                            disabled={adminActionLoading === review.id}
                            style={{
                              border: 0, borderRadius: 12, background: "rgba(234,179,8,.2)", color: "#fde68a",
                              padding: "8px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer",
                              opacity: adminActionLoading === review.id ? 0.5 : 1,
                            }}
                            onClick={() => adminUpdateStatus(review.id, "needs_review")}
                          >
                            Требует доработки
                          </button>
                          <button
                            style={{
                              border: "1px solid rgba(255,255,255,.12)", borderRadius: 12, background: "rgba(255,255,255,.06)",
                              color: "#94a3b8", padding: "8px 14px", fontWeight: 600, fontSize: 12, cursor: "pointer",
                            }}
                            onClick={() => adminDownloadJson(review)}
                          >
                            Скачать JSON
                          </button>
                          <button
                            style={{
                              border: "1px solid rgba(99,102,241,.3)", borderRadius: 12, background: "rgba(99,102,241,.08)",
                              color: "#a5b4fc", padding: "8px 14px", fontWeight: 600, fontSize: 12, cursor: "pointer",
                            }}
                            onClick={() => openCorrectionForm(review)}
                          >
                            Редактировать
                          </button>
                        </div>

                        {editingReview === review.id && (
                          <div style={{ marginTop: 16, borderTop: "1px solid rgba(255,255,255,.08)", paddingTop: 16 }}>
                            <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Редакция отзыва</div>

                            <input style={{ ...s.crisisInput, marginBottom: 8 }} placeholder="Что было неверно в вопросах?" value={correctionForm.wrong_questions} onChange={(e) => setCorrectionForm({ ...correctionForm, wrong_questions: e.target.value })} />
                            <input style={{ ...s.crisisInput, marginBottom: 8 }} placeholder="Какие вопросы нужно было добавить?" value={correctionForm.missing_questions} onChange={(e) => setCorrectionForm({ ...correctionForm, missing_questions: e.target.value })} />
                            <input style={{ ...s.crisisInput, marginBottom: 8 }} placeholder="Какие вопросы были лишними?" value={correctionForm.bad_question_wording} onChange={(e) => setCorrectionForm({ ...correctionForm, bad_question_wording: e.target.value })} />
                            <textarea style={{ ...s.crisisTextarea, minHeight: 60, marginBottom: 8 }} placeholder="Исправленная версия отчета для пациента" value={correctionForm.corrected_user_report} onChange={(e) => setCorrectionForm({ ...correctionForm, corrected_user_report: e.target.value })} />
                            <textarea style={{ ...s.crisisTextarea, minHeight: 60, marginBottom: 8 }} placeholder="Исправленная версия отчета для специалиста" value={correctionForm.corrected_doctor_report} onChange={(e) => setCorrectionForm({ ...correctionForm, corrected_doctor_report: e.target.value })} />
                            <textarea style={{ ...s.crisisTextarea, minHeight: 60, marginBottom: 8 }} placeholder="Предложение для изменения протокола / prompts" value={correctionForm.protocol_update} onChange={(e) => setCorrectionForm({ ...correctionForm, protocol_update: e.target.value })} />
                            <textarea style={{ ...s.crisisTextarea, minHeight: 60, marginBottom: 12 }} placeholder="Комментарий редактора" value={correctionForm.correction_comment} onChange={(e) => setCorrectionForm({ ...correctionForm, correction_comment: e.target.value })} />

                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <button
                                disabled={adminActionLoading === review.id}
                                style={{ border: 0, borderRadius: 12, background: "rgba(99,102,241,.2)", color: "#c7d2fe", padding: "8px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer", opacity: adminActionLoading === review.id ? 0.5 : 1 }}
                                onClick={() => adminSaveCorrection(review.id, null)}
                              >
                                Сохранить правки
                              </button>
                              <button
                                disabled={adminActionLoading === review.id}
                                style={{ border: 0, borderRadius: 12, background: "rgba(34,197,94,.2)", color: "#bbf7d0", padding: "8px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer", opacity: adminActionLoading === review.id ? 0.5 : 1 }}
                                onClick={() => adminSaveCorrection(review.id, "approved")}
                              >
                                Одобрить после правки
                              </button>
                              <button
                                style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: 12, background: "rgba(255,255,255,.06)", color: "#94a3b8", padding: "8px 14px", fontWeight: 600, fontSize: 12, cursor: "pointer" }}
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
                        <div key={review?.id} style={{ border: "1px solid rgba(220,38,38,.2)", borderRadius: 20, background: "rgba(220,38,38,.05)", padding: 20, color: "#fecaca", fontSize: 13 }}>
                          Ошибка отображения review {review?.id || "unknown"}
                        </div>
                      );
                    }
                  })}
                </div>
              )}

              {/* Future export button placeholder */}
              {/*
                TODO: "Экспортировать approved reviews в JSONL"
                <button>Экспортировать одобренные в JSONL</button>
              */}

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
              boxShadow: "0 8px 30px rgba(0,0,0,.5)", animation: "toastIn 0.3s ease",
              textAlign: "center", maxWidth: "calc(100vw - 40px)",
              ...(toast.type === "error"
                ? { background: "rgba(220,38,38,.2)", border: "1px solid rgba(248,113,113,.4)", color: "#fecaca" }
                : { background: "rgba(34,197,94,.2)", border: "1px solid rgba(74,222,128,.4)", color: "#bbf7d0" }),
            }}
          >
            {toast.message}
          </div>
        )}
      </div>
    );
  }

  const s = {
    page: {
      minHeight: "100vh",
      background: "#050817",
      color: "white",
      fontFamily: "Inter, system-ui, Arial",
      padding: "32px",
    },
    wrap: { maxWidth: 1200, margin: "0 auto" },
    header: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 80,
    },
    logo: { fontSize: 28, fontWeight: 800 },
    sub: { color: "#94a3b8", marginTop: 4 },
    crisis: {
      background: "#dc2626",
      color: "white",
      border: 0,
      borderRadius: 22,
      padding: "16px 24px",
      fontWeight: 800,
      fontSize: 16,
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
      border: "1px solid rgba(255,255,255,.14)",
      background: "rgba(255,255,255,.06)",
      borderRadius: 999,
      padding: "12px 18px",
      color: "#cbd5e1",
      marginBottom: 28,
    },
    h1: {
      fontSize: 68,
      lineHeight: 1.03,
      fontWeight: 900,
      margin: 0,
      letterSpacing: "-0.05em",
    },
    p: {
      color: "#cbd5e1",
      fontSize: 20,
      lineHeight: 1.7,
      maxWidth: 680,
    },
    row: {
      display: "flex",
      gap: 14,
      marginTop: 28,
      flexWrap: "wrap",
    },
    primary: {
      border: 0,
      borderRadius: 22,
      background: "white",
      color: "#020617",
      padding: "16px 24px",
      fontWeight: 800,
      fontSize: 16,
      cursor: "pointer",
    },
    secondary: {
      border: "1px solid rgba(255,255,255,.18)",
      borderRadius: 22,
      background: "rgba(255,255,255,.06)",
      color: "white",
      padding: "16px 24px",
      fontWeight: 800,
      fontSize: 16,
      cursor: "pointer",
    },
    card: {
      border: "1px solid rgba(255,255,255,.12)",
      background: "rgba(255,255,255,.08)",
      borderRadius: 36,
      padding: 28,
      boxShadow: "0 30px 80px rgba(0,0,0,.35)",
    },
    inner: {
      background: "rgba(2,6,23,.75)",
      borderRadius: 30,
      padding: 26,
      marginTop: 22,
    },
    textarea: {
      width: "100%",
      minHeight: 180,
      resize: "vertical",
      border: "1px solid rgba(255,255,255,.12)",
      borderRadius: 24,
      background: "transparent",
      color: "white",
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
      background: "white",
      color: "#020617",
      padding: "18px 22px",
      fontWeight: 900,
      fontSize: 16,
      cursor: "pointer",
    },
    error: {
      marginTop: 16,
      background: "rgba(220,38,38,.18)",
      color: "#fecaca",
      padding: 16,
      borderRadius: 18,
    },
    result: {
      marginTop: 24,
      border: "1px solid rgba(255,255,255,.12)",
      background: "rgba(255,255,255,.06)",
      borderRadius: 28,
      padding: 24,
    },
    label: { color: "#94a3b8", fontSize: 14, marginTop: 18, marginBottom: 6 },
    label2: { color: "#94a3b8", fontSize: 14, marginTop: 22, marginBottom: 6 },
    questionCard: {
      background: "rgba(255,255,255,.06)",
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
      border: "1px solid rgba(255,255,255,.12)",
      background: "rgba(255,255,255,.04)",
      color: "white",
      borderRadius: 14,
      padding: "10px 16px",
      cursor: "pointer",
    },
    activeTab: {
      border: "1px solid rgba(255,255,255,.18)",
      background: "white",
      color: "#020617",
      borderRadius: 14,
      padding: "10px 16px",
      fontWeight: 700,
      cursor: "pointer",
    },
    reportBlock: {
      background: "rgba(255,255,255,.05)",
      borderRadius: 20,
      padding: 20,
    },
    expertBox: {
      marginTop: 24,
      border: "1px solid rgba(255,255,255,.12)",
      background: "rgba(255,255,255,.05)",
      borderRadius: 24,
      padding: 20,
    },
    overlay: {
      position: "fixed",
      top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(0,0,0,.65)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1000,
      padding: 20,
    },
    modal: {
      background: "#0f172a",
      borderRadius: 28,
      padding: 28,
      maxWidth: 560,
      width: "100%",
      border: "1px solid rgba(255,255,255,.1)",
      boxShadow: "0 30px 80px rgba(0,0,0,.5)",
    },
    modalTitle: {
      fontSize: 26,
      fontWeight: 900,
      marginBottom: 12,
    },
    modalWarning: {
      background: "rgba(220,38,38,.15)",
      color: "#fecaca",
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
      border: "1px solid rgba(255,255,255,.12)",
      borderRadius: 16,
      background: "rgba(2,6,23,.55)",
      color: "white",
      padding: 14,
      fontSize: 15,
      outline: "none",
      boxSizing: "border-box",
      marginBottom: 14,
    },
    crisisInput: {
      width: "100%",
      border: "1px solid rgba(255,255,255,.12)",
      borderRadius: 16,
      background: "rgba(2,6,23,.55)",
      color: "white",
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
      background: "rgba(220,38,38,.22)",
      border: "1px solid rgba(248,113,113,.35)",
      color: "#fecaca",
      padding: 16,
      borderRadius: 18,
      lineHeight: 1.5,
    },
    crisisConfirmation: {
      marginTop: 14,
      background: "rgba(34,197,94,.16)",
      border: "1px solid rgba(74,222,128,.35)",
      color: "#bbf7d0",
      padding: 16,
      borderRadius: 18,
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
      boxShadow: "0 8px 30px rgba(0,0,0,.5)",
      animation: "toastIn 0.3s ease",
      textAlign: "center",
      maxWidth: "calc(100vw - 40px)",
    },
    toastSuccess: {
      background: "rgba(34,197,94,.2)",
      border: "1px solid rgba(74,222,128,.4)",
      color: "#bbf7d0",
    },
    toastError: {
      background: "rgba(220,38,38,.2)",
      border: "1px solid rgba(248,113,113,.4)",
      color: "#fecaca",
    },
    answerInput: {
      width: "100%",
      minHeight: 80,
      resize: "vertical",
      border: "1px solid rgba(255,255,255,.12)",
      borderRadius: 16,
      background: "rgba(2,6,23,.55)",
      color: "white",
      padding: 14,
      fontSize: 15,
      outline: "none",
      boxSizing: "border-box",
    },
  };

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
          <div>
            <div style={s.logo}>🧠 Точка опоры</div>
            <div style={s.sub}>Анонимно. Безопасно. Можно просто начать говорить.</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {expertData && (
              <div style={{
                background: "rgba(99,102,241,.15)", border: "1px solid rgba(99,102,241,.3)",
                borderRadius: 22, padding: "8px 16px", fontSize: 13, color: "#c7d2fe",
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <span>🔬 {expertData.name}, {expertData.role}</span>
                <button
                  onClick={handleExpertLogout}
                  style={{
                    background: "none", border: "1px solid rgba(255,255,255,.2)", borderRadius: 10,
                    color: "#94a3b8", padding: "4px 10px", fontSize: 11, cursor: "pointer",
                  }}
                >
                  Выйти
                </button>
              </div>
            )}
            <button
              style={{
                ...s.secondary, fontSize: 13, padding: "10px 16px",
                border: "1px solid rgba(99,102,241,.3)", background: "rgba(99,102,241,.08)",
              }}
              onClick={() => setExpertModalOpen(true)}
            >
              🔬 Для специалистов
            </button>
            <button
              style={s.crisis}
              onClick={() => setCrisisOpen(true)}
            >
              ⚠ Мне срочно нужна помощь
            </button>
          </div>
        </header>

        <main style={s.grid} className="app-grid">
          <section>
            <h1 style={s.h1} className="app-hero-title">
              Расскажите, что с вами происходит — голосом или текстом.
            </h1>
            <p style={s.p} className="app-hero-text">
              Сервис поможет мягко разобрать состояние, определить возможный
              спектр проблемы и предложить понятный план действий.
            </p>

            <div style={s.row} className="app-actions">
              <button style={s.primary} onClick={() => setMode("voice")}>
                🎙 Рассказать голосом
              </button>
              <button style={s.secondary} onClick={() => setMode("text")}>
                ⌨ Написать текстом
              </button>
              <button
                style={{ ...s.secondary, border: "1px solid rgba(99,102,241,.4)", background: "rgba(99,102,241,.12)" }}
                onClick={() => setSessionModalOpen(true)}
              >
                🔄 Продолжить разговор
              </button>
            </div>

            <p style={{ ...s.sub, marginTop: 24 }}>
              Сервис не ставит диагноз. Решение о диагнозе и лечении принимает
              врач.
            </p>
          </section>

          <section style={s.card} className="app-card">
            <div style={s.sub}>Первичный вход</div>
            <div style={{ fontSize: 28, fontWeight: 900 }}>
              Анонимный разговор
            </div>

            <div style={s.inner}>
              {mode === "voice" ? (
                <div style={{ textAlign: "center", padding: "40px 20px" }}>
                  <div style={{ fontSize: 58 }}>🎙</div>
                  <h2>Голосовой режим</h2>

                  <p style={{ color: "#94a3b8", lineHeight: 1.6 }}>
                    Нажмите "Начать запись", расскажите о своем состоянии, затем остановите запись.
                    Мы расшифруем голос и перенесем текст в обычное поле.
                  </p>

                  {!recording ? (
                    <button style={s.wide} onClick={startRecording} disabled={transcribing}>
                      {transcribing ? "Расшифровываем..." : "Начать запись"}
                    </button>
                  ) : (
                    <button style={{ ...s.wide, background: "#dc2626", color: "white" }} onClick={stopRecording}>
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
                    color: recordingTime > 45 ? "#fca5a5" : "#94a3b8",
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
                    placeholder="Например: последние месяцы я плохо сплю, тревожусь, не могу собраться, часто думаю о потере..."
                  />
                  <button
                    style={s.wide}
                    onClick={submitRound}
                    disabled={loading}
                  >
                    {loading
                      ? "Формируем вопросы..."
                      : "Начать анонимный разбор состояния"}
                  </button>
                </>
              ) : phase === "questions" ? (
                <>
                  <div style={{ marginBottom: 16, color: "#94a3b8" }}>
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
                                ? "#fca5a5"
                                : "#94a3b8",
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
                <h2 style={{ marginTop: 0 }}>Предварительный отчёт</h2>

                {publicCode && (
                  <div style={{
                    background: "rgba(99,102,241,.12)", border: "1px solid rgba(99,102,241,.3)",
                    borderRadius: 16, padding: "12px 16px", marginBottom: 16,
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                  }}>
                    <span style={{ color: "#a5b4fc", fontSize: 13 }}>
                      Код диалога для продолжения:
                    </span>
                    <span style={{ fontWeight: 900, fontSize: 18, color: "#c7d2fe", letterSpacing: 1 }}>
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

                <button
                  style={{ ...s.secondary, marginTop: 16 }}
                  onClick={() => setSessionReviewOpen(!sessionReviewOpen)}
                >
                  Оценка сессии
                </button>

                {sessionReviewOpen && (
                  <div style={s.expertBox}>
                    <h3 style={{ margin: "0 0 16px", fontSize: 18 }}>Оценка сессии</h3>

                    <label style={s.label}>Оценка пациентом</label>
                    <div style={{ marginBottom: 6, color: "#94a3b8", fontSize: 13 }}>Насколько полезным был разбор? 1–5</div>
                    <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          style={{
                            width: 44, height: 44, borderRadius: 12, border: "1px solid rgba(255,255,255,.12)",
                            background: patientRating === n ? "white" : "rgba(255,255,255,.06)",
                            color: patientRating === n ? "#020617" : "white",
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

                    <div style={{ borderTop: "1px solid rgba(255,255,255,.08)", margin: "20px 0" }} />

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
                              await fetch("/api/save-review", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify(buildCaseReview()),
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
                  style={{ ...s.wide, marginTop: 20 }}
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

                  {crisisConfirmation && (
                    <div style={s.crisisConfirmation}>{crisisConfirmation}</div>
                  )}

                  {crisisWarning && (
                    <div style={s.crisisWarning}>{crisisWarning}</div>
                  )}

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
                        : "🎙 Рассказать голосом"}
                  </button>

                  <div
                    style={{
                      marginTop: 8,
                      color: crisisRecordingTime > 45 ? "#fca5a5" : "#94a3b8",
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

                  <input
                    style={s.crisisInput}
                    value={crisisContact}
                    onChange={(e) => setCrisisContact(e.target.value)}
                    placeholder="Телефон или Telegram для связи"
                  />
                  <div style={s.crisisActions}>
                    <button style={s.wide} onClick={submitCrisisRequest}>
                      Жду звонка специалиста
                    </button>
                    <button style={s.wide} onClick={continueFromCrisis}>
                      Продолжить анонимный разбор
                    </button>
                  </div>
                </>
            </div>
          </div>
        )}

        {sessionModalOpen && (
          <div style={s.overlay} onClick={() => setSessionModalOpen(false)}>
            <div style={s.modal} className="modal" onClick={(e) => e.stopPropagation()}>
              <div style={s.modalTitle}>Продолжить разговор</div>

              <p style={{ color: "#94a3b8", lineHeight: 1.6, marginBottom: 20 }}>
                Введите код диалога, который был показан после завершения предыдущей сессии.
              </p>

              <input
                style={s.crisisInput}
                value={sessionCodeInput}
                onChange={(e) => setSessionCodeInput(e.target.value.toUpperCase())}
                placeholder="ТОЧКА-XXXX-XXXX"
              />

              <div style={s.crisisActions}>
                <button
                  style={s.wide}
                  disabled={loadingSession || sessionCodeInput.trim().length < 5}
                  onClick={async () => {
                    setLoadingSession(true);
                    try {
                      const code = sessionCodeInput.trim();

                      // Try Supabase first
                      let res = await fetch("/api/load-session", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ publicCode: code }),
                      });
                      let data = await res.json();

                      // Fallback to local fs
                      if (!res.ok || !data.ok) {
                        res = await fetch("/api/get-session", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ code }),
                        });
                        data = await res.json();
                        if (!res.ok) throw new Error(data.error || "Сессия не найдена");
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
                  {loadingSession ? "Поиск..." : "Продолжить"}
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
                  <p style={{ color: "#bbf7d0", lineHeight: 1.6, marginBottom: 16, background: "rgba(34,197,94,.12)", padding: "14px 18px", borderRadius: 14, fontSize: 14 }}>
                    Вы зарегистрированы как специалист. Ваш профиль привязан к этому устройству.
                  </p>
                  <div style={{ background: "rgba(99,102,241,.12)", border: "1px solid rgba(99,102,241,.25)", borderRadius: 14, padding: "16px 18px", marginBottom: 16 }}>
                    <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 6 }}>Ваш код специалиста</div>
                    <div style={{ fontSize: 20, fontWeight: 900, color: "#a5b4fc", letterSpacing: 1, fontFamily: "monospace" }}>
                      {registrationResult.access_code}
                    </div>
                    <div style={{ color: "#64748b", fontSize: 12, marginTop: 8 }}>
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
                  <div style={s.modalTitle}>Режим специалиста</div>

                  {/* Block A: existing code */}
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 14, marginBottom: 10 }}>У меня уже есть код</div>
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
                  <div style={{ borderTop: "1px solid rgba(255,255,255,.08)", margin: "16px 0" }} />

                  {/* Block B: first time registration */}
                  <div>
                    <div style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Я впервые здесь</div>
                    <p style={{ color: "#94a3b8", lineHeight: 1.6, marginBottom: 14, fontSize: 13 }}>
                      Если вы врач, психолог или другой специалист и участвуете в тестировании, заполните короткую форму. Доступ включится сразу.
                    </p>
                    <button
                      style={{ ...s.wide, background: "rgba(99,102,241,.15)", color: "#a5b4fc", border: "1px solid rgba(99,102,241,.3)" }}
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
                  <p style={{ color: "#94a3b8", lineHeight: 1.6, marginBottom: 16, fontSize: 13 }}>
                    Заполните форму. После регистрации вы получите код специалиста и доступ включится сразу.
                  </p>

                  <input style={s.crisisInput} placeholder="ФИО *" value={registerForm.name} onChange={(e) => setRegisterForm({ ...registerForm, name: e.target.value })} />
                  <input style={s.crisisInput} placeholder="Email" type="email" value={registerForm.email} onChange={(e) => setRegisterForm({ ...registerForm, email: e.target.value })} />
                  <input style={s.crisisInput} placeholder="Telegram" value={registerForm.telegram} onChange={(e) => setRegisterForm({ ...registerForm, telegram: e.target.value })} />
                  <select style={{ ...s.crisisInput, cursor: "pointer" }} value={registerForm.role} onChange={(e) => setRegisterForm({ ...registerForm, role: e.target.value })}>
                    <option value="psychiatrist">Психиатр</option>
                    <option value="psychologist">Психолог</option>
                    <option value="psychotherapist">Психотерапевт</option>
                    <option value="clinical_psychologist">Клинический психолог</option>
                    <option value="neurologist">Невролог</option>
                    <option value="other">Другое</option>
                  </select>
                  <input style={s.crisisInput} placeholder="Специализация" value={registerForm.specialty} onChange={(e) => setRegisterForm({ ...registerForm, specialty: e.target.value })} />
                  <input style={s.crisisInput} placeholder="Город" value={registerForm.city} onChange={(e) => setRegisterForm({ ...registerForm, city: e.target.value })} />
                  <input style={s.crisisInput} placeholder="Организация" value={registerForm.organization} onChange={(e) => setRegisterForm({ ...registerForm, organization: e.target.value })} />

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
