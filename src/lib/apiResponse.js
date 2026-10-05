// Safe response parsing and error classification for API calls.
// Handles JSON and text responses, network errors, and timeout.

export async function parseApiResponse(res) {
  const contentType = res.headers.get("content-type") || "";
  const bodyText = await res.text();
  let json = null;
  if (contentType.includes("application/json") || bodyText.startsWith("{") || bodyText.startsWith("[")) {
    try { json = JSON.parse(bodyText); } catch {}
  }
  return { status: res.status, ok: res.ok, json, text: bodyText, contentType };
}

export function classifyHttpError(status, json, text) {
  if (status === 401) return { code: "UNAUTHORIZED", message: "Сессия истекла. Войдите снова по коду продолжения.", retryable: true };
  if (status === 403) return { code: "FORBIDDEN", message: "Нет доступа к этому действию.", retryable: false };
  if (status === 413) return { code: "PAYLOAD_TOO_LARGE", message: "Слишком большой запрос. Попробуйте уменьшить количество фото.", retryable: false };
  if (status === 429) return { code: "RATE_LIMITED", message: "Слишком много запросов. Подождите немного.", retryable: true };
  if (status >= 500) return { code: "SERVER_ERROR", message: json?.error || "Сервер временно недоступен. Попробуйте ещё раз.", retryable: true };
  return { code: "UNKNOWN", message: json?.error || text?.slice(0, 120) || "Неизвестная ошибка.", retryable: true };
}

export function classifyNetworkError(err) {
  return { code: "NETWORK_ERROR", message: "Нет соединения с сервером. Проверьте интернет и попробуйте ещё раз.", retryable: true, original: err?.message };
}

export function estimateRequestSize(body) {
  try {
    return new TextEncoder().encode(JSON.stringify(body)).length;
  } catch {
    return -1;
  }
}

export function countPhotos(dailyLog) {
  const photos = dailyLog?.plate_photos;
  return Array.isArray(photos) ? photos.length : 0;
}
