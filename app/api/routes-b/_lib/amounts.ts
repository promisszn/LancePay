export function normalizeCurrencyAmount(value: unknown): number {
  return Number(value ?? 0)
}
