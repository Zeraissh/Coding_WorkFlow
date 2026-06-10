/**
 * Unit tests for src/utils/math.ts
 *
 * Run with: npx vitest run
 * Install:   npm install -D vitest
 */

import { describe, it, expect } from "vitest";
import {
  add,
  subtract,
  multiply,
  divide,
  safeDivide,
  modulo,
  sum,
  average,
  median,
  min,
  max,
  clamp,
  round,
  isEven,
  isOdd,
  factorial,
  power,
  sqrt,
  degToRad,
  radToDeg,
  lerp,
  gcd,
  lcm,
} from "../../src/utils/math.js";

// ---------------------------------------------------------------------------
// add
// ---------------------------------------------------------------------------
describe("add", () => {
  it("adds two positive numbers", () => {
    expect(add(2, 3)).toBe(5);
  });

  it("adds a positive and a negative number", () => {
    expect(add(5, -3)).toBe(2);
  });

  it("adds two negative numbers", () => {
    expect(add(-4, -6)).toBe(-10);
  });

  it("adds zero correctly", () => {
    expect(add(0, 7)).toBe(7);
    expect(add(7, 0)).toBe(7);
  });

  it("handles floating point numbers", () => {
    expect(add(0.1, 0.2)).toBeCloseTo(0.3);
  });
});

// ---------------------------------------------------------------------------
// subtract
// ---------------------------------------------------------------------------
describe("subtract", () => {
  it("subtracts two positive numbers", () => {
    expect(subtract(10, 3)).toBe(7);
  });

  it("subtracts a positive from a negative", () => {
    expect(subtract(-5, 3)).toBe(-8);
  });

  it("subtracting zero", () => {
    expect(subtract(5, 0)).toBe(5);
    expect(subtract(0, 5)).toBe(-5);
  });

  it("handles floating point numbers", () => {
    expect(subtract(0.3, 0.1)).toBeCloseTo(0.2);
  });
});

// ---------------------------------------------------------------------------
// multiply
// ---------------------------------------------------------------------------
describe("multiply", () => {
  it("multiplies two positive numbers", () => {
    expect(multiply(4, 3)).toBe(12);
  });

  it("multiplies by zero results in zero", () => {
    expect(multiply(5, 0)).toBe(0);
    expect(multiply(0, 5)).toBe(0);
  });

  it("multiplies negative numbers", () => {
    expect(multiply(-2, 3)).toBe(-6);
    expect(multiply(-2, -3)).toBe(6);
  });

  it("handles floating point", () => {
    expect(multiply(0.1, 0.2)).toBeCloseTo(0.02);
  });
});

// ---------------------------------------------------------------------------
// divide
// ---------------------------------------------------------------------------
describe("divide", () => {
  it("divides two positive numbers", () => {
    expect(divide(10, 2)).toBe(5);
  });

  it("divides by 1 returns the dividend", () => {
    expect(divide(7, 1)).toBe(7);
  });

  it("divides negative numbers", () => {
    expect(divide(-10, 2)).toBe(-5);
    expect(divide(10, -2)).toBe(-5);
    expect(divide(-10, -2)).toBe(5);
  });

  it("handles floating point division", () => {
    expect(divide(1, 3)).toBeCloseTo(0.333333, 5);
  });

  it("throws on division by zero", () => {
    expect(() => divide(5, 0)).toThrow("Division by zero is not allowed.");
  });

  it("throws on zero divided by zero", () => {
    expect(() => divide(0, 0)).toThrow("Division by zero is not allowed.");
  });
});

// ---------------------------------------------------------------------------
// safeDivide
// ---------------------------------------------------------------------------
describe("safeDivide", () => {
  it("divides normally when divisor is non-zero", () => {
    expect(safeDivide(10, 2)).toBe(5);
  });

  it("returns fallback (default 0) when divisor is zero", () => {
    expect(safeDivide(10, 0)).toBe(0);
  });

  it("returns custom fallback when divisor is zero", () => {
    expect(safeDivide(10, 0, Infinity)).toBe(Infinity);
    expect(safeDivide(10, 0, -1)).toBe(-1);
    expect(safeDivide(10, 0, NaN)).toBeNaN();
  });

  it("does not use fallback when divisor is non-zero", () => {
    expect(safeDivide(10, 2, 999)).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// modulo
// ---------------------------------------------------------------------------
describe("modulo", () => {
  it("returns remainder of positive numbers", () => {
    expect(modulo(10, 3)).toBe(1);
  });

  it("returns 0 when divisible", () => {
    expect(modulo(12, 4)).toBe(0);
  });

  it("handles negative dividend", () => {
    expect(modulo(-10, 3)).toBe(-1);
  });

  it("throws on modulo by zero", () => {
    expect(() => modulo(5, 0)).toThrow("Modulo by zero is not allowed.");
  });
});

// ---------------------------------------------------------------------------
// sum
// ---------------------------------------------------------------------------
describe("sum", () => {
  it("sums a list of positive numbers", () => {
    expect(sum(1, 2, 3, 4)).toBe(10);
  });

  it("sums negative and positive numbers", () => {
    expect(sum(-1, 2, -3, 4)).toBe(2);
  });

  it("returns 0 for empty arguments", () => {
    expect(sum()).toBe(0);
  });

  it("returns the number itself for a single argument", () => {
    expect(sum(42)).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// average
// ---------------------------------------------------------------------------
describe("average", () => {
  it("computes average of positive numbers", () => {
    expect(average(2, 4, 6)).toBe(4);
  });

  it("computes average with negative numbers", () => {
    expect(average(-2, 2)).toBe(0);
  });

  it("returns 0 for empty arguments", () => {
    expect(average()).toBe(0);
  });

  it("returns the value for a single number", () => {
    expect(average(7)).toBe(7);
  });

  it("handles floating point average", () => {
    expect(average(1, 2)).toBe(1.5);
  });
});

// ---------------------------------------------------------------------------
// median
// ---------------------------------------------------------------------------
describe("median", () => {
  it("returns the middle value for odd count", () => {
    expect(median(1, 3, 2)).toBe(2);
  });

  it("returns average of two middle values for even count", () => {
    expect(median(1, 2, 3, 4)).toBe(2.5);
  });

  it("returns 0 for empty arguments", () => {
    expect(median()).toBe(0);
  });

  it("returns the single value for one argument", () => {
    expect(median(5)).toBe(5);
  });

  it("handles unsorted input", () => {
    expect(median(5, 1, 3, 2, 4)).toBe(3);
  });

  it("handles negative numbers", () => {
    expect(median(-5, -1, -3)).toBe(-3);
  });
});

// ---------------------------------------------------------------------------
// min
// ---------------------------------------------------------------------------
describe("min", () => {
  it("returns smallest number", () => {
    expect(min(3, 1, 2)).toBe(1);
  });

  it("returns Infinity for empty arguments", () => {
    expect(min()).toBe(Infinity);
  });

  it("handles negative numbers", () => {
    expect(min(-5, 0, 5)).toBe(-5);
  });

  it("handles single argument", () => {
    expect(min(7)).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// max
// ---------------------------------------------------------------------------
describe("max", () => {
  it("returns largest number", () => {
    expect(max(3, 1, 2)).toBe(3);
  });

  it("returns -Infinity for empty arguments", () => {
    expect(max()).toBe(-Infinity);
  });

  it("handles negative numbers", () => {
    expect(max(-5, 0, 5)).toBe(5);
  });

  it("handles single argument", () => {
    expect(max(7)).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// clamp
// ---------------------------------------------------------------------------
describe("clamp", () => {
  it("returns value when within range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("returns lower bound when value is below range", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it("returns upper bound when value is above range", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("works when lower equals upper", () => {
    expect(clamp(7, 5, 5)).toBe(5);
    expect(clamp(3, 5, 5)).toBe(5);
  });

  it("throws when lower > upper", () => {
    expect(() => clamp(5, 10, 0)).toThrow("Invalid range");
  });

  it("handles negative ranges", () => {
    expect(clamp(-7, -10, -5)).toBe(-7);
    expect(clamp(-12, -10, -5)).toBe(-10);
    expect(clamp(-3, -10, -5)).toBe(-5);
  });
});

// ---------------------------------------------------------------------------
// round
// ---------------------------------------------------------------------------
describe("round", () => {
  it("rounds to 0 decimal places by default", () => {
    expect(round(3.7)).toBe(4);
    expect(round(3.2)).toBe(3);
  });

  it("rounds to specified decimal places", () => {
    expect(round(3.14159, 2)).toBe(3.14);
    expect(round(3.14159, 4)).toBe(3.1416);
  });

  it("handles 0 decimals explicitly", () => {
    expect(round(2.5, 0)).toBe(3);
  });

  it("handles negative value", () => {
    expect(round(-2.7)).toBe(-3);
    expect(round(-2.3)).toBe(-2);
  });

  it("handles large decimal places", () => {
    expect(round(1.005, 2)).toBe(1.01);
  });
});

// ---------------------------------------------------------------------------
// isEven
// ---------------------------------------------------------------------------
describe("isEven", () => {
  it("returns true for even integers", () => {
    expect(isEven(0)).toBe(true);
    expect(isEven(2)).toBe(true);
    expect(isEven(-4)).toBe(true);
  });

  it("returns false for odd integers", () => {
    expect(isEven(1)).toBe(false);
    expect(isEven(-3)).toBe(false);
  });

  it("returns false for non-integer numbers", () => {
    expect(isEven(2.5)).toBe(false);
  });

  it("returns false for NaN", () => {
    expect(isEven(NaN)).toBe(false);
  });

  it("returns false for Infinity", () => {
    expect(isEven(Infinity)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isOdd
// ---------------------------------------------------------------------------
describe("isOdd", () => {
  it("returns true for odd integers", () => {
    expect(isOdd(1)).toBe(true);
    expect(isOdd(-3)).toBe(true);
  });

  it("returns false for even integers", () => {
    expect(isOdd(0)).toBe(false);
    expect(isOdd(2)).toBe(false);
    expect(isOdd(-4)).toBe(false);
  });

  it("returns false for non-integer numbers", () => {
    expect(isOdd(1.5)).toBe(false);
  });

  it("returns false for NaN", () => {
    expect(isOdd(NaN)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// factorial
// ---------------------------------------------------------------------------
describe("factorial", () => {
  it("returns 1 for 0! and 1!", () => {
    expect(factorial(0)).toBe(1);
    expect(factorial(1)).toBe(1);
  });

  it("computes factorial for positive integers", () => {
    expect(factorial(2)).toBe(2);
    expect(factorial(3)).toBe(6);
    expect(factorial(4)).toBe(24);
    expect(factorial(5)).toBe(120);
  });

  it("computes factorial for larger numbers", () => {
    expect(factorial(10)).toBe(3628800);
  });

  it("throws for negative numbers", () => {
    expect(() => factorial(-1)).toThrow(
      "Factorial is only defined for non-negative integers."
    );
  });

  it("throws for non-integer numbers", () => {
    expect(() => factorial(2.5)).toThrow(
      "Factorial is only defined for non-negative integers."
    );
    expect(() => factorial(NaN)).toThrow(
      "Factorial is only defined for non-negative integers."
    );
    expect(() => factorial(Infinity)).toThrow(
      "Factorial is only defined for non-negative integers."
    );
  });
});

// ---------------------------------------------------------------------------
// power
// ---------------------------------------------------------------------------
describe("power", () => {
  it("computes positive exponent", () => {
    expect(power(2, 3)).toBe(8);
  });

  it("computes exponent 0 returns 1", () => {
    expect(power(5, 0)).toBe(1);
  });

  it("computes exponent 1 returns base", () => {
    expect(power(7, 1)).toBe(7);
  });

  it("computes negative exponent", () => {
    expect(power(2, -1)).toBe(0.5);
    expect(power(4, -2)).toBeCloseTo(0.0625);
  });

  it("handles fractional exponent (square root)", () => {
    expect(power(9, 0.5)).toBeCloseTo(3);
  });

  it("handles negative base", () => {
    expect(power(-2, 3)).toBe(-8);
    expect(power(-2, 2)).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// sqrt
// ---------------------------------------------------------------------------
describe("sqrt", () => {
  it("computes square root of perfect squares", () => {
    expect(sqrt(0)).toBe(0);
    expect(sqrt(1)).toBe(1);
    expect(sqrt(4)).toBe(2);
    expect(sqrt(9)).toBe(3);
    expect(sqrt(16)).toBe(4);
  });

  it("computes square root of non-perfect squares", () => {
    expect(sqrt(2)).toBeCloseTo(1.4142, 4);
    expect(sqrt(3)).toBeCloseTo(1.732, 3);
  });

  it("throws on negative numbers", () => {
    expect(() => sqrt(-1)).toThrow(
      "Cannot compute square root of a negative number."
    );
  });
});

// ---------------------------------------------------------------------------
// degToRad
// ---------------------------------------------------------------------------
describe("degToRad", () => {
  it("converts 0 degrees to 0 radians", () => {
    expect(degToRad(0)).toBe(0);
  });

  it("converts 180 degrees to PI radians", () => {
    expect(degToRad(180)).toBeCloseTo(Math.PI);
  });

  it("converts 360 degrees to 2 * PI radians", () => {
    expect(degToRad(360)).toBeCloseTo(2 * Math.PI);
  });

  it("converts 90 degrees to PI/2 radians", () => {
    expect(degToRad(90)).toBeCloseTo(Math.PI / 2);
  });

  it("converts negative degrees", () => {
    expect(degToRad(-180)).toBeCloseTo(-Math.PI);
  });
});

// ---------------------------------------------------------------------------
// radToDeg
// ---------------------------------------------------------------------------
describe("radToDeg", () => {
  it("converts 0 radians to 0 degrees", () => {
    expect(radToDeg(0)).toBe(0);
  });

  it("converts PI radians to 180 degrees", () => {
    expect(radToDeg(Math.PI)).toBeCloseTo(180);
  });

  it("converts 2 * PI radians to 360 degrees", () => {
    expect(radToDeg(2 * Math.PI)).toBeCloseTo(360);
  });

  it("converts PI/2 radians to 90 degrees", () => {
    expect(radToDeg(Math.PI / 2)).toBeCloseTo(90);
  });

  it("converts negative radians", () => {
    expect(radToDeg(-Math.PI)).toBeCloseTo(-180);
  });
});

// ---------------------------------------------------------------------------
// lerp
// ---------------------------------------------------------------------------
describe("lerp", () => {
  it("returns a when t = 0", () => {
    expect(lerp(10, 20, 0)).toBe(10);
  });

  it("returns b when t = 1", () => {
    expect(lerp(10, 20, 1)).toBe(20);
  });

  it("returns midpoint when t = 0.5", () => {
    expect(lerp(10, 20, 0.5)).toBe(15);
  });

  it("extrapolates when t < 0", () => {
    expect(lerp(10, 20, -0.5)).toBe(5);
  });

  it("extrapolates when t > 1", () => {
    expect(lerp(10, 20, 1.5)).toBe(25);
  });

  it("handles negative range", () => {
    expect(lerp(-10, 10, 0.5)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// gcd
// ---------------------------------------------------------------------------
describe("gcd", () => {
  it("computes GCD of two positive numbers", () => {
    expect(gcd(12, 8)).toBe(4);
    expect(gcd(17, 5)).toBe(1);
  });

  it("computes GCD when one number is 0", () => {
    expect(gcd(0, 5)).toBe(5);
    expect(gcd(5, 0)).toBe(5);
  });

  it("computes GCD of two zeros (returns 0)", () => {
    expect(gcd(0, 0)).toBe(0);
  });

  it("handles negative numbers (uses absolute values)", () => {
    expect(gcd(-12, 8)).toBe(4);
    expect(gcd(12, -8)).toBe(4);
    expect(gcd(-12, -8)).toBe(4);
  });

  it("computes GCD of equal numbers", () => {
    expect(gcd(7, 7)).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// lcm
// ---------------------------------------------------------------------------
describe("lcm", () => {
  it("computes LCM of two positive numbers", () => {
    expect(lcm(4, 5)).toBe(20);
    expect(lcm(6, 8)).toBe(24);
  });

  it("returns 0 when either number is 0", () => {
    expect(lcm(0, 5)).toBe(0);
    expect(lcm(5, 0)).toBe(0);
    expect(lcm(0, 0)).toBe(0);
  });

  it("handles negative numbers (uses absolute values)", () => {
    expect(lcm(-4, 5)).toBe(20);
    expect(lcm(4, -5)).toBe(20);
  });

  it("computes LCM of equal numbers", () => {
    expect(lcm(7, 7)).toBe(7);
  });

  it("computes LCM of coprime numbers", () => {
    expect(lcm(7, 11)).toBe(77);
  });
});
