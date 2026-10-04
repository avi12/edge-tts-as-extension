const MAX_CHUNK_LENGTH = 3000;
const SENTENCE_ENDS = [". ", "! ", "? ", "\n"];
const MIN_SENTENCE_CUT_RATIO = 0.5;

export interface TextChunk {
  text: string;
  start: number;
}

function findChunkEnd({ text, iStart, maxLength }: {
  text: string;
  iStart: number;
  maxLength: number;
}) {
  const iLimit = Math.min(iStart + maxLength, text.length);
  const isLastChunk = iLimit === text.length;
  if (isLastChunk) {
    return iLimit;
  }

  const candidate = text.slice(iStart, iLimit);
  const iSentenceEnd = Math.max(...SENTENCE_ENDS.map(sentenceEnd => candidate.lastIndexOf(sentenceEnd)));
  const isSentenceEndLateEnough = iSentenceEnd > maxLength * MIN_SENTENCE_CUT_RATIO;
  if (isSentenceEndLateEnough) {
    return iStart + iSentenceEnd + 1;
  }

  const iSpace = candidate.lastIndexOf(" ");
  if (iSpace > 0) {
    return iStart + iSpace;
  }

  return iLimit;
}

export function chunkText({ text, maxLength = MAX_CHUNK_LENGTH }: {
  text: string;
  maxLength?: number;
}) {
  const chunks: TextChunk[] = [];
  let iStart = 0;
  while (iStart < text.length) {
    const iEnd = findChunkEnd({
      text,
      iStart,
      maxLength
    });
    const chunk = text.slice(iStart, iEnd);
    const isBlank = chunk.trim() === "";
    if (!isBlank) {
      chunks.push({
        text: chunk,
        start: iStart
      });
    }

    iStart = iEnd;
  }

  return chunks;
}
