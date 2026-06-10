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
export declare function reverseString(input: string): string;
//# sourceMappingURL=stringReverse.d.ts.map