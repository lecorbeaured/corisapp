import nodemailer from "nodemailer";

export type Mailer = {
  send: (to: string, subject: string, text: string) => Promise<void>;
};

export function createMailer(): Mailer {
  const host = (process.env.SMTP_HOST ?? "").trim();
  const port = Number(process.env.SMTP_PORT ?? "587");
  const user = (process.env.SMTP_USER ?? "").trim();
  const pass = (process.env.SMTP_PASS ?? "").trim();
  const from = (process.env.SMTP_FROM ?? "CORIS <no-reply@coris.local>").trim();

  // If SMTP is not configured, fall back to console logging.
  if (!host || !user || !pass) {
    return {
      async send(to, subject, text) {
        // eslint-disable-next-line no-console
        console.log("[MAILER:DEV_FALLBACK]", { to, subject, text });
        // This is intentionally not throwing, so dev can proceed.
      }
    };
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    auth: { user, pass }
  });

  return {
    async send(to, subject, text) {
      await transporter.sendMail({ from, to, subject, text });
    }
  };
}
