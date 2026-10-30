const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

function rounded(x, y, cx, cy, halfW, halfH, radius) {
  const dx = Math.max(Math.abs(x - cx) - (halfW - radius), 0);
  const dy = Math.max(Math.abs(y - cy) - (halfH - radius), 0);
  return dx * dx + dy * dy <= radius * radius;
}
function sample(x, y) {
  if (!rounded(x, y, 128, 128, 120, 120, 55)) return [0, 0, 0, 0];
  const shift = (x + y) / 512;
  let color = [Math.round(27 + 27 * shift), Math.round(47 + 42 * shift), Math.round(78 + 53 * shift), 255];
  if (rounded(x, y, 128, 128, 78, 68, 16)) color = [230, 240, 255, 255];
  if (rounded(x, y, 128, 128, 56, 53, 7)) color = [40, 67, 101, 255];
  for (const holeY of [82, 113, 144, 175]) {
    if (rounded(x, y, 62, holeY, 6, 9, 3) || rounded(x, y, 194, holeY, 6, 9, 3)) color = [40, 67, 101, 255];
  }
  const d1 = (x - 112) * (95 - 161) - (112 - 112) * (y - 161);
  const d2 = (x - 164) * (161 - 128) - (112 - 164) * (y - 128);
  const d3 = (x - 112) * (128 - 95) - (164 - 112) * (y - 95);
  if ((d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0)) color = [229, 240, 255, 255];
  return color;
}
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let n = 0; n < 8; n++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function chunk(type, bytes) {
  const name = Buffer.from(type);
  const input = Buffer.concat([name, bytes]);
  let crc = 0xffffffff;
  for (const byte of input) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  const output = Buffer.alloc(12 + bytes.length);
  output.writeUInt32BE(bytes.length, 0);
  name.copy(output, 4);
  bytes.copy(output, 8);
  output.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + bytes.length);
  return output;
}
function renderPng(size) {
  const data = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    for (let x = 0; x < size; x++) {
      const rgba = sample(x * 256 / size, y * 256 / size);
      for (let channel = 0; channel < 4; channel++) data[row + 1 + x * 4 + channel] = rgba[channel];
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(data)), chunk('IEND', Buffer.alloc(0))
  ]);
}
const png = renderPng(256);
const icoHeader = Buffer.alloc(22);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(1, 4);
icoHeader.writeUInt16LE(1, 10);
icoHeader.writeUInt16LE(32, 12);
icoHeader.writeUInt32LE(png.length, 14);
icoHeader.writeUInt32LE(22, 18);
const outputDir = path.join(process.cwd(), 'build');
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'icon.png'), renderPng(1024));
fs.writeFileSync(path.join(outputDir, 'icon.ico'), Buffer.concat([icoHeader, png]));
