// Render the production templates with a capture-only sender; no network calls.
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const source = fs.readFileSync("artifacts/api-server/src/lib/email.ts", "utf8");
const ast = ts.createSourceFile("email.ts", source, ts.ScriptTarget.Latest, true);
const names = new Set(["escapeHtml", "emailShell", "sendTimeOffPayrollEmail", "sendTimeOffApprovedEmail"]);
const selected = ast.statements
  .filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text))
  .map(node => node.getText(ast).replace(/^export /, "")).join("\n");
const logo = fs.readFileSync("artifacts/legend-bucks/public/logos/legend-bucks-rewards-white.png").toString("base64");
const context = vm.createContext({
  APP_URL: "",
  sendBrandedEmail: async (to, subject, html) => {
    const label = to === "payroll@legendboats.com" ? "payroll" : "team-member";
    html = html.replace('src="/logos/legend-bucks-rewards-white.png"', `src="data:image/png;base64,${logo}"`);
    html = html.replace(/(<body[^>]*>)/, `$1<div style="max-width:560px;margin:24px auto 0;font:14px Arial;color:#444;line-height:1.8;padding:0 16px"><strong>SAMPLE — not sent</strong><br>To: ${to}<br>Subject: ${subject}</div>`);
    fs.mkdirSync("artifacts/legend-bucks/public/email-samples", { recursive: true });
    fs.writeFileSync(`artifacts/legend-bucks/public/email-samples/${label}.html`, html);
  },
});
vm.runInContext(ts.transpile(selected, { target: ts.ScriptTarget.ES2022 }), context);
(async () => {
  await context.sendTimeOffPayrollEmail("Alex Sample", "alex@example.com", "8 Hours of Time Off", "One 8-hour day of time off.", 1234);
  await context.sendTimeOffApprovedEmail("alex@example.com", "Alex", "8 Hours of Time Off");
})();