import assert from "node:assert/strict";
import {
  retryDelaySeconds, safeErrorCode, claimOutbox, processOutboxRecord, runOutboxBatch,
} from "./process-clinical-outbox.mjs";

function makePool(initial, options={}) {
  const shared={
    rows:initial.map((x)=>({attempts:0,status:"pending",available_at:null,
      lease_token:null,leased_until:null,...x})),
    receipts:new Set(), failAckOnce:!!options.failAckOnce, nextToken:1,
    commits:0, rollbacks:0,
  };
  function clone() {
    return {rows:shared.rows.map((r)=>({...r})),receipts:new Set(shared.receipts)};
  }
  return {
    shared,
    async connect() {
      let pending=null;
      return {
        release() {},
        async query(sql,args=[]) {
          const s=sql.trim();
          if(s==="BEGIN"){pending=clone();return {rowCount:0,rows:[]};}
          if(s==="COMMIT"){
            shared.rows=pending.rows;shared.receipts=pending.receipts;
            pending=null;shared.commits++;return {rowCount:0,rows:[]};
          }
          if(s==="ROLLBACK"){pending=null;shared.rollbacks++;return {rowCount:0,rows:[]};}
          if(!pending)throw Error("query outside transaction");
          if(s.startsWith("UPDATE clinical_internal.source_outbox")&&s.includes("LEASE_EXHAUSTED")) {
            const expired=pending.rows.filter(r=>r.status==="processing"&&r.expired&&r.attempts>=args[0]);
            for(const row of expired) {
              row.status="dead_letter";row.error_code="LEASE_EXHAUSTED";
              row.leased_until=null;row.lease_token=null;
            }
            return {rows:expired.map(r=>({id:r.id})),rowCount:expired.length};
          }
          if(s.startsWith("WITH candidates")) {
            const [limit,maxAttempts]=args;
            const eligible=pending.rows.filter(r=>r.attempts<maxAttempts&&(
              r.status==="pending"||r.status==="retry"||r.status==="processing"&&r.expired));
            const claimed=eligible.slice(0,limit).map(r=>{
              r.attempts++;r.status="processing";r.lease_token=`00000000-0000-4000-8000-${String(shared.nextToken++).padStart(12,"0")}`;
              r.expired=false;return {id:r.id,lease_token:r.lease_token,attempts:r.attempts};
            });
            return {rows:claimed,rowCount:claimed.length};
          }
          const row=pending.rows.find(r=>r.id===args[0]&&r.lease_token===args[1]&&r.status==="processing");
          if(s.startsWith("SELECT id FROM clinical_internal.source_outbox")) {
            return {rows:row?[{id:row.id}]:[],rowCount:row?1:0};
          }
          if(s.startsWith("INSERT INTO clinical_internal.source_receipts")) {
            if(!row)throw Error("lost lease");
            pending.receipts.add(row.id);return {rowCount:1};
          }
          if(s.startsWith("UPDATE clinical_internal.source_outbox")&&s.includes("status='processed'")) {
            if(shared.failAckOnce){shared.failAckOnce=false;const e=Error("simulated transient failure");e.code="40001";throw e;}
            if(!row)return {rows:[],rowCount:0};
            row.status="processed";row.lease_token=null;return {rows:[{id:row.id}],rowCount:1};
          }
          if(s.startsWith("UPDATE clinical_internal.source_outbox")&&s.includes("dead_letter")) {
            if(!row)return {rows:[],rowCount:0};
            row.status=row.attempts>=args[2]?"dead_letter":"retry";
            row.lease_token=null;
            row.error_code=args[3];return {rows:[{status:row.status}],rowCount:1};
          }
          throw Error("Unrecognized query");
        },
      };
    },
  };
}

assert.equal(retryDelaySeconds(1),5);
assert.equal(retryDelaySeconds(2),10);
assert.equal(retryDelaySeconds(99),3600);
assert.equal(safeErrorCode({message:"patient name",code:"40001"}),"40001");
assert.equal(safeErrorCode({message:"patient name"}),"WORKER_ERROR");
await assert.rejects(()=>claimOutbox(makePool([]),{batchSize:500}),/Invalid batch size/);
const pool=makePool([{id:1},{id:2}]);
let r=await runOutboxBatch(pool);
assert.deepEqual([r.claimed,r.processed],[2,2]);
assert.equal(pool.shared.receipts.size,2);
r=await runOutboxBatch(pool);
assert.equal(r.claimed,0);
assert.equal(pool.shared.receipts.size,2);
const failure=makePool([{id:7}],{failAckOnce:true});
r=await runOutboxBatch(failure);
assert.equal(r.retry,1);
assert.equal(failure.shared.receipts.size,0,"Receipt must roll back with failed ACK");
assert.equal(failure.shared.rows[0].status,"retry");
r=await runOutboxBatch(failure);
assert.equal(r.processed,1);
assert.equal(failure.shared.receipts.size,1);
const exhausted=makePool([{id:9,attempts:5}],{failAckOnce:true});
r=await runOutboxBatch(exhausted);
assert.equal(r.dead_letter,1);
assert.equal(exhausted.shared.receipts.size,0);
const crashedAtLimit=makePool([{id:19,status:"processing",attempts:6,expired:true,
  lease_token:"00000000-0000-4000-8000-000000000222"}]);
const expiredResult=await runOutboxBatch(crashedAtLimit);
assert.equal(expiredResult.claimed,0);
assert.equal(crashedAtLimit.shared.rows[0].status,"dead_letter");
assert.equal(crashedAtLimit.shared.rows[0].error_code,"LEASE_EXHAUSTED");
const lost=makePool([{id:11,status:"processed"}]);
assert.equal(await processOutboxRecord(lost,{id:11,lease_token:"00000000-0000-4000-8000-000000000111",attempts:1}),"lease_lost");
console.log("Clinical outbox worker: 19 synthetic assertions passed; no EHR connections");
