import React, { useEffect, useRef, useState } from "react";
import "./PracticePatientBooking.css";

const formats = { offline: "Очно", online: "Онлайн", phone: "По телефону", video: "Видеосвязь" };
const statuses = {
  held: "Ожидает подтверждения", confirmed: "Подтверждена", completed: "Приём состоялся",
  cancelled: "Отменена", expired: "Время брони истекло",
};
const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium", timeStyle: "short", timeZone: "UTC",
});
const POLICY_VERSION = "12h-20-v1";
const creditLabel = (amount) => Number(amount).toLocaleString("ru-RU") + " кредитов";
const paymentOf = (booking) => Array.isArray(booking.practice_booking_credits)
  ? booking.practice_booking_credits[0] : booking.practice_booking_credits;
const cancellationPolicy = "При отмене за 12 часов и раньше вернётся вся стоимость. При отмене менее чем за 12 часов удерживается 20% стоимости услуги, возвращается 80%.";
const isActive = (status) => status === "held" || status === "confirmed";

async function post(path, data, signal) {
  const response = await fetch(path, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data), signal,
  });
  const result = await response.json().catch(() => ({}));
  // The booking route's 503 also covers deliberately disabled environments.
  if (!response.ok || !result.ok) {
    const error = new Error(result.error || "Не удалось выполнить запрос. Попробуйте ещё раз.");
    error.status = response.status;
    error.details = result;
    throw error;
  }
  return result;
}

function NewBookingForm({ services, request, onSaved, balance, walletActive, onTopUp, onRefresh }) {
  const [serviceId, setServiceId] = useState(services[0].service_id);
  const [day, setDay] = useState("");
  const [slots, setSlots] = useState([]);
  const [startTime, setStartTime] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reservation = useRef(null);
  const [accepted, setAccepted] = useState(false);
  const service = services.find((item) => item.service_id === serviceId);
  const price = Number(service?.price_credits);
  const shortfall = Math.max(0, price - balance);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (!day) return;
    const controller = new AbortController();
    setLoading(true);
    request("getPracticeSlots", { service_id: serviceId, day }, controller.signal)
      .then(({ free }) => {
        if (controller.signal.aborted) return;
        setSlots(free.filter((slot) => Date.parse(slot.starts_at) > Date.now()));
      })
      .catch((err) => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [request, serviceId, day]);

  function resetSlot() {
    setStartTime("");
    setSlots([]);
    setError("");
    setLoading(false);
    reservation.current = null;
  }

  async function reserve(event) {
    event.preventDefault();
    if (!accepted || busy || !walletActive || !Number.isSafeInteger(price)) return;
    if (shortfall > 0) return onTopUp(shortfall);
    setBusy(true);
    setError("");
    const key = reservation.current ||= crypto.randomUUID();
    try {
      await request("reservePracticeBooking", {
        service_id: serviceId, day, start_time: startTime, idempotency_key: key,
        expected_price_credits: price, cancellation_policy_version: POLICY_VERSION,
      });
      resetSlot();
      setDay("");
      await onSaved();
    } catch (err) {
      if (err.status === 409 || err.status === 402) reservation.current = null;
      if (err.status === 402) onTopUp(err.details?.missing_credits);
      if (err.details?.code === "P0011") { setAccepted(false); await onRefresh(); }
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="practice-patient-fields" onSubmit={reserve} data-testid="a2-patient-booking" data-tour-target="patient-booking-form">
      <label>Услуга и место приёма
        <select data-testid="a2-patient-service" value={serviceId} disabled={busy}
          onChange={(event) => { resetSlot(); setServiceId(event.target.value); }}>
          {services.map((service) => (
            <option key={service.service_id} value={service.service_id}>
              {[service.name, service.place_name || formats[service.format], creditLabel(service.price_credits), `${service.price_kop / 100} ₽`, `${service.duration_min} мин`].filter(Boolean).join(" · ")}
            </option>
          ))}
        </select>
      </label>
      <label>Дата приёма
        <input data-testid="a2-patient-day" type="date" min={today} value={day} disabled={busy}
          onChange={(event) => { resetSlot(); setDay(event.target.value); }} required />
      </label>
      {day && (
        <label>Свободное время (UTC)
          <select data-testid="a2-patient-slot" value={startTime} required disabled={busy || loading || !slots.length}
            onChange={(event) => { reservation.current = null; setStartTime(event.target.value); }}>
            <option value="">{loading ? "Загружаем время…" : slots.length ? "Выберите время" : "Свободного времени нет"}</option>
            {slots.map((slot) => <option key={slot.starts_at} value={slot.start_time}>{slot.start_time}</option>)}
          </select>
        </label>
      )}
      <p>К оплате {creditLabel(price)}. Доступно {creditLabel(balance)}.</p>
      <p>{cancellationPolicy}</p>
      <label className="practice-patient-consent">
        <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} required />
        Согласен с условиями отмены и списанием {creditLabel(price)} при бронировании.
      </label>
      {shortfall > 0 && <p role="status">Не хватает {creditLabel(shortfall)}. Пополните баланс.</p>}
      {!walletActive && <p role="alert">Оплата с этого кошелька сейчас недоступна.</p>}
      {shortfall > 0 ? (
        <button type="button" onClick={() => onTopUp(shortfall)}>Пополнить баланс</button>
      ) : (
        <button type="submit" data-testid="a2-patient-reserve"
          disabled={busy || loading || !startTime || !accepted || !walletActive || !Number.isSafeInteger(price)}>
          {busy ? "Бронируем…" : `Оплатить ${creditLabel(price)} и записаться`}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

function AppointmentList({ title, bookings, busy, onAction }) {
  if (!bookings.length) return null;
  return (
    <>
      <h4>{title}</h4>
      <ul className="practice-patient-list">
        {bookings.map((booking) => {
          const service = booking.practice_services;
          const payment = paymentOf(booking);
          const status = booking.status === "held" && Date.parse(booking.expires_at) <= Date.now()
            ? "expired" : booking.status;
          return (
            <li key={booking.id} className="practice-patient-card">
              <strong>{booking.experts?.name || "Специалист"} · {service?.name || "Приём"}</strong>
              <span>{[booking.organizations?.name, booking.practice_places?.name, formats[service?.format]].filter(Boolean).join(" · ")}</span>
              <time dateTime={booking.starts_at}>{dateFormat.format(new Date(booking.starts_at))} UTC</time>
              <span>{statuses[status]}</span>
              {payment && <span>Оплачено {creditLabel(payment.charged_credits)}</span>}
              {status === "cancelled" && payment && (
                <span>Возвращено {creditLabel(payment.refunded_credits)} · Удержано {creditLabel(payment.cancellation_fee_credits)}</span>
              )}
              {isActive(status) && Date.parse(booking.starts_at) > Date.now() && (
                <div className="practice-patient-actions">
                  {status === "held" && (
                    <button type="button" data-testid="a2-patient-pay" disabled={busy}
                      onClick={() => onAction("payPracticeBookingCredits", booking)}>Оплатить кредитами</button>
                  )}
                  <button type="button" className="practice-patient-secondary" data-testid="a2-patient-cancel" disabled={busy}
                    onClick={() => onAction("quotePracticeCancellation", booking)}>Отменить запись</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

export default function PracticePatientBooking({ sessionId, accessToken, module, cabinetVersion, onBalanceChange }) {
  const [cabinet, setCabinet] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  const [selected, setSelected] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cancellation, setCancellation] = useState(null);
  const [legacyPayment, setLegacyPayment] = useState(null);
  const [topUp, setTopUp] = useState(null);
  const balanceCallback = useRef(onBalanceChange);
  balanceCallback.current = onBalanceChange;
  const peerModule = module === "support" ? "body" : "support";
  const peerLabel = module === "support" ? "Health" : "Support";

  const request = React.useCallback((action, body = {}, signal) => post("/api/practice-booking", {
    action, ...body, session_id: sessionId, access_token: accessToken,
  }, signal), [sessionId, accessToken]);

  const refresh = React.useCallback(async (signal) => {
    try {
      const result = await request("getPracticePatientCabinet", {}, signal);
      if (!signal?.aborted) {
        setUnavailable(false);
        setCabinet(result);
        balanceCallback.current?.(result.available_credits);
      }
    } catch (err) {
      if (signal?.aborted) return;
      if (err.status === 503) setUnavailable(true);
      else {
        if (err.status === 401) setCabinet(null);
        setError(err.message);
      }
    }
  }, [request]);

  useEffect(() => {
    const controller = new AbortController();
    const reloadOnFocus = () => refresh(controller.signal);
    reloadOnFocus();
    window.addEventListener("focus", reloadOnFocus);
    return () => {
      controller.abort();
      window.removeEventListener("focus", reloadOnFocus);
    };
  }, [refresh, cabinetVersion]);

  async function perform(work, successMessage) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      setNotice(successMessage);
    } catch (err) {
      setError(err.message);
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  function link(event) {
    event.preventDefault();
    const input = code.trim();
    setCode("");
    perform(() => post("/api/session", {
      action: "linkPracticePatientProfiles", module: peerModule, continuation_code: input,
      session_id: sessionId, access_token: accessToken,
    }), "Профили связаны. Специалисты и записи теперь видны в обоих разделах.");
  }

  const bookings = cabinet?.bookings || [];
  const specialists = cabinet?.specialists || [];
  const serviceCount = specialists.reduce((total, specialist) => total + (specialist.services?.length || 0), 0);
  const tourState = {
    "data-tour-unavailable": unavailable ? "true" : "false",
    "data-tour-specialist-count": cabinet ? specialists.length : undefined,
    "data-tour-service-count": cabinet ? serviceCount : undefined,
  };

  if (!cabinet) {
    return (
      <section className="practice-patient" data-testid="a2-patient-panel" data-tour-target="patient-specialist" {...tourState}>
        <h3>Мои специалисты и запись</h3>
        <div data-tour-target="patient-booking" {...tourState}>
          {unavailable ? (
            <p role="status">Серверный раздел записи временно недоступен. Это не означает, что прикреплённый специалист отсутствует.</p>
          ) : error ? (
            <p role="alert">{error}</p>
          ) : (
            <p role="status" aria-live="polite">Загружаем прикреплённых специалистов и доступные услуги…</p>
          )}
          {(unavailable || error) && (
            <button type="button" className="practice-patient-secondary" onClick={() => {
              setUnavailable(false);
              setError("");
              refresh();
            }}>Повторить загрузку</button>
          )}
        </div>
      </section>
    );
  }
  const upcoming = bookings.filter((booking) => isActive(booking.status)
    && Date.parse(booking.starts_at) > Date.now()
    && (booking.status !== "held" || Date.parse(booking.expires_at) > Date.now()));
  const history = bookings.filter((booking) => !upcoming.includes(booking));
  async function onAction(action, booking) {
    if (action === "payPracticeBookingCredits") {
      setLegacyPayment(booking);
      return;
    }
    setBusy(true);
    setError("");
    try {
      setCancellation(await request("quotePracticeCancellation", { booking_id: booking.id }));
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function cancelBooking() {
    setBusy(true);
    setError("");
    try {
      const result = await request("cancelPracticeBookingPublic", {
        booking_id: cancellation.booking_id, expected_fee_credits: cancellation.cancellation_fee_credits,
      });
      setCancellation(null);
      setNotice(`Запись отменена. Возвращено ${creditLabel(result.refund_credits || 0)} на кошелёк оплаты. Удержано ${creditLabel(result.cancellation_fee_credits || 0)}.`);
    } catch (err) {
      setError(err.message);
      if (err.details?.code === "P0013") {
        try { setCancellation(await request("quotePracticeCancellation", { booking_id: cancellation.booking_id })); }
        catch { setCancellation(null); }
      }
    } finally { await refresh(); setBusy(false); }
  }

  return (
    <section className="practice-patient" data-testid="a2-patient-panel" data-tour-target="patient-specialist" {...tourState}>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {topUp !== null && (
        <div className="practice-patient-card" role="status">
          <strong>Пополните баланс</strong>
          {topUp > 0 && <p>Нужно добавить {creditLabel(topUp)} — {(topUp / 10).toLocaleString("ru-RU")} ₽.</p>}
          <p>Платёжное пополнение подключается. После зачисления кредитов обновите баланс и повторите запись.</p>
          <button type="button" onClick={() => { setTopUp(null); refresh(); }}>Обновить баланс</button>
        </div>
      )}
      {cancellation && (
        <section className="practice-patient-card" role="dialog" aria-label="Подтверждение отмены">
          <strong>Отменить запись?</strong>
          <p>{cancellationPolicy}</p>
          <p>Будет удержано {creditLabel(cancellation.cancellation_fee_credits)}. На кошелёк оплаты вернётся {creditLabel(cancellation.refund_credits)}.</p>
          {cancellation.can_cancel ? (
            <button type="button" disabled={busy} onClick={cancelBooking}>Подтвердить отмену</button>
          ) : <p>Эту запись уже нельзя отменить.</p>}
          <button type="button" className="practice-patient-secondary" disabled={busy} onClick={() => setCancellation(null)}>Сохранить запись</button>
        </section>
      )}
      {legacyPayment && (
        <section className="practice-patient-card" role="dialog" aria-label="Оплата записи">
          <p>{cancellationPolicy}</p>
          <p>К оплате {creditLabel(legacyPayment.practice_services?.price_credits)}.</p>
          <button disabled={busy} type="button" onClick={() => perform(async () => {
            try {
              await request("payPracticeBookingCredits", {
                booking_id: legacyPayment.id,
                expected_price_credits: legacyPayment.practice_services?.price_credits,
                cancellation_policy_version: POLICY_VERSION,
              });
              setLegacyPayment(null);
            } catch (err) {
              if (err.status === 402) setTopUp(err.details?.missing_credits || 0);
              throw err;
            }
          }, "Запись оплачена и подтверждена.")}>Согласен с условиями, оплатить</button>
          <button disabled={busy} type="button" onClick={() => setLegacyPayment(null)}>Назад</button>
        </section>
      )}
      {!cabinet ? (
        <button type="button" onClick={() => { setError(""); refresh(); }}>Обновить кабинет</button>
      ) : (
        <>
          <p><strong>Доступно {creditLabel(cabinet.available_credits)}</strong> · {(cabinet.available_credits / 10).toLocaleString("ru-RU")} ₽</p>
          <p>10 кредитов = 1 ₽. Кошелёк {module === "body" ? "Health" : "Support"}.</p>
          <button type="button" className="practice-patient-secondary" onClick={() => setTopUp(0)}>Пополнить баланс</button>
          <div data-tour-target="patient-booking" {...tourState}>
            <h3>Мои специалисты</h3>
            {specialists.length === 0 && (
              <p>У вас пока нет прикреплённых специалистов для серверной записи. В Support можно пригласить своего специалиста или запросить подбор. Если связь уже есть в другом профиле, свяжите профили ниже.</p>
            )}
            {specialists.length > 0 && serviceCount === 0 && (
              <p role="status">Специалист прикреплён, но активных серверных услуг для записи пока нет. Связь со специалистом сохранена.</p>
            )}
            <ul className="practice-patient-list">
              {specialists.map((specialist) => {
                const key = `${specialist.expert_id}:${specialist.organization_id || ""}`;
                return (
                  <li key={key} className="practice-patient-card">
                    <strong>{specialist.name}</strong>
                    <span>{[specialist.specialty, specialist.organization_name].filter(Boolean).join(" · ")}</span>
                    <button type="button" className="practice-patient-secondary" aria-expanded={selected === key}
                      onClick={() => setSelected(selected === key ? "" : key)}>
                      {selected === key ? "Скрыть услуги" : "Услуги и запись"}
                    </button>
                    <button type="button" className="practice-patient-secondary" disabled={busy}
                      onClick={() => {
                        if (!window.confirm(`Открепить специалиста «${specialist.name}»? Доступ к данным будет отозван в обоих кабинетах.`)) return;
                        setSelected("");
                        perform(() => request("revokePracticeSpecialist", {
                          expert_id: specialist.expert_id,
                          organization_id: specialist.organization_id || null,
                        }), "Связь со специалистом отозвана в обоих кабинетах.");
                      }}>
                      Открепить специалиста
                    </button>
                    {selected === key && (specialist.services.length ? (
                      <NewBookingForm
                        key={specialist.services.map(({ service_id }) => service_id).join(",")}
                        services={specialist.services} request={request}
                        balance={cabinet.available_credits} walletActive={cabinet.wallet_status === "active"} onRefresh={refresh}
                        onTopUp={(amount) => { setTopUp(amount || 0); refresh(); }}
                        onSaved={() => { setNotice("Запись оплачена кредитами и подтверждена."); return refresh(); }}
                      />
                    ) : <p>У этого специалиста пока нет активных серверных услуг для записи.</p>)}
                  </li>
                );
              })}
            </ul>

            <h3>Мои записи</h3>
            {!bookings.length && <p>Здесь появятся ваши записи на приём.</p>}
            <AppointmentList title="Ближайшие" bookings={[...upcoming].reverse()} busy={busy} onAction={onAction} />
            <AppointmentList title="История" bookings={history} busy={busy} onAction={onAction} />
          </div>

          {cabinet.linking_available && (
            <details>
              <summary>{cabinet.linked ? "Связанные профили Health и Support" : `Связать с профилем ${peerLabel}`}</summary>
              {cabinet.linked ? (
                <button type="button" className="practice-patient-secondary" disabled={busy} onClick={() =>
                  perform(() => request("unlinkPracticePatientProfiles"), "Связь профилей удалена.")}>
                  Отвязать профиль
                </button>
              ) : (
                <form className="practice-patient-fields" onSubmit={link}>
                  <p>После привязки специалисты и записи будут видны в обоих профилях.</p>
                  <label>Код продолжения {peerLabel}
                    <input type="password" value={code} onChange={(event) => setCode(event.target.value)}
                      autoComplete="off" spellCheck={false} maxLength={64} required />
                  </label>
                  <button type="submit" disabled={busy || !code.trim()}>Связать профили</button>
                </form>
              )}
            </details>
          )}
        </>
      )}
    </section>
  );
}
