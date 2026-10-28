# Changelog

All notable changes to gogoga Invoice Sync are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). 中文版见 [CHANGELOG.zh-CN.md](CHANGELOG.zh-CN.md).

## [0.2.0] - 2026-10-15

### Added
- English and Simplified Chinese interface, following Obsidian's language.
- English README with a Simplified Chinese translation.

## [0.1.0] - 2026-10-14

First public release.

### Added
- Syncs e-invoices from a dedicated IMAP mailbox (163 Mail by default) into notes. Mail is only read, never deleted or sent. Desktop only.
- Parses the national-standard invoice XML, follows download links in the mail body when there is no attachment, and reads PDFs that have a text layer.
- Archives the original PDF / OFD / XML files and generates a Bases table of all invoices.
- A command to toggle the reimbursement status; XML / ZIP files dropped into `invoices/import/` are imported.
- The mailbox password is kept in the system keychain, not in the synced `data.json`.

[0.2.0]: https://github.com/JackWeiGogoga/gogoga-invoice-sync/compare/0.1.0...0.2.0
[0.1.0]: https://github.com/JackWeiGogoga/gogoga-invoice-sync/releases/tag/0.1.0
