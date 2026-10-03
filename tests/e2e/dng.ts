/**
 * Builds a minimal but real Bayer-CFA DNG (16-bit, uncompressed, RGGB) for
 * RAW pipeline tests. Left half is red-dominant, right half blue-dominant.
 */
export function makeBayerDng(width = 320, height = 240): Buffer {
  const pix = Buffer.alloc(width * height * 2);
  const white = 4000;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const left = x < width / 2;
      // RGGB: (0,0)=R (0,1)=G (1,0)=G (1,1)=B
      const site = (y % 2) * 2 + (x % 2);
      const rgb = left ? [3200, 900, 700] : [700, 1000, 3200];
      const v = site === 0 ? rgb[0] : site === 3 ? rgb[2] : rgb[1];
      pix.writeUInt16LE(v, (y * width + x) * 2);
    }

  type Entry = { tag: number; type: number; count: number; value: Buffer };
  const SHORT = 3, LONG = 4, RATIONAL = 5, SRATIONAL = 10, BYTE = 1, ASCII = 2;
  const u16 = (...v: number[]) => { const b = Buffer.alloc(2 * v.length); v.forEach((n, i) => b.writeUInt16LE(n, 2 * i)); return b; };
  const u32 = (...v: number[]) => { const b = Buffer.alloc(4 * v.length); v.forEach((n, i) => b.writeUInt32LE(n, 4 * i)); return b; };
  const srat = (...v: number[]) => { const b = Buffer.alloc(8 * v.length); v.forEach((n, i) => { b.writeInt32LE(Math.round(n * 10000), 8 * i); b.writeInt32LE(10000, 8 * i + 4); }); return b; };
  const rat = (...v: number[]) => { const b = Buffer.alloc(8 * v.length); v.forEach((n, i) => { b.writeUInt32LE(Math.round(n * 10000), 8 * i); b.writeUInt32LE(10000, 8 * i + 4); }); return b; };
  const str = (s: string) => Buffer.from(s + "\0", "ascii");
  const entries: Entry[] = [
    { tag: 254, type: LONG, count: 1, value: u32(0) },
    { tag: 256, type: LONG, count: 1, value: u32(width) },
    { tag: 257, type: LONG, count: 1, value: u32(height) },
    { tag: 258, type: SHORT, count: 1, value: u16(16) },
    { tag: 259, type: SHORT, count: 1, value: u16(1) },
    { tag: 262, type: SHORT, count: 1, value: u16(32803) },
    { tag: 271, type: ASCII, count: 9, value: str("ProStudio") },
    { tag: 272, type: ASCII, count: 10, value: str("TestSensor") },
    { tag: 273, type: LONG, count: 1, value: u32(0) }, // patched
    { tag: 274, type: SHORT, count: 1, value: u16(1) },
    { tag: 277, type: SHORT, count: 1, value: u16(1) },
    { tag: 278, type: LONG, count: 1, value: u32(height) },
    { tag: 279, type: LONG, count: 1, value: u32(pix.length) },
    { tag: 284, type: SHORT, count: 1, value: u16(1) },
    { tag: 33421, type: SHORT, count: 2, value: u16(2, 2) },
    { tag: 33422, type: BYTE, count: 4, value: Buffer.from([0, 1, 1, 2]) },
    { tag: 50706, type: BYTE, count: 4, value: Buffer.from([1, 4, 0, 0]) },
    { tag: 50707, type: BYTE, count: 4, value: Buffer.from([1, 1, 0, 0]) },
    { tag: 50708, type: ASCII, count: 20, value: str("ProStudio TestSensor") },
    { tag: 50714, type: LONG, count: 1, value: u32(0) },
    { tag: 50717, type: LONG, count: 1, value: u32(white) },
    { tag: 50721, type: SRATIONAL, count: 9, value: srat(1, 0, 0, 0, 1, 0, 0, 0, 1) },
    { tag: 50728, type: RATIONAL, count: 3, value: rat(1, 1, 1) },
    { tag: 50778, type: SHORT, count: 1, value: u16(21) },
  ];
  entries.forEach((e) => {
    if (e.type === ASCII) e.count = e.value.length;
  });
  entries.sort((a, b) => a.tag - b.tag);
  const ifdOffset = 8;
  const ifdSize = 2 + entries.length * 12 + 4;
  let extra = ifdOffset + ifdSize;
  const extras: Buffer[] = [];
  const ifd = Buffer.alloc(ifdSize);
  ifd.writeUInt16LE(entries.length, 0);
  const dataOffsetPlaceholder: number[] = [];
  entries.forEach((e, i) => {
    const p = 2 + i * 12;
    ifd.writeUInt16LE(e.tag, p);
    ifd.writeUInt16LE(e.type, p + 2);
    ifd.writeUInt32LE(e.count, p + 4);
    if (e.value.length <= 4) e.value.copy(ifd, p + 8);
    else {
      ifd.writeUInt32LE(extra, p + 8);
      extras.push(e.value);
      extra += e.value.length + (e.value.length % 2);
      if (e.value.length % 2) extras.push(Buffer.alloc(1));
    }
    if (e.tag === 273) dataOffsetPlaceholder.push(p + 8);
  });
  ifd.writeUInt32LE(0, ifdSize - 4);
  const dataOffset = extra;
  for (const p of dataOffsetPlaceholder) ifd.writeUInt32LE(dataOffset, p);
  const header = Buffer.from([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0]);
  return Buffer.concat([header, ifd, ...extras, pix]);
}
