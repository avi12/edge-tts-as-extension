// Where a narrated page can be. Both narration content scripts match on this list, so a
// site is added in exactly one place - and this file imports nothing, because WXT loads
// an entrypoint to read its definition and a heavy import there costs every build.
//
// - Claude's artifact frames: where narrated pages are published
// - localhost / 127.0.0.1: an author previewing one before it is published
// - the maths study pad: its סדרות chapter is six narrated scenes, built from the same
//   contract by that project's workbook/build/seqreel.py

export const NARRATED_SITES = [
  "https://*.claudeusercontent.com/*",
  "http://localhost/*",
  "http://127.0.0.1/*",
  "https://avi-math-study.web.app/*"
];
