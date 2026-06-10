/**
 * Math utility functions.
 * Provides a collection of safe, typed mathematical operations.
 */
/**
 * Adds two numbers.
 * @returns The sum of `a` and `b`.
 */
export declare function add(a: number, b: number): number;
/**
 * Subtracts the second number from the first.
 * @returns The difference `a - b`.
 */
export declare function subtract(a: number, b: number): number;
/**
 * Multiplies two numbers.
 * @returns The product of `a` and `b`.
 */
export declare function multiply(a: number, b: number): number;
/**
 * Divides the first number by the second.
 * Throws if `b` is zero to avoid NaN/Infinity surprises.
 * @returns The quotient `a / b`.
 * @throws {Error} If `b` is 0.
 */
export declare function divide(a: number, b: number): number;
/**
 * Safely divides two numbers, returning a fallback value when the divisor is zero.
 * @param a - Dividend.
 * @param b - Divisor.
 * @param fallback - Value returned when `b` is 0 (default: `0`).
 * @returns The quotient, or `fallback` if `b` is 0.
 */
export declare function safeDivide(a: number, b: number, fallback?: number): number;
/**
 * Returns the remainder of `a` divided by `b` (modulo).
 * Throws if `b` is zero.
 * @returns `a % b`
 * @throws {Error} If `b` is 0.
 */
export declare function modulo(a: number, b: number): number;
/**
 * Computes the sum of an arbitrary number of values.
 * Returns 0 for an empty argument list.
 */
export declare function sum(...values: number[]): number;
/**
 * Computes the arithmetic mean (average) of the provided values.
 * Returns 0 for an empty argument list.
 */
export declare function average(...values: number[]): number;
/**
 * Computes the median of the provided values.
 * Returns 0 for an empty argument list.
 */
export declare function median(...values: number[]): number;
/**
 * Returns the minimum value from the provided numbers.
 * Returns `Infinity` for an empty argument list (consistent with `Math.min`).
 */
export declare function min(...values: number[]): number;
/**
 * Returns the maximum value from the provided numbers.
 * Returns `-Infinity` for an empty argument list (consistent with `Math.max`).
 */
export declare function max(...values: number[]): number;
/**
 * Clamps a value to the inclusive [min, max] range.
 * @param value - The number to clamp.
 * @param lower - The lower bound.
 * @param upper - The upper bound.
 * @returns The clamped value.
 * @throws {Error} If `lower > upper`.
 */
export declare function clamp(value: number, lower: number, upper: number): number;
/**
 * Rounds a number to a specified number of decimal places.
 * @param value - The number to round.
 * @param decimals - Number of decimal places (default: `0`).
 * @returns The rounded number.
 */
export declare function round(value: number, decimals?: number): number;
/**
 * Checks whether a value is an even integer.
 */
export declare function isEven(value: number): boolean;
/**
 * Checks whether a value is an odd integer.
 */
export declare function isOdd(value: number): boolean;
/**
 * Computes the factorial of a non-negative integer.
 * Throws if `n` is negative or not an integer.
 * @returns `n!`
 * @throws {Error} If `n` is not a non-negative integer.
 */
export declare function factorial(n: number): number;
/**
 * Raises `base` to the power of `exponent`.
 * (Thin wrapper around `Math.pow` or `**` for consistency.)
 */
export declare function power(base: number, exponent: number): number;
/**
 * Returns the square root of `value`.
 * Throws if `value` is negative.
 * @throws {Error} If `value < 0`.
 */
export declare function sqrt(value: number): number;
/**
 * Converts degrees to radians.
 */
export declare function degToRad(degrees: number): number;
/**
 * Converts radians to degrees.
 */
export declare function radToDeg(radians: number): number;
/**
 * Linearly interpolates between `a` and `b` by factor `t`.
 * When `t = 0` returns `a`; when `t = 1` returns `b`.
 */
export declare function lerp(a: number, b: number, t: number): number;
/**
 * Computes the greatest common divisor (GCD) of two integers using the Euclidean algorithm.
 */
export declare function gcd(a: number, b: number): number;
/**
 * Computes the least common multiple (LCM) of two integers.
 */
export declare function lcm(a: number, b: number): number;
//# sourceMappingURL=math.d.ts.map