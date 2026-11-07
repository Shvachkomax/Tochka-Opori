// Расчёт тарифной модели «Моя практика». НЕ денежный журнал и НЕ платёжный API.
// 20% от подтверждённой суммы платной услуги; другие 25% за AI-трафик учитываются отдельно.
export const MY_PRACTICE_DEFAULT_FEE_BPS = 2000;
export const BASIS_POINTS = 10000;
const MAX_KOPECKS = 100000000000; // 1 млрд рублей для защиты арифметики в сценариях модели

function validateAmount(amount, label) {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_KOPECKS) {
    throw new RangeError(label + ": ожидается неотрицательная целая сумма в копейках.");
  }
}

function validateRate(rateBps) {
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > BASIS_POINTS) {
    throw new RangeError("Комиссия должна быть в диапазоне 0–100%.");
  }
}

/**
 * Предварительный расчёт. Доля «клинике» здесь означает расчёт с ЮЛ,
 * выступающим исполнителем услуги, а не автоматически гонорар врачу.
 * Эквайринг, налоги и расходы не вычтены.
 */
export function quotePracticeCommission(priceKopecks, rateBps = MY_PRACTICE_DEFAULT_FEE_BPS) {
  validateAmount(priceKopecks, "Стоимость услуги");
  validateRate(rateBps);
  const feeKopecks = Math.round(priceKopecks * rateBps / BASIS_POINTS);
  return Object.freeze({
    priceKopecks,
    feeBps: rateBps,
    platformFeeKopecks: feeKopecks,
    organizationShareKopecks: priceKopecks - feeKopecks,
  });
}

/**
 * Тестовый расчёт удержания и возврата.
 * При неполученном платеже или незавершённой услуге комиссия НЕ доступна к выплате.
 * Подтверждение платежа должно приходить исключительно от сервера/провайдера.
 */
export function simulatePracticeSettlement({
  grossPaidKopecks,
  refundedKopecks = 0,
  paymentConfirmed = false,
  serviceCompleted = false,
  holdReleased = false,
  rateBps = MY_PRACTICE_DEFAULT_FEE_BPS,
}) {
  validateAmount(grossPaidKopecks, "Оплаченная сумма");
  validateAmount(refundedKopecks, "Возврат");
  if (refundedKopecks > grossPaidKopecks) throw new RangeError("Возврат превышает исходный платёж.");
  const original = quotePracticeCommission(grossPaidKopecks, rateBps);
  const net = quotePracticeCommission(grossPaidKopecks - refundedKopecks, rateBps);
  const available = paymentConfirmed && serviceCompleted && holdReleased;
  return Object.freeze({
    original, net,
    reversedFeeKopecks: original.platformFeeKopecks - net.platformFeeKopecks,
    commissionStatus: available ? "payable" : paymentConfirmed ? "held" : "unconfirmed",
    payablePlatformFeeKopecks: available ? net.platformFeeKopecks : 0,
  });
}

export function formatPracticeRubles(kopecks) {
  validateAmount(kopecks, "Сумма");
  return new Intl.NumberFormat("ru-RU", {
    style: "currency", currency: "RUB", minimumFractionDigits: 0,
    maximumFractionDigits: kopecks % 100 === 0 ? 0 : 2,
  }).format(kopecks / 100);
}
