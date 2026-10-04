import { z } from "zod";

// MV3's extension CSP blocks the `new Function` probe zod runs on first object-schema build
z.config({ jitless: true });

export { z };
