"""One Edge TTS request on the wire, timed to its narration.

    pnpm narrate demo.html --out demo.narrated.html --export clips
    NARRATION_CLIP=clips/01-here-is-one-request-on-the-wire-first-th.json \
        manim -qm src/manim/examples/request_on_the_wire.py RequestOnTheWire

Cues spoken by the clip: config, ssml, audio, turnend.
"""

import os
import sys
from pathlib import Path

from manim import (DOWN, LEFT, RIGHT, UP, Create, FadeIn, FadeOut, Flash, Indicate, LaggedStart, Line,
                   Rectangle, RoundedRectangle, Succession, Text, VGroup, Write, config, linear,
                   normalize)

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from narrated_scene import NarratedScene  # noqa: E402

# Cyberpunk skin, dark register
GROUND = "#060d14"
CYAN = "#00e5ff"
MAGENTA = "#ff2a4d"
VIOLET = "#c77dff"
TEXT = "#e2f4fa"
DIM = "#3a5568"
MONO = "Consolas"

AUDIO_CHUNKS = 6
TRAVEL_SECONDS = 1.4

config.background_color = GROUND


def label(text, size=24, color=TEXT):
    return Text(text, font=MONO, font_size=size, color=color)


def node(title, subtitle):
    box = Rectangle(width=3.2, height=1.8, color=CYAN, stroke_width=3)
    return VGroup(box, VGroup(label(title, 30), label(subtitle, 18, DIM)).arrange(DOWN, buff=0.15))


def packet(text, color):
    tag = label(text, 20, GROUND)
    chip = RoundedRectangle(corner_radius=0.0, width=tag.width + 0.4, height=0.5,
                            fill_color=color, fill_opacity=1, stroke_width=0)
    return VGroup(chip, tag)


def inset(item, start, end):
    """Pull both ends of a wire in by half the packet's width, so packets never overlap the boxes."""
    step = normalize(end - start) * (item.width / 2 + 0.1)
    return start + step, end - step


class RequestOnTheWire(NarratedScene):
    clip = os.environ.get("NARRATION_CLIP", "")

    def send(self, item, start, end, run_time=TRAVEL_SECONDS):
        start, end = inset(item, start, end)
        item.move_to(start)
        self.play(FadeIn(item, scale=0.6), run_time=0.25)
        self.play(item.animate.move_to(end), run_time=run_time, rate_func=linear)
        self.play(FadeOut(item, scale=0.6), run_time=0.25)

    def construct(self):
        title = label("ONE REQUEST ON THE WIRE", 34, CYAN).to_edge(UP, buff=0.5)
        client = node("CLIENT", "narrate CLI").shift(LEFT * 4.6 + UP * 0.4)
        server = node("EDGE TTS", "speech.platform").shift(RIGHT * 4.6 + UP * 0.4)
        wire = Line(client.get_right(), server.get_left(), color=DIM, stroke_width=4)
        upstream = wire.copy().shift(UP * 0.35).set_opacity(0)
        downstream = wire.copy().shift(DOWN * 0.35).set_opacity(0)

        steps = VGroup(*(label(text, 22, DIM) for text in
                         ("1 config", "2 SSML", "3 audio x N", "4 turn.end"))).arrange(RIGHT, buff=0.9)
        steps.to_edge(DOWN, buff=0.7)

        self.play(Write(title), run_time=0.8)
        self.play(FadeIn(client, shift=RIGHT * 0.3), FadeIn(server, shift=LEFT * 0.3), run_time=0.7)
        self.play(Create(wire), FadeIn(steps), run_time=0.7)

        self.until("config")
        self.play(steps[0].animate.set_color(CYAN), wire.animate.set_color(CYAN), run_time=0.3)
        self.send(packet("speech.config  mp3 24k", CYAN), upstream.get_start(), upstream.get_end())
        self.play(Indicate(server[0], color=CYAN), run_time=0.6)

        self.until("ssml")
        self.play(steps[1].animate.set_color(MAGENTA), run_time=0.3)
        self.send(packet("ssml  <voice>text</voice>", MAGENTA), upstream.get_start(), upstream.get_end())
        self.play(Indicate(server[0], color=MAGENTA), run_time=0.6)

        self.until("audio")
        self.play(steps[2].animate.set_color(VIOLET), run_time=0.3)
        chunks = [packet("audio", VIOLET) for _ in range(AUDIO_CHUNKS)]
        chunk_start, chunk_end = inset(chunks[0], downstream.get_end(), downstream.get_start())
        for chunk in chunks:
            chunk.move_to(chunk_start)
        self.play(LaggedStart(*(Succession(FadeIn(chunk, run_time=0.15),
                                           chunk.animate(rate_func=linear, run_time=1.2)
                                           .move_to(chunk_end),
                                           FadeOut(chunk, run_time=0.15))
                                for chunk in chunks), lag_ratio=0.35), run_time=3.2)

        self.until("turnend")
        self.play(steps[3].animate.set_color(CYAN), run_time=0.3)
        self.send(packet("turn.end", TEXT), downstream.get_end(), downstream.get_start())
        closed = label("REQUEST CLOSED", 26, MAGENTA).next_to(wire, UP, buff=0.9)
        self.play(wire.animate.set_color(DIM), Flash(client[0].get_right(), color=CYAN),
                  FadeIn(closed), run_time=0.6)

        self.finish()
