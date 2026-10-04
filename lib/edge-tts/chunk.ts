/**
 * Long text is split into requests the service handles comfortably.
 * Splits prefer sentence ends, then any whitespace, then a hard cut.
 */
export const MAX_CHUNK_CHARS = 3000;

export interface TextChunk {
  text: string;
  /** Index of this chunk's first character in the original text. */
  start: number;
}

export function chunkText(text: string, max = MAX_CHUNK_CHARS): TextChunk[] {
  const chunks: TextChunk[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + max, text.length);
    if (end < text.length) {
      const window = text.slice(start, end);
      const sentence = Math.max(
        ...['. ', '! ', '? ', '\n'].map((s) => window.lastIndexOf(s)),
      );
      const space = window.lastIndexOf(' ');
      const cut = sentence > max / 2 ? sentence + 1 : space > 0 ? space : -1;
      if (cut > 0) end = start + cut;
    }
    const piece = text.slice(start, end);
    if (piece.trim()) chunks.push({ text: piece, start });
    start = end;
  }
  return chunks;
}
