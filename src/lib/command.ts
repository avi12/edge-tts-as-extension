// Zod-free, so the narration runtime embedded in pages can send the same commands as the popup.
// The strings are ours, but they are also the external API the README publishes for other extensions
// (chrome.runtime.sendMessage with { type: "speak" | "pause" | "resume" | "stop" | "get-state" }),
// so renaming one breaks a caller we do not ship
export enum Command {
  Speak = "speak",
  Stop = "stop",
  Pause = "pause",
  Resume = "resume",
  GetState = "get-state"
}
