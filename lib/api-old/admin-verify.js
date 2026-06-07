export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { password } = req.body || {};

    if (!password || !process.env.ADMIN_SECRET) {
      return res.status(401).json({ ok: false, error: "Нет доступа" });
    }

    if (password !== process.env.ADMIN_SECRET) {
      return res.status(403).json({ ok: false, error: "Неверный пароль" });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Ошибка проверки",
    });
  }
}
