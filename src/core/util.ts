/** 通用小工具：文件名清洗、模板渲染、时间格式化、YAML 转义。（取自 fav-sync） */

/** Windows/macOS 都不允许或会让 Obsidian 困扰的字符。 */
const ILLEGAL = /[\\/:*?"<>|#^[\]]/g;
const CONTROL = /[\u0000-\u001f\u007f]/g;

/**
 * 清洗成安全的文件/目录名：去非法字符、压缩空白、限长。
 * 保留中文与常见符号，尽量维持可读性。
 */
export function sanitizeName(input: string, maxLen = 80): string {
  const cleaned = (input || "")
    .replace(CONTROL, "")
    .replace(ILLEGAL, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .trim();
  const safe = cleaned.length > maxLen ? cleaned.slice(0, maxLen).trim() : cleaned;
  return safe || "untitled";
}

/** 拼接 vault 相对路径，忽略空段。 */
export function joinPath(...parts: Array<string | undefined>): string {
  return parts
    .filter((p): p is string => !!p && p.trim() !== "")
    .map((p) => p.replace(/^\/+|\/+$/g, ""))
    .filter((p) => p !== "")
    .join("/");
}

/**
 * 渲染 `{token}` 模板。未知 token 原样保留，便于用户发现拼错。
 * 每段值都会被 sanitizeName 处理，模板里的 `/` 作为目录分隔保留。
 */
export function applyTemplate(
  template: string,
  vars: Record<string, string | undefined>,
): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const v = vars[key];
    if (v === undefined) return whole;
    return sanitizeName(v);
  });
}

/** ISO 字符串 → YYYY-MM-DD（本地时区）。 */
export function toDateStr(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * ISO 字符串 → 本地时区的 `YYYY-MM-DDTHH:mm:ss`。
 * 用于 collected 字段：保留到秒才能在同一天内正确排序，
 * 且这种格式能被 Obsidian / Dataview / Notebook Navigator 直接当日期解析。
 */
export function toDateTimeStr(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** YAML 标量转义：统一用双引号包裹，规避冒号/引号/换行带来的解析问题。 */
export function yamlString(value: string): string {
  return `"${(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;
}

/** YAML 字符串数组。 */
export function yamlList(values: string[]): string {
  return `[${values.map((v) => yamlString(v)).join(", ")}]`;
}

/** 金额固定两位小数，用于文件名和展示。 */
export function money(v: number): string {
  return v.toFixed(2);
}
