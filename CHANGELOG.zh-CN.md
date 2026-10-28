# 更新日志

gogoga Invoice Sync 每个版本的主要变化都记在这里。格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。English: [CHANGELOG.md](CHANGELOG.md).

## [0.2.0] - 2026-10-15

### 新增
- 界面支持英文和简体中文，跟随 Obsidian 的语言设置。
- 英文 README，另附简体中文版。

## [0.1.0] - 2026-10-14

首个公开版本。

### 新增
- 把专收发票的 IMAP 邮箱（默认 163）里的电子发票同步成笔记，只读邮件，不删除、不发送。仅桌面端。
- 解析数电票国标 XML；邮件里没有附件时，跟着正文里的下载链接去取；只有带文字层的 PDF 时也能解析。
- 原始 PDF / OFD / XML 归档进库，生成一张 Bases 发票总表。
- 报销状态切换命令；`invoices/import/` 里放 XML / ZIP 会自动导入。
- 授权码存在系统钥匙串，不写进随库同步的 `data.json`。

[0.2.0]: https://github.com/JackWeiGogoga/gogoga-invoice-sync/compare/0.1.0...0.2.0
[0.1.0]: https://github.com/JackWeiGogoga/gogoga-invoice-sync/releases/tag/0.1.0
