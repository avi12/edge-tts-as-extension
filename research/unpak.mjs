import fs from 'fs'; import zlib from 'zlib';
const [,, file, outDir] = process.argv;
const b = fs.readFileSync(file);
const count = b.readUInt32LE(8), hdr = 16; // Edge: u32 ver, u32 enc, u32 count, u32 aliasCount, then {u32 id,u32 off}
fs.mkdirSync(outDir, { recursive: true });
let n = 0;
for (let i = 0; i < count; i++) {
  const id = b.readUInt32LE(hdr + i*8), off = b.readUInt32LE(hdr + i*8 + 4), next = b.readUInt32LE(hdr + (i+1)*8 + 4);
  let d = b.subarray(off, next);
  try { if (d[0] === 0x1f && d[1] === 0x8b) d = zlib.gunzipSync(d); else if (d[0] === 0x1e && d[1] === 0x9b) d = zlib.brotliDecompressSync(d.subarray(8)); } catch {}
  fs.writeFileSync(`${outDir}/${id}`, d); n++;
  if (i < 3) console.log(id, off, next);
}
console.log('written', n);
