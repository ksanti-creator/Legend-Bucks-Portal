import { ReplitConnectors } from "@replit/connectors-sdk";

const FROM_ADDRESS = "Legend Bucks <noreply@legendboats.com>";
const APP_URL = process.env.APP_URL ?? "https://legendbucks.replit.app";

interface ResendResponse {
  id?: string;
  message?: string;
}

/**
 * Send a magic-link login email via Resend.
 */
export async function sendMagicLinkEmail(
  to: string,
  firstName: string,
  token: string,
): Promise<void> {
  const connectors = new ReplitConnectors();

  const loginUrl = `${APP_URL}/login?token=${encodeURIComponent(token)}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sign in to Legend Bucks</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#00afed 0%,#0090cc 100%);padding:36px 40px 28px;">
              <p style="margin:0;color:#ffffff;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;opacity:0.8;">LEGEND BOATS</p>
              <h1 style="margin:8px 0 0;color:#ffffff;font-size:28px;font-weight:700;letter-spacing:-0.5px;">Legend Bucks</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <p style="margin:0 0 16px;color:#4f4f51;font-size:16px;line-height:1.6;">
                Hi ${firstName},
              </p>
              <p style="margin:0 0 28px;color:#4f4f51;font-size:16px;line-height:1.6;">
                Click the button below to sign in to Legend Bucks. This link expires in <strong>15 minutes</strong> and can only be used once.
              </p>
              <table cellpadding="0" cellspacing="0" style="margin:0 auto 28px;">
                <tr>
                  <td style="background:#00afed;border-radius:6px;">
                    <a href="${loginUrl}"
                       style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.3px;">
                      Sign In to Legend Bucks →
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;color:#888;font-size:13px;line-height:1.5;">
                Or copy and paste this token into the app:
              </p>
              <p style="margin:0 0 28px;font-family:monospace;font-size:18px;font-weight:700;letter-spacing:4px;color:#4f4f51;background:#f5f5f5;padding:12px 16px;border-radius:4px;border:1px solid #e0e0e0;">
                ${token}
              </p>
              <p style="margin:0;color:#aaa;font-size:12px;line-height:1.6;">
                If you didn't request this, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#4f4f51;padding:20px 40px;">
              <p style="margin:0;color:#ffffff;font-size:12px;opacity:0.6;">
                © ${new Date().getFullYear()} Legend Boats Inc. — Internal use only.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const response = await connectors.proxy("resend", "/emails", {
    method: "POST",
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [to],
      subject: "Your Legend Bucks sign-in link",
      html,
    }),
  });

  const data = (await response.json()) as ResendResponse;

  if (!response.ok) {
    throw new Error(`Failed to send email: ${data.message ?? response.status}`);
  }
}

/**
 * Send an invitation email to a newly-created employee.
 */
export async function sendInviteEmail(
  to: string,
  firstName: string,
  invitedBy: string,
  token: string,
): Promise<void> {
  const connectors = new ReplitConnectors();

  const acceptUrl = `${APP_URL}/login?token=${encodeURIComponent(token)}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>You're invited to Legend Bucks</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#00afed 0%,#0090cc 100%);padding:36px 40px 28px;">
              <p style="margin:0;color:#ffffff;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;opacity:0.8;">LEGEND BOATS</p>
              <h1 style="margin:8px 0 0;color:#ffffff;font-size:28px;font-weight:700;letter-spacing:-0.5px;">Legend Bucks</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <p style="margin:0 0 16px;color:#4f4f51;font-size:16px;line-height:1.6;">
                Hi ${firstName},
              </p>
              <p style="margin:0 0 16px;color:#4f4f51;font-size:16px;line-height:1.6;">
                <strong>${invitedBy}</strong> has invited you to join <strong>Legend Bucks</strong> — Legend Boats' employee rewards platform.
              </p>
              <p style="margin:0 0 28px;color:#4f4f51;font-size:16px;line-height:1.6;">
                Earn recognition, redeem rewards, and contribute to team goals. Click below to accept your invitation and set up your account.
              </p>
              <table cellpadding="0" cellspacing="0" style="margin:0 auto 28px;">
                <tr>
                  <td style="background:#35b729;border-radius:6px;">
                    <a href="${acceptUrl}"
                       style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.3px;">
                      Accept Invitation →
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;color:#888;font-size:13px;line-height:1.5;">
                Or copy and paste this token into the app:
              </p>
              <p style="margin:0 0 28px;font-family:monospace;font-size:18px;font-weight:700;letter-spacing:4px;color:#4f4f51;background:#f5f5f5;padding:12px 16px;border-radius:4px;border:1px solid #e0e0e0;">
                ${token}
              </p>
              <p style="margin:0;color:#aaa;font-size:12px;line-height:1.6;">
                This invitation link expires in 15 minutes. If you weren't expecting this, you can safely ignore it.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#4f4f51;padding:20px 40px;">
              <p style="margin:0;color:#ffffff;font-size:12px;opacity:0.6;">
                © ${new Date().getFullYear()} Legend Boats Inc. — Internal use only.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const response = await connectors.proxy("resend", "/emails", {
    method: "POST",
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [to],
      subject: `${invitedBy} invited you to Legend Bucks`,
      html,
    }),
  });

  const data = (await response.json()) as ResendResponse;

  if (!response.ok) {
    throw new Error(`Failed to send invite email: ${data.message ?? response.status}`);
  }
}
