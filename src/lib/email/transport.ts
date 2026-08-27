import nodemailer from "nodemailer";

/**
 * Shared nodemailer transport, built from SMTP_* env vars. Server-only.
 * Configure via .env.local (see .env.example). For Gmail use an App Password.
 */
let cached: nodemailer.Transporter | null = null;

export function getTransport() {
  if (cached) return cached;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 465);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error(
      "SMTP is not configured. Set SMTP_HOST, SMTP_USER and SMTP_PASS in .env.local.",
    );
  }

  cached = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // 465 = implicit TLS; 587 = STARTTLS
    auth: { user, pass },
  });

  return cached;
}

export function fromAddress() {
  return process.env.SMTP_FROM ?? "FactoryOS <no-reply@factoryos.com>";
}
