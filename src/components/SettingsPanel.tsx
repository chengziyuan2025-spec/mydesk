import { DatabaseBackup, Download, Eye, FolderOpen, MonitorCog, Moon, Sun, Upload } from "lucide-react";
import type { AppData, Settings, Theme } from "../types";
import { Modal } from "./Modal";

interface SettingsPanelProps {
  data: AppData;
  onChange: (settings: Settings) => void;
  onRestoreContainer: (id: string) => void;
  onExport: () => void;
  onImport: () => void;
  onOpenBackupDirectory: () => void;
  onClose: () => void;
}

export function SettingsPanel({ data, onChange, onRestoreContainer, onExport, onImport, onOpenBackupDirectory, onClose }: SettingsPanelProps) {
  const settings = data.settings;
  const hidden = data.containers.filter((container) => container.hidden);
  const patch = (value: Partial<Settings>) => onChange({ ...settings, ...value });

  return (
    <Modal title="设置" description="偏好设置会自动保存，并立即作用于当前窗口。" onClose={onClose}>
      <div className="settings-list">
        <section className="setting-row setting-row--stack">
          <div className="setting-copy">
            <span className="setting-icon"><MonitorCog size={19} strokeWidth={1.6} /></span>
            <div><strong>界面主题</strong><p>选择更适合当前环境的显示方式</p></div>
          </div>
          <div className="segmented" aria-label="界面主题">
            {(["light", "dark"] as Theme[]).map((theme) => (
              <button key={theme} type="button" className={settings.theme === theme ? "is-active" : ""} onClick={() => patch({ theme })}>
                {theme === "light" ? <Sun size={16} strokeWidth={1.7} /> : <Moon size={16} strokeWidth={1.7} />}
                {theme === "light" ? "亮色" : "暗色"}
              </button>
            ))}
          </div>
        </section>
        <section className="setting-row">
          <div className="setting-copy">
            <span className="setting-index">01</span>
            <div><strong>桌面自动收纳</strong><p>监听桌面中新出现的 .lnk 与 .exe 文件</p></div>
          </div>
          <label className="switch">
            <input type="checkbox" checked={settings.autoCollect} onChange={(event) => patch({ autoCollect: event.target.checked })} />
            <span /><em>{settings.autoCollect ? "已开启" : "已关闭"}</em>
          </label>
        </section>
        <section className={`setting-row ${!settings.autoCollect ? "is-disabled" : ""}`}>
          <div className="setting-copy">
            <span className="setting-index">02</span>
            <div><strong>收纳后处理源文件</strong><p>删除会将源文件移入系统回收站</p></div>
          </div>
          <div className="segmented segmented--compact">
            <button type="button" disabled={!settings.autoCollect} className={!settings.deleteSource ? "is-active" : ""} onClick={() => patch({ deleteSource: false })}>保留</button>
            <button type="button" disabled={!settings.autoCollect} className={settings.deleteSource ? "is-active" : ""} onClick={() => patch({ deleteSource: true })}>移至回收站</button>
          </div>
        </section>
        <section className="setting-row setting-row--stack">
          <div className="setting-copy">
            <span className="setting-icon"><DatabaseBackup size={19} strokeWidth={1.6} /></span>
            <div><strong>数据管理</strong><p>每日自动保留最近 7 份本地备份</p></div>
          </div>
          <div className="data-actions">
            <button type="button" className="button button--ghost" onClick={onExport}><Download size={16} />导出</button>
            <button type="button" className="button button--ghost" onClick={onImport}><Upload size={16} />导入</button>
            <button type="button" className="button button--ghost" onClick={onOpenBackupDirectory}><FolderOpen size={16} />备份目录</button>
          </div>
        </section>
        <section className={`setting-row ${!settings.autoCollect ? "is-disabled" : ""}`}>
          <div className="setting-copy">
            <span className="setting-index">03</span>
            <div><strong>默认收纳容器</strong><p>新发现的快捷方式将进入这里</p></div>
          </div>
          <select
            value={settings.defaultContainerId}
            disabled={!settings.autoCollect || !data.containers.length}
            onChange={(event) => patch({ defaultContainerId: event.target.value })}
          >
            {!data.containers.length && <option value="">暂无容器</option>}
            {data.containers.map((container) => <option value={container.id} key={container.id}>{container.name}{container.hidden ? "（已隐藏）" : ""}</option>)}
          </select>
        </section>
        {hidden.length > 0 && (
          <section className="hidden-containers">
            <header><div><Eye size={18} strokeWidth={1.6} /><strong>已隐藏容器</strong></div><span>{hidden.length}</span></header>
            <div className="hidden-containers__items">
              {hidden.map((container) => (
                <button type="button" key={container.id} onClick={() => onRestoreContainer(container.id)}>
                  <span>{container.name}</span><em>恢复显示</em>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}
