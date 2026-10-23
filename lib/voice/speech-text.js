export function speechText(message) {
  return [...new Set([message?.answer, message?.safety_note, message?.small_next_step, message?.question_for_specialist].filter(v => typeof v === 'string' && v.trim()))].join('\n\n');
}

// Keep every character, including safety notes. Short first audio becomes ready
// before the rest; subsequent chunks can be fetched during playback.
export function speechChunks(text) {
  const chunks = [];
  let remaining = text;
  while (remaining.length) {
    const limit = chunks.length ? 420 : 240;
    let end = Math.min(limit, remaining.length);
    if (end < remaining.length) {
      const prefix = remaining.slice(0, end);
      const sentences = [...prefix.matchAll(/[.!?…]\s+/g)];
      const sentence = sentences.at(-1);
      const boundary = sentence ? sentence.index + sentence[0].length : prefix.lastIndexOf(' ') + 1;
      if (boundary > limit / 3) end = boundary;
    }
    chunks.push(remaining.slice(0, end));
    remaining = remaining.slice(end);
  }
  return chunks;
}
