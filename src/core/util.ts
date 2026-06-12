/** 按 Unicode 码点计数,中英文各算 1 字 */
export function countChars(s: string): number {
  return [...s.trim()].length
}

/** story 的计数忽略所有空白(换行、缩进不占预算) */
export function countStoryChars(s: string): number {
  return [...s.replace(/\s+/g, '')].length
}

export function toPosix(p: string): string {
  return p.replace(/\\/g, '/')
}

export function isKebabCase(id: string): boolean {
  return /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(id)
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export class ArchmapError extends Error {}

export const VERSION = '0.2.0'
