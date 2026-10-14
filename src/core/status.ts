export const REIMBURSED_STATUS = "已报销";
export const PENDING_STATUS = "未报销";

/** 新版布尔属性优先；旧 status 仅用于无损迁移。 */
export function isReimbursed(reimbursed: unknown, legacyStatus?: unknown): boolean {
  return typeof reimbursed === "boolean" ? reimbursed : legacyStatus === REIMBURSED_STATUS;
}

export function toggleReimbursed(current: unknown, legacyStatus?: unknown): boolean {
  return !isReimbursed(current, legacyStatus);
}

export function reimbursementLabel(reimbursed: boolean): string {
  return reimbursed ? REIMBURSED_STATUS : PENDING_STATUS;
}
