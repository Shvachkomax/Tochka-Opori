const brandKey = import.meta.env.VITE_APP_BRAND || "tochka-opory";
const isAnMed = brandKey === "anmed";
const isKgmu = brandKey === "kgmu";
const isPneumo = brandKey === "pneumointegration";
const isPilot = isAnMed || isKgmu || isPneumo;

export const APP_BRAND = Object.freeze({
  isAnMed,
  isKgmu,
  isPneumo,
  isPilot,
  isSupportPilot: isPilot,
  brandKey,
  name: isKgmu ? "Казанский ГМУ" : isAnMed ? "АнМед" : isPneumo ? "Институт ПневмоИнтеграции" : "Точка опоры",
  title: isKgmu
    ? "Казанский ГМУ — тестирование «Точки Опоры»"
    : isAnMed
      ? "АнМед — тестовый сайт"
      : isPneumo
        ? "Институт ПневмоИнтеграции — тестовый сайт"
        : "Точка опоры",
  subtitle: isKgmu
    ? "Кафедра психиатрии и медицинской психологии"
    : isAnMed
      ? "Многопрофильная клиника"
      : isPneumo
        ? "Психологическая поддержка"
        : "Анонимно. Безопасно. Можно просто поговорить.",
  pilotNotice: isPilot
    ? isPneumo
      ? "Закрытое тестирование для специалистов института. Используйте только вымышленные данные; не вводите сведения реальных пациентов."
      : "Закрытое тестирование. Используйте только вымышленные данные; не вводите сведения реальных пациентов."
    : null,
  logoHeader: isPneumo ? "/logo-pneumointegration-header.jpg" : null,
});
