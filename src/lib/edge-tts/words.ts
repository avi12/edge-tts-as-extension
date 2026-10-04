// Word boundaries name the spoken word but not where it sits in the text, so each is found
// after the previous one
export function createWordLocator({ text, iStart = 0 }: {
  text: string;
  iStart?: number;
}) {
  let iCursor = iStart;
  return (word: string) => {
    const iWord = text.indexOf(word, iCursor);
    if (iWord < 0) {
      return null;
    }

    iCursor = iWord + word.length;
    return iWord;
  };
}
