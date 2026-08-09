/**
 * 数字格式化：3312 → "3312"，11000 → "1.1w"，1230000 → "123w"
 */
export function formatCount(n) {
  if (n == null || isNaN(n)) return "0";
  n = Number(n);
  if (n < 10000) return String(Math.floor(n));
  if (n < 100000000) return (n / 10000).toFixed(1).replace(/\.0$/, "") + "w";
  return (n / 100000000).toFixed(1).replace(/\.0$/, "") + "亿";
}

/** 货币：$0.99 */
export function formatPrice(price) {
  return `$${parseFloat(price).toFixed(2)}`;
}
