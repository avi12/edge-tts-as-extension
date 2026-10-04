import { detectLanguage, pickVoice } from "./language";
import { describe, expect, it } from "vitest";

const VOICES = [
  ["en-US-AriaNeural", "en-US", "Female"],
  ["en-GB-RyanNeural", "en-GB", "Male"],
  ["he-IL-AvriNeural", "he-IL", "Male"],
  ["he-IL-HilaNeural", "he-IL", "Female"],
  ["ar-EG-ShakirNeural", "ar-EG", "Male"],
  ["ar-SA-ZariyahNeural", "ar-SA", "Female"]
].map(([ShortName = "", Locale = "", Gender = ""]) => ({
  ShortName,
  Locale,
  Gender,
  FriendlyName: ShortName,
  LocaleName: Locale
}));

describe("detectLanguage", () => {
  it("names the language of a non-Latin script", () => {
    expect(detectLanguage("שלום, מה שלומך?")).toBe("he");
    expect(detectLanguage("こんにちは世界")).toBe("ja");
  });

  it("goes with the script most letters are in", () => {
    expect(detectLanguage("הקוד רץ ב-Node עם WebSocket ומחזיר שמע")).toBe("he");
    expect(detectLanguage("The word שלום means peace")).toBeNull();
  });

  it("leaves Latin text and empty text undecided", () => {
    expect(detectLanguage("Bonjour tout le monde")).toBeNull();
    expect(detectLanguage("")).toBeNull();
  });
});

describe("pickVoice", () => {
  it("keeps the preferred voice when it speaks the language", () => {
    expect(
      pickVoice({
        voices: VOICES,
        locale: "en",
        preferredVoice: "en-US-AriaNeural"
      })
    ).toBe("en-US-AriaNeural");
  });

  it("switches to a voice of the same gender in the other language", () => {
    expect(
      pickVoice({
        voices: VOICES,
        locale: "he",
        preferredVoice: "en-US-AriaNeural"
      })
    ).toBe("he-IL-HilaNeural");
    expect(
      pickVoice({
        voices: VOICES,
        locale: "he",
        preferredVoice: "en-GB-RyanNeural"
      })
    ).toBe("he-IL-AvriNeural");
  });

  it("honours an exact locale over gender", () => {
    expect(
      pickVoice({
        voices: VOICES,
        locale: "ar-EG",
        preferredVoice: "en-US-AriaNeural"
      })
    ).toBe("ar-EG-ShakirNeural");
  });

  it("falls back to the preferred voice when no voice speaks the language", () => {
    expect(
      pickVoice({
        voices: VOICES,
        locale: "fi",
        preferredVoice: "en-US-AriaNeural"
      })
    ).toBe("en-US-AriaNeural");
  });
});
