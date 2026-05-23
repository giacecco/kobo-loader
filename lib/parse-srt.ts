/**
 * Parse an SRT subtitle file into clean, readable text.
 *
 * Handles YouTube auto-captions quirks:
 * - Deduplicates consecutive identical lines (common with auto-captions)
 * - Merges short sentence fragments into paragraphs
 * - Strips all timing and index metadata
 */
export function parseSrt(content: string): string {
  const blocks = content.trim().split(/\n\n+/);

  const texts: string[] = [];

  for (const block of blocks) {
    const lines = block.split("\n");

    // Skip index line and timestamp line(s)
    // SRT format: index, timestamp, text...
    let textStart = 1;
    // Some SRT variants have the timestamp on line 2, some on line 1 with index
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].includes("-->")) {
        textStart = i;
        break;
      }
    }

    const text = lines.slice(textStart).join(" ").replace(/<[^>]+>/g, "").trim();
    if (text) {
      texts.push(text);
    }
  }

  // YouTube auto-captions use a rolling display window: each SRT block
  // contains the tail of the previous block plus new words. Strip the
  // repeated prefix so each entry holds only newly added content.
  const deduped = removeRollingOverlap(texts);

  // Merge into paragraphs: split on sentence-ending punctuation
  // followed by uppercase = new sentence, else continuation
  return mergeIntoParagraphs(deduped);
}

function removeRollingOverlap(texts: string[]): string[] {
  if (texts.length === 0) return [];
  const result: string[] = [texts[0]];

  for (let i = 1; i < texts.length; i++) {
    const prevWords = texts[i - 1].split(/\s+/).filter(Boolean);
    const currWords = texts[i].split(/\s+/).filter(Boolean);

    // Find the longest suffix of texts[i-1] that is a prefix of texts[i].
    // That overlap is content already emitted; only the remainder is new.
    let overlap = 0;
    const maxLen = Math.min(prevWords.length, currWords.length);
    for (let len = maxLen; len > 0; len--) {
      if (
        prevWords.slice(-len).join(" ").toLowerCase() ===
        currWords.slice(0, len).join(" ").toLowerCase()
      ) {
        overlap = len;
        break;
      }
    }

    const newContent = currWords.slice(overlap).join(" ").trim();
    if (newContent) result.push(newContent);
  }

  return result;
}

function mergeIntoParagraphs(lines: string[]): string {
  if (lines.length === 0) return "";

  const paragraphs: string[] = [];
  let current = lines[0];

  for (let i = 1; i < lines.length; i++) {
    const prev = current;
    const next = lines[i];

    // If the previous segment ends mid-sentence (no sentence-ending punctuation),
    // or the next segment starts lowercase, it's likely a continuation
    const prevEndsSentence = /[.!?]$/.test(prev);
    const nextStartsLowerCase = /^[a-z]/.test(next);

    if (!prevEndsSentence || nextStartsLowerCase) {
      current += " " + next;
    } else {
      paragraphs.push(current);
      current = next;
    }
  }

  paragraphs.push(current);

  return paragraphs.join("\n\n");
}
