"""Time a Manim scene to a narration clip exported by `pnpm narrate --export <dir>`.

The export writes `NN-slug.mp3` beside `NN-slug.json`:
    { "duration": s, "text": ..., "words": [[s, charStart, charLength], ...], "cues": [[name, s], ...] }

Write the narration first (cues as `[[name]]` markers), export it, then let the cues drive the scene:

    from narrated_scene import NarratedScene

    class Explainer(NarratedScene):
        clip = "clips/01-here-is-one-request.json"   # the mp3 is found beside it

        def construct(self):
            self.play(FadeIn(title))          # the voice was added at t=0 by setup()
            self.until("config")              # wait for the [[config]] cue...
            self.play(GrowArrow(arrow))       # ...so this starts as the cue is spoken
            self.finish()                     # hold until the voice ends

    manim -qm explainer.py Explainer          # mp4 with the voice muxed in

Cues are moments where an animation STARTS, so keep each beat's animations shorter than the gap to
the next cue. If a beat overruns, `until` logs a warning and continues (the visuals drift late).
"""

import json
import logging
from pathlib import Path

from manim import Scene

logger = logging.getLogger("manim")

# Smaller gaps than this are rounding noise, not worth a wait() (which would also emit a frame)
MIN_WAIT_SECONDS = 1e-3


class NarratedScene(Scene):
    """Scene whose clock is driven by one exported narration clip (JSON + mp3 beside it)."""

    clip: str | Path = ""

    def setup(self):
        """Runs before construct(): load the clip's timings and start its mp3 at scene time 0."""
        # narration_* names: Scene already owns .duration (last play length) and .time
        json_path = Path(self.clip).resolve()
        timings = json.loads(json_path.read_text(encoding="utf-8"))
        self.narration_duration: float = timings["duration"]
        self.narration_text: str = timings["text"]
        self.narration_words: list[list] = timings["words"]
        self.cues: dict[str, float] = dict(timings["cues"])
        self.add_sound(str(json_path.with_suffix(".mp3")), time_offset=0)

    @property
    def now(self) -> float:
        """Scene clock in seconds (CairoRenderer.time, advanced by every play/wait)."""
        return self.renderer.time

    def wait_until(self, seconds: float, label: str = ""):
        """wait() until the scene clock reaches `seconds`; warn instead if it already passed."""
        gap = seconds - self.now
        if gap > MIN_WAIT_SECONDS:
            self.wait(gap)
        elif gap < -MIN_WAIT_SECONDS:
            logger.warning(f"NarratedScene: {label or seconds} at {seconds:.3f}s already passed "
                           f"(scene is at {self.now:.3f}s, {-gap:.3f}s late)")

    def until(self, cue: str):
        """Wait until the narration reaches `[[cue]]` (the first word spoken after the marker)."""
        if cue not in self.cues:
            raise KeyError(f"No cue '{cue}' in clip (cues: {', '.join(self.cues)})")
        self.wait_until(self.cues[cue], f"cue '{cue}'")

    def finish(self):
        """Hold the last frame until the narration ends."""
        self.wait_until(self.narration_duration, "end of narration")
