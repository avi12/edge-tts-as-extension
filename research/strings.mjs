import fs from 'fs';
const buf = fs.readFileSync(process.argv[2]);
const out = [];
let cur = '';
for (let i = 0; i < buf.length; i++) { const b = buf[i]; if (b >= 0x20 && b < 0x7f) cur += String.fromCharCode(b); else { if (cur.length >= 6) out.push(cur); cur = ''; } }
// utf16le
cur='';
for (let i = 0; i+1 < buf.length; i+=2) { const b = buf[i], h = buf[i+1]; if (h===0 && b >= 0x20 && b < 0x7f) cur += String.fromCharCode(b); else { if (cur.length >= 6) out.push('[u16] '+cur); cur=''; } }
fs.writeFileSync(process.argv[3], out.join('\n'));
