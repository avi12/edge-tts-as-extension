import { parseNarrationScript, timeNarration } from "@/lib/narration";
import { describe, expect, it } from "vitest";

describe("parseNarrationScript", () => {
  it("strips cue markers and records where each cue starts", () => {
    const { text, cues } = parseNarrationScript("The popup sends a request [[wire]] across the wire, then [[audio]]audio streams back");
    expect(text).toBe("The popup sends a request across the wire, then audio streams back");
    expect(cues).toEqual([
      {
        name: "wire",
        start: text.indexOf("across")
      },
      {
        name: "audio",
        start: text.indexOf("audio")
      }
    ]);
  });

  it("collapses whitespace from multi-line attributes", () => {
    expect(parseNarrationScript("  [[a]] First line\n      second   line  ").text).toBe("First line second line");
  });

  it("leaves scripts without markers alone", () => {
    expect(parseNarrationScript("Just words")).toEqual({
      text: "Just words",
      cues: []
    });
  });
});

describe("timeNarration", () => {
  it("places words in the text and times each cue at its first word", () => {
    const { text, cues } = parseNarrationScript("Look left. [[box]] The box, then [[wire]] the wire");
    const boundaries = ["Look", "left", "The", "box", "then", "the", "wire"].map((word, i) => ({
      time: i * 0.5,
      duration: 0.4,
      text: word
    }));
    expect(
      timeNarration({
        text,
        cues,
        boundaries,
        duration: 4
      })
    ).toEqual({
      words: [[0, 0, 4], [0.5, 5, 4], [1, 11, 3], [1.5, 15, 3], [2, 20, 4], [2.5, 25, 3], [3, 29, 4]],
      cues: [["box", 1], ["wire", 2.5]]
    });
  });

  it("times a trailing cue at the end of the audio", () => {
    const { text, cues } = parseNarrationScript("Done [[end]]");
    expect(
      timeNarration({
        text,
        cues,
        boundaries: [{
          time: 0,
          duration: 0.3,
          text: "Done"
        }],
        duration: 0.8
      }).cues
    ).toEqual([["end", 0.8]]);
  });
});
