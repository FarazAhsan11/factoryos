import { getTransport, fromAddress } from "./transport";

const BRAND = "#2563EB";
const INK = "#0F1B34";
const MUTED = "#64748B";

interface InviteEmailInput {
  to: string;
  /** The admin's name, used in the greeting. */
  fullName?: string | null;
  factoryName: string;
  inviteUrl: string;
  /** Optional logo URL shown next to the factory name. */
  logoUrl?: string | null;
}

/**
 * Branded HTML for the factory-admin invite. Table-based with inline styles so
 * it renders consistently across email clients (Gmail, Outlook, Apple Mail).
 */
export function renderFactoryInviteEmail({
  fullName,
  factoryName,
  inviteUrl,
  logoUrl,
}: Omit<InviteEmailInput, "to">) {
  // Bulletproof brand header: a blue rounded "F" tile + wordmark (no SVG).
  const brandTile = `
    <span style="display:inline-block;width:28px;height:28px;line-height:28px;text-align:center;background:${BRAND};color:#ffffff;border-radius:8px;font-weight:700;font-size:16px;vertical-align:middle;">F</span>
    <span style="display:inline-block;margin-left:8px;font-size:18px;font-weight:700;color:${INK};vertical-align:middle;">Factory<span style="color:${BRAND};">OS</span></span>`;

  const factoryLogo = logoUrl
    ? `<img src="${logoUrl}" alt="" width="40" height="40" style="display:block;border-radius:10px;object-fit:cover;" />`
    : `<span style="display:inline-block;width:40px;height:40px;line-height:40px;text-align:center;background:#EFF4FF;color:${BRAND};border-radius:10px;font-weight:700;">${escapeHtml(
        factoryName.charAt(0).toUpperCase()
      )}</span>`;

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
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding-right:12px;">${factoryLogo}</td>
                    <td>
                      <div style="font-size:13px;color:${MUTED};">You've been invited to manage</div>
                      <div style="font-size:20px;font-weight:700;color:${INK};">${escapeHtml(
                        factoryName
                      )}</div>
                    </td>
                  </tr>
                </table>

                <p style="margin:24px 0 8px;font-size:15px;line-height:1.6;color:#334155;">
                  ${fullName ? `Hi ${escapeHtml(fullName)}, you're` : "You're"}
                  set up as the <strong>Factory Admin</strong> for
                  <strong>${escapeHtml(factoryName)}</strong> on FactoryOS.
                  Set a password to activate your account and open your dashboard.
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
              <td style="padding:18px 28px;border-top:1px solid #EEF1F6;font-size:12px;color:#94A3B8;">
                This invite was sent by a FactoryOS platform administrator. If you
                weren't expecting it, you can ignore this email.
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

/** Sends the branded invite email. Throws if SMTP is misconfigured. */
export async function sendFactoryInviteEmail(input: InviteEmailInput) {
  const html = renderFactoryInviteEmail(input);
  await getTransport().sendMail({
    from: fromAddress(),
    to: input.to,
    subject: `You're invited to manage ${input.factoryName} on FactoryOS`,
    html,
  });
}
