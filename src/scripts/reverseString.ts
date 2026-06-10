/**
 * 字符串反转脚本
 *
 * 将字符串反转并在控制台打印。
 *
 * 使用方法:
 *   npx tsx src/scripts/reverseString.ts "要反转的字符串"
 *
 * 如果未提供参数，将使用默认示例字符串。
 */
import { reverseString } from '../utils/stringReverse.js';

// ============================================================
// 获取输入
// ============================================================
const input = process.argv[2] || 'Hello, World! 你好世界 🌍';

// ============================================================
// 反转并输出
// ============================================================
const reversed = reverseString(input);
const doubleReversed = reverseString(reversed);

console.log(`原始字符串:   "${input}"`);
console.log(`反转字符串:   "${reversed}"`);
console.log(`两次反转后:   "${doubleReversed}"`);
console.log(`验证通过:     ${input === doubleReversed}`);
