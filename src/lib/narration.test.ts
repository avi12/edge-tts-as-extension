import { getDeclaredLanguage, parseNarrationScript, timeNarration } from "@/lib/narration";
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
      cues: [["box", 1, 11], ["wire", 2.5, 25]]
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
    ).toEqual([["end", 0.8, 5]]);
  });

  it("finds words whose typographic quotes the service straightened", () => {
    const { text, cues } = parseNarrationScript("It’s [[quote]]the “fast” path");
    const boundaries = ["It's", "the", "fast", "path"].map((word, i) => ({
      time: i * 0.5,
      duration: 0.4,
      text: word
    }));
    expect(
      timeNarration({
        text,
        cues,
        boundaries,
        duration: 2
      })
    ).toEqual({
      words: [[0, 0, 4], [0.5, 5, 3], [1, 10, 4], [1.5, 16, 4]],
      cues: [["quote", 0.5, 5]]
    });
  });
});

describe("getDeclaredLanguage", () => {
  it("declares nothing for a card that only inherits the page's own language", () => {
    expect(
      getDeclaredLanguage({
        text: "This card asks for nothing",
        cardLanguage: "en",
        rootLanguage: "en"
      })
    ).toBeNull();
  });

  it("declares a lang attribute that differs from the page's", () => {
    expect(
      getDeclaredLanguage({
        text: "Bonjour tout le monde",
        cardLanguage: "fr",
        rootLanguage: "en"
      })
    ).toBe("fr");
  });

  it("lets the writing system speak for itself, whatever the page says", () => {
    expect(
      getDeclaredLanguage({
        text: "הכרטיס הזה כתוב בעברית",
        cardLanguage: "en",
        rootLanguage: "en"
      })
    ).toBe("he");
  });

  it("declares nothing when the page says nothing either", () => {
    expect(
      getDeclaredLanguage({
        text: "Plain words",
        cardLanguage: null,
        rootLanguage: null
      })
    ).toBeNull();
  });
});
