/**
 * Math utility functions.
 * Provides a collection of safe, typed mathematical operations.
 */

/**
 * Adds two numbers.
 * @returns The sum of `a` and `b`.
 */
export function add(a: number, b: number): number {
  return a + b;
}

/**
 * Subtracts the second number from the first.
 * @returns The difference `a - b`.
 */
export function subtract(a: number, b: number): number {
  return a - b;
}

/**
 * Multiplies two numbers.
 * @returns The product of `a` and `b`.
 */
export function multiply(a: number, b: number): number {
  return a * b;
}

/**
 * Divides the first number by the second.
 * Throws if `b` is zero to avoid NaN/Infinity surprises.
 * @returns The quotient `a / b`.
 * @throws {Error} If `b` is 0.
 */
export function divide(a: number, b: number): number {
  if (b === 0) {
    throw new Error("Division by zero is not allowed.");
  }
  return a / b;
}

/**
 * Safely divides two numbers, returning a fallback value when the divisor is zero.
 * @param a - Dividend.
 * @param b - Divisor.
 * @param fallback - Value returned when `b` is 0 (default: `0`).
 * @returns The quotient, or `fallback` if `b` is 0.
 */
export function safeDivide(a: number, b: number, fallback: number = 0): number {
  if (b === 0) {
    return fallback;
  }
  return a / b;
}

/**
 * Returns the remainder of `a` divided by `b` (modulo).
 * Throws if `b` is zero.
 * @returns `a % b`
 * @throws {Error} If `b` is 0.
 */
export function modulo(a: number, b: number): number {
  if (b === 0) {
    throw new Error("Modulo by zero is not allowed.");
  }
  return a % b;
}

/**
 * Computes the sum of an arbitrary number of values.
 * Returns 0 for an empty argument list.
 */
export function sum(...values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

/**
 * Computes the arithmetic mean (average) of the provided values.
 * Returns 0 for an empty argument list.
 */
export function average(...values: number[]): number {
  if (values.length === 0) return 0;
  return sum(...values) / values.length;
}

/**
 * Computes the median of the provided values.
 * Returns 0 for an empty argument list.
 */
export function median(...values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

/**
 * Returns the minimum value from the provided numbers.
 * Returns `Infinity` for an empty argument list (consistent with `Math.min`).
 */
export function min(...values: number[]): number {
  return Math.min(...values);
}

/**
 * Returns the maximum value from the provided numbers.
 * Returns `-Infinity` for an empty argument list (consistent with `Math.max`).
 */
export function max(...values: number[]): number {
  return Math.max(...values);
}

/**
 * Clamps a value to the inclusive [min, max] range.
 * @param value - The number to clamp.
 * @param lower - The lower bound.
 * @param upper - The upper bound.
 * @returns The clamped value.
 * @throws {Error} If `lower > upper`.
 */
export function clamp(value: number, lower: number, upper: number): number {
  if (lower > upper) {
    throw new Error(`Invalid range: lower (${lower}) must be <= upper (${upper}).`);
  }
  return Math.max(lower, Math.min(upper, value));
}

/**
 * Rounds a number to a specified number of decimal places.
 * @param value - The number to round.
 * @param decimals - Number of decimal places (default: `0`).
 * @returns The rounded number.
 */
export function round(value: number, decimals: number = 0): number {
  const factor = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Checks whether a value is an even integer.
 */
export function isEven(value: number): boolean {
  return Number.isInteger(value) && value % 2 === 0;
}

/**
 * Checks whether a value is an odd integer.
 */
export function isOdd(value: number): boolean {
  return Number.isInteger(value) && value % 2 !== 0;
}

/**
 * Computes the factorial of a non-negative integer.
 * Throws if `n` is negative or not an integer.
 * @returns `n!`
 * @throws {Error} If `n` is not a non-negative integer.
 */
export function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error("Factorial is only defined for non-negative integers.");
  }
  if (n === 0 || n === 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i++) {
    result *= i;
  }
  return result;
}

/**
 * Raises `base` to the power of `exponent`.
 * (Thin wrapper around `Math.pow` or `**` for consistency.)
 */
export function power(base: number, exponent: number): number {
  return Math.pow(base, exponent);
}

/**
 * Returns the square root of `value`.
 * Throws if `value` is negative.
 * @throws {Error} If `value < 0`.
 */
export function sqrt(value: number): number {
  if (value < 0) {
    throw new Error("Cannot compute square root of a negative number.");
  }
  return Math.sqrt(value);
}

/**
 * Converts degrees to radians.
 */
export function degToRad(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Converts radians to degrees.
 */
export function radToDeg(radians: number): number {
  return radians * (180 / Math.PI);
}

/**
 * Linearly interpolates between `a` and `b` by factor `t`.
 * When `t = 0` returns `a`; when `t = 1` returns `b`.
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Computes the greatest common divisor (GCD) of two integers using the Euclidean algorithm.
 */
export function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

/**
 * Computes the least common multiple (LCM) of two integers.
 */
export function lcm(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return Math.abs(a * b) / gcd(a, b);
}
