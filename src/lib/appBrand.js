const brand = import.meta.env.VITE_APP_BRAND;
const isAnMed = brand === "anmed";
const isKgmu = brand === "kgmu";

export const APP_BRAND = Object.freeze({
  isAnMed,
  isKgmu,
  isSupportPilot: isAnMed || isKgmu,
  name: isKgmu ? "Казанский ГМУ" : isAnMed ? "АнМед" : "Точка опоры",
  title: isKgmu ? "Казанский ГМУ — тестирование «Точки Опоры»" : isAnMed ? "АнМед — тестовый сайт" : "Точка опоры",
  subtitle: isKgmu ? "Кафедра психиатрии и медицинской психологии" : isAnMed ? "Многопрофильная клиника" : "Анонимно. Безопасно. Можно просто поговорить.",
  pilotNotice: "Закрытое тестирование. Используйте только вымышленные данные; не вводите сведения реальных пациентов.",
});
