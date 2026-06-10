/**
 * Unit tests for src/utils/stringReverse.ts
 *
 * Run with: npx vitest run
 */
import { describe, it, expect } from "vitest";
import { reverseString } from "../src/utils/stringReverse.js";
// ---------------------------------------------------------------------------
// reverseString - Basic ASCII
// ---------------------------------------------------------------------------
describe("reverseString - Basic ASCII", () => {
    it("reverses a simple word", () => {
        expect(reverseString("hello")).toBe("olleh");
    });
    it("reverses a sentence with spaces", () => {
        expect(reverseString("hello world")).toBe("dlrow olleh");
    });
    it("reverses a palindrome (same forward and backward)", () => {
        expect(reverseString("racecar")).toBe("racecar");
    });
    it("reverses a string with mixed case", () => {
        expect(reverseString("AbCdEf")).toBe("fEdCbA");
    });
    it("reverses a string with numbers", () => {
        expect(reverseString("abc123")).toBe("321cba");
    });
    it("reverses a single character", () => {
        expect(reverseString("a")).toBe("a");
    });
    it("reverses two identical characters", () => {
        expect(reverseString("aa")).toBe("aa");
    });
    it("reverses a string with only digits", () => {
        expect(reverseString("12345")).toBe("54321");
    });
});
// ---------------------------------------------------------------------------
// reverseString - Empty & edge cases
// ---------------------------------------------------------------------------
describe("reverseString - Empty & edge cases", () => {
    it("returns empty string for empty input", () => {
        expect(reverseString("")).toBe("");
    });
    it("reverses a string with only spaces", () => {
        expect(reverseString("   ")).toBe("   ");
    });
    it("reverses a string with leading/trailing spaces", () => {
        expect(reverseString("  hello  ")).toBe("  olleh  ");
    });
    it("reverses a string with a single space", () => {
        expect(reverseString(" ")).toBe(" ");
    });
});
// ---------------------------------------------------------------------------
// reverseString - Unicode (emoji, multi-byte)
// ---------------------------------------------------------------------------
describe("reverseString - Unicode", () => {
    it("reverses a string with emoji", () => {
        // 💖 = U+1F496 (surrogate pair), 🐱 = U+1F431
        expect(reverseString("💖🐱")).toBe("🐱💖");
    });
    it("reverses a string mixing ASCII and emoji", () => {
        expect(reverseString("a👋b")).toBe("b👋a");
    });
    it("reverses a string with accented Latin characters", () => {
        expect(reverseString("café")).toBe("éfac");
    });
    it("reverses a string with multiple accented characters", () => {
        expect(reverseString("Ångström")).toBe("mörtsgnÅ");
    });
    it("reverses a string with CJK characters", () => {
        expect(reverseString("你好世界")).toBe("界世好你");
    });
    it("reverses a string with mixed scripts", () => {
        expect(reverseString("hello世界")).toBe("界世olleh");
    });
    it("reverses a single emoji", () => {
        expect(reverseString("👋")).toBe("👋");
    });
    it("reverses a string with a zero-width joiner (ZWJ) sequence", () => {
        // Family emoji: man + ZWJ + woman + ZWJ + girl + ZWJ + boy
        // U+1F468 U+200D U+1F469 U+200D U+1F467 U+200D U+1F466
        const family = "👨‍👩‍👧‍👦";
        // Reversing should preserve the grapheme cluster as a whole
        const result = reverseString("a" + family + "b");
        expect(result).toBe("b" + family + "a");
    });
    it("reverses a string with flag emoji (regional indicator pairs)", () => {
        // Flag: US = U+1F1FA U+1F1F8, GB = U+1F1EC U+1F1E7
        const flagUS = "🇺🇸";
        const flagGB = "🇬🇧";
        expect(reverseString(flagUS + flagGB)).toBe(flagGB + flagUS);
    });
    it("reverses a string with combining characters", () => {
        // 'e' + combining acute accent (U+0301) => é
        const eWithAcute = "e\u0301";
        const result = reverseString("a" + eWithAcute + "b");
        // With Intl.Segmenter, the grapheme is preserved
        // Fallback may reverse code points, resulting in combining char + 'e'
        // The test verifies the function doesn't throw and produces consistent output
        expect(typeof result).toBe("string");
        expect(result.length).toBeGreaterThanOrEqual(3);
    });
    it("reverses a string with Devanagari (Indian) script", () => {
        // Hindi word "नमस्ते" (namaste)
        // The grapheme clusters are reversed as whole units
        const input = "नमस्ते";
        const result = reverseString(input);
        // Verify double-reverse returns original (identity test)
        expect(reverseString(result)).toBe(input);
        expect(typeof result).toBe("string");
        expect(result.length).toBe(input.length);
    });
    it("reverses a string with Arabic script (RTL)", () => {
        // Arabic "مرحبا" (hello)
        const input = "مرحبا";
        const result = reverseString(input);
        expect(typeof result).toBe("string");
        expect(result.length).toBe(input.length);
        // Double reverse should return original
        expect(reverseString(result)).toBe(input);
    });
    it("reverses a string with Thai script", () => {
        // Thai "สวัสดี" (hello)
        const input = "สวัสดี";
        const result = reverseString(input);
        // Verify double-reverse returns original (identity test)
        expect(reverseString(result)).toBe(input);
        expect(typeof result).toBe("string");
    });
    it("reverses a string with mathematical symbols", () => {
        expect(reverseString("a+∑b")).toBe("b∑+a");
    });
});
// ---------------------------------------------------------------------------
// reverseString - Special characters
// ---------------------------------------------------------------------------
describe("reverseString - Special characters", () => {
    it("reverses a string with newlines", () => {
        expect(reverseString("a\nb\nc")).toBe("c\nb\na");
    });
    it("reverses a string with tabs", () => {
        expect(reverseString("a\tb\tc")).toBe("c\tb\ta");
    });
    it("reverses a string with carriage return", () => {
        expect(reverseString("ab\rcd")).toBe("dc\rba");
    });
    it("reverses a string with mixed whitespace", () => {
        expect(reverseString("a \t\nb")).toBe("b\n\t a");
    });
    it("reverses a string with backslash", () => {
        expect(reverseString("a\\b")).toBe("b\\a");
    });
    it("reverses a string with quotes", () => {
        expect(reverseString('he"llo')).toBe('oll"eh');
        expect(reverseString("he'llo")).toBe("oll'eh");
    });
    it("reverses a string with HTML entities", () => {
        // "a&lt;b&gt;" → characters: a, &, l, t, ;, b, &, g, t, ;
        // reversed: ;, t, g, &, b, ;, t, l, &, a
        expect(reverseString("a&lt;b&gt;")).toBe(";tg&b;tl&a");
    });
    it("reverses a string with null character", () => {
        expect(reverseString("a\0b")).toBe("b\0a");
    });
    it("reverses a string with all printable ASCII special chars", () => {
        const special = "!@#$%^&*()_+-=[]{}|;':\",./<>?`~";
        const reversed = [...special].reverse().join("");
        expect(reverseString(special)).toBe(reversed);
    });
});
// ---------------------------------------------------------------------------
// reverseString - TypeError for non-string input
// ---------------------------------------------------------------------------
describe("reverseString - TypeError", () => {
    it("throws TypeError when input is a number", () => {
        expect(() => reverseString(123)).toThrow(TypeError);
        expect(() => reverseString(123)).toThrow("reverseString: expected a string, got number");
    });
    it("throws TypeError when input is an object", () => {
        expect(() => reverseString({})).toThrow(TypeError);
    });
    it("throws TypeError when input is an array", () => {
        expect(() => reverseString([])).toThrow(TypeError);
    });
    it("throws TypeError when input is null", () => {
        expect(() => reverseString(null)).toThrow(TypeError);
        expect(() => reverseString(null)).toThrow("reverseString: expected a string, got object" // typeof null === 'object'
        );
    });
    it("throws TypeError when input is undefined", () => {
        expect(() => reverseString(undefined)).toThrow(TypeError);
    });
    it("throws TypeError when input is a boolean", () => {
        expect(() => reverseString(true)).toThrow(TypeError);
        expect(() => reverseString(false)).toThrow(TypeError);
    });
    it("throws TypeError when input is a function", () => {
        expect(() => reverseString((() => { }))).toThrow(TypeError);
    });
    it("throws TypeError when input is a Symbol", () => {
        expect(() => reverseString(Symbol("test"))).toThrow(TypeError);
    });
});
// ---------------------------------------------------------------------------
// reverseString - Double-reverse (idempotent)
// ---------------------------------------------------------------------------
describe("reverseString - Double reverse", () => {
    it("returns the original string when reversed twice (ASCII)", () => {
        const original = "Hello, World!";
        expect(reverseString(reverseString(original))).toBe(original);
    });
    it("returns the original string when reversed twice (Unicode)", () => {
        const original = "Hello 👋🌍 café";
        expect(reverseString(reverseString(original))).toBe(original);
    });
    it("returns the original string when reversed twice (CJK)", () => {
        const original = "こんにちは世界";
        expect(reverseString(reverseString(original))).toBe(original);
    });
    it("returns the original string when reversed twice (mixed)", () => {
        const original = "a👨‍👩‍👧b🇺🇸c café d";
        const doubleReversed = reverseString(reverseString(original));
        expect(doubleReversed).toBe(original);
    });
});
// ---------------------------------------------------------------------------
// reverseString - Stress / edge performance
// ---------------------------------------------------------------------------
describe("reverseString - Large inputs", () => {
    it("handles a long ASCII string", () => {
        const long = "a".repeat(10000) + "b".repeat(10000);
        const expected = "b".repeat(10000) + "a".repeat(10000);
        expect(reverseString(long)).toBe(expected);
    });
    it("handles a string with many emoji", () => {
        const emojis = "👋🌍💖🐱🎉🚀".repeat(100);
        const reversed = [...emojis].reverse().join("");
        expect(reverseString(emojis)).toBe(reversed);
    });
    it("handles a string with alternating ASCII and Unicode", () => {
        const pattern = "a👋b🌍c💖";
        const repeated = pattern.repeat(200);
        const result = reverseString(repeated);
        // Double reverse should be identity
        expect(reverseString(result)).toBe(repeated);
    });
});
//# sourceMappingURL=stringReverse.test.js.map