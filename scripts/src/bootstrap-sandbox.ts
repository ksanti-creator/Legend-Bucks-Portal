import { pool, sandboxEnabled, SANDBOX_SCHEMA } from "@workspace/db";

// Manual, development-only bootstrap. Never run during server startup or publish.
if (!sandboxEnabled()) throw new Error("Sandbox bootstrap requires LEGEND_BUCKS_SANDBOX=true and NODE_ENV=development");

const tables = [
  "departments", "locations", "employees", "magic_tokens", "sessions",
  "transactions", "rewards", "reward_sizes", "redemptions", "goals",
  "goal_contributions", "app_settings", "gift_card_issues",
] as const;
const ident = (value: string) => `"${value.replace(/"/g, '""')}"`;
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const path = await client.query("SHOW search_path");
  if (path.rows[0].search_path !== SANDBOX_SCHEMA) throw new Error("Sandbox connection did not enforce isolated search_path");
  const publicCounts = new Map<string, string>();
  for (const table of tables) {
    const result = await client.query(`SELECT count(*)::text AS count FROM public.${ident(table)}`);
    publicCounts.set(table, result.rows[0].count);
  }
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${ident(SANDBOX_SCHEMA)}`);
  for (const table of tables) {
    const present = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1", [table],
    );
    if (!present.rowCount) throw new Error(`Missing public table structure: ${table}`);
    // LIKE ALL copies columns, defaults, constraints and indexes, but NOT foreign keys
    // or rows. FK omission keeps every relation independent of public IDs.
    await client.query(`CREATE TABLE IF NOT EXISTS ${ident(SANDBOX_SCHEMA)}.${ident(table)} (LIKE public.${ident(table)} INCLUDING ALL)`);
    const serials = await client.query<{ column_name: string }>(
      `SELECT a.attname AS column_name
       FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
       JOIN pg_namespace n ON n.oid=c.relnamespace
       JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
       WHERE n.nspname=$1 AND c.relname=$2 AND pg_get_expr(d.adbin,d.adrelid) LIKE 'nextval(%'`,
      [SANDBOX_SCHEMA, table],
    );
    for (const { column_name } of serials.rows) {
      const sequence = `${table}_${column_name}_seq`;
      await client.query(`CREATE SEQUENCE IF NOT EXISTS ${ident(SANDBOX_SCHEMA)}.${ident(sequence)}`);
      await client.query(`ALTER SEQUENCE ${ident(SANDBOX_SCHEMA)}.${ident(sequence)} OWNED BY ${ident(SANDBOX_SCHEMA)}.${ident(table)}.${ident(column_name)}`);
      await client.query(`ALTER TABLE ${ident(SANDBOX_SCHEMA)}.${ident(table)} ALTER COLUMN ${ident(column_name)} SET DEFAULT nextval('${SANDBOX_SCHEMA}.${sequence}'::regclass)`);
    }
  }
  // Refuse a partial pre-existing clone whose defaults still reference public.
  const unsafe = await client.query(
    `SELECT c.relname, a.attname FROM pg_attrdef d
     JOIN pg_class c ON c.oid=d.adrelid JOIN pg_namespace n ON n.oid=c.relnamespace
     JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=d.adnum
     JOIN pg_depend dep ON dep.classid='pg_attrdef'::regclass AND dep.objid=d.oid
     JOIN pg_class seq ON seq.oid=dep.refobjid AND seq.relkind='S'
     JOIN pg_namespace sn ON sn.oid=seq.relnamespace
     WHERE n.nspname=$1 AND sn.nspname<>$1`,
    [SANDBOX_SCHEMA],
  );
  if (unsafe.rowCount) throw new Error("A sandbox sequence default points outside the sandbox");
  const externalFks = await client.query(
    `SELECT 1 FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
     JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class parent ON parent.oid=k.confrelid
     JOIN pg_namespace pn ON pn.oid=parent.relnamespace
     WHERE k.contype='f' AND n.nspname=$1 AND pn.nspname<>$1`, [SANDBOX_SCHEMA],
  );
  if (externalFks.rowCount) throw new Error("A sandbox FK points outside the sandbox");

  const department = await client.query(
    "INSERT INTO departments (name) VALUES ('Preview Crew') ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id",
  );
  const location = await client.query(
    "INSERT INTO locations (name) VALUES ('Demo Showroom') ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id",
  );
  const people = [
    ["Alex", "Preview", "preview.admin@example.test", "admin", null],
    ["Pat", "Preview", "preview.payroll@example.test", "accounting_admin", null],
    ["AI", "Pulse", "aipulse@legendboats.com", "manager", 25000],
    ["Sam", "Preview", "preview.employee@example.test", "team_member", null],
    ["Taylor", "Preview", "preview.taylor@example.test", "team_member", null],
    ["Jordan", "Preview", "preview.jordan@example.test", "team_member", null],
  ] as const;
  const ids = new Map<string, number>();
  for (const [first, last, email, role, budget] of people) {
    const result = await client.query<{ id: number }>(
      `INSERT INTO employees (first_name,last_name,email,role,status,department_id,location_id,award_budget_yearly)
       VALUES ($1,$2,$3,$4,'active',$5,$6,$7)
       ON CONFLICT (email) DO UPDATE SET email=EXCLUDED.email RETURNING id`,
      [first, last, email, role, department.rows[0].id, location.rows[0].id, budget],
    );
    ids.set(email, result.rows[0].id);
  }
  await client.query("UPDATE employees SET manager_id=$1 WHERE email LIKE 'preview.%@example.test' AND role='team_member'", [ids.get("aipulse@legendboats.com")]);
  const reward = async (name: string, category: string, cost: number, custom: boolean) => {
    const existing = await client.query<{ id: number }>("SELECT id FROM rewards WHERE name=$1 LIMIT 1", [name]);
    if (existing.rows[0]) return existing.rows[0].id;
    const result = await client.query<{ id: number }>(
      `INSERT INTO rewards (name,description,category,buck_cost,approval_required,is_custom_gift_card,gift_card_increment_lb,gift_card_minimum_lb,gift_card_maximum_lb)
       VALUES ($1,$2,$3,$4,true,$5,$6,$7,$8) RETURNING id`,
      [name, custom ? "Choose a custom Legend Bucks amount for a sample gift card." : "Eight-hour time-off request for payroll walkthrough.",
        category, cost, custom, custom ? 100 : null, custom ? 100 : null, custom ? 5000 : null],
    );
    return result.rows[0].id;
  };
  const timeOff = await reward("Preview Time Off — 8 hours", "Time Off", 800, false);
  const giftCard = await reward("Preview Custom Gift Card", "Gift Card", 100, true);
  for (const [email, amount] of [
    ["preview.employee@example.test", 2200],
    ["preview.taylor@example.test", 1700],
    ["preview.jordan@example.test", 1300],
  ] as const) {
    const employeeId = ids.get(email)!;
    if (!(await client.query("SELECT 1 FROM transactions WHERE to_employee_id=$1 AND note=$2", [employeeId, "Sandbox opening balance"])).rowCount) {
      await client.query(
        "INSERT INTO transactions (type,amount,to_employee_id,created_by_id,note) VALUES ('adjustment',$1,$2,$3,$4)",
        [amount, employeeId, ids.get("preview.admin@example.test"), "Sandbox opening balance"],
      );
    }
  }
  const sam = ids.get("preview.employee@example.test")!;
  for (const [rewardId, cost, note, gift] of [
    [timeOff, 800, "Sample request: 8 hours of paid time off next Friday.", false],
    [giftCard, 300, "Sample request: a $3 custom Legend Bucks gift card.", true],
  ] as const) {
    if ((await client.query("SELECT 1 FROM redemptions WHERE employee_id=$1 AND reward_id=$2 AND note=$3", [sam, rewardId, note])).rowCount) continue;
    const redemption = await client.query<{ id: number }>(
      `INSERT INTO redemptions (employee_id,reward_id,status,buck_cost,note,gift_card_lb_amount,gift_card_cad_value_cents,gift_card_recipient_name,gift_card_recipient_email)
       VALUES ($1,$2,'requested',$3,$4,$5,$6,$7,$8) RETURNING id`,
      [sam, rewardId, cost, note, gift ? 300 : null, gift ? 300 : null, gift ? "Sam Preview" : null,
        gift ? "preview.employee@example.test" : null],
    );
    await client.query(
      "INSERT INTO transactions (type,amount,from_employee_id,redemption_id,note) VALUES ('redemption_debit',$1,$2,$3,$4)",
      [cost, sam, redemption.rows[0].id, "Sandbox sample redemption"],
    );
  }
  for (const table of tables) {
    const result = await client.query(`SELECT count(*)::text AS count FROM public.${ident(table)}`);
    if (result.rows[0].count !== publicCounts.get(table)) throw new Error(`Public table count changed: ${table}`);
  }
  await client.query("COMMIT");
  console.log("Sandbox structure and dummy walkthrough seeded; public table counts unchanged, sequences and FKs isolated.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}