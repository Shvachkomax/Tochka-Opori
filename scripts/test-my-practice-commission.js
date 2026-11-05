import assert from "node:assert/strict";
import { quotePracticeCommission, simulatePracticeSettlement, formatPracticeRubles, MY_PRACTICE_DEFAULT_FEE_BPS } from "../lib/my-practice/commission.js";

assert.equal(MY_PRACTICE_DEFAULT_FEE_BPS,2000);
assert.deepEqual(quotePracticeCommission(500000),{
  priceKopecks:500000,feeBps:2000,platformFeeKopecks:100000,organizationShareKopecks:400000
});
for(const amount of [0,1,3,7,99,101,205,500000,1000000000]){
  const q=quotePracticeCommission(amount);
  assert.equal(q.platformFeeKopecks+q.organizationShareKopecks,amount);
  assert(q.platformFeeKopecks>=0 && q.organizationShareKopecks>=0);
}
assert.equal(quotePracticeCommission(105).platformFeeKopecks,21);
assert.equal(quotePracticeCommission(13).platformFeeKopecks,3);
assert.equal(quotePracticeCommission(999,0).platformFeeKopecks,0);
assert.equal(quotePracticeCommission(999,10000).organizationShareKopecks,0);
assert.throws(()=>quotePracticeCommission(-1),RangeError);
assert.throws(()=>quotePracticeCommission(20.5),RangeError);
assert.throws(()=>quotePracticeCommission(Number.NaN),RangeError);
assert.throws(()=>quotePracticeCommission(100,10001),RangeError);

const unpaid=simulatePracticeSettlement({grossPaidKopecks:500000});
assert.equal(unpaid.commissionStatus,"unconfirmed");
assert.equal(unpaid.payablePlatformFeeKopecks,0);
const paidButOpen=simulatePracticeSettlement({grossPaidKopecks:500000,paymentConfirmed:true});
assert.equal(paidButOpen.commissionStatus,"held");
assert.equal(paidButOpen.payablePlatformFeeKopecks,0);
const finishedStillHeld=simulatePracticeSettlement({grossPaidKopecks:500000,paymentConfirmed:true,serviceCompleted:true});
assert.equal(finishedStillHeld.payablePlatformFeeKopecks,0);
const payable=simulatePracticeSettlement({grossPaidKopecks:500000,paymentConfirmed:true,serviceCompleted:true,holdReleased:true});
assert.equal(payable.payablePlatformFeeKopecks,100000);
const partialRefund=simulatePracticeSettlement({grossPaidKopecks:500000,refundedKopecks:150000,paymentConfirmed:true,serviceCompleted:true,holdReleased:true});
assert.equal(partialRefund.net.platformFeeKopecks,70000);
assert.equal(partialRefund.reversedFeeKopecks,30000);
const fullRefund=simulatePracticeSettlement({grossPaidKopecks:500000,refundedKopecks:500000,paymentConfirmed:true,serviceCompleted:true,holdReleased:true});
assert.equal(fullRefund.net.platformFeeKopecks,0);
assert.equal(fullRefund.reversedFeeKopecks,100000);
assert.throws(()=>simulatePracticeSettlement({grossPaidKopecks:100,refundedKopecks:101}),RangeError);
assert.match(formatPracticeRubles(500000),/5\s?000/u);
console.log("My Practice: 20% commission model, payment gates and refunds — PASS");
