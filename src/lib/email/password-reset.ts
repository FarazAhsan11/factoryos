import { getTransport, fromAddress } from "./transport";

const BRAND = "#2563EB";
const INK = "#0F1B34";
const MUTED = "#64748B";

interface ResetEmailInput {
  to: string;
  code: string;
}

/**
 * Branded HTML for the password-reset code. Table-based with inline styles so
 * it renders consistently across email clients.
 */
export function renderPasswordResetEmail({ code }: { code: string }) {
  const brandTile = `
    <span style="display:inline-block;width:28px;height:28px;line-height:28px;text-align:center;background:${BRAND};color:#ffffff;border-radius:8px;font-weight:700;font-size:16px;vertical-align:middle;">F</span>
    <span style="display:inline-block;margin-left:8px;font-size:18px;font-weight:700;color:${INK};vertical-align:middle;">Factory<span style="color:${BRAND};">OS</span></span>`;

  const digits = code
    .split("")
    .map(
      (d) =>
        `<span style="display:inline-block;min-width:20px;padding:0 4px;">${d}</span>`
    )
    .join("");

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#F6F8FC;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F8FC;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px;max-width:100%;background:#ffffff;border:1px solid #E6EAF1;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:24px 28px;border-bottom:1px solid #EEF1F6;">${brandTile}</td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <div style="font-size:20px;font-weight:700;color:${INK};">Reset your password</div>
                <p style="margin:12px 0 8px;font-size:15px;line-height:1.6;color:#334155;">
                  Use this code to reset your FactoryOS password. It expires in
                  1 hour.
                </p>

                <div style="margin:20px 0;padding:16px;background:#F5F8FF;border:1px solid #DCE7FF;border-radius:12px;text-align:center;font-size:30px;font-weight:700;letter-spacing:6px;color:${BRAND};">
                  ${digits}
                </div>

                <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:${MUTED};">
                  If you didn't request a password reset, you can safely ignore
                  this email — your password won't change.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px;border-top:1px solid #EEF1F6;font-size:12px;color:#94A3B8;">
                FactoryOS · automated security email
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Sends the 6-digit reset code. Throws if SMTP is misconfigured. */
export async function sendPasswordResetEmail(input: ResetEmailInput) {
  const html = renderPasswordResetEmail({ code: input.code });
  await getTransport().sendMail({
    from: fromAddress(),
    to: input.to,
    subject: `Your FactoryOS password reset code: ${input.code}`,
    html,
  });
}
