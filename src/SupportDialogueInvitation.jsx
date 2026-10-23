import { useEffect, useRef, useState } from "react";

const DEFAULT_ROTATION_MS = 8000;

export default function SupportDialogueInvitation({
  invitations,
  eyebrow = "С чего можно начать",
  onTalk,
  onSelectionChange,
  engagementLocked = false,
  resetToken = 0,
  rotationMs = DEFAULT_ROTATION_MS,
}) {
  const items = Array.isArray(invitations) ? invitations.filter((item) => item?.id && item?.text) : [];
  const idsKey = items.map((item) => item.id).join("|");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [manualPaused, setManualPaused] = useState(false);
  const [rotationStopped, setRotationStopped] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [documentHidden, setDocumentHidden] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const pointerDownRef = useRef(false);
  const selectionChangeRef = useRef(onSelectionChange);

  const current = items[selectedIndex] || items[0] || null;
  const canRotate = items.length > 1
    && !reducedMotion
    && !documentHidden
    && !manualPaused
    && !rotationStopped
    && !hovered
    && !focusWithin
    && !engagementLocked;

  useEffect(() => {
    selectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  useEffect(() => {
    setSelectedIndex(0);
    setManualPaused(false);
    setRotationStopped(false);
    setHovered(false);
    setFocusWithin(false);
  }, [resetToken, idsKey]);

  useEffect(() => {
    setSelectedIndex((previous) => Math.min(previous, Math.max(0, items.length - 1)));
  }, [idsKey, items.length]);

  useEffect(() => {
    if (engagementLocked) setRotationStopped(true);
  }, [engagementLocked]);

  useEffect(() => {
    if (!current) return;
    selectionChangeRef.current?.(current);
  }, [current?.id]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mediaQuery.matches);
    update();
    mediaQuery.addEventListener?.("change", update);
    return () => mediaQuery.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const update = () => setDocumentHidden(document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    if (!canRotate) return undefined;
    const timer = window.setInterval(() => {
      setSelectedIndex((previous) => (previous + 1) % items.length);
    }, Math.max(1000, Number(rotationMs) || DEFAULT_ROTATION_MS));
    return () => window.clearInterval(timer);
  }, [canRotate, idsKey, items.length, rotationMs]);

  if (!current) return null;

  const canNavigate = items.length > 1;
  const showPauseControl = canNavigate && !engagementLocked && !reducedMotion;
  const pauseLabel = canRotate ? "Пауза" : "Продолжить показ";

  function markPointerDown() {
    pointerDownRef.current = true;
    setRotationStopped(true);
    window.setTimeout(() => {
      pointerDownRef.current = false;
    }, 50);
  }

  function selectPrevious() {
    setRotationStopped(true);
    setSelectedIndex((previous) => (previous - 1 + items.length) % items.length);
  }

  function selectNext() {
    setRotationStopped(true);
    setSelectedIndex((previous) => (previous + 1) % items.length);
  }

  function togglePause() {
    if (!canRotate) {
      setManualPaused(false);
      setRotationStopped(false);
      setHovered(false);
      setFocusWithin(false);
      return;
    }
    setManualPaused(true);
    setRotationStopped(false);
  }

  function handleTalk() {
    setRotationStopped(true);
    onTalk?.(current);
  }

  return (
    <div
      className="support-dialogue-invitation"
      role="group"
      aria-label="Подсказки для начала разговора"
      aria-live="off"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onPointerDown={markPointerDown}
      onFocusCapture={() => {
        if (!pointerDownRef.current) {
          setFocusWithin(true);
          setRotationStopped(true);
        }
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocusWithin(false);
      }}
    >
      <div className="support-dialogue-invitation__eyebrow">{eyebrow}</div>

      <div className="support-dialogue-invitation__stack">
        {items.map((item, index) => (
          <p
            key={item.id}
            className={`support-dialogue-invitation__text${index === selectedIndex ? " is-active" : ""}`}
            aria-hidden={index !== selectedIndex}
          >
            {item.text}
          </p>
        ))}
      </div>

      <div className="support-dialogue-invitation__controls">
        <button
          type="button"
          className="support-dialogue-invitation__talk"
          onClick={handleTalk}
        >
          Поговорить
        </button>

        {canNavigate && (
          <div className="support-dialogue-invitation__rotation" aria-label="Показ подсказок">
            <button
              type="button"
              className="support-dialogue-invitation__icon-button"
              onClick={selectPrevious}
              aria-label="Предыдущая подсказка"
            >
              ←
            </button>
            {showPauseControl && (
              <button
                type="button"
                className="support-dialogue-invitation__pause"
                onPointerDown={(event) => {
                  pointerDownRef.current = true;
                  event.stopPropagation();
                  window.setTimeout(() => {
                    pointerDownRef.current = false;
                  }, 50);
                }}
                onClick={togglePause}
                aria-pressed={!canRotate}
              >
                {pauseLabel}
              </button>
            )}
            <button
              type="button"
              className="support-dialogue-invitation__icon-button"
              onClick={selectNext}
              aria-label="Следующая подсказка"
            >
              →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
