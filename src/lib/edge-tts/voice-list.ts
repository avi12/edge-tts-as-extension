import { TRUSTED_CLIENT_TOKEN, VOICES_URL } from "./constants";
import { z } from "@/lib/zod";

// The fields are the service's own, documented under "Get a list of voices" - Gender is only ever
// Female or Male in today's 322 voices, but the vocabulary is the service's to extend
// https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech#get-a-list-of-voices

// The voice list spells its token parameter in lower case, unlike the synthesis socket. Azure's own
// voices/list takes the key as the Ocp-Apim-Subscription-Key request header; this Read Aloud url takes
// it in the query string instead, which is voiceListRequester.js's doing and documented nowhere
// https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech#authentication
const TRUSTED_CLIENT_TOKEN_PARAMETER = "trustedclienttoken";

// ShortName, Locale, LocaleName and Gender are all in the documented sample response above. FriendlyName
// is not: it is this list's own, and Edge's voiceModel.js requires it, building a name out of LocalName
// and LocaleName only for the Azure-shaped list that lacks it
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
