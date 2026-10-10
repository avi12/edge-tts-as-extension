import { z } from "zod";

// MV3's extension CSP blocks the `new Function` probe zod runs on first object-schema build: the
// extension_pages policy "cannot be relaxed beyond this minimum value", so 'unsafe-eval' can never be
// added and the probe throws wherever a schema is built - background, offscreen or popup alike
// https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy
z.config({ jitless: true });

export { z };
