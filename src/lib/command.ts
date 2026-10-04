// Zod-free, so the narration runtime embedded in pages can send the same commands as the popup
export enum Command {
  Speak = "speak",
  Stop = "stop",
  Pause = "pause",
  Resume = "resume",
  GetState = "get-state"
}
