import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { inspectMigrationHistory } from "./migration-history.mjs";

const failure = (code, details = {}) => Object.assign(new Error(code), { code, ...details });
const contractPath = new URL("./migration-schema-contract.json", import.meta.url);
let contractPromise;
export const loadSchemaContract = () => contractPromise ??= readFile(contractPath, "utf8").then(JSON.parse);

// Catalog reads only. The snapshot is the result of executing the seven
// unmodified bundled migrations on a clean PostgreSQL engine; it is NOT an
// invented definition of the unavailable legacy migration.
export const SCHEMA_QUERIES = {
  tables: `select c.relname as table_name, c.relkind::text as kind,
    c.relrowsecurity as row_security, c.relforcerowsecurity as force_row_security
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname=current_schema() and c.relkind in ('r','p','v','m','f') and c.relname <> 'schema_migrations'
    order by c.relname`,
  columns: `select c.relname as table_name, a.attname as column_name,
    pg_catalog.format_type(a.atttypid,a.atttypmod) as data_type, a.attnotnull as not_null,
    pg_catalog.pg_get_expr(d.adbin,d.adrelid) as default_expression
    from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid=a.attrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where n.nspname=current_schema() and c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped and c.relname <> 'schema_migrations'
    order by c.relname,a.attname`,
  constraints: `select r.relname as table_name, c.conname as name, c.contype::text as kind,
    pg_catalog.pg_get_constraintdef(c.oid,true) as definition,
    c.convalidated as validated, c.condeferrable as deferrable, c.condeferred as deferred
    from pg_catalog.pg_constraint c join pg_catalog.pg_class r on r.oid=c.conrelid
    join pg_catalog.pg_namespace n on n.oid=r.relnamespace
    where n.nspname=current_schema() and r.relname <> 'schema_migrations' and c.contype in ('p','u','f','c','x')
    order by r.relname,c.conname`,
  indexes: `select r.relname as table_name, c.relname as name, i.indisunique as is_unique,
    i.indisvalid as valid, i.indisready as ready, am.amname as method,
    coalesce((to_jsonb(i)->>'indnullsnotdistinct')::boolean,false) as nulls_not_distinct,
    array(select pg_catalog.pg_get_indexdef(i.indexrelid,k,true) from generate_series(1,i.indnatts) k) as keys,
    i.indoption::text as options, pg_catalog.pg_get_expr(i.indpred,i.indrelid) as predicate
    from pg_catalog.pg_index i join pg_catalog.pg_class c on c.oid=i.indexrelid
    join pg_catalog.pg_class r on r.oid=i.indrelid join pg_catalog.pg_namespace n on n.oid=r.relnamespace
    join pg_catalog.pg_am am on am.oid=c.relam
    where n.nspname=current_schema() and r.relname <> 'schema_migrations'
    order by r.relname,c.relname`,
  enums: `select t.typname as name, array_agg(e.enumlabel::text order by e.enumsortorder) as labels
    from pg_catalog.pg_type t join pg_catalog.pg_namespace n on n.oid=t.typnamespace
    join pg_catalog.pg_enum e on e.enumtypid=t.oid where n.nspname=current_schema()
    group by t.typname order by t.typname`,
  functions: `select p.proname as name, pg_catalog.pg_get_function_result(p.oid) as result,
    l.lanname as language, p.prosrc as body, p.prosecdef as security_definer
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    join pg_catalog.pg_language l on l.oid=p.prolang
    where n.nspname=current_schema() and p.pronargs=0
      and p.proname in ('touch_conversation','portal_release_stale_reservations','portal_reject_audit_mutation')
    order by p.proname`,
  triggers: `select r.relname as table_name, t.tgname as name, p.proname as function_name,
    t.tgtype::integer as type, t.tgenabled::text as enabled,
    pg_catalog.pg_get_expr(t.tgqual,t.tgrelid) as condition, encode(t.tgargs,'hex') as arguments
    from pg_catalog.pg_trigger t join pg_catalog.pg_class r on r.oid=t.tgrelid
    join pg_catalog.pg_namespace n on n.oid=r.relnamespace join pg_catalog.pg_proc p on p.oid=t.tgfoid
    where n.nspname=current_schema() and not t.tgisinternal and r.relname <> 'schema_migrations'
    order by r.relname,t.tgname`,
};

export async function readSchemaSnapshot(query) {
  const snapshot = {};
  // A transaction owns one connection. Keep its catalog reads sequential.
  for (const [section, source] of Object.entries(SCHEMA_QUERIES)) snapshot[section] = await query(source);
  // A free plan is needed by registration and quota queries. Read only the
  // existence of that reference row, never plan prices or user information.
  snapshot.runtimeData = { freePlan: false };
  if (snapshot.columns.some((row) => row.table_name === "plans" && row.column_name === "code")) {
    const rows = await query("select exists(select 1 from plans where code='free') as available");
    snapshot.runtimeData.freePlan = rows[0]?.available === true;
  }
  return snapshot;
}

const rowKey = (section, row) => section === "columns" ? `${row.table_name}.${row.column_name}`
  : section === "tables" ? row.table_name : row.table_name ? `${row.table_name}.${row.name}` : row.name;

export function compareSchemaContract(expected, actual) {
  const issues = [];
  const requiredTables = new Set(expected.tables.map((table) => table.table_name));
  for (const section of Object.keys(SCHEMA_QUERIES)) {
    const required = new Map(expected[section].map((row) => [rowKey(section, row), row]));
    const observed = new Map((actual[section] || []).map((row) => [rowKey(section, row), row]));
    const equivalent = (left, right) => {
      if (!["constraints", "indexes"].includes(section)) return isDeepStrictEqual(left, right);
      // PostgreSQL can give equivalent indexes/constraints different names in
      // another release branch. Runtime code does not address them by name.
      const withoutName = (value) => { const definition = { ...value }; delete definition.name; return definition; };
      return isDeepStrictEqual(withoutName(left), withoutName(right));
    };
    for (const [key, row] of required) {
      const found = observed.get(key) || [...observed.values()].find((candidate) => equivalent(row, candidate));
      if (!found) issues.push({ section, object: key, reason: "missing" });
      else if (!equivalent(found, row)) issues.push({ section, object: key, reason: "definition_mismatch" });
    }
    for (const [key, row] of observed) {
      if (required.has(key) || !requiredTables.has(row.table_name)) continue;
      if ([...required.values()].some((candidate) => equivalent(row, candidate))) continue;
      // Nullable extra columns and non-unique indexes are harmless extensions.
      // New checks, uniqueness or triggers can change application writes and
      // therefore require the original historical source to be reviewed.
      if (["constraints", "triggers"].includes(section)
        || (section === "indexes" && row.is_unique)
        || (section === "columns" && row.not_null && row.default_expression === null)) {
        issues.push({ section, object: key, reason: "unreviewed_write_constraint" });
      }
    }
  }
  if (actual.runtimeData?.freePlan !== true) issues.push({ section: "runtimeData", object: "plans.free", reason: "missing" });
  return { ok: issues.length === 0, issues };
}

export async function verifyDatabaseCompatibility(migrations, applied, readSchema) {
  const contract = await loadSchemaContract();
  const inspected = inspectMigrationHistory(migrations, applied);
  if (inspected.integrityIssues.length) throw failure(inspected.integrityIssues[0].code, {
    file: inspected.integrityIssues[0].file, historyIssues: inspected.integrityIssues,
  });
  // A baseline verifies the current runtime contract. It does not claim that
  // unrecorded canonical SQL ran, nor recreate or rewrite any historical row.
  // Never infer compatibility just from a filename or migration number.
  const identity = migrations.map(({ name, checksum }) => ({ name, checksum }));
  if (!isDeepStrictEqual(identity, contract.migrations)) throw failure("MIGRATION_BASELINE_RELEASE_UNSUPPORTED");
  const actual = await readSchema();
  const verification = compareSchemaContract(contract.schema, actual);
  if (!verification.ok) throw failure("MIGRATION_SCHEMA_INCOMPATIBLE", { schemaIssues: verification.issues });
  return {
    event: "migration.compatibility_verified", mode: "schema_baseline",
    retainedSources: inspected.externalSources.map((row) => row.name).sort(),
    unrecordedSources: inspected.unrecorded,
    sourceUnavailable: inspected.externalSources.length > 0,
    recordedChecksumsVerified: true, canonicalHistoryComplete: inspected.unrecorded.length === 0,
    schemaVerified: true, historyChanged: false, applied: 0,
  };
}
