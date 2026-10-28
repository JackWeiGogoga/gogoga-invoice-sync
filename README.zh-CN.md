# gogoga Invoice Sync

[English](https://github.com/JackWeiGogoga/gogoga-invoice-sync/blob/main/README.md) | **简体中文**

把专收发票的 IMAP 邮箱（默认 163 邮箱）里的电子发票同步成 Obsidian 笔记：
解析数电票国标 XML，邮件里没有附件时跟随正文里的下载链接去拿，
原始 PDF/OFD/XML 归档进 vault，并生成一张 Bases 发票总表。仅桌面端。

界面语言跟随 Obsidian 的语言设置，支持简体中文和英文。

## 用法

1. 在设置里填好**邮箱地址**，在**授权码**一项里选择或新建一个密钥，把 IMAP 授权码存进去（保存在系统钥匙串）。163 邮箱在「设置 → POP3/SMTP/IMAP」里开启 IMAP 并生成授权码。**测试连接**只登录、不读取邮件内容。
2. 命令面板运行「同步发票邮箱」，或打开侧边栏的发票面板点「同步」。
3. 「打开发票总表」查看全部发票；「切换当前发票报销状态」在笔记里标记已报销。

也可以把 XML/ZIP 丢进 `invoices/import/`，下次同步时自动导入。

生成的位置（都可在设置里改）：

- 笔记：`invoices/{year}/{month}/{date} {seller} {total}.md`
- 原始文件：`attachments/invoices/{year}/`
- 总表：`invoices/发票总表.base`

笔记里 `%% invoice-sync:start/end %%` 之间是插件管理的区域，标记之外的内容不会被改写。

## 网络与隐私

- **IMAP**：直连你在设置里填的邮件服务器（默认 `imap.163.com:993`，TLS），只读取邮件，不删除、不发送。
- **发票下载链接**：邮件里没有 XML 附件时，会访问邮件正文中的开票平台链接（跟随短链跳转）下载 XML/PDF/OFD。
- 授权码存在 Obsidian 的 SecretStorage（系统钥匙串），不会写进随 vault 同步的 `data.json`。
- 不接入任何大模型或第三方中转服务，没有遥测。

## 开发

```bash
pnpm install
pnpm build          # 构建到 dist/main.js
pnpm smoke          # 离线冒烟测试
```

安装到 vault：把 `dist/main.js`、`manifest.json`、`styles.css` 放进
`<vault>/.obsidian/plugins/gogoga-invoice-sync/`。

发布：`git tag 0.1.1 && git push --tags`（tag 必须与 manifest.json 的 version 一致，不带 v），
GitHub Actions 会构建并把三个文件挂到 Release，可用 BRAT 安装。

## 更新日志

每个版本的变化见 [CHANGELOG.zh-CN.md](CHANGELOG.zh-CN.md)（[English](CHANGELOG.md)）。发版前先写好新版本的条目：Release 说明从这里取，没写时发布会失败。

## 许可

MIT，见 [LICENSE](https://github.com/JackWeiGogoga/gogoga-invoice-sync/blob/main/LICENSE)。
