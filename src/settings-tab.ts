import { App, Notice, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import type InvoiceSyncPlugin from "./main";

export class InvoiceSyncSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: InvoiceSyncPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    const s = this.plugin.settings;
    const save = async () => {
      await this.plugin.saveSettings();
      this.plugin.refreshView();
    };
    containerEl.empty();

    // ---- 邮箱 ----
    new Setting(containerEl).setName("邮箱").setHeading();

    new Setting(containerEl)
      .setName("邮箱地址")
      .setDesc("专门收发票的邮箱。")
      .addText((t) =>
        t.setPlaceholder("invoice@163.com").setValue(s.email).onChange(async (v) => {
          s.email = v.trim();
          await save();
        }),
      );

    new Setting(containerEl)
      .setName("授权码")
      .setDesc("选择或新建一个存放 IMAP 授权码的密钥。授权码保存在系统钥匙串里，不会写进插件设置文件，也不随 iCloud 同步。在 163 网页版 设置 → POP3/SMTP/IMAP 里开启 IMAP 后生成。")
      .addComponent((el) =>
        new SecretComponent(this.app, el).setValue(s.secretId).onChange(async (v) => {
          s.secretId = v;
          await save();
        }),
      );

    new Setting(containerEl)
      .setName("测试连接")
      .setDesc("登录邮箱并列出文件夹，不读取邮件内容。")
      .addButton((b) =>
        b.setButtonText("测试").onClick(async () => {
          b.setDisabled(true).setButtonText("连接中…");
          try {
            const folders = await this.plugin.sync.testConnection();
            new Notice(`连接成功：${folders.map((f) => `${f.path}(${f.messages ?? "?"})`).join("、")}`, 8000);
          } catch (err) {
            new Notice(`连接失败：${err instanceof Error ? err.message : String(err)}`, 10000);
          } finally {
            b.setDisabled(false).setButtonText("测试");
          }
        }),
      );

    new Setting(containerEl)
      .setName("IMAP 服务器")
      .setDesc("163 邮箱不用改。")
      .addText((t) =>
        t.setValue(s.host).onChange(async (v) => {
          s.host = v.trim() || "imap.163.com";
          await save();
        }),
      )
      .addText((t) => {
        t.inputEl.style.width = "5em";
        t.setValue(String(s.port)).onChange(async (v) => {
          s.port = Number(v) || 993;
          await save();
        });
      });

    // ---- 同步 ----
    new Setting(containerEl).setName("同步").setHeading();

    new Setting(containerEl)
      .setName("扫描的文件夹")
      .setDesc("逗号分隔，默认只有 INBOX。")
      .addText((t) =>
        t.setValue(s.folders.join(", ")).onChange(async (v) => {
          s.folders = v.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
          await save();
        }),
      );

    new Setting(containerEl)
      .setName("同时扫描垃圾邮件")
      .setDesc("发票通知偶尔会被 163 当成垃圾邮件。")
      .addToggle((t) =>
        t.setValue(s.includeJunk).onChange(async (v) => {
          s.includeJunk = v;
          await save();
        }),
      );

    new Setting(containerEl)
      .setName("首次同步起始日期")
      .setDesc("只在第一次同步时生效，格式 2025-01-01；留空为全部邮件。")
      .addText((t) =>
        t.setPlaceholder("全部").setValue(s.sinceDate).onChange(async (v) => {
          s.sinceDate = /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : "";
          await save();
        }),
      );

    new Setting(containerEl)
      .setName("跟随下载链接")
      .setDesc("邮件没有附带 XML 时，打开正文里的下载链接去取。")
      .addToggle((t) =>
        t.setValue(s.followLinks).onChange(async (v) => {
          s.followLinks = v;
          await save();
        }),
      );

    new Setting(containerEl)
      .setName("自动同步")
      .addToggle((t) =>
        t.setValue(s.autoSyncEnabled).onChange(async (v) => {
          s.autoSyncEnabled = v;
          await save();
          this.plugin.rescheduleAutoSync();
        }),
      )
      .addDropdown((d) =>
        d
          .addOptions({ "30": "每 30 分钟", "60": "每小时", "180": "每 3 小时", "720": "每 12 小时" })
          .setValue(String(s.autoSyncIntervalMinutes))
          .onChange(async (v) => {
            s.autoSyncIntervalMinutes = Number(v);
            await save();
            this.plugin.rescheduleAutoSync();
          }),
      );

    new Setting(containerEl)
      .setName("启动时同步")
      .setDesc("打开 Obsidian 后自动同步一次。")
      .addToggle((t) =>
        t.setValue(s.syncOnStartup).onChange(async (v) => {
          s.syncOnStartup = v;
          await save();
        }),
      );

    // ---- 存放 ----
    new Setting(containerEl).setName("笔记与文件").setHeading();

    const text = (name: string, desc: string, key: "rootFolder" | "dirTemplate" | "fileTemplate" | "filesFolder" | "importFolder" | "initialStatus") =>
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addText((t) =>
          t.setValue(s[key]).onChange(async (v) => {
            if (v.trim()) s[key] = v.trim();
            await save();
          }),
        );
    text("根目录", "发票笔记和总表放在这里。", "rootFolder");
    text("目录模板", "可用 {year} {month} {category} {seller}。", "dirTemplate");
    text("文件名模板", "可用 {date} {seller} {total} {number} {category} {kind}。", "fileTemplate");
    text("原始文件目录", "PDF / OFD / XML 按年份存在这里，以发票号码命名。", "filesFolder");
    text("导入文件夹", "手动下载的 XML / ZIP / PDF / OFD 丢进来，同步时自动处理。", "importFolder");
    text("初始报销状态", "新发票的 status 字段；之后由你自己改。", "initialStatus");

    new Setting(containerEl)
      .setName("内嵌 PDF 预览")
      .addToggle((t) =>
        t.setValue(s.embedPdf).onChange(async (v) => {
          s.embedPdf = v;
          await save();
        }),
      );

    // ---- 抬头 ----
    new Setting(containerEl).setName("抬头校验").setHeading();
    new Setting(containerEl)
      .setName("我的抬头")
      .setDesc("每行一个，名称或税号均可。设置后，购买方不在列表里的发票会进待处理并标注「抬头不符」。")
      .addTextArea((t) => {
        t.inputEl.rows = 3;
        t.setValue(s.myBuyers.join("\n")).onChange(async (v) => {
          s.myBuyers = v.split("\n").map((x) => x.trim()).filter(Boolean);
          await save();
        });
      });

    // ---- 维护 ----
    new Setting(containerEl).setName("维护").setHeading();
    new Setting(containerEl)
      .setName("重新扫描邮箱")
      .setDesc("忘掉已处理过的邮件，下次同步从头扫一遍。已有的发票按号码去重，不会重复生成。")
      .addButton((b) =>
        b.setButtonText("重置").onClick(async () => {
          this.plugin.index.resetMailState();
          await this.plugin.index.save();
          new Notice("已重置，下次同步会重新扫描全部邮件");
        }),
      );
  }
}
