/**
 * Splits a string into an array of grapheme clusters (user-perceived characters),
 * properly handling Unicode surrogate pairs and combining characters.
 *
 * Uses `Intl.Segmenter` when available (Node 16+, modern browsers) for full
 * grapheme-cluster support. Falls back to `Array.from` which correctly handles
 * surrogate pairs (e.g., emoji) but may split combining characters.
 *
 * @param input - The string to split
 * @returns Array of grapheme clusters
 */
function splitIntoGraphemes(input) {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
        const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
        return [...segmenter.segment(input)].map((s) => s.segment);
    }
    // Fallback: handles surrogate pairs but not combining characters
    return Array.from(input);
}
/**
 * Reverses a string in a Unicode-aware manner.
 *
 * The reversal is performed on grapheme clusters so that multi-byte characters
 * (emoji, accented letters, etc.) are preserved as whole units and not broken
 * into individual bytes or surrogate halves.
 *
 * @param input - The string to reverse
 * @returns The reversed string
 * @throws {TypeError} if the input is not a string
 *
 * @example
 * reverseString('hello')          // 'olleh'
 * reverseString('')               // ''
 * reverseString('👋🌍')           // '🌍👋'
 * reverseString('café')           // 'éfac'
 * reverseString('a👨‍👩‍👧b')  // 'b👨‍👩‍👧a' (family emoji preserved)
 */
export function reverseString(input) {
    if (typeof input !== 'string') {
        throw new TypeError(`reverseString: expected a string, got ${typeof input}`);
    }
    // Empty string or single character (after grapheme split) is its own reverse
    if (input.length === 0) {
        return '';
    }
    const graphemes = splitIntoGraphemes(input);
    // Single grapheme — no reversal needed
    if (graphemes.length <= 1) {
        return input;
    }
    return graphemes.reverse().join('');
}
//# sourceMappingURL=stringReverse.js.map