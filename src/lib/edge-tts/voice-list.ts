import { TRUSTED_CLIENT_TOKEN, VOICES_URL } from "./constants";
import { z } from "@/lib/zod";

// The voice list spells its token parameter in lower case, unlike the synthesis socket
const TRUSTED_CLIENT_TOKEN_PARAMETER = "trustedclienttoken";

const voiceSchema = z.object({
  ShortName: z.string(),
  FriendlyName: z.string(),
  Locale: z.string(),
  LocaleName: z.string(),
  Gender: z.string()
});

const voicesSchema = z.array(voiceSchema);

export type Voice = z.infer<typeof voiceSchema>;

export async function fetchVoices() {
  const parameters = new URLSearchParams({ [TRUSTED_CLIENT_TOKEN_PARAMETER]: TRUSTED_CLIENT_TOKEN });
  const response = await fetch(`${VOICES_URL}?${parameters}`);
  if (!response.ok) {
    throw new Error(`Couldn't get the voice list (${response.status})`);
  }

  return voicesSchema.parse(await response.json());
}
