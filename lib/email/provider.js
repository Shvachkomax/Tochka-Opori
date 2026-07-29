const PROVIDERS = {
  console: {
    async sendEmail({ to, toName, subject }) {
      console.log("[email:console] To:", to, "Name:", toName || "—", "Subject:", subject);
      return { success: true, messageId: `console-${Date.now()}` };
    },
  },

  resend: {
    async sendEmail({ to, toName, subject, bodyText, from, replyTo }) {
      const apiKey = process.env.COUNCIL_EMAIL_API_KEY;
      if (!apiKey) {
        return { success: false, error: "COUNCIL_EMAIL_API_KEY not configured" };
      }
      try {
        const payload = {
          from: from || process.env.COUNCIL_EMAIL_FROM || "noreply@tochka-opori.online",
          to: [to],
          subject,
          text: bodyText || "",
        };
        if (replyTo) payload.reply_to = replyTo;
        if (toName) payload.to = [{ email: to, name: toName }];
        if (process.env.COUNCIL_EMAIL_REPLY_TO) {
          payload.reply_to = process.env.COUNCIL_EMAIL_REPLY_TO;
        }

        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        const data = await res.json();
        if (!res.ok) {
          return { success: false, error: data.message || data.error || `HTTP ${res.status}` };
        }
        return { success: true, messageId: data.id };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  },
};

const DEFAULT_PROVIDER = "console";

export function getEmailProvider() {
  const name = (process.env.COUNCIL_EMAIL_PROVIDER || DEFAULT_PROVIDER).toLowerCase();
  const provider = PROVIDERS[name];
  if (!provider) {
    console.warn(`[email] Unknown provider "${name}", falling back to console`);
    return PROVIDERS.console;
  }
  return provider;
}

export async function sendEmail({ to, toName, subject, bodyText }) {
  const provider = getEmailProvider();
  const from = process.env.COUNCIL_EMAIL_FROM;
  const replyTo = process.env.COUNCIL_EMAIL_REPLY_TO;
  return provider.sendEmail({ to, toName, subject, bodyText, from, replyTo });
}
