import { getTransport, fromAddress } from "./transport";

const BRAND = "#4F46E5";
const INK = "#14162B";
const MUTED = "#6B7189";

interface EmployeeInviteInput {
  to: string;
  /** Shown in the greeting; falls back to a generic line when absent. */
  fullName?: string | null;
  factoryName: string;
  /** Human label for the role they were given ("Admin", "Operator"). */
  roleLabel: string;
  /** /auth/confirm link that lands them on set-password → their dashboard. */
  inviteUrl: string;
  logoUrl?: string | null;
}

/**
 * Branded HTML for a factory-member invite. Same table-based, inline-styled
 * shape as the factory-admin invite so both render identically across clients;
 * the copy differs because this one comes from their own factory's admin.
 */
export function renderEmployeeInviteEmail({
  fullName,
  factoryName,
  roleLabel,
  inviteUrl,
  logoUrl,
}: Omit<EmployeeInviteInput, "to">) {
  const brandTile = `
    <span style="display:inline-block;width:28px;height:28px;line-height:28px;text-align:center;background:${BRAND};color:#ffffff;border-radius:8px;font-weight:700;font-size:16px;vertical-align:middle;">F</span>
    <span style="display:inline-block;margin-left:8px;font-size:18px;font-weight:700;color:${INK};vertical-align:middle;">Factory<span style="color:${BRAND};">OS</span></span>`;

  const factoryLogo = logoUrl
    ? `<img src="${logoUrl}" alt="" width="40" height="40" style="display:block;border-radius:10px;object-fit:cover;" />`
    : `<span style="display:inline-block;width:40px;height:40px;line-height:40px;text-align:center;background:#EDEEFE;color:${BRAND};border-radius:10px;font-weight:700;">${escapeHtml(
        factoryName.charAt(0).toUpperCase(),
      )}</span>`;

  const greeting = fullName ? `Hi ${escapeHtml(fullName)},` : "Hi,";

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#EAEDF5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EAEDF5;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px;max-width:100%;background:#ffffff;border:1px solid #DCDFEC;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:24px 28px;border-bottom:1px solid #EEF1F6;">${brandTile}</td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding-right:12px;">${factoryLogo}</td>
                    <td>
                      <div style="font-size:13px;color:${MUTED};">You've been added to</div>
                      <div style="font-size:20px;font-weight:700;color:${INK};">${escapeHtml(
                        factoryName,
                      )}</div>
                    </td>
                  </tr>
                </table>

                <p style="margin:24px 0 8px;font-size:15px;line-height:1.6;color:#334155;">
                  ${greeting} your team added you to
                  <strong>${escapeHtml(factoryName)}</strong> on FactoryOS as
                  <strong>${escapeHtml(roleLabel)}</strong>.
                  Set a password to activate your account and open the factory
                  dashboard.
                </p>

                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
                  <tr>
                    <td style="border-radius:12px;background:${BRAND};">
                      <a href="${inviteUrl}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:12px;">
                        Set password &amp; open dashboard
                      </a>
                    </td>
                  </tr>
                </table>

                <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:${MUTED};">
                  If the button doesn't work, copy this link into your browser:<br/>
                  <a href="${inviteUrl}" style="color:${BRAND};word-break:break-all;">${inviteUrl}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px;border-top:1px solid #EEF1F6;font-size:12px;color:#9297AE;">
                This invite was sent by an administrator at ${escapeHtml(
                  factoryName,
                )}. If you weren't expecting it, you can ignore this email.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Sends the member invite. Throws if SMTP is misconfigured. */
export async function sendEmployeeInviteEmail(input: EmployeeInviteInput) {
  await getTransport().sendMail({
    from: fromAddress(),
    to: input.to,
    subject: `You've been added to ${input.factoryName} on FactoryOS`,
    html: renderEmployeeInviteEmail(input),
  });
}
