"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mulberry32 = mulberry32;
exports.gaussian = gaussian;
/** Tiny seeded PRNG (mulberry32) — deterministic per seed, no dependency needed.
 * Used so a run started with the same seed looks identical on every replay,
 * matching the "seedable" requirement in CONTEXT.md §7. */
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/** Gaussian noise via Box-Muller, driven by the same seeded generator. */
function gaussian(rng, mean = 0, stdDev = 1) {
    const u1 = Math.max(rng(), 1e-9);
    const u2 = rng();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z0 * stdDev;
}
//# sourceMappingURL=rng.js.map