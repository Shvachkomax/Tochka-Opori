import assert from "node:assert/strict";
import {
  FIRST_SCREEN_INVITATIONS,
  CABINET_INVITATIONS,
  buildCabinetInvitations,
  buildDialogueInvitationContext,
  buildDialogueInvitationPromptNote,
  formatDayCount,
  getCabinetInvitationById,
  getFirstScreenInvitationById,
  getPreviousVisitGapDays,
  getSupportInvitationById,
} from "../lib/support/dialogue-invitations.js";

console.log("First-screen invitation catalog");
assert.deepEqual(
  FIRST_SCREEN_INVITATIONS.map((item) => item.id),
  [
    "first_start",
    "first_anxiety",
    "first_relationships",
    "first_body",
    "first_sleep",
    "first_day",
    "first_prepare",
  ],
);
assert.deepEqual(
  FIRST_SCREEN_INVITATIONS.map((item) => item.topic),
  [
    "start",
    "anxiety",
    "work_relationships",
    "body_sensations",
    "sleep",
    "daily_life",
    "preparing_questions",
  ],
);
assert.equal(getFirstScreenInvitationById("first_sleep")?.topic, "sleep");
assert.equal(getFirstScreenInvitationById("cabinet_checkin"), null);
assert.equal(getCabinetInvitationById("cabinet_checkin")?.topic, "current_state");
assert.equal(getCabinetInvitationById("first_sleep"), null);
assert.equal(getSupportInvitationById("cabinet_checkin")?.topic, "current_state");

console.log("Cabinet invitation selection");
const base = buildCabinetInvitations();
assert.deepEqual(base.map((item) => item.id), ["cabinet_checkin", "cabinet_day", "cabinet_now"]);

const previous = new Date(2026, 9, 20, 12);
const oneDayLater = new Date(2026, 9, 21, 8);
const withRecentConversation = buildCabinetInvitations({
  hasPreviousConversation: true,
  previousVisitAt: previous,
  now: oneDayLater,
});
assert.deepEqual(withRecentConversation.map((item) => item.id), [
  "cabinet_checkin",
  "cabinet_day",
  "cabinet_now",
  "cabinet_continue",
]);

const threeDaysLater = new Date(2026, 9, 23, 8);
const withGap = buildCabinetInvitations({
  hasPreviousConversation: true,
  previousVisitAt: previous,
  now: threeDaysLater,
});
assert.deepEqual(withGap.map((item) => item.id), [
  "cabinet_gap",
  "cabinet_checkin",
  "cabinet_day",
  "cabinet_now",
  "cabinet_continue",
]);
assert.equal(withGap[0].text, "С прошлого посещения прошло 3 дня. Как вы сейчас?");
assert.equal(withGap[0].gapDays, 3);

const withoutConversation = buildCabinetInvitations({
  hasPreviousConversation: false,
  previousVisitAt: previous,
  now: threeDaysLater,
});
assert.ok(!withoutConversation.some((item) => item.id === "cabinet_gap"));
assert.ok(!withoutConversation.some((item) => item.id === "cabinet_continue"));

console.log("Gap date handling");
assert.equal(getPreviousVisitGapDays(null, threeDaysLater), null);
assert.equal(getPreviousVisitGapDays("not-a-date", threeDaysLater), null);
assert.equal(getPreviousVisitGapDays("2026-10-24T12:00:00", threeDaysLater), null);
assert.equal(getPreviousVisitGapDays(previous, threeDaysLater), 3);
assert.equal(formatDayCount(3), "3 дня");
assert.equal(formatDayCount(5), "5 дней");
assert.equal(formatDayCount(11), "11 дней");
assert.equal(formatDayCount(21), "21 день");
assert.equal(formatDayCount(22), "22 дня");
assert.ok(CABINET_INVITATIONS.some((item) => item.id === "cabinet_gap"));
assert.ok(Object.isFrozen(base));

console.log("Trusted invitation context");
assert.equal(getSupportInvitationById("unknown"), null);
assert.equal(getSupportInvitationById("first_sleep<script>"), null);
assert.equal(getSupportInvitationById({ id: "first_sleep" }), null);
assert.equal(getSupportInvitationById("x".repeat(65)), null);

const sleepContext = buildDialogueInvitationContext("first_sleep");
assert.deepEqual(sleepContext, {
  id: "first_sleep",
  topic: "sleep",
  contextText: "Трудно уснуть или восстановить силы? Как это проявляется у вас?",
});
assert.equal(buildDialogueInvitationContext("unknown"), null);
assert.equal(buildDialogueInvitationContext("cabinet_gap"), null);
assert.equal(buildDialogueInvitationContext("cabinet_gap", { gapDays: 2 }), null);
assert.equal(
  buildDialogueInvitationContext("cabinet_gap", { gapDays: 5 })?.contextText,
  "Человек вернулся после перерыва 5 дней.",
);

const note = buildDialogueInvitationPromptNote(sleepContext);
assert.match(note, /не ответ пользователя/);
assert.match(note, /не клинический симптом/);
assert.match(note, /Трудно уснуть/);
assert.equal(buildDialogueInvitationPromptNote(null), "");
assert.equal(buildDialogueInvitationPromptNote({ contextText: "" }), "");

console.log("All support dialogue invitation checks passed.");
