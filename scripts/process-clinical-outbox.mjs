// Restricted, one-shot clinical outbox processor.
// Run on an audited backend worker with a dedicated PostgreSQL credential.
// Does not send data to AI, Clinical Knowledge, analytics or external endpoints.
const SOURCE_SCHEMA = "clinical_internal";
const MAX_BATCH = 50;
const MAX_ATTEMPTS = 6;

export function retryDelaySeconds(attempts) {
  return Math.min(3600, 5 * 2 ** Math.max(0, Math.min(12, attempts - 1)));
}

export function safeErrorCode(error) {
  const code = error?.code;
  return typeof code === "string" && /^[A-Z0-9_]{3,12}$/i.test(code)
    ? code : "WORKER_ERROR";
}

const CLAIM_SQL = `
WITH candidates AS (
 SELECT id FROM ${SOURCE_SCHEMA}.source_outbox
 WHERE attempts < $2
   AND (
     (status IN ('pending','retry') AND (available_at IS NULL OR available_at <= now()))
     OR (status='processing' AND leased_until IS NOT NULL AND leased_until < now())
   )
 ORDER BY id
 LIMIT $1
 FOR UPDATE SKIP LOCKED
)
UPDATE ${SOURCE_SCHEMA}.source_outbox o
SET status='processing', attempts=attempts+1,
    lease_token=gen_random_uuid(), leased_until=now()+interval '120 seconds',
    available_at=NULL
FROM candidates c
WHERE o.id=c.id
RETURNING o.id,o.lease_token,o.attempts
`;

const LOCK_SQL = `
SELECT id FROM ${SOURCE_SCHEMA}.source_outbox
WHERE id=$1 AND lease_token=$2::uuid AND status='processing'
  AND leased_until>now() FOR UPDATE
`;

const RECORD_SQL = `
INSERT INTO ${SOURCE_SCHEMA}.source_receipts (
  outbox_id,source_table,source_key,operation,
  owner_type,owner_key,organization_key,captured_at
)
SELECT id,source_table,source_key,operation,
       owner_type,owner_key,organization_key,captured_at
FROM ${SOURCE_SCHEMA}.source_outbox
WHERE id=$1 AND lease_token=$2::uuid AND status='processing'
ON CONFLICT (outbox_id) DO NOTHING
`;

const ACK_SQL = `
UPDATE ${SOURCE_SCHEMA}.source_outbox
SET status='processed',processed_at=now(),leased_until=NULL,
    lease_token=NULL,error_code=NULL
WHERE id=$1 AND lease_token=$2::uuid AND status='processing'
RETURNING id
`;

const RETRY_SQL = `
UPDATE ${SOURCE_SCHEMA}.source_outbox
SET status=CASE WHEN attempts >= $3 THEN 'dead_letter' ELSE 'retry' END,
    error_code=$4, leased_until=NULL, lease_token=NULL,
    available_at=CASE WHEN attempts >= $3 THEN NULL
                      ELSE now()+($5::integer * interval '1 second') END
WHERE id=$1 AND lease_token=$2::uuid AND status='processing'
RETURNING status
`;

async function transaction(pool, action) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

export async function claimOutbox(pool, { batchSize=25, maxAttempts=MAX_ATTEMPTS } = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH)
    throw new Error("Invalid batch size");
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 12)
    throw new Error("Invalid max attempts");
  return transaction(pool, async (c) =>
    (await c.query(CLAIM_SQL, [batchSize,maxAttempts])).rows || []);
}

export async function processOutboxRecord(pool, job, maxAttempts=MAX_ATTEMPTS) {
  try {
    const success = await transaction(pool, async (c) => {
      const locked = await c.query(LOCK_SQL,[job.id,job.lease_token]);
      if (!locked.rowCount) return false; // lease expired, or another worker holds the job
      await c.query(RECORD_SQL,[job.id,job.lease_token]);
      const ack = await c.query(ACK_SQL,[job.id,job.lease_token]);
      if (ack.rowCount !== 1) throw new Error("Acknowledgement mismatch");
      return true;
    });
    return success ? "processed" : "lease_lost";
  } catch (error) {
    // Failure handling must be in a separate transaction. Never place raw error
    // messages, medical descriptions or patient identifiers in logs or error_code.
    const code = safeErrorCode(error);
    try {
      const r = await transaction(pool,(c)=>c.query(RETRY_SQL,[
        job.id,job.lease_token,maxAttempts,code,retryDelaySeconds(job.attempts),
      ]));
      return r.rows?.[0]?.status || "lease_lost";
    } catch {
      // Lease expiry will make the same job available again.
      return "lease_recovery_required";
    }
  }
}

export async function runOutboxBatch(pool, options={}) {
  const jobs=await claimOutbox(pool,options);
  const results={claimed:jobs.length,processed:0,retry:0,dead_letter:0,
    lease_lost:0,lease_recovery_required:0};
  for(const job of jobs) {
    const status=await processOutboxRecord(pool,job,options.maxAttempts||MAX_ATTEMPTS);
    if (Object.hasOwn(results,status)) results[status]++;
  }
  // Aggregated operational numbers only. No row IDs or clinical content.
  return results;
}

// A worker must be explicitly enabled and provisioned. Importing this file is inert.
if (process.argv[1]?.endsWith("/process-clinical-outbox.mjs")) {
  if (process.env.CLINICAL_OUTBOX_WORKER_APPROVED !== "YES_STAGING_ONLY") {
    process.stderr.write("Outbox worker disabled: staging approval is required.\\n");
    process.exitCode=2;
  } else if (!process.env.DATABASE_URL) {
    process.stderr.write("DATABASE_URL is missing.\\n");
    process.exitCode=2;
  } else {
    const { default: pg }=await import("pg");
    const pool=new pg.Pool({ connectionString:process.env.DATABASE_URL,
      max:2,connectionTimeoutMillis:5000,statement_timeout:10000,
      application_name:"clinical-outbox-worker" });
    try {
      const result=await runOutboxBatch(pool);
      process.stdout.write(JSON.stringify(result)+"\\n");
      if(result.dead_letter||result.lease_recovery_required)process.exitCode=1;
    } catch(e) {
      process.stderr.write("Outbox worker unavailable: "+safeErrorCode(e)+"\\n");
      process.exitCode=1;
    } finally {
      await pool.end();
    }
  }
}
