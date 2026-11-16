import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

const db = new PGlite({ extensions: { btree_gist } });
const sql = (file) => readFile(new URL("../supabase/migrations/" + file, import.meta.url), "utf8");
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const row = async (query, values = []) => (await db.query(query, values)).rows[0];
const value = async (query, values = []) => Object.values(await row(query, values))[0];

try {
  await db.exec(`
    create extension btree_gist;
    create role anon; create role authenticated; create role service_role bypassrls;
    create table experts(id uuid primary key);
    create table organizations(id uuid primary key);
  `);
  const baseline = await sql("20260814000000_production_baseline.sql");
  for (const table of ["usage_wallets", "usage_ledger"]) {
    const statement = baseline.match(new RegExp(`CREATE TABLE public.${table} \\([\\s\\S]*?\\n\\);`))[0];
    await db.exec(statement);
    await db.exec(`alter table ${table} add primary key(id)`);
  }
  await db.exec(`
    alter table usage_ledger add column reversed_usage_id uuid references usage_ledger(id);
    create unique index on usage_ledger(wallet_id, request_id);
    grant select, insert, update on usage_wallets, usage_ledger to service_role;
  `);
  for (const migration of [
    "20261109120000_my_practice_bookings_a2.sql",
    "20261109130000_my_practice_bookings_a2_corrective.sql",
    "20261109140000_my_practice_bookings_a2_ttl_semantics.sql",
    "20261110022907_my_practice_bookings_a2_hardening.sql",
    "20261116084712_practice_booking_credit_payments.sql",
  ]) await db.exec(await sql(migration));

  await db.query("insert into experts values ($1),($2)", [id(1), id(2)]);
  await db.query(`insert into practice_services(id,expert_id,name,price_kop,duration_min)
    values ($1,$2,'Приём',200000,60),($3,$4,'Другой врач',200000,60)`, [id(10), id(1), id(11), id(2)]);
  await db.exec(`insert into practice_availability(expert_id,weekday,start_time,end_time)
    select e.id, d, '00:00', '23:59' from experts e cross join generate_series(1,7) d`);
  await db.query(`insert into usage_wallets(id,owner_type,owner_id,module,balance,total_used,refill_mode)
    values ($1,'anonymous_profile',$2,'body',20000,0,'on_zero')`, [id(20), id(30)]);
  const wallet = () => row("select balance,total_used from usage_wallets where id=$1", [id(20)]);
  const start = (days, hour = 10) => {
    const date = new Date(Date.now() + days * 86400000);
    date.setUTCHours(hour, 0, 0, 0);
    return date.toISOString();
  };
  const reserve = (key, when = start(3), service = id(10), doctor = id(1), expected = 20000) => value(`
    select reserve_practice_booking_with_credits($1,null,null,$2,'anonymous_profile',$3,'health-session',
      $4,null,$5,$6,'12h-20-v1')`, [doctor, service, id(30), when, key, expected]);
  const cancel = (booking, fee) => value(
    "select cancel_practice_booking_with_credits($1,'patient',$2)", [booking, fee]);
  const quote = (booking) => value("select quote_practice_booking_cancellation($1)", [booking]);

  assert.equal(await value("select price_credits from practice_services where id=$1", [id(10)]), 20000);
  await assert.rejects(reserve("changed-price", start(3), id(10), id(1), 19000), { code: "P0011" });
  assert.equal(await value("select count(*)::int from practice_bookings"), 0);
  const paid = await reserve("first");
  assert.equal(paid.status, "confirmed");
  assert.equal((await wallet()).balance, 0);
  assert.equal((await wallet()).total_used, 20000);
  assert.equal((await reserve("first")).idempotent_replay, true);
  assert.equal(await value("select count(*)::int from usage_ledger"), 1);
  await assert.rejects(reserve("insufficient", start(4), id(11), id(2)), { code: "P0010" });
  assert.equal(await value("select count(*)::int from practice_bookings"), 1, "failed debit leaves no slot");
  assert.equal((await wallet()).balance, 0, "on_zero never replenishes booking credit");
  await assert.rejects(reserve("first", start(5)), { code: "23505" });
  const earlyQuote = await quote(paid.id);
  assert.equal(earlyQuote.cancellation_fee_credits, 0);
  assert.equal((await cancel(paid.id, 0)).refund_credits, 20000);
  assert.equal((await wallet()).balance, 20000);
  assert.equal((await cancel(paid.id, 0)).idempotent_replay, true);
  assert.equal(await value("select count(*)::int from usage_ledger"), 2);
  assert.equal((await reserve("first")).status, "cancelled", "retry after cancellation cannot charge again");

  const near = await reserve("near", start(4));
  await db.query("update practice_bookings set starts_at=now()+interval '11 hours',ends_at=now()+interval '12 hours' where id=$1", [near.id]);
  await db.query("update practice_services set price_kop=300000 where id=$1", [id(10)]);
  assert.equal((await quote(near.id)).cancellation_fee_credits, 4000, "booked price is immutable");
  await assert.rejects(cancel(near.id, 0), { code: "P0013" });
  assert.equal((await wallet()).balance, 0);
  const late = await cancel(near.id, 4000);
  assert.equal(late.refund_credits, 16000);
  assert.equal((await wallet()).balance, 16000);
  assert.equal((await wallet()).total_used, 4000);
  assert.equal((await cancel(near.id, 4000)).refund_credits, 16000);
  assert.equal((await wallet()).balance, 16000);

  const boundary = await row(`select
    practice_cancellation_fee(20000,'2030-01-02 12:00Z','2030-01-02 00:00Z') as exact,
    practice_cancellation_fee(20000,'2030-01-02 12:00Z','2030-01-02 00:00:00.001Z') as late,
    practice_cancellation_fee(20000,'2030-01-02 12:00Z','2030-01-01 23:59:59.999Z') as early`);
  assert.deepEqual(boundary, { exact: 0, late: 4000, early: 0 });

  await db.query("update usage_wallets set balance=20000 where id=$1", [id(20)]);
  await db.query("update practice_services set price_kop=200000 where id=$1", [id(10)]);
  const completed = await reserve("complete", start(5));
  const settle = () => value("select complete_practice_booking_with_credits($1,'doctor')", [completed.id]);
  assert.equal((await settle()).service_fee_credits, 4000);
  assert.equal((await settle()).idempotent_replay, true);
  await assert.rejects(cancel(completed.id, 4000), { code: "22023" });
  assert.equal((await wallet()).balance, 0);

  // Requests queued together execute against the same real SQL balance.
  await db.query("update usage_wallets set balance=20000 where id=$1", [id(20)]);
  const competing = await Promise.allSettled([
    reserve("compete-a", start(6)), reserve("compete-b", start(7), id(11), id(2)),
  ]);
  assert.equal(competing.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(competing.find((result) => result.status === "rejected").reason.code, "P0010");
  assert.equal((await wallet()).balance, 0);

  // A conflicting slot rolls back without debiting another patient's wallet.
  await db.query("update usage_wallets set balance=20000 where id=$1", [id(20)]);
  const occupied = competing.find((result) => result.status === "fulfilled").value.id;
  const occupiedBooking = await row("select starts_at,service_id,expert_id from practice_bookings where id=$1", [occupied]);
  await assert.rejects(reserve("same-slot", occupiedBooking.starts_at, occupiedBooking.service_id, occupiedBooking.expert_id), { code: "23P01" });
  assert.equal((await wallet()).balance, 20000);
  await db.query("update usage_wallets set status='paused' where id=$1", [id(20)]);
  await assert.rejects(reserve("paused", start(10)), { code: "P0012" });
  await db.query("update usage_wallets set status='active' where id=$1", [id(20)]);

  // Legacy holds now charge the wallet on explicit confirmation.
  const legacy = await value(`
    select reserve_practice_booking($1,null,null,$2,'anonymous_profile',$3,'health-session',
      $4,null,'legacy-hold',10)`, [id(1), id(10), id(30), start(11)]);
  const legacyPaid = await value("select pay_practice_booking_credits($1,20000,'12h-20-v1')", [legacy.id]);
  assert.equal(legacyPaid.status, "confirmed");
  assert.equal((await wallet()).balance, 0);
  assert.equal((await cancel(legacy.id, 0)).refund_credits, 20000);

  // Earlier simulated payments retain their pre-credit completion path.
  const simulated = await value(`
    select reserve_practice_booking($1,null,null,$2,'anonymous_profile',$3,'health-session',
      $4,null,'old-test-payment',10)`, [id(1), id(10), id(30), start(12)]);
  await value("select confirm_practice_booking($1,'old-test','patient_test')", [simulated.id]);
  const oldCompletion = await value("select complete_practice_booking_with_credits($1,'doctor')", [simulated.id]);
  assert.equal(oldCompletion.status, "completed");
  assert.ok(oldCompletion.commission_id);

  await db.query("update practice_services set price_kop=1 where id=$1", [id(11)]);
  assert.equal(await value("select price_credits from practice_services where id=$1", [id(11)]), 1);
  await db.query("update practice_services set price_kop=0 where id=$1", [id(11)]);
  const free = await reserve("free", start(13), id(11), id(2), 0);
  assert.equal(free.status, "confirmed");
  assert.equal((await cancel(free.id, 0)).refund_credits, 0);

  // Exercise the functions as the actual API database role as well.
  await db.exec("set role service_role");
  const roleBooking = await reserve("service-role", start(14), id(10), id(1), 20000);
  assert.equal((await cancel(roleBooking.id, 0)).refund_credits, 20000);
  await db.exec("reset role");
  await db.exec("set role anon");
  await assert.rejects(db.query("select * from practice_booking_credits"), { code: "42501" });
  await assert.rejects(db.query("select quote_practice_booking_cancellation($1)", [paid.id]), { code: "42501" });
  await db.exec("reset role");
  console.log("PASS real PostgreSQL migrations: conversion, atomic debit/rollback, low balance, idempotency, 12h boundary, 20% refund, snapshot price, settlement, competing requests, role isolation.");
} finally {
  await db.close();
}
