const brandKey = import.meta.env.VITE_APP_BRAND || "tochka-opory";
const isAnMed = brandKey === "anmed";
const isPneumo = brandKey === "pneumointegration";
const isPilot = isAnMed || isPneumo;

export const APP_BRAND = Object.freeze({
  isAnMed,
  isPneumo,
  isPilot,
  brandKey,
  name: isAnMed ? "АнМед" : isPneumo ? "Институт ПневмоИнтеграции" : "Точка опоры",
  title: isAnMed ? "АнМед — тестовый сайт" : isPneumo ? "Институт ПневмоИнтеграции — тестовый сайт" : "Точка опоры",
  subtitle: isAnMed ? "Многопрофильная клиника" : isPneumo ? "Психологическая поддержка" : "Анонимно. Безопасно. Можно просто поговорить.",
  pilotNotice: isAnMed
    ? "Закрытое тестирование. Используйте только вымышленные данные; не вводите сведения реальных пациентов."
    : isPneumo
      ? "Закрытое тестирование для специалистов института. Используйте только вымышленные данные; не вводите сведения реальных пациентов."
      : null,
  logoHeader: isAnMed ? null : isPneumo ? "/logo-pneumointegration-header.jpg" : "/logo-tochka-opory-header.png",
});
