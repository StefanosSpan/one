// Translation of the staff screens for venues in the United States (no DOM here: also used by tests and tools).
// The screens are written in Greek. A text is translated piece by piece: numbers, separators and brackets split it,
// each piece is looked up in the dictionary, and a piece that is not there is put together from the longest known
// phrases. Missing words are reported through `onMissing`.
export const GREEK = /[Ͱ-Ͽἀ-῿]/;

// Separators (kept as they are): middle dots, bars, dashes, colons, line breaks, brackets, quotes, numbers and prices.
const SPLIT = /(\s*(?:[·|•\n\t…]|—|–|:(?=\s|$)|\s-\s|[!?;](?=\s|$))\s*|[()«»"“”[\]]|[+\-−]?\d[\d.,:/%′'×]*\s*(?:€|\$|%)?|€|\$|%)/;
const EDGE = /^([\s,.;!?]*)([\s\S]*?)([\s,.;!?]*)$/;

/** Splits a text into [piece, isSeparator] pairs. */
export function pieces(text) {
  // split() with one capturing group alternates text, separator, text, separator…
  return String(text).split(SPLIT).map((p, i) => [p ?? '', i % 2 === 1]).filter(([p]) => p !== '');
}

/** The dictionary keys a source text gives (used to build and check the dictionary). */
export function keysOf(text) {
  const out = [];
  for (const [p, sep] of pieces(text)) {
    if (sep || !GREEK.test(p)) continue;
    const key = p.match(EDGE)[2].trim();
    if (key && GREEK.test(key)) out.push(key);
  }
  return out;
}

// Longest known phrases first, for pieces made of several dictionary entries (e.g. a label next to a value).
// All or nothing: a piece with a Greek word that is not in the dictionary stays as it is, so the owner's own texts
// (a dish name or description written in Greek) are never half translated.
function compose(piece, dict, onMissing) {
  const words = piece.split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < words.length;) {
    let done = false;
    for (let j = Math.min(words.length, i + 12); j > i; j--) {
      const phrase = words.slice(i, j).join(' ');
      const [, lead, core, tail] = phrase.match(EDGE);
      if (dict[core] !== undefined) { out.push(lead + dict[core] + tail); i = j; done = true; break; }
    }
    if (!done) {
      if (GREEK.test(words[i])) { onMissing?.(piece); return piece; }
      out.push(words[i]);
      i += 1;
    }
  }
  return out.join(' ');
}

/** English for a Greek text of the staff screens (texts without Greek letters come back unchanged). */
export function translate(text, dict, onMissing) {
  if (!text || !GREEK.test(text)) return text;
  const [, lead, core, tail] = String(text).match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (dict[core] !== undefined) return lead + dict[core] + tail;
  return pieces(text).map(([p, sep]) => {
    // A middle dot right after a word is the Greek semicolon ("υπολογιστή· συνδέονται"); between spaces it is a separator.
    if (sep) return (/^·\s/.test(p) ? `;${p.slice(1)}` : p).replace(/«/g, '“').replace(/»/g, '”');
    const [, l, c, t] = p.match(EDGE);
    if (dict[c] !== undefined) return l + dict[c] + t;
    const [, ws1, body, ws2] = p.match(/^(\s*)([\s\S]*?)(\s*)$/);
    return ws1 + compose(body, dict, onMissing) + ws2;
  }).join('');
}
