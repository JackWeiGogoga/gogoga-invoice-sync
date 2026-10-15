import { App, Notice, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import type InvoiceSyncPlugin from "./main";
import { t } from "./i18n";

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
    new Setting(containerEl).setName(t("settings.mailbox")).setHeading();

    new Setting(containerEl)
      .setName(t("settings.email.name"))
      .setDesc(t("settings.email.desc"))
      .addText((c) =>
        c.setPlaceholder("invoice@163.com").setValue(s.email).onChange(async (v) => {
          s.email = v.trim();
          await save();
        }),
      );

    new Setting(containerEl)
      .setName(t("settings.authCode.name"))
      .setDesc(t("settings.authCode.desc"))
      .addComponent((el) =>
        new SecretComponent(this.app, el).setValue(s.secretId).onChange(async (v) => {
          s.secretId = v;
          await save();
        }),
      );

    new Setting(containerEl)
      .setName(t("settings.test.name"))
      .setDesc(t("settings.test.desc"))
      .addButton((b) =>
        b.setButtonText(t("settings.test.button")).onClick(async () => {
          b.setDisabled(true).setButtonText(t("settings.test.connecting"));
          try {
            const folders = await this.plugin.sync.testConnection();
            const list = folders.map((f) => `${f.path}(${f.messages ?? "?"})`).join(t("parse.listSeparator"));
            new Notice(t("settings.test.success", { folders: list }), 8000);
          } catch (err) {
            new Notice(t("settings.test.failed", { error: err instanceof Error ? err.message : String(err) }), 10000);
          } finally {
            b.setDisabled(false).setButtonText(t("settings.test.button"));
          }
        }),
      );

    new Setting(containerEl)
      .setName(t("settings.host.name"))
      .setDesc(t("settings.host.desc"))
      .addText((c) =>
        c.setValue(s.host).onChange(async (v) => {
          s.host = v.trim() || "imap.163.com";
          await save();
        }),
      )
      .addText((c) => {
        c.inputEl.addClass("invoice-sync-port-input");
        c.setValue(String(s.port)).onChange(async (v) => {
          s.port = Number(v) || 993;
          await save();
        });
      });

    // ---- 同步 ----
    new Setting(containerEl).setName(t("settings.sync")).setHeading();

    new Setting(containerEl)
      .setName(t("settings.folders.name"))
      .setDesc(t("settings.folders.desc"))
      .addText((c) =>
        c.setValue(s.folders.join(", ")).onChange(async (v) => {
          s.folders = v.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
          await save();
        }),
      );

    new Setting(containerEl)
      .setName(t("settings.junk.name"))
      .setDesc(t("settings.junk.desc"))
      .addToggle((c) =>
        c.setValue(s.includeJunk).onChange(async (v) => {
          s.includeJunk = v;
          await save();
        }),
      );

    new Setting(containerEl)
      .setName(t("settings.since.name"))
      .setDesc(t("settings.since.desc"))
      .addText((c) =>
        c.setPlaceholder(t("settings.since.placeholder")).setValue(s.sinceDate).onChange(async (v) => {
          s.sinceDate = /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : "";
          await save();
        }),
      );

    new Setting(containerEl)
      .setName(t("settings.follow.name"))
      .setDesc(t("settings.follow.desc"))
      .addToggle((c) =>
        c.setValue(s.followLinks).onChange(async (v) => {
          s.followLinks = v;
          await save();
        }),
      );

    new Setting(containerEl)
      .setName(t("settings.auto.name"))
      .addToggle((c) =>
        c.setValue(s.autoSyncEnabled).onChange(async (v) => {
          s.autoSyncEnabled = v;
          await save();
          this.plugin.rescheduleAutoSync();
        }),
      )
      .addDropdown((d) =>
        d
          .addOptions({
            "30": t("settings.auto.30"),
            "60": t("settings.auto.60"),
            "180": t("settings.auto.180"),
            "720": t("settings.auto.720"),
          })
          .setValue(String(s.autoSyncIntervalMinutes))
          .onChange(async (v) => {
            s.autoSyncIntervalMinutes = Number(v);
            await save();
            this.plugin.rescheduleAutoSync();
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.startup.name"))
      .setDesc(t("settings.startup.desc"))
      .addToggle((c) =>
        c.setValue(s.syncOnStartup).onChange(async (v) => {
          s.syncOnStartup = v;
          await save();
        }),
      );

    // ---- 存放 ----
    new Setting(containerEl).setName(t("settings.storage")).setHeading();

    const text = (name: string, desc: string, key: "rootFolder" | "dirTemplate" | "fileTemplate" | "filesFolder" | "importFolder") =>
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addText((c) =>
          c.setValue(s[key]).onChange(async (v) => {
            if (v.trim()) s[key] = v.trim();
            await save();
          }),
        );
    text(t("settings.root.name"), t("settings.root.desc"), "rootFolder");
    text(t("settings.dirTemplate.name"), t("settings.dirTemplate.desc"), "dirTemplate");
    text(t("settings.fileTemplate.name"), t("settings.fileTemplate.desc"), "fileTemplate");
    text(t("settings.filesFolder.name"), t("settings.filesFolder.desc"), "filesFolder");
    text(t("settings.importFolder.name"), t("settings.importFolder.desc"), "importFolder");

    new Setting(containerEl)
      .setName(t("settings.embedPdf.name"))
      .addToggle((c) =>
        c.setValue(s.embedPdf).onChange(async (v) => {
          s.embedPdf = v;
          await save();
        }),
      );

    // ---- 抬头 ----
    new Setting(containerEl).setName(t("settings.buyers")).setHeading();
    new Setting(containerEl)
      .setName(t("settings.myBuyers.name"))
      .setDesc(t("settings.myBuyers.desc"))
      .addTextArea((c) => {
        c.inputEl.rows = 3;
        c.setValue(s.myBuyers.join("\n")).onChange(async (v) => {
          s.myBuyers = v.split("\n").map((x) => x.trim()).filter(Boolean);
          await save();
        });
      });

    // ---- 维护 ----
    new Setting(containerEl).setName(t("settings.maintenance")).setHeading();
    new Setting(containerEl)
      .setName(t("settings.rescan.name"))
      .setDesc(t("settings.rescan.desc"))
      .addButton((b) =>
        b.setButtonText(t("settings.rescan.button")).onClick(async () => {
          this.plugin.index.resetMailState();
          await this.plugin.index.save();
          new Notice(t("settings.rescan.done"));
        }),
      );
  }
}
