export function speechText(message) {
  return [...new Set([message?.answer, message?.safety_note, message?.small_next_step, message?.question_for_specialist].filter(v => typeof v === 'string' && v.trim()))].join('\n\n');
}
