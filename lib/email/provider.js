const PROVIDERS = {
  console: {
    async sendEmail({ to, subject }) {
      console.log("[email:console] To:", to, "Subject:", subject);
      return { success: true, messageId: `console-${Date.now()}` };
    },
  },

  resend: {
    async sendEmail({ to, subject, bodyText, from, replyTo }) {
      const apiKey = process.env.COUNCIL_EMAIL_API_KEY;
      if (!apiKey) {
        console.log("[email:resend] API key missing");
        return { success: false, error: "COUNCIL_EMAIL_API_KEY not configured" };
      }
      try {
        const payload = {
          from: from || process.env.COUNCIL_EMAIL_FROM || "noreply@tochka-opori.online",
          to,
          subject,
          text: bodyText || "",
        };
        const rt = replyTo || process.env.COUNCIL_EMAIL_REPLY_TO;
        if (rt) payload.reply_to = rt;

        console.log("[email:resend] Calling Resend API");
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        const data = await res.json();
        console.log("[email:resend] Response status:", res.status, "has id:", Boolean(data && data.id));
        if (!res.ok) {
          console.log("[email:resend] Error response:", data);
          return { success: false, error: data.message || data.error || `HTTP ${res.status}` };
        }
        return { success: true, messageId: data.id };
      } catch (err) {
        console.log("[email:resend] Fetch error:", err.message);
        return { success: false, error: err.message };
      }
    },
  },
};

const DEFAULT_PROVIDER = "console";

export function getEmailProvider() {
  const raw = process.env.COUNCIL_EMAIL_PROVIDER || "";
  const name = raw.toLowerCase();
  const provider = PROVIDERS[name];
  console.log("[email] COUNCIL_EMAIL_PROVIDER present:", raw.length > 0);
  console.log("[email] Resolved provider:", name || "console (default)");
  console.log("[email] API key configured:", Boolean(process.env.COUNCIL_EMAIL_API_KEY));
  console.log("[email] API key prefix re_:", (process.env.COUNCIL_EMAIL_API_KEY || "").startsWith("re_"));
  console.log("[email] COUNCIL_EMAIL_FROM present:", Boolean(process.env.COUNCIL_EMAIL_FROM));
  console.log("[email] COUNCIL_EMAIL_REPLY_TO present:", Boolean(process.env.COUNCIL_EMAIL_REPLY_TO));
  console.log("[email] COUNCIL_EMAIL_TEST_TO configured:", Boolean(process.env.COUNCIL_EMAIL_TEST_TO));
  if (!provider) {
    console.warn(`[email] Unknown provider "${name}", falling back to console`);
    return PROVIDERS.console;
  }
  return provider;
}

export async function sendEmail({ to, subject, bodyText }) {
  const provider = getEmailProvider();
  const from = process.env.COUNCIL_EMAIL_FROM;
  const replyTo = process.env.COUNCIL_EMAIL_REPLY_TO;
  console.log("[email] Called sendEmail, provider:", Object.keys(PROVIDERS).join(","));
  console.log("[email] from present:", Boolean(from));
  const result = await provider.sendEmail({ to, subject, bodyText, from, replyTo });
  console.log("[email] sendEmail result success:", result.success);
  return result;
}
