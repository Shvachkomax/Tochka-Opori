import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  PATIENT_TOUR_INVITE_DELAY_MS,
  PATIENT_TOUR_INVITE_PULSE_MS,
  PATIENT_TOUR_STEPS,
  normalizePatientTourProfile,
  parsePatientTourProgress,
  patientTourInviteKey,
  patientTourStepStatus,
  patientTourStorageKey,
  shouldInviteToPatientTour,
} from "../../lib/my-practice/patient-onboarding-tour.js";
import GuidedTour from "./GuidedTour.jsx";
import "./PatientCabinetTour.css";

function readStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeStorage(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

export default function PatientCabinetTour({ profile, scope }) {
  const normalizedProfile = normalizePatientTourProfile(profile);
  const steps = PATIENT_TOUR_STEPS[normalizedProfile];
  const progressKey = useMemo(() => patientTourStorageKey(normalizedProfile, scope), [normalizedProfile, scope]);
  const inviteKey = useMemo(() => patientTourInviteKey(normalizedProfile, scope), [normalizedProfile, scope]);
  const initialProgress = useMemo(() => parsePatientTourProgress(readStorage(progressKey), steps.length), [progressKey, steps.length]);
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(initialProgress.step);
  const [completed, setCompleted] = useState(initialProgress.completed);
  const [inviteDismissed, setInviteDismissed] = useState(() => readStorage(inviteKey) === "dismissed");
  const [invitePulse, setInvitePulse] = useState(false);
  const [inviteTip, setInviteTip] = useState(false);
  const [targetState, setTargetState] = useState({
    targetFound: false, unavailable: false, specialists: null, services: null,
  });
  const inviteEligible = shouldInviteToPatientTour({ dismissed: inviteDismissed, completed });

  const dismissInvite = useCallback(() => {
    setInviteDismissed(true);
    setInvitePulse(false);
    setInviteTip(false);
    writeStorage(inviteKey, "dismissed");
  }, [inviteKey]);

  useEffect(() => {
    const progress = parsePatientTourProgress(readStorage(progressKey), steps.length);
    setActive(false);
    setStep(progress.step);
    setCompleted(progress.completed);
    setInviteDismissed(readStorage(inviteKey) === "dismissed");
  }, [inviteKey, progressKey, steps.length]);

  useEffect(() => {
    if (!inviteEligible || active) {
      setInvitePulse(false);
      setInviteTip(false);
      return undefined;
    }
    setInvitePulse(true);
    const tipTimer = setTimeout(() => setInviteTip(true), PATIENT_TOUR_INVITE_DELAY_MS);
    const pulseTimer = setTimeout(() => setInvitePulse(false), PATIENT_TOUR_INVITE_PULSE_MS);
    return () => {
      clearTimeout(tipTimer);
      clearTimeout(pulseTimer);
    };
  }, [active, inviteEligible]);

  const openTour = useCallback(() => {
    dismissInvite();
    const progress = parsePatientTourProgress(readStorage(progressKey), steps.length);
    const nextStep = progress.completed ? 0 : progress.step;
    setCompleted(false);
    setStep(nextStep);
    writeStorage(progressKey, String(nextStep));
    setActive(true);
  }, [dismissInvite, progressKey, steps.length]);

  const moveTo = useCallback((nextStep) => {
    setStep(nextStep);
    writeStorage(progressKey, String(nextStep));
  }, [progressKey]);

  const next = useCallback(() => {
    if (step === steps.length - 1) {
      setCompleted(true);
      writeStorage(progressKey, "complete");
      setActive(false);
      return;
    }
    moveTo(step + 1);
  }, [moveTo, progressKey, step, steps.length]);

  useEffect(() => {
    if (!active) return undefined;
    const target = steps[step]?.target;
    const readTarget = () => {
      const element = target ? document.querySelector(target) : null;
      const parseCount = (value) => {
        if (value === undefined) return null;
        const count = Number(value);
        return Number.isInteger(count) && count >= 0 ? count : null;
      };
      const nextState = {
        targetFound: Boolean(element),
        unavailable: element?.dataset.tourUnavailable === "true",
        specialists: parseCount(element?.dataset.tourSpecialistCount),
        services: parseCount(element?.dataset.tourServiceCount),
      };
      setTargetState((current) => Object.keys(nextState).every((key) => current[key] === nextState[key])
        ? current : nextState);
    };
    readTarget();
    const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(readTarget);
    observer?.observe(document.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ["data-tour-unavailable", "data-tour-specialist-count", "data-tour-service-count"],
    });
    return () => observer?.disconnect();
  }, [active, step, steps]);

  const hint = patientTourStepStatus(steps[step]?.id, targetState);
  const closeTour = useCallback(() => setActive(false), []);

  return (
    <div className="patient-tour-launch">
      <div className="patient-tour-invite-wrap">
        <button
          type="button"
          className={`patient-tour-entry ${inviteEligible ? "patient-tour-entry-highlight" : ""} ${inviteEligible && invitePulse ? "patient-tour-entry-pulse" : ""}`}
          onClick={openTour}
          data-testid={`patient-tour-start-${normalizedProfile}`}
        >
          <span aria-hidden="true">▶</span> Знакомство с кабинетом
        </button>
        {inviteEligible && <span className="patient-tour-invite-label">Начните здесь</span>}
        {inviteEligible && inviteTip && !active && (
          <div className="patient-tour-invite-tip" role="status">
            <span>Покажем, как пользоваться кабинетом, общаться со специалистом и записываться на приём.</span>
            <button type="button" onClick={dismissInvite} aria-label="Скрыть приглашение к знакомству">×</button>
          </div>
        )}
      </div>
      {active && (
        <GuidedTour
          steps={steps}
          step={step}
          statusText={hint}
          onNext={next}
          onBack={() => moveTo(Math.max(0, step - 1))}
          onSkip={next}
          onClose={closeTour}
          dialogLabel="Знакомство с кабинетом пациента"
          dialogTestId={`patient-tour-dialog-${normalizedProfile}`}
          nextTestId={`patient-tour-next-${normalizedProfile}`}
        />
      )}
    </div>
  );
}
