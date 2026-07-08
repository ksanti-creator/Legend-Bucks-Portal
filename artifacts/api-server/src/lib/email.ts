import { ReplitConnectors } from "@replit/connectors-sdk";

const APP_URL = process.env.APP_URL ?? "https://legend-bucks-portal.replit.app";
// Optional display From header, e.g. `Legend Bucks <rewards@legendboats.com>`.
// Gmail only honors it if the address is the authorized account or a configured
// "send as" alias; otherwise Gmail sends from the authenticated account.
const GMAIL_FROM = process.env.GMAIL_FROM;

interface GmailSendResponse {
  id?: string;
  error?: { message?: string };
}

/** Encode a UTF-8 string as base64url (RFC 4648 §5) for the Gmail `raw` field. */
function toBase64Url(input: string): string {
  return Buffer.from(input, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * MIME encoded-word encode a header value if it contains non-ASCII characters
 * (RFC 2047, base64/UTF-8 form). Email headers are ASCII-only, so raw UTF-8
 * bytes (e.g. emoji, accented names) would otherwise arrive garbled. Pure-ASCII
 * values are returned unchanged so ordinary subjects are untouched.
 */
export function encodeHeaderValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf-8").toString("base64")}?=`;
}

/**
 * Encode the display-name portion of a `From` header while leaving the
 * `<address>` (which must stay ASCII) intact. Handles both the
 * `Name <addr@example.com>` and bare-address forms.
 */
export function encodeFromHeader(from: string): string {
  const match = /^(.*?)\s*(<[^>]+>)\s*$/.exec(from);
  if (!match) return encodeHeaderValue(from);
  const [, name, address] = match;
  if (!name) return address;
  return `${encodeHeaderValue(name)} ${address}`;
}

/**
 * Send an HTML email via the Gmail API (connector proxy). The message is sent
 * from the authorized Google account.
 */
async function sendGmail(to: string, subject: string, html: string): Promise<void> {
  const connectors = new ReplitConnectors();

  const headers = [
    `To: ${to}`,
    `Subject: ${encodeHeaderValue(subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
  ];
  if (GMAIL_FROM) headers.unshift(`From: ${encodeFromHeader(GMAIL_FROM)}`);

  const raw = toBase64Url(`${headers.join("\r\n")}\r\n\r\n${html}`);

  const response = await connectors.proxy("google-mail", "/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });

  const data = (await response.json()) as GmailSendResponse;

  if (!response.ok) {
    throw new Error(`Failed to send email: ${data.error?.message ?? response.status}`);
  }
}

/**
 * Escape a string for safe interpolation into HTML email bodies, preventing
 * markup/content injection from user- or admin-supplied fields (notes, names,
 * reward titles, etc.).
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Send a magic-link login email via Gmail.
 */
export async function sendMagicLinkEmail(
  to: string,
  firstName: string,
  token: string,
): Promise<void> {
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
                Hi ${escapeHtml(firstName)},
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

  await sendGmail(to, "Your Legend Bucks sign-in link", html);
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
                Hi ${escapeHtml(firstName)},
              </p>
              <p style="margin:0 0 16px;color:#4f4f51;font-size:16px;line-height:1.6;">
                <strong>${escapeHtml(invitedBy)}</strong> has invited you to join <strong>Legend Bucks</strong> — Legend Boats' employee rewards platform.
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

  await sendGmail(to, `${invitedBy} invited you to Legend Bucks`, html);
}

/**
 * Wrap body content in the shared Legend Bucks branded email shell.
 */
function emailShell(title: string, bodyHtml: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
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
              ${bodyHtml}
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
}

/**
 * Send an already-rendered branded HTML email via Gmail, throwing on failure
 * with a contextual label.
 */
async function sendBrandedEmail(to: string, subject: string, html: string, errorLabel: string): Promise<void> {
  try {
    await sendGmail(to, subject, html);
  } catch (err) {
    throw new Error(`${errorLabel}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Format an integer Legend Bucks amount, e.g. 1250 -> "1,250 LB".
 */
function formatBucks(amount: number): string {
  return `${amount.toLocaleString("en-US")} LB`;
}

/**
 * Notify a recipient that they were awarded Legend Bucks.
 */
export async function sendBucksReceivedEmail(
  to: string,
  firstName: string,
  senderName: string,
  amount: number,
  note: string | null,
): Promise<void> {
  const noteBlock = note
    ? `<p style="margin:0 0 8px;color:#888;font-size:13px;line-height:1.5;">Their note:</p>
       <p style="margin:0 0 28px;color:#4f4f51;font-size:16px;line-height:1.6;font-style:italic;background:#f5f5f5;padding:14px 18px;border-radius:6px;border-left:4px solid #00afed;">
         “${escapeHtml(note)}”
       </p>`
    : "";

  const html = emailShell(
    "You received Legend Bucks",
    `<p style="margin:0 0 16px;color:#4f4f51;font-size:16px;line-height:1.6;">
       Hi ${escapeHtml(firstName)},
     </p>
     <p style="margin:0 0 24px;color:#4f4f51;font-size:16px;line-height:1.6;">
       <strong>${escapeHtml(senderName)}</strong> just recognized your work with Legend Bucks.
     </p>
     <table cellpadding="0" cellspacing="0" style="margin:0 auto 28px;">
       <tr>
         <td style="background:#f5f5f5;border-radius:8px;padding:24px 40px;text-align:center;">
           <p style="margin:0;color:#00afed;font-size:34px;font-weight:700;letter-spacing:-0.5px;">+${formatBucks(amount)}</p>
         </td>
       </tr>
     </table>
     ${noteBlock}
     <p style="margin:0;color:#aaa;font-size:12px;line-height:1.6;">
       Sign in to Legend Bucks to see your balance and redeem rewards.
     </p>`,
  );

  await sendBrandedEmail(to, `You received ${formatBucks(amount)}! 🎉`, html, "Failed to send bucks-received email");
}

/**
 * Send a redemption "receipt" to the employee who redeemed a reward.
 */
export async function sendRedemptionReceiptEmail(
  to: string,
  firstName: string,
  rewardName: string,
  buckCost: number,
  date: Date,
  status: string,
): Promise<void> {
  const dateLabel = date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);

  const html = emailShell(
    "Your Legend Bucks redemption receipt",
    `<p style="margin:0 0 16px;color:#4f4f51;font-size:16px;line-height:1.6;">
       Hi ${escapeHtml(firstName)},
     </p>
     <p style="margin:0 0 24px;color:#4f4f51;font-size:16px;line-height:1.6;">
       Here's your receipt for the reward you just redeemed.
     </p>
     <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;background:#f5f5f5;border-radius:8px;">
       <tr>
         <td style="padding:16px 20px;border-bottom:1px solid #e0e0e0;color:#888;font-size:13px;">Reward</td>
         <td style="padding:16px 20px;border-bottom:1px solid #e0e0e0;color:#4f4f51;font-size:15px;font-weight:700;text-align:right;">${escapeHtml(rewardName)}</td>
       </tr>
       <tr>
         <td style="padding:16px 20px;border-bottom:1px solid #e0e0e0;color:#888;font-size:13px;">Cost</td>
         <td style="padding:16px 20px;border-bottom:1px solid #e0e0e0;color:#4f4f51;font-size:15px;font-weight:700;text-align:right;">${formatBucks(buckCost)}</td>
       </tr>
       <tr>
         <td style="padding:16px 20px;border-bottom:1px solid #e0e0e0;color:#888;font-size:13px;">Date</td>
         <td style="padding:16px 20px;border-bottom:1px solid #e0e0e0;color:#4f4f51;font-size:15px;font-weight:700;text-align:right;">${dateLabel}</td>
       </tr>
       <tr>
         <td style="padding:16px 20px;color:#888;font-size:13px;">Status</td>
         <td style="padding:16px 20px;color:#4f4f51;font-size:15px;font-weight:700;text-align:right;">${escapeHtml(statusLabel)}</td>
       </tr>
     </table>
     <p style="margin:0;color:#aaa;font-size:12px;line-height:1.6;">
       Sign in to Legend Bucks to track the status of your redemption.
     </p>`,
  );

  await sendBrandedEmail(to, `Redemption receipt: ${rewardName}`, html, "Failed to send redemption receipt email");
}

/**
 * Notify an employee that their redemption was approved.
 */
export async function sendRedemptionApprovedEmail(
  to: string,
  firstName: string,
  rewardName: string,
): Promise<void> {
  const html = emailShell(
    "Your redemption was approved",
    `<p style="margin:0 0 16px;color:#4f4f51;font-size:16px;line-height:1.6;">
       Hi ${escapeHtml(firstName)},
     </p>
     <p style="margin:0 0 24px;color:#4f4f51;font-size:16px;line-height:1.6;">
       Good news — your redemption for <strong>${escapeHtml(rewardName)}</strong> has been <strong style="color:#35b729;">approved</strong>. We'll let you know once it's on its way.
     </p>
     <p style="margin:0;color:#aaa;font-size:12px;line-height:1.6;">
       Sign in to Legend Bucks to track the status of your redemption.
     </p>`,
  );

  await sendBrandedEmail(to, `Approved: ${rewardName}`, html, "Failed to send redemption approved email");
}

/**
 * Notify an employee that their redemption was rejected (bucks refunded).
 */
export async function sendRedemptionRejectedEmail(
  to: string,
  firstName: string,
  rewardName: string,
  buckCost: number,
  adminNote: string | null,
): Promise<void> {
  const noteBlock = adminNote
    ? `<p style="margin:0 0 8px;color:#888;font-size:13px;line-height:1.5;">Reason:</p>
       <p style="margin:0 0 28px;color:#4f4f51;font-size:16px;line-height:1.6;font-style:italic;background:#f5f5f5;padding:14px 18px;border-radius:6px;border-left:4px solid #d64545;">
         “${escapeHtml(adminNote)}”
       </p>`
    : "";

  const html = emailShell(
    "Your redemption was not approved",
    `<p style="margin:0 0 16px;color:#4f4f51;font-size:16px;line-height:1.6;">
       Hi ${escapeHtml(firstName)},
     </p>
     <p style="margin:0 0 24px;color:#4f4f51;font-size:16px;line-height:1.6;">
       Unfortunately, your redemption for <strong>${escapeHtml(rewardName)}</strong> was <strong style="color:#d64545;">not approved</strong>. Your <strong>${formatBucks(buckCost)}</strong> has been refunded to your balance.
     </p>
     ${noteBlock}
     <p style="margin:0;color:#aaa;font-size:12px;line-height:1.6;">
       Sign in to Legend Bucks to browse other rewards.
     </p>`,
  );

  await sendBrandedEmail(to, `Update on your redemption: ${rewardName}`, html, "Failed to send redemption rejected email");
}

/**
 * Notify an employee that their redemption was fulfilled / shipped.
 */
export async function sendRedemptionFulfilledEmail(
  to: string,
  firstName: string,
  rewardName: string,
): Promise<void> {
  const html = emailShell(
    "Your reward is on its way",
    `<p style="margin:0 0 16px;color:#4f4f51;font-size:16px;line-height:1.6;">
       Hi ${escapeHtml(firstName)},
     </p>
     <p style="margin:0 0 24px;color:#4f4f51;font-size:16px;line-height:1.6;">
       Your redemption for <strong>${escapeHtml(rewardName)}</strong> has been <strong style="color:#35b729;">fulfilled</strong> and is on its way to you. 🎉
     </p>
     <p style="margin:0;color:#aaa;font-size:12px;line-height:1.6;">
       Sign in to Legend Bucks to see your redemption history.
     </p>`,
  );

  await sendBrandedEmail(to, `On its way: ${rewardName}`, html, "Failed to send redemption fulfilled email");
}
