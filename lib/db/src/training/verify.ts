import pg from "pg";

const DATABASE = "legend_bucks_training";
const ROLE = "legend_training_app";

export type TrainingPreflight = {
  connected: boolean;
  restricted: boolean;
  initialized: boolean;
  database?: string;
  role?: string;
  tableCount?: number;
  errorCode?: string;
  reason: string;
};

/**
 * Read-only training provisioning check. Deliberately imports neither the normal
 * db module nor its connection. Never return URLs, hosts, passwords or raw
 * driver errors. This check is not authorization to enable Training Mode.
 */
export async function verifyTrainingDatabase(): Promise<TrainingPreflight> {
  let client: pg.Client | undefined;
  try {
    const connectionString = process.env.TRAINING_DATABASE_URL;
    if (!connectionString) {
      return { connected: false, restricted: false, initialized: false, reason: "TRAINING_DATABASE_URL is missing." };
    }
    const url = new URL(connectionString);
    if (!["postgres:", "postgresql:"].includes(url.protocol) ||
        decodeURIComponent(url.pathname.slice(1)) !== DATABASE ||
        decodeURIComponent(url.username) !== ROLE ||
        url.searchParams.has("options")) {
      return { connected: false, restricted: false, initialized: false, reason: "Expected the restricted training database and role, without connection options." };
    }
    if (process.env.DATABASE_URL) {
      const normal = new URL(process.env.DATABASE_URL);
      const hostname = (value: URL) => value.hostname.replace(/-pooler(?=\.)/, "");
      if (hostname(normal) === hostname(url)) {
        return { connected: false, restricted: false, initialized: false, reason: "Training must use a separate database endpoint, not the normal workspace endpoint." };
      }
    }
    client = new pg.Client({
      connectionString,
      connectionTimeoutMillis: 12_000,
      statement_timeout: 10_000,
      options: "-c default_transaction_read_only=on",
      application_name: "legend_training_readonly_preflight",
    });
    client.on("error", () => { /* Never log raw driver errors or connection details. */ });
    await client.connect();
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL search_path = pg_catalog, public");
    const { rows: [identity] } = await client.query<{
      database_name: string; role_name: string; unsafe_role: boolean;
      can_create_schema: boolean; can_create_tables: boolean; can_use_schema: boolean;
    }>(`
      SELECT current_database() AS database_name, current_user AS role_name,
        EXISTS (
          SELECT 1 FROM pg_roles r
          WHERE pg_has_role(current_user, r.oid, 'MEMBER')
            AND (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole
                 OR r.rolreplication OR r.rolbypassrls
                 OR r.rolname IN ('neon_superuser', 'pg_read_all_data', 'pg_write_all_data'))
        ) AS unsafe_role,
        has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_schema,
        has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_tables,
        has_schema_privilege(current_user, 'public', 'USAGE') AS can_use_schema
    `);
    const restricted = !!identity &&
      identity.database_name === DATABASE && identity.role_name === ROLE &&
      !identity.unsafe_role && !identity.can_create_schema &&
      !identity.can_create_tables && identity.can_use_schema;
    if (!restricted) {
      return { connected: true, restricted: false, initialized: false, reason: "Training role or database permission checks failed." };
    }
    const { rows: [metadata] } = await client.query<{ table_count: number; marker_exists: boolean }>(`
      SELECT (SELECT count(*)::int FROM pg_tables
        WHERE schemaname NOT IN ('pg_catalog', 'information_schema')) AS table_count,
        to_regclass('public.training_installation') IS NOT NULL AS marker_exists
    `);
    let initialized = false;
    if (metadata.marker_exists) {
      const { rows } = await client.query<{ purpose: string; schema_version: number }>(
        "SELECT purpose, schema_version FROM public.training_installation WHERE id = 1",
      );
      initialized = rows.length === 1 &&
        rows[0].purpose === "legend-bucks-training-only" && rows[0].schema_version === 1;
    }
    return {
      connected: true, restricted: true, initialized,
      database: identity.database_name, role: identity.role_name,
      tableCount: metadata.table_count,
      reason: initialized
        ? "Training schema marker verified. Workflow and isolation acceptance tests are still required."
        : "Owner initialization is required. Training must remain disabled.",
    };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    return {
      connected: false, restricted: false, initialized: false,
      errorCode: typeof code === "string" && /^[A-Z0-9_]{1,30}$/.test(code) ? code : undefined,
      reason: "Training verification failed; no fallback to the normal database is permitted.",
    };
  } finally {
    await client?.query("ROLLBACK").catch(() => {});
    await client?.end().catch(() => {});
  }
}
