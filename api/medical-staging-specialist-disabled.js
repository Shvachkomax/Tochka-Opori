export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(503).json({ ok: false, code: "MEDICAL_STAGING_DATA_DISABLED", error: "Medical staging patient data access is disabled" });
}
