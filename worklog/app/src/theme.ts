/**
 * 最小限のデザイントークン。
 * テナントのテーマカラー (F-506) で primary を差し替えられるようにしておく。
 */
export const colors = {
  bg: "#0f1115",
  surface: "#181c23",
  surfaceAlt: "#20252e",
  border: "#2b323d",
  text: "#f2f4f8",
  textMuted: "#9aa4b2",
  primary: "#20ade5",
  primaryText: "#04222e",
  danger: "#e5484d",
  warning: "#f5a524",
  success: "#30a46c",
  /** 未撮影の空きコマ (F-304) */
  empty: "#232833",
  /** 削除済みの枠 (F-902) */
  deleted: "#2a2230",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
} as const;

export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 18,
  xl: 22,
  xxl: 34,
} as const;
