// base64-encode UTF-8 without relying on Buffer (not in RN by default) or
// btoa (not in older RN engines). Hand-rolled to keep zero deps.
export function toBase64(input: string): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else {
      bytes.push(
        0xe0 | (c >> 12),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f),
      );
    }
  }
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < bytes.length ? bytes[i + 1] : -1;
    const b3 = i + 2 < bytes.length ? bytes[i + 2] : -1;
    const c1 = b1 >> 2;
    const c2 = ((b1 & 0x03) << 4) | (b2 >= 0 ? b2 >> 4 : 0);
    const c3 = b2 >= 0 ? ((b2 & 0x0f) << 2) | (b3 >= 0 ? b3 >> 6 : 0) : 64;
    const c4 = b3 >= 0 ? b3 & 0x3f : 64;
    out +=
      chars[c1] +
      chars[c2] +
      (c3 === 64 ? "=" : chars[c3]) +
      (c4 === 64 ? "=" : chars[c4]);
  }
  return out;
}
