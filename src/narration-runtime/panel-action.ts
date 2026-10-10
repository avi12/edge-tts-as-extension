// What the tour panel's buttons ask for. Its own module so the panel component and the runtime that
// mounts it can both name an action without importing each other
export enum PanelAction {
  Tour = "tour",
  Previous = "previous",
  Back = "back",
  Pause = "pause",
  Resume = "resume",
  Next = "next",
  Stop = "stop"
}
