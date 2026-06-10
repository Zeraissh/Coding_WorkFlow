/**
 * 字符串反转脚本
 * 包含反转函数和控制台打印
 */

/**
 * 将字符串反转（支持 Unicode 字符）
 * @param input - 要反转的字符串
 * @returns 反转后的字符串
 */
function reverseString(input: string): string {
  if (typeof input !== 'string') {
    throw new TypeError(`reverseString: 期望字符串类型，但收到 ${typeof input}`);
  }

  // 使用 Array.from 正确处理 Unicode 代理对
  const chars = Array.from(input);
  return chars.reverse().join('');
}

// ============================================================
// 控制台打印示例
// ============================================================
const original = 'Hello, World! 你好世界 🌍';
const reversed = reverseString(original);

console.log(`原始字符串: "${original}"`);
console.log(`反转字符串: "${reversed}"`);

// 验证：两次反转应还原
const doubleReversed = reverseString(reversed);
console.log(`两次反转后: "${doubleReversed}"`);
console.log(`验证通过: ${original === doubleReversed}`);
