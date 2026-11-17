import React, { useEffect, useRef, useState } from "react";
import "./GuidedTour.css";

// Shared click-through tour shell. Product-specific wrappers provide the copy,
// targets and completion rules; this component only handles safe positioning.
export default function GuidedTour({
  steps,
  step,
  targetOverride,
  instructionOverride,
  statusText,
  onNext,
  onBack,
  onSkip,
  onClose,
  nextDisabled = false,
  showBack = true,
  showSkip = true,
  classPrefix = "cabinet-tour",
  primaryClassName,
  secondaryClassName,
  containerSelector = "[data-tour-container]",
  dialogLabel = "Обучение по кабинету",
  dialogTestId = "cabinet-tour-dialog",
  nextTestId = "cabinet-tour-next",
  finalLabel = "Завершить обучение",
}) {
  const item = steps[step];
  const target = targetOverride || item?.target;
  const [position, setPosition] = useState(null);
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!item || !target) return undefined;
    let frame = 0;
    const measure = () => {
      const el = document.querySelector(target);
      if (!el) {
        setPosition(null);
        return;
      }
      const r = el.getBoundingClientRect();
      const panel = el.closest(containerSelector)?.getBoundingClientRect() || r;
      const width = Math.min(354, window.innerWidth - 24);
      const height = Math.min(dialogRef.current?.getBoundingClientRect().height || 300, window.innerHeight - 24);
      const gutter = 16;
      const rightX = panel.right + gutter;
      const leftX = panel.left - width - gutter;
      const side = rightX + width + 12 <= window.innerWidth ? "right" : leftX >= 12 ? "left" : "top";
      const interactiveRects = [...el.querySelectorAll("button,input,select,textarea,[role=button]")]
        .map((control) => control.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight);
      const overlapArea = (candidateTop) => interactiveRects.reduce((total, rect) => {
        const overlapWidth = Math.max(0, Math.min(window.innerWidth - 12, rect.right) - Math.max(window.innerWidth - width - 12, rect.left));
        const overlapHeight = Math.max(0, Math.min(candidateTop + height, rect.bottom) - Math.max(candidateTop, rect.top));
        return total + overlapWidth * overlapHeight;
      }, 0);
      const topCandidate = 12;
      const bottomCandidate = Math.max(12, window.innerHeight - height - 12);
      const verticalTop = overlapArea(bottomCandidate) < overlapArea(topCandidate) ? bottomCandidate : topCandidate;
      const popStyle = side === "right" || side === "left"
        ? { top: Math.min(Math.max(12, r.top), Math.max(12, window.innerHeight - height - 12)), left: side === "right" ? rightX : leftX, bottom: "auto" }
        : { top: verticalTop, left: Math.max(12, window.innerWidth - width - 12), bottom: "auto" };
      setPosition({
        highlight: {
          top: Math.max(0, r.top - 7),
          left: Math.max(0, r.left - 7),
          width: Math.max(1, r.width + 14),
          height: Math.max(1, r.height + 14),
        },
        popStyle,
        side,
      });
    };
    const el = document.querySelector(target);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(update);
    if (observer && document.body) observer.observe(document.body, { childList: true, subtree: true });
    const timeout = setTimeout(update, 400);
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timeout);
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      observer?.disconnect();
      document.removeEventListener("keydown", onKey);
    };
  }, [containerSelector, item, onClose, step, target]);

  if (!item) return null;
  const last = step === steps.length - 1;
  return (
    <>
      {position && (
        <div
          className={`${classPrefix}-spotlight`}
          aria-hidden="true"
          style={position.highlight}
        />
      )}
      <aside
        ref={dialogRef}
        className={`${classPrefix}-popover ${classPrefix}-placement-${position?.side || "top"}`}
        role="dialog"
        aria-modal="false"
        aria-label={dialogLabel}
        style={position?.popStyle}
        data-testid={dialogTestId}
      >
        <div className={`${classPrefix}-top`}>
          <span>Экскурсия · шаг {step + 1} из {steps.length}</span>
          <button type="button" onClick={onClose} aria-label="Закрыть обучение">×</button>
        </div>
        <h3>{item.title}</h3>
        <p>{instructionOverride || item.description}</p>
        {statusText && <p className={`${classPrefix}-status`} role="status">{statusText}</p>}
        <div className={`${classPrefix}-actions`}>
          {showBack && step > 0 && (
            <button type="button" className={secondaryClassName || `${classPrefix}-secondary`} onClick={onBack}>Назад</button>
          )}
          {showSkip && !last && (
            <button type="button" className={secondaryClassName || `${classPrefix}-secondary`} onClick={onSkip}>Пропустить</button>
          )}
          <button
            type="button"
            className={primaryClassName || `${classPrefix}-primary`}
            onClick={onNext}
            disabled={nextDisabled}
            data-testid={nextTestId}
          >
            {last ? finalLabel : "Далее"}
          </button>
        </div>
      </aside>
    </>
  );
}
