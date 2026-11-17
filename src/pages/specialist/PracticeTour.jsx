import React from "react";
import {TOUR_STEPS} from "../../../lib/my-practice/onboarding-tour.js";
import GuidedTour from "../../components/GuidedTour.jsx";
import "./PracticeTour.css";

export default function PracticeTour({step,ready,targetOverride,instructionOverride,onNext,onSkip,onClose}){
  return <GuidedTour
    steps={TOUR_STEPS}
    step={step}
    targetOverride={targetOverride}
    instructionOverride={instructionOverride}
    statusText={ready?"Шаг выполнен. Можно продолжить.":"Выполните действие и сохраните изменения либо пропустите этот шаг."}
    onNext={onNext}
    onSkip={onSkip}
    onClose={onClose}
    nextDisabled={!ready}
    showBack={false}
    classPrefix="mp-tour"
    primaryClassName="mp-primary"
    secondaryClassName="mp-secondary"
    containerSelector=".my-practice-pilot"
    dialogLabel="Обучение по кабинету"
    dialogTestId="mp-tour-dialog"
    nextTestId="mp-tour-next"
    finalLabel="Завершить"
  />;
}
