/** 公司主題色（companies.theme_color）→ 色碼。祥興 cyan／沂融 orange，老闆切公司時整頁色條跟著換。 */
export function themeHex(theme?: string | null) {
  switch (theme) {
    case "orange":
      return "#f97316";
    case "cyan":
      return "#06b6d4";
    case "green":
      return "#22c55e";
    case "violet":
      return "#8b5cf6";
    default:
      return "#64748b";
  }
}
