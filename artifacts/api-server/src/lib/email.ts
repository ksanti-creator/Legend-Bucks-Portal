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
            <td style="background:linear-gradient(135deg,#00afed 0%,#0090cc 100%);padding:28px 40px;text-align:center;">
              <img src="${APP_URL}/logos/legend-bucks-rewards-white.png" width="300" alt="Legend Bucks Rewards Program" style="display:block;width:300px;max-width:100%;height:auto;margin:0 auto;" />
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
  giftCard?: { cadValueCents: number; recipientName: string; recipientEmail: string; message: string | null },
): Promise<void> {
  const dateLabel = date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
  const giftCardRows = giftCard
    ? `<tr><td style="padding:16px 20px;border-bottom:1px solid #e0e0e0;color:#888;font-size:13px;">Gift card value</td><td style="padding:16px 20px;border-bottom:1px solid #e0e0e0;text-align:right;font-weight:700;">$${(giftCard.cadValueCents / 100).toFixed(2)} CAD</td></tr>
       <tr><td style="padding:16px 20px;border-bottom:1px solid #e0e0e0;color:#888;font-size:13px;">Recipient</td><td style="padding:16px 20px;border-bottom:1px solid #e0e0e0;text-align:right;font-weight:700;">${escapeHtml(giftCard.recipientName)} &lt;${escapeHtml(giftCard.recipientEmail)}&gt;</td></tr>
       ${giftCard.message ? `<tr><td style="padding:16px 20px;border-bottom:1px solid #e0e0e0;color:#888;font-size:13px;">Message</td><td style="padding:16px 20px;border-bottom:1px solid #e0e0e0;text-align:right;">${escapeHtml(giftCard.message)}</td></tr>` : ""}`
    : "";

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
        ${giftCardRows}
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
        ${giftCard ? "Gift cards are issued after approval and cannot be exchanged for cash." : "Sign in to Legend Bucks to track the status of your redemption."}
     </p>`,
  );

  await sendBrandedEmail(to, `Redemption receipt: ${rewardName}`, html, "Failed to send redemption receipt email");
}

/**
 * Notify an approver (admin or scoped manager) that a new redemption request
 * came in. Buck cost only — never include accounting-only CAD values here.
 */
export async function sendNewRedemptionRequestEmail(
  to: string,
  firstName: string,
  employeeName: string,
  rewardName: string,
  buckCost: number,
  note: string | null,
  sizeLabel: string | null = null,
): Promise<void> {
  const sizeRow = sizeLabel
    ? `<tr>
         <td style="padding:16px 20px;border-bottom:1px solid #e0e0e0;color:#888;font-size:13px;">Size</td>
         <td style="padding:16px 20px;border-bottom:1px solid #e0e0e0;color:#4f4f51;font-size:15px;font-weight:700;text-align:right;">${escapeHtml(sizeLabel)}</td>
       </tr>`
    : "";
  const noteBlock = note
    ? `<p style="margin:0 0 8px;color:#888;font-size:13px;line-height:1.5;">Their note:</p>
       <p style="margin:0 0 28px;color:#4f4f51;font-size:16px;line-height:1.6;font-style:italic;background:#f5f5f5;padding:14px 18px;border-radius:6px;border-left:4px solid #00afed;">
         “${escapeHtml(note)}”
       </p>`
    : "";

  const html = emailShell(
    "New redemption request",
    `<p style="margin:0 0 16px;color:#4f4f51;font-size:16px;line-height:1.6;">
       Hi ${escapeHtml(firstName)},
     </p>
     <p style="margin:0 0 24px;color:#4f4f51;font-size:16px;line-height:1.6;">
       <strong>${escapeHtml(employeeName)}</strong> just redeemed a reward and it's waiting in the Fulfillment Center.
     </p>
     <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;background:#f5f5f5;border-radius:8px;">
       <tr>
         <td style="padding:16px 20px;border-bottom:1px solid #e0e0e0;color:#888;font-size:13px;">Employee</td>
         <td style="padding:16px 20px;border-bottom:1px solid #e0e0e0;color:#4f4f51;font-size:15px;font-weight:700;text-align:right;">${escapeHtml(employeeName)}</td>
       </tr>
       <tr>
         <td style="padding:16px 20px;border-bottom:1px solid #e0e0e0;color:#888;font-size:13px;">Reward</td>
         <td style="padding:16px 20px;border-bottom:1px solid #e0e0e0;color:#4f4f51;font-size:15px;font-weight:700;text-align:right;">${escapeHtml(rewardName)}</td>
       </tr>
       ${sizeRow}
       <tr>
         <td style="padding:16px 20px;color:#888;font-size:13px;">Cost</td>
         <td style="padding:16px 20px;color:#4f4f51;font-size:15px;font-weight:700;text-align:right;">${formatBucks(buckCost)}</td>
       </tr>
     </table>
     ${noteBlock}
     <p style="margin:0;color:#aaa;font-size:12px;line-height:1.6;">
       Sign in to Legend Bucks to review this request in the Fulfillment Center.
     </p>`,
  );

  await sendBrandedEmail(to, `New redemption request: ${rewardName}`, html, "Failed to send new redemption request email");
}

/**
 * Notify an accounting admin (payroll) that a Time Off redemption is waiting
 * for their sign-off. Buck cost only — never include accounting-only CAD here
 * either, since this template flows through the same escaping rules.
 */
export async function sendTimeOffPayrollEmail(
  employeeName: string,
  employeeEmail: string,
  rewardName: string,
  rewardDescription: string | null,
  redemptionId: number,
): Promise<void> {
  const html = emailShell("Time Off approved — BambooHR action required",
    `<p style="color:#4f4f51;line-height:1.6;">Hi Payroll,</p>
     <p style="color:#4f4f51;line-height:1.6;">A Time Off reward has been approved. Please add the time specified by this reward to the team member's <strong>Time Off in Lieu</strong> balance in <strong>BambooHR</strong>.</p>
     <p>Team member: <strong>${escapeHtml(employeeName)}</strong><br />
     Account email: ${escapeHtml(employeeEmail)}<br />
     Reward: <strong>${escapeHtml(rewardName)}</strong><br />
     Request reference: #${redemptionId}</p>
     ${rewardDescription ? `<p>${escapeHtml(rewardDescription)}</p>` : ""}
     <p style="color:#4f4f51;line-height:1.6;">Use the reward's stated time allowance; confirm the duration before making an entry if it is unclear. This email does not update BambooHR automatically. Complete the existing payroll sign-off in Legend Bucks after processing.</p>`);
  await sendBrandedEmail("payroll@legendboats.com", `Time Off in Lieu: ${employeeName} — request #${redemptionId}`, html, "Failed to send Time Off payroll email");
}

export async function sendTimeOffApprovedEmail(to: string, firstName: string, rewardName: string): Promise<void> {
  const html = emailShell("Time Off: manager approved — awaiting payroll",
    `<p style="color:#4f4f51;line-height:1.6;">Hi ${escapeHtml(firstName)},</p>
     <p style="color:#4f4f51;line-height:1.6;">Your manager has approved your request for <strong>${escapeHtml(rewardName)}</strong>. Your request is still <strong>Awaiting Payroll</strong>.</p>
     <p style="color:#4f4f51;line-height:1.6;"><strong>This email does not confirm that your BambooHR balance is ready.</strong> Payroll still needs to process the request and add the time to your <strong>Time Off in Lieu</strong> balance in <strong>BambooHR</strong>. Check that the time has been added, or confirm with payroll, before scheduling it.</p>
     <p style="color:#4f4f51;line-height:1.6;">Once the balance has been added, you must go into BambooHR and schedule this time off as you normally would. Approval of this reward does not book any dates or replace the usual time-off request and approval process.</p>`);
  await sendBrandedEmail(to, `Manager approved — awaiting payroll: ${rewardName}`, html, "Failed to send Time Off approval email");
}

export async function sendPayrollApprovalNeededEmail(
  to: string,
  firstName: string,
  employeeName: string,
  rewardName: string,
  buckCost: number,
): Promise<void> {
  const html = emailShell(
    "Payroll sign-off needed",
    `<p style="margin:0 0 16px;color:#4f4f51;font-size:16px;line-height:1.6;">
       Hi ${escapeHtml(firstName)},
     </p>
     <p style="margin:0 0 24px;color:#4f4f51;font-size:16px;line-height:1.6;">
       A <strong>Time Off</strong> redemption by <strong>${escapeHtml(employeeName)}</strong> has been approved and now needs your payroll sign-off before it can be fulfilled.
     </p>
     <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;background:#f5f5f5;border-radius:8px;">
       <tr>
         <td style="padding:16px 20px;border-bottom:1px solid #e0e0e0;color:#888;font-size:13px;">Employee</td>
         <td style="padding:16px 20px;border-bottom:1px solid #e0e0e0;color:#4f4f51;font-size:15px;font-weight:700;text-align:right;">${escapeHtml(employeeName)}</td>
       </tr>
       <tr>
         <td style="padding:16px 20px;border-bottom:1px solid #e0e0e0;color:#888;font-size:13px;">Reward</td>
         <td style="padding:16px 20px;border-bottom:1px solid #e0e0e0;color:#4f4f51;font-size:15px;font-weight:700;text-align:right;">${escapeHtml(rewardName)}</td>
       </tr>
       <tr>
         <td style="padding:16px 20px;color:#888;font-size:13px;">Cost</td>
         <td style="padding:16px 20px;color:#4f4f51;font-size:15px;font-weight:700;text-align:right;">${formatBucks(buckCost)}</td>
       </tr>
     </table>
     <p style="margin:0;color:#aaa;font-size:12px;line-height:1.6;">
       Sign in to Legend Bucks to review this request in the Fulfillment Center.
     </p>`,
  );

  await sendBrandedEmail(to, `Payroll sign-off needed: ${rewardName}`, html, "Failed to send payroll approval needed email");
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

/** The plaintext code is accepted only for immediate rendering/sending. */
export async function sendGiftCardRecipientEmail(
  to: string,
  recipientName: string,
  code: string,
  cadValueCents: number,
  qrDataUrl: string,
  catalogImageUrl: string | null,
): Promise<void> {
  const absoluteImageUrl = catalogImageUrl
    ? new URL(catalogImageUrl, `${APP_URL}/`).toString()
    : null;
  const imageBlock = absoluteImageUrl
    ? `<img src="${escapeHtml(absoluteImageUrl)}" width="480" alt="Legend Boats Gift Card" style="display:block;width:100%;max-width:480px;height:auto;max-height:300px;object-fit:cover;margin:0 auto 24px;border-radius:8px;" />`
    : "";
  const last4 = code.slice(-4);
  const html = emailShell(
    "Your Legend Boats Gift Card is ready",
    `<p style="margin:0 0 16px;color:#4f4f51;font-size:16px;">Hi ${escapeHtml(recipientName)},</p>
     <p style="margin:0 0 24px;color:#4f4f51;font-size:16px;">Your purchase of a <strong>$${(cadValueCents / 100).toFixed(2)} CAD</strong> Legend Boats Gift Card is complete. Your card is ready to use.</p>
     ${imageBlock}
     <div style="padding:22px;background:#f5f5f5;border-radius:8px;text-align:center;margin-bottom:24px;">
       <p style="margin:0 0 12px;font:700 20px monospace;letter-spacing:2px;color:#222;">${escapeHtml(code)}</p>
       <img src="${qrDataUrl}" width="240" height="240" alt="Gift card QR code" style="display:block;margin:auto;" />
       <p style="margin:12px 0 0;color:#888;font-size:12px;">Card reference: LBGC-••••-••••-••••-••••-••••-••••-${escapeHtml(last4)}</p>
     </div>
     <p style="margin:0 0 12px;color:#4f4f51;font-size:15px;"><strong>Present this code at a Legend Boats store to apply it toward your purchase.</strong></p>
     <p style="margin:0;color:#888;font-size:13px;">This card cannot be exchanged for cash.</p>`,
  );
  await sendBrandedEmail(to, "Your Legend Boats Gift Card is ready", html, "Failed to send gift-card email");
}
