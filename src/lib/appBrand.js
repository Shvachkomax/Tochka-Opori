const isAnMed = import.meta.env.VITE_APP_BRAND === "anmed";

export const APP_BRAND = Object.freeze({
  isAnMed,
  name: isAnMed ? "АнМед" : "Точка опоры",
  title: isAnMed ? "АнМед — тестовый сайт" : "Точка опоры",
  subtitle: isAnMed ? "Многопрофильная клиника" : "Анонимно. Безопасно. Можно просто поговорить.",
  pilotNotice: "Закрытое тестирование. Используйте только вымышленные данные; не вводите сведения реальных пациентов.",
});
