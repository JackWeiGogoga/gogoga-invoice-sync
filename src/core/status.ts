import { t } from "../i18n";

/** 旧版写进笔记的 status 文本值，只用于迁移判断，属于数据，不翻译。 */
export const REIMBURSED_STATUS = "已报销";
export const PENDING_STATUS = "未报销";

/** 新版布尔属性优先；旧 status 仅用于无损迁移。 */
export function isReimbursed(reimbursed: unknown, legacyStatus?: unknown): boolean {
  return typeof reimbursed === "boolean" ? reimbursed : legacyStatus === REIMBURSED_STATUS;
}

export function toggleReimbursed(current: unknown, legacyStatus?: unknown): boolean {
  return !isReimbursed(current, legacyStatus);
}

/** 界面上显示的状态文案，跟随界面语言。 */
export function reimbursementLabel(reimbursed: boolean): string {
  return reimbursed ? t("status.reimbursed") : t("status.pending");
}
