import pg from "pg";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function buildReadUrl() {
  console.log("Region "+process.env.FLY_REGION);
  // 1) Ako si eksplicitno setovao READ_DATABASE_URL (npr. lokalno) â€” koristi to
  if (process.env.READ_DATABASE_URL) return process.env.READ_DATABASE_URL;

  // 2) InaÄe izvedi iz DATABASE_URL
  const writeUrl = new URL(mustEnv("DATABASE_URL"));

  // Lokalni dev (nema FLY_REGION) -> oÄekujemo fly proxy na 15433
  if (!process.env.FLY_REGION) {
    writeUrl.hostname = "127.0.0.1";
    writeUrl.port = process.env.PG_READ_PORT || "15433";
    return writeUrl.toString();
  }

  // Na Fly-u: pin na lokalni region i koristi 5433 (local member: leader ili replica)
  const internalHostSuffix = process.env.PG_INTERNAL_HOST_SUFFIX || "eaes-pg.internal";
  writeUrl.hostname = `${process.env.FLY_REGION}.${internalHostSuffix}`;
  writeUrl.port = "5433";
  // sslmode ti moÅ¾e ostati disable u Fly private mreÅ¾i (kao i attach string)
  
  return writeUrl.toString();
}

export const writePool = new pg.Pool({
  connectionString: mustEnv("DATABASE_URL"),
  max: 20,
});

export const readPool = new pg.Pool({
  connectionString: buildReadUrl(),
  max: 20,
});

writePool.on("error", (err) => {
  console.error("[DB WRITE POOL ERROR]", err);
});

readPool.on("error", (err) => {
  console.error("[DB READ POOL ERROR]", err);
});


// helperi (da ne pomeÅ¡aÅ¡ sluÄajno)
export const dbWrite = (q, p) => writePool.query(q, p);
export const dbRead = (q, p) => readPool.query(q, p);

/**
 * Loguje da li je pool nakaÄen na repliku ili leader, + host/port.
 * Ne pravi niÅ¡ta u bazi, samo SELECT.
 */
async function logPoolRole(pool, name) {
  const sql = `
    SELECT
      pg_is_in_recovery() AS is_replica,
      inet_server_addr()  AS server_ip,
      inet_server_port()  AS server_port,
      current_database()  AS db,
      current_user        AS db_user
  `;
  try {
    const { rows } = await pool.query(sql);
    const r = rows[0];
    console.log(
      `[DB ${name}] ${r.is_replica ? "REPLICA" : "LEADER"} ` +
      `ip=${r.server_ip} port=${r.server_port} db=${r.db} user=${r.db_user}`
    );
    return r;
  } catch (e) {
    console.log(`[DB ${name}] role-check FAILED:`, e?.message || e);
    return null;
  }
}

/**
 * Pozovi ovo jednom na startup-u (iz server.js posle inicijalizacije),
 * ili periodiÄno ako hoÄ‡eÅ¡ da hvataÅ¡ failover.
 */
export async function logDbRolesOnce() {
  await logPoolRole(writePool, "WRITE");
  await logPoolRole(readPool, "READ");
}

// opcionalno: periodiÄni check (npr. na 60s)
export function startDbRoleLogger(intervalMs = 60_000) {
  // odmah jednom
  logDbRolesOnce();
  // pa na interval
  return setInterval(logDbRolesOnce, intervalMs);
}
