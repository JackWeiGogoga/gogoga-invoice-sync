# gogoga Invoice Sync

**English** | [简体中文](https://github.com/JackWeiGogoga/gogoga-invoice-sync/blob/main/README.zh-CN.md)

Sync e-invoices from a dedicated invoice IMAP mailbox (163 Mail by default) into Obsidian notes.
The plugin parses the national-standard XML of fully digital e-invoices (数电票). When an email has no attachment, it follows the download link in the email body.
The original PDF, OFD, and XML files are archived in your vault, and the plugin generates an invoice overview table with Bases. Desktop only.

The interface follows Obsidian's language setting: English, or Simplified Chinese when Obsidian is set to Chinese. Generated invoice notes and the overview table keep Chinese property names.

## Install

### With BRAT (recommended)

This plugin isn't in the community directory. Install it with [BRAT](https://github.com/TfTHacker/obsidian42-brat), which also keeps it updated: install and enable **BRAT** from the community plugins, click **Add beta plugin** in BRAT's settings, enter `https://github.com/JackWeiGogoga/gogoga-invoice-sync`, then enable **gogoga Invoice Sync** under Settings → Community plugins.

### Manual install

For offline machines (such as a company network) or to pin a specific version:

1. Open the [Releases page](https://github.com/JackWeiGogoga/gogoga-invoice-sync/releases/latest) and download the three files `main.js`, `manifest.json`, `styles.css` under **Assets**. **Don't download the Source code archives**: they are the source code, which Obsidian can't load.
2. In your vault's folder, go to `.obsidian/plugins/`, create a folder named `gogoga-invoice-sync`, and put the files in it, so you end up with paths like `<vault>/.obsidian/plugins/gogoga-invoice-sync/main.js`.
   - `.obsidian` is a hidden folder: press `⌘ ⇧ .` in Finder on macOS; on Windows, tick **Hidden items** under **View** in File Explorer.
3. Restart Obsidian (or click the refresh button under Settings → Community plugins), then enable **gogoga Invoice Sync** in the list of installed plugins.

On phones, where moving files around is awkward, use BRAT.

## Usage

1. In settings, enter your **Email address**. Under **Authorization code**, pick or create a secret and paste your IMAP authorization code into it; it is kept in the system keychain. In 163 Mail, enable IMAP and generate the code under **设置 → POP3/SMTP/IMAP** (Settings → POP3/SMTP/IMAP). **Test connection** checks the login without reading any email.
2. Run **Sync invoice mailbox** from the command palette, or open the invoice panel in the sidebar and select **Sync**.
3. Use **Open invoice overview** to see all invoices, and **Toggle reimbursement status of current invoice** to mark an invoice as reimbursed in its note.

You can also drop XML or ZIP files into `invoices/import/`. They're imported automatically on the next sync.

Output locations (all configurable in settings):

- Notes: `invoices/{year}/{month}/{date} {seller} {total}.md`
- Original files: `attachments/invoices/{year}/`
- Overview table: `invoices/发票总表.base`

The area between `%% invoice-sync:start/end %%` in a note is managed by the plugin. Content outside the markers is never rewritten.

## Network and privacy

- **IMAP**: Connects directly to the mail server you configure in settings (default `imap.163.com:993`, TLS). It only reads email, and never deletes or sends any.
- **Invoice download links**: When an email has no XML attachment, the plugin visits the invoicing platform link in the email body (following short-link redirects) to download the XML, PDF, or OFD file.
- The authorization code is stored in Obsidian's SecretStorage (the system keychain), and is never written to `data.json`, which syncs with your vault.
- No large language models or third-party relay services are used, and there is no telemetry.

## Development

```bash
pnpm install
pnpm build          # outputs dist/main.js
pnpm smoke          # offline smoke tests
```

To install into a vault, copy `dist/main.js`, `manifest.json`, and `styles.css` into
`<vault>/.obsidian/plugins/gogoga-invoice-sync/`.

To release: `git tag 0.1.1 && git push --tags` (the tag must match the version in manifest.json, without a `v` prefix).
GitHub Actions builds the plugin and attaches the three files to the release, which you can then install with BRAT.

## Changelog

What changed in each version is in [CHANGELOG.md](CHANGELOG.md) ([中文](CHANGELOG.zh-CN.md)). Add the new version there before releasing: the release notes are taken from it, and the release fails when the entry is missing.

## License

MIT. See [LICENSE](https://github.com/JackWeiGogoga/gogoga-invoice-sync/blob/main/LICENSE).
