import { db, isTraining, sandboxEnabled } from "@workspace/db";
import { trainingOutboxTable } from "@workspace/db/training-schema";
import { ReplitConnectors } from "@replit/connectors-sdk";

export type PreferredLanguage = "en" | "fr-CA";
const APP_URL = process.env.APP_URL ?? "https://legend-bucks-portal.replit.app";
// Gmail honors this only for its authorized account or configured send-as alias.
const GMAIL_FROM = process.env.GMAIL_FROM;

interface GmailSendResponse {
  id?: string;
  error?: { message?: string };
}

function toBase64Url(input: string): string {
  return Buffer.from(input, "utf-8").toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** RFC 2047: preserve accented French subjects and display names. */
export function encodeHeaderValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf-8").toString("base64")}?=`;
}

export function encodeFromHeader(from: string): string {
  const match = /^(.*?)\s*(<[^>]+>)\s*$/.exec(from);
  if (!match) return encodeHeaderValue(from);
  const [, name, address] = match;
  return name ? `${encodeHeaderValue(name)} ${address}` : address;
}

async function sendGmail(to: string, subject: string, html: string): Promise<void> {
  if (isTraining()) {
    await db.insert(trainingOutboxTable).values({
      recipient: /^[^@\s]+@example\.test$/i.test(to) ? to : "training.notifications@example.test",
      subject: `TRAINING — ${subject.replace(/LBGC\S*/gi, "[REDACTED]").replace(/https?:\/\/\S+/gi, "[LINK OMITTED]")}`,
      summary: "Simulated notification. No email was sent; login links and message bodies are intentionally omitted.",
    });
    return;
  }
  if (sandboxEnabled()) {
    // Never log email contents, login tokens or connector credentials.
    console.info("[sandbox] Simulated email delivery; no message was sent.");
    return;
  }
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
  if (!response.ok) throw new Error(`Failed to send email: ${data.error?.message ?? response.status}`);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Translate only authored copy, never names, rewards, notes, descriptions or codes.
function copy(language: PreferredLanguage) {
  return (en: string, fr: string): string => language === "fr-CA" ? fr : en;
}
function formatBucks(amount: number, language: PreferredLanguage): string {
  return `${amount.toLocaleString(language === "fr-CA" ? "fr-CA" : "en-CA")} LB`;
}
function formatCad(cents: number, language: PreferredLanguage): string {
  return new Intl.NumberFormat(language === "fr-CA" ? "fr-CA" : "en-CA", {
    style: "currency", currency: "CAD", currencyDisplay: "code",
  }).format(cents / 100);
}
function paragraph(html: string): string {
  return `<p style="margin:0 0 24px;color:#4f4f51;font-size:16px;line-height:1.6;">${html}</p>`;
}
function row(label: string, valueHtml: string): string {
  return `<tr><td style="padding:16px 20px;border-bottom:1px solid #e0e0e0;color:#888;font-size:13px;">${escapeHtml(label)}</td><td style="padding:16px 20px;border-bottom:1px solid #e0e0e0;color:#4f4f51;font-size:15px;font-weight:700;text-align:right;">${valueHtml}</td></tr>`;
}
function table(rowsHtml: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;background:#f5f5f5;border-radius:8px;">${rowsHtml}</table>`;
}
function greeting(name: string, language: PreferredLanguage): string {
  return paragraph(`${copy(language)("Hi", "Bonjour")} ${escapeHtml(name)},`);
}
function noteBlock(note: string | null, label: string): string {
  return note ? `<p style="margin:0 0 8px;color:#888;font-size:13px;">${escapeHtml(label)}</p>
    <p style="margin:0 0 28px;color:#4f4f51;font-size:16px;line-height:1.6;font-style:italic;background:#f5f5f5;padding:14px 18px;border-radius:6px;border-left:4px solid #00afed;">“${escapeHtml(note)}”</p>` : "";
}
function emailShell(title: string, bodyHtml: string, language: PreferredLanguage): string {
  const t = copy(language);
  return `<!DOCTYPE html>
<html lang="${language}">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 0;"><tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
      <tr><td style="background:linear-gradient(135deg,#00afed 0%,#0090cc 100%);padding:28px 40px;text-align:center;">
        <img src="${escapeHtml(APP_URL)}/logos/legend-bucks-rewards-white.png" width="300" alt="${t("Legend Bucks Rewards Program", "Programme de récompenses Legend Bucks")}" style="display:block;width:300px;max-width:100%;height:auto;margin:0 auto;" />
      </td></tr>
      <tr><td style="padding:40px 40px 32px;">${bodyHtml}</td></tr>
      <tr><td style="background:#4f4f51;padding:20px 40px;"><p style="margin:0;color:#ffffff;font-size:12px;opacity:0.6;">© ${new Date().getFullYear()} Legend Boats Inc. — ${t("Internal use only.", "Usage interne seulement.")}</p></td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}
async function sendBrandedEmail(to: string, subject: string, html: string, errorLabel: string): Promise<void> {
  try {
    await sendGmail(to, subject, html);
  } catch (err) {
    throw new Error(`${errorLabel}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
function loginButton(token: string, label: string): string {
  const url = `${APP_URL}/login?token=${encodeURIComponent(token)}`;
  return `<table cellpadding="0" cellspacing="0" style="margin:0 auto 28px;"><tr><td style="background:#00afed;border-radius:6px;"><a href="${escapeHtml(url)}" style="display:inline-block;padding:14px 32px;color:#fff;font-size:15px;font-weight:700;text-decoration:none;">${escapeHtml(label)} →</a></td></tr></table>`;
}
function loginToken(token: string, language: PreferredLanguage): string {
  return paragraph(copy(language)("Or copy and paste this token into the app:", "Ou copiez et collez ce code dans l’application :")) +
    `<p style="margin:0 0 28px;font-family:monospace;font-size:18px;font-weight:700;letter-spacing:4px;background:#f5f5f5;padding:12px 16px;border-radius:4px;">${escapeHtml(token)}</p>`;
}

/** Critical account-access email: always sent, regardless of notification opt-outs. */
export async function sendMagicLinkEmail(
  to: string, firstName: string, token: string, language: PreferredLanguage = "en",
): Promise<void> {
  const t = copy(language);
  const html = emailShell(t("Sign in to Legend Bucks", "Connexion à Legend Bucks"),
    greeting(firstName, language) +
    paragraph(t("Click the button below to sign in to Legend Bucks. This link expires in <strong>15 minutes</strong> and can only be used once.",
      "Cliquez sur le bouton ci-dessous pour vous connecter à Legend Bucks. Ce lien expire dans <strong>15 minutes</strong> et ne peut être utilisé qu’une seule fois.")) +
    loginButton(token, t("Sign In to Legend Bucks", "Se connecter à Legend Bucks")) +
    loginToken(token, language) +
    paragraph(t("If you didn't request this, you can safely ignore this email.", "Si vous n’avez pas fait cette demande, vous pouvez ignorer ce courriel.")), language);
  await sendGmail(to, t("Your Legend Bucks sign-in link", "Votre lien de connexion à Legend Bucks"), html);
}

/** Critical invitation email: always sent. */
export async function sendInviteEmail(
  to: string, firstName: string, invitedBy: string, token: string, language: PreferredLanguage = "en",
): Promise<void> {
  const t = copy(language);
  const html = emailShell(t("You're invited to Legend Bucks", "Invitation à Legend Bucks"),
    greeting(firstName, language) +
    paragraph(t(`<strong>${escapeHtml(invitedBy)}</strong> has invited you to join <strong>Legend Bucks</strong> — Legend Boats' employee rewards platform.`,
      `<strong>${escapeHtml(invitedBy)}</strong> vous invite à rejoindre <strong>Legend Bucks</strong> — la plateforme de récompenses pour les employés de Legend Boats.`)) +
    paragraph(t("Earn recognition, redeem rewards, and contribute to team goals. Click below to accept your invitation and set up your account.",
      "Recevez de la reconnaissance, échangez vos Bucks contre des récompenses et contribuez aux objectifs d’équipe. Cliquez ci-dessous pour accepter votre invitation et configurer votre compte.")) +
    loginButton(token, t("Accept Invitation", "Accepter l’invitation")) + loginToken(token, language) +
    paragraph(t("This invitation link expires in 15 minutes. If you weren't expecting this, you can safely ignore it.",
      "Ce lien d’invitation expire dans 15 minutes. Si vous n’attendiez pas cette invitation, vous pouvez l’ignorer.")), language);
  await sendGmail(to, t(`${invitedBy} invited you to Legend Bucks`, `${invitedBy} vous invite à Legend Bucks`), html);
}

export async function sendBucksReceivedEmail(
  to: string, firstName: string, senderName: string, amount: number, note: string | null, language: PreferredLanguage = "en",
): Promise<void> {
  const t = copy(language);
  const html = emailShell(t("You received Legend Bucks", "Vous avez reçu des Legend Bucks"),
    greeting(firstName, language) +
    paragraph(t(`<strong>${escapeHtml(senderName)}</strong> just recognized your work with Legend Bucks.`,
      `<strong>${escapeHtml(senderName)}</strong> vient de souligner votre travail avec des Legend Bucks.`)) +
    `<p style="margin:0 0 28px;background:#f5f5f5;padding:24px;text-align:center;color:#00afed;font-size:34px;font-weight:700;">+${formatBucks(amount, language)}</p>` +
    noteBlock(note, t("Their note:", "Son message :")) +
    paragraph(t("Sign in to Legend Bucks to see your balance and redeem rewards.",
      "Connectez-vous à Legend Bucks pour consulter votre solde et échanger vos Bucks contre des récompenses.")), language);
  await sendBrandedEmail(to, t(`You received ${formatBucks(amount, language)}! 🎉`, `Vous avez reçu ${formatBucks(amount, language)}! 🎉`), html, "Failed to send bucks-received email");
}

function redemptionStatus(status: string, language: PreferredLanguage): string {
  if (language === "en") return status.charAt(0).toUpperCase() + status.slice(1);
  const labels: Record<string, string> = {
    requested: "Demandée", pending_payroll: "En attente de la paie", approved: "Approuvée",
    rejected: "Refusée", fulfilled: "Traitée", cancelled: "Annulée",
  };
  return labels[status] ?? status;
}

export async function sendRedemptionReceiptEmail(
  to: string, firstName: string, rewardName: string, buckCost: number, date: Date, status: string,
  giftCard?: { cadValueCents: number; recipientName: string; recipientEmail: string; message: string | null },
  language: PreferredLanguage = "en",
): Promise<void> {
  const t = copy(language);
  const dateLabel = date.toLocaleDateString(language === "fr-CA" ? "fr-CA" : "en-CA", { month: "long", day: "numeric", year: "numeric" });
  const giftCardRows = giftCard
    ? row(t("Gift card value", "Valeur de la carte-cadeau"), formatCad(giftCard.cadValueCents, language)) +
      row(t("Recipient", "Destinataire"), `${escapeHtml(giftCard.recipientName)} &lt;${escapeHtml(giftCard.recipientEmail)}&gt;`) +
      (giftCard.message ? row(t("Message", "Message"), escapeHtml(giftCard.message)) : "")
    : "";
  const html = emailShell(t("Your Legend Bucks redemption receipt", "Votre reçu d’échange Legend Bucks"),
    greeting(firstName, language) +
    paragraph(t("Here's your receipt for the reward you just redeemed.", "Voici le reçu pour la récompense que vous venez de demander.")) +
    table(row(t("Reward", "Récompense"), escapeHtml(rewardName)) + giftCardRows +
      row(t("Cost", "Coût"), formatBucks(buckCost, language)) + row(t("Date", "Date"), dateLabel) +
      row(t("Status", "Statut"), escapeHtml(redemptionStatus(status, language)))) +
    paragraph(giftCard
      ? t("Gift cards are issued after approval and cannot be exchanged for cash.", "Les cartes-cadeaux sont émises après approbation et ne peuvent pas être échangées contre de l’argent.")
      : t("Sign in to Legend Bucks to track the status of your redemption.", "Connectez-vous à Legend Bucks pour suivre le statut de votre demande.")), language);
  await sendBrandedEmail(to, t(`Redemption receipt: ${rewardName}`, `Reçu d’échange : ${rewardName}`), html, "Failed to send redemption receipt email");
}

/** Buck cost only; accounting-only CAD values must never appear here. */
export async function sendNewRedemptionRequestEmail(
  to: string, firstName: string, employeeName: string, rewardName: string, buckCost: number, note: string | null,
  sizeLabel: string | null = null, language: PreferredLanguage = "en",
): Promise<void> {
  const t = copy(language);
  const html = emailShell(t("New redemption request", "Nouvelle demande d’échange"),
    greeting(firstName, language) +
    paragraph(t(`<strong>${escapeHtml(employeeName)}</strong> just redeemed a reward and it's waiting in the Fulfillment Center.`,
      `<strong>${escapeHtml(employeeName)}</strong> vient de demander une récompense. La demande est en attente dans le centre de traitement.`)) +
    table(row(t("Employee", "Employé"), escapeHtml(employeeName)) + row(t("Reward", "Récompense"), escapeHtml(rewardName)) +
      (sizeLabel ? row(t("Size", "Taille"), escapeHtml(sizeLabel)) : "") + row(t("Cost", "Coût"), formatBucks(buckCost, language))) +
    noteBlock(note, t("Their note:", "Son message :")) +
    paragraph(t("Sign in to Legend Bucks to review this request in the Fulfillment Center.",
      "Connectez-vous à Legend Bucks pour examiner cette demande dans le centre de traitement.")), language);
  await sendBrandedEmail(to, t(`New redemption request: ${rewardName}`, `Nouvelle demande d’échange : ${rewardName}`), html, "Failed to send new redemption request email");
}

/** The fixed mailbox locale is resolved by the caller; no notification gating changes. */
export async function sendTimeOffPayrollEmail(
  employeeName: string, employeeEmail: string, rewardName: string, rewardDescription: string | null, redemptionId: number,
  language: PreferredLanguage = "en",
): Promise<void> {
  const t = copy(language);
  const html = emailShell(t("Time Off approved — BambooHR action required", "Congé approuvé — action requise dans BambooHR"),
    paragraph(t("Hi Payroll,", "Bonjour à l’équipe de la paie,")) +
    paragraph(t("A Time Off reward has been approved. Please add the time specified by this reward to the team member's <strong>Time Off in Lieu</strong> balance in <strong>BambooHR</strong>.",
      "Une récompense de congé a été approuvée. Veuillez ajouter la durée indiquée pour cette récompense au solde de <strong>congé compensatoire (Time Off in Lieu)</strong> de l’employé dans <strong>BambooHR</strong>.")) +
    paragraph(`${t("Team member:", "Employé :")} <strong>${escapeHtml(employeeName)}</strong><br />
      ${t("Account email:", "Courriel du compte :")} ${escapeHtml(employeeEmail)}<br />
      ${t("Reward:", "Récompense :")} <strong>${escapeHtml(rewardName)}</strong><br />
      ${t("Request reference:", "Référence de la demande :")} #${redemptionId}`) +
    (rewardDescription ? paragraph(escapeHtml(rewardDescription)) : "") +
    paragraph(t("Use the reward's stated time allowance; confirm the duration before making an entry if it is unclear. This email does not update BambooHR automatically. After adding the balance in BambooHR, approve the request in the Payroll tab in Legend Bucks, then mark the approved Time Off redemption fulfilled.",
      "Utilisez la durée indiquée pour la récompense; si elle n’est pas claire, confirmez-la avant de faire la saisie. Ce courriel ne met pas BambooHR à jour automatiquement. Après avoir ajouté le solde dans BambooHR, approuvez la demande dans l’onglet Paie de Legend Bucks, puis marquez la demande de congé approuvée comme traitée.")), language);
  await sendBrandedEmail("payroll@legendboats.com", t(`Time Off in Lieu: ${employeeName} — request #${redemptionId}`,
    `Congé compensatoire : ${employeeName} — demande nº ${redemptionId}`), html, "Failed to send Time Off payroll email");
}

export async function sendTimeOffApprovedEmail(
  to: string, firstName: string, rewardName: string, language: PreferredLanguage = "en",
): Promise<void> {
  const t = copy(language);
  const html = emailShell(t("Time Off: manager approved — awaiting payroll", "Congé : approuvé par le gestionnaire — en attente de la paie"),
    greeting(firstName, language) +
    paragraph(t(`Your manager has approved your request for <strong>${escapeHtml(rewardName)}</strong>. Your request is still <strong>Awaiting Payroll</strong>.`,
      `Votre gestionnaire a approuvé votre demande pour <strong>${escapeHtml(rewardName)}</strong>. Elle est toujours <strong>en attente de la paie</strong>.`)) +
    paragraph(t("<strong>This email does not confirm that your BambooHR balance is ready.</strong> Payroll still needs to process the request and add the time to your <strong>Time Off in Lieu</strong> balance in <strong>BambooHR</strong>. Check that the time has been added, or confirm with payroll, before scheduling it.",
      "<strong>Ce courriel ne confirme pas que votre solde dans BambooHR est prêt.</strong> L’équipe de la paie doit encore traiter la demande et ajouter la durée à votre solde de <strong>congé compensatoire (Time Off in Lieu)</strong> dans <strong>BambooHR</strong>. Vérifiez que la durée a été ajoutée, ou confirmez-le avec la paie, avant de planifier votre congé.")) +
    paragraph(t("Once the balance has been added, you must go into BambooHR and schedule this time off as you normally would. Approval of this reward does not book any dates or replace the usual time-off request and approval process.",
      "Une fois le solde ajouté, vous devez aller dans BambooHR et planifier ce congé comme d’habitude. L’approbation de cette récompense ne réserve aucune date et ne remplace pas le processus habituel de demande et d’approbation de congé.")), language);
  await sendBrandedEmail(to, t(`Manager approved — awaiting payroll: ${rewardName}`, `Approuvé par le gestionnaire — en attente de la paie : ${rewardName}`), html, "Failed to send Time Off approval email");
}

export async function sendPayrollApprovalNeededEmail(
  to: string, firstName: string, employeeName: string, rewardName: string, buckCost: number, language: PreferredLanguage = "en",
): Promise<void> {
  const t = copy(language);
  const html = emailShell(t("Payroll sign-off needed", "Approbation de la paie requise"),
    greeting(firstName, language) +
    paragraph(t(`A <strong>Time Off</strong> redemption by <strong>${escapeHtml(employeeName)}</strong> has been approved and now needs your payroll sign-off before it can be fulfilled.`,
      `Une demande de <strong>congé</strong> de <strong>${escapeHtml(employeeName)}</strong> a été approuvée et nécessite maintenant votre approbation de la paie avant de pouvoir être traitée.`)) +
    table(row(t("Employee", "Employé"), escapeHtml(employeeName)) + row(t("Reward", "Récompense"), escapeHtml(rewardName)) +
      row(t("Cost", "Coût"), formatBucks(buckCost, language))) +
    paragraph(t("Sign in to Legend Bucks to review this request in the Fulfillment Center.",
      "Connectez-vous à Legend Bucks pour examiner cette demande dans le centre de traitement.")), language);
  await sendBrandedEmail(to, t(`Payroll sign-off needed: ${rewardName}`, `Approbation de la paie requise : ${rewardName}`), html, "Failed to send payroll approval needed email");
}

export async function sendRedemptionApprovedEmail(
  to: string, firstName: string, rewardName: string, language: PreferredLanguage = "en",
): Promise<void> {
  const t = copy(language);
  const html = emailShell(t("Your redemption was approved", "Votre demande d’échange a été approuvée"),
    greeting(firstName, language) +
    paragraph(t(`Good news — your redemption for <strong>${escapeHtml(rewardName)}</strong> has been <strong style="color:#35b729;">approved</strong>. We'll let you know once it's on its way.`,
      `Bonne nouvelle — votre demande pour <strong>${escapeHtml(rewardName)}</strong> a été <strong style="color:#35b729;">approuvée</strong>. Nous vous aviserons lorsqu’elle sera en route.`)) +
    paragraph(t("Sign in to Legend Bucks to track the status of your redemption.", "Connectez-vous à Legend Bucks pour suivre le statut de votre demande.")), language);
  await sendBrandedEmail(to, t(`Approved: ${rewardName}`, `Approuvée : ${rewardName}`), html, "Failed to send redemption approved email");
}

export async function sendRedemptionRejectedEmail(
  to: string, firstName: string, rewardName: string, buckCost: number, adminNote: string | null, language: PreferredLanguage = "en",
): Promise<void> {
  const t = copy(language);
  const html = emailShell(t("Your redemption was not approved", "Votre demande d’échange n’a pas été approuvée"),
    greeting(firstName, language) +
    paragraph(t(`Unfortunately, your redemption for <strong>${escapeHtml(rewardName)}</strong> was <strong style="color:#d64545;">not approved</strong>. Your <strong>${formatBucks(buckCost, language)}</strong> has been refunded to your balance.`,
      `Malheureusement, votre demande pour <strong>${escapeHtml(rewardName)}</strong> <strong style="color:#d64545;">n’a pas été approuvée</strong>. Vos <strong>${formatBucks(buckCost, language)}</strong> ont été remboursés à votre solde.`)) +
    noteBlock(adminNote, t("Reason:", "Motif :")) +
    paragraph(t("Sign in to Legend Bucks to browse other rewards.", "Connectez-vous à Legend Bucks pour découvrir d’autres récompenses.")), language);
  await sendBrandedEmail(to, t(`Update on your redemption: ${rewardName}`, `Mise à jour de votre demande : ${rewardName}`), html, "Failed to send redemption rejected email");
}

export async function sendRedemptionFulfilledEmail(
  to: string, firstName: string, rewardName: string, language: PreferredLanguage = "en",
): Promise<void> {
  const t = copy(language);
  const html = emailShell(t("Your reward is on its way", "Votre récompense est en route"),
    greeting(firstName, language) +
    paragraph(t(`Your redemption for <strong>${escapeHtml(rewardName)}</strong> has been <strong style="color:#35b729;">fulfilled</strong> and is on its way to you. 🎉`,
      `Votre demande pour <strong>${escapeHtml(rewardName)}</strong> a été <strong style="color:#35b729;">traitée</strong> et votre récompense est en route. 🎉`)) +
    paragraph(t("Sign in to Legend Bucks to see your redemption history.", "Connectez-vous à Legend Bucks pour consulter votre historique d’échanges.")), language);
  await sendBrandedEmail(to, t(`On its way: ${rewardName}`, `En route : ${rewardName}`), html, "Failed to send redemption fulfilled email");
}

/** Plaintext bearer-value code is accepted only for immediate rendering/sending. */
export async function sendGiftCardRecipientEmail(
  to: string, recipientName: string, code: string, cadValueCents: number, qrDataUrl: string, catalogImageUrl: string | null,
  language: PreferredLanguage = "en",
): Promise<void> {
  const t = copy(language);
  const absoluteImageUrl = catalogImageUrl ? new URL(catalogImageUrl, `${APP_URL}/`).toString() : null;
  const imageBlock = absoluteImageUrl ? `<img src="${escapeHtml(absoluteImageUrl)}" width="480" alt="${t("Legend Boats Gift Card", "Carte-cadeau Legend Boats")}" style="display:block;width:100%;max-width:480px;height:auto;max-height:300px;object-fit:cover;margin:0 auto 24px;border-radius:8px;" />` : "";
  const html = emailShell(t("Your Legend Boats Gift Card is ready", "Votre carte-cadeau Legend Boats est prête"),
    greeting(recipientName, language) +
    paragraph(t(`Your purchase of a <strong>${formatCad(cadValueCents, language)}</strong> Legend Boats Gift Card is complete. Your card is ready to use.`,
      `Votre achat d’une carte-cadeau Legend Boats de <strong>${formatCad(cadValueCents, language)}</strong> est terminé. Votre carte est prête à être utilisée.`)) +
    imageBlock +
    `<div style="padding:22px;background:#f5f5f5;border-radius:8px;text-align:center;margin-bottom:24px;">
      <p style="margin:0 0 12px;font:700 20px monospace;letter-spacing:2px;color:#222;">${escapeHtml(code)}</p>
      <img src="${escapeHtml(qrDataUrl)}" width="240" height="240" alt="${t("Gift card QR code", "Code QR de la carte-cadeau")}" style="display:block;margin:auto;" />
      <p style="margin:12px 0 0;color:#888;font-size:12px;">${t("Card reference:", "Référence de la carte :")} LBGC-••••-••••-••••-••••-••••-••••-${escapeHtml(code.slice(-4))}</p>
    </div>` +
    paragraph(t("<strong>Present this code at a Legend Boats store to apply it toward your purchase.</strong>",
      "<strong>Présentez ce code dans un magasin Legend Boats pour l’appliquer à votre achat.</strong>")) +
    paragraph(t("This card cannot be exchanged for cash.", "Cette carte ne peut pas être échangée contre de l’argent.")), language);
  await sendBrandedEmail(to, t("Your Legend Boats Gift Card is ready", "Votre carte-cadeau Legend Boats est prête"), html, "Failed to send gift-card email");
}