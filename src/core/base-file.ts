/**
 * 首次同步时生成的 Bases 总表。只在不存在时创建，之后你怎么改都不覆盖。
 */
export function baseFileContent(root: string): string {
  const cols = ["file.name", "note.reimbursed", "note.issued", "note.seller", "note.category", "note.total", "note.tax"];
  const order = cols.map((c) => `      - ${c}`).join("\n");
  return `filters:
  and:
    - file.inFolder("${root}")
    - 'type == "invoice"'
properties:
  note.issued:
    displayName: 开票日期
  note.seller:
    displayName: 销售方
  note.category:
    displayName: 类别
  note.total:
    displayName: 价税合计
  note.tax:
    displayName: 税额
  note.reimbursed:
    displayName: 已报销
  note.buyer:
    displayName: 购买方
  note.invoice_no:
    displayName: 发票号码
  note.month:
    displayName: 月份
views:
  - type: table
    name: 全部
    order:
${order}
    sort:
      - property: note.issued
        direction: DESC
    summaries:
      note.total: Sum
      note.tax: Sum
  - type: table
    name: 未报销
    filters:
      and:
        - 'reimbursed != true'
    order:
${order}
    sort:
      - property: note.issued
        direction: ASC
    summaries:
      note.total: Sum
  - type: table
    name: 按月
    groupBy:
      property: note.month
      direction: DESC
    order:
${order}
    sort:
      - property: note.issued
        direction: DESC
    summaries:
      note.total: Sum
`;
}
