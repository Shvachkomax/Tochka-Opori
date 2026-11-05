// Исключительно синтетические данные: никаких пациентов или реальных клиник.
export const DEMO_DOCTOR = Object.freeze({
  id: "demo-doctor-01",
  name: "Врач-демонстратор",
  specialty: "Врач-психиатр",
  city: "Учебный город",
  about: "Пример личного рабочего места врача с приёмами в нескольких клиниках.",
});
export const DEMO_CLINICS = Object.freeze([
  { id: "demo-clinic-a", name: "Клиника «Север» (демо)", address: "Вымышленный адрес №1", color: "#6E9184", bookingUrl: null, verifiedForPublication: false,
    offers: [
      { id: "a-first", name: "Первичная очная консультация", format: "offline", minutes: 60, priceRub: 4500 },
      { id: "a-return", name: "Повторная очная консультация", format: "offline", minutes: 40, priceRub: 3000 },
    ] },
  { id: "demo-clinic-b", name: "Клиника «Центр» (демо)", address: "Вымышленный адрес №2", color: "#B89078", bookingUrl: null, verifiedForPublication: false,
    offers: [
      { id: "b-first", name: "Первичная очная консультация", format: "offline", minutes: 60, priceRub: 5000 },
      { id: "b-online", name: "Повторная дистанционная консультация*", format: "online", minutes: 30, priceRub: 2800 },
    ] },
  { id: "demo-clinic-c", name: "Клиника «Юг» (демо)", address: "Вымышленный адрес №3", color: "#9B8DAE", bookingUrl: null, verifiedForPublication: false,
    offers: [{ id: "c-return", name: "Повторная очная консультация", format: "offline", minutes: 45, priceRub: 3500 }] },
]);
export const DEMO_BUSY_BLOCKS = Object.freeze([
  { id: "busy-a-1", clinicId: "demo-clinic-a", day: "2026-11-09", start: "10:00", end: "14:00" },
  { id: "busy-b-1", clinicId: "demo-clinic-b", day: "2026-11-10", start: "12:00", end: "17:00" },
  { id: "busy-c-1", clinicId: "demo-clinic-c", day: "2026-11-11", start: "10:00", end: "13:00" },
  { id: "busy-a-2", clinicId: "demo-clinic-a", day: "2026-11-12", start: "15:00", end: "19:00" },
  { id: "busy-b-2", clinicId: "demo-clinic-b", day: "2026-11-13", start: "10:00", end: "16:00" },
]);
export function filterOffers(clinics, { clinicId = "all", format = "all" } = {}) {
  return clinics.filter(clinic => clinicId === "all" || clinic.id === clinicId)
    .flatMap(clinic => clinic.offers
      .filter(offer => offer.status !== "archived" && (format === "all" || offer.format === format))
      .map(offer => ({ ...offer, clinicId: clinic.id, clinicName: clinic.name, address: clinic.address, color: clinic.color,
        bookingUrl: clinic.bookingUrl, verifiedForPublication: clinic.verifiedForPublication })));
}
export function toMondayUTC(dateString) {
  const d = new Date(dateString + "T12:00:00Z");
  if (Number.isNaN(d.valueOf())) throw new Error("Некорректная дата");
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
  return d.toISOString().slice(0,10);
}
export function addDaysUTC(dayString, count) {
  const d = new Date(dayString + "T12:00:00Z");
  if (Number.isNaN(d.valueOf())) throw new Error("Некорректная дата");
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0,10);
}
export function busyBlocksForWeek(blocks, monday, clinicId = "all") {
  const through = addDaysUTC(monday, 7);
  return blocks.filter(block => block.day >= monday && block.day < through && (clinicId === "all" || block.clinicId === clinicId));
}
// В реальной интеграции нужны проверенные полномочия клиники, врача и URL. Здесь всегда false.
export function canPublishBookingLink({ clinicApproved = false, doctorAuthorized = false, bookingUrl = null } = {}) {
  if (!clinicApproved || !doctorAuthorized || !bookingUrl) return false;
  try { const u = new URL(bookingUrl); return u.protocol === "https:" && u.hostname.includes(".") && !u.username && !u.password; }
  catch { return false; }
}
export const rubles = value => new Intl.NumberFormat("ru-RU", { style:"currency", currency:"RUB", maximumFractionDigits:0 }).format(value);
