// RFC 1321 MD5 as a self-contained routine. Web Crypto's digest() only
// offers the SHA family, so hash matching that needs MD5 carries its own
// implementation here.
export function md5(input) {
    const bytes = new TextEncoder().encode(String(input));
    const len = bytes.length;

    // Bit-length (64-bit, little-endian) appended after a 0x80 terminator and
    // zero-padding to a 56-byte-multiple block tail.
    const bitLenHi = Math.floor(len / 0x20000000);
    const bitLenLo = (len << 3) >>> 0;

    const padded = new Uint8Array((((len + 8) >> 6) + 1) << 6);
    padded.set(bytes);
    padded[len] = 0x80;
    const dv = new DataView(padded.buffer);
    dv.setUint32(padded.length - 8, bitLenLo, true);
    dv.setUint32(padded.length - 4, bitLenHi, true);

    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;

    const S = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
        5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
        4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
        6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
    ];
    const K = new Uint32Array(64);
    for (let i = 0; i < 64; i++)
        K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;

    for (let off = 0; off < padded.length; off += 64) {
        const M = new Uint32Array(16);
        for (let j = 0; j < 16; j++)
            M[j] = dv.getUint32(off + j * 4, true);

        let A = a0, B = b0, C = c0, D = d0;
        for (let i = 0; i < 64; i++) {
            let F, g;
            if (i < 16) {
                F = (B & C) | (~B & D);
                g = i;
            } else if (i < 32) {
                F = (D & B) | (~D & C);
                g = (5 * i + 1) % 16;
            } else if (i < 48) {
                F = B ^ C ^ D;
                g = (3 * i + 5) % 16;
            } else {
                F = C ^ (B | ~D);
                g = (7 * i) % 16;
            }
            const tmp = D;
            D = C;
            C = B;
            B = (B + rotl((A + F + K[i] + M[g]) >>> 0, S[i])) >>> 0;
            A = tmp;
        }
        a0 = (a0 + A) >>> 0;
        b0 = (b0 + B) >>> 0;
        c0 = (c0 + C) >>> 0;
        d0 = (d0 + D) >>> 0;
    }

    return hex32(a0) + hex32(b0) + hex32(c0) + hex32(d0);
}

const rotl = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;

const hex32 = n => {
    let s = '';
    for (let i = 0; i < 4; i++)
        s += ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
    return s;
};
