import { useEffect, useState } from "react";
import { DatabaseBackup, Download, Eye, FolderOpen, Keyboard, MonitorCog, Moon, RefreshCw, Sun, Upload, X } from "lucide-react";
import type { AppData, HotkeyAction, HotkeyStatus, Settings, Theme } from "../types";
import { platform, type EverythingDetection } from "../services/platform";
import { Modal } from "./Modal";

interface SettingsPanelProps {
  data: AppData;
  onChange: (settings: Settings) => void;
  onRestoreContainer: (id: string) => void;
  onExport: () => void;
  onImport: () => void;
  onOpenBackupDirectory: () => void;
  onNotify: (message: string, type: "success" | "error" | "info") => void;
  onClose: () => void;
}

export function SettingsPanel({ data, onChange, onRestoreContainer, onExport, onImport, onOpenBackupDirectory, onNotify, onClose }: SettingsPanelProps) {
  const settings = data.settings;
  const hidden = data.containers.filter((container) => container.hidden);
  const patch = (value: Partial<Settings>) => onChange({ ...settings, ...value });
  const [hotkeyStatuses, setHotkeyStatuses] = useState<HotkeyStatus[]>([]);
  const [hotkeyError, setHotkeyError] = useState<Record<string, string>>({});
  const [everything, setEverything] = useState<EverythingDetection | null>(null);
  useEffect(() => { void platform.getHotkeyStatuses().then(setHotkeyStatuses); void platform.detectEverything().then(setEverything); }, []);

  const setHotkey = async (action: HotkeyAction, accelerator: string | null) => {
    try {
      await platform.setHotkeyBinding(action, accelerator);
      setHotkeyError((current) => ({ ...current, [action]: "" }));
      setHotkeyStatuses(await platform.getHotkeyStatuses());
    } catch (error) {
      const message = String(error);
      setHotkeyError((current) => ({ ...current, [action]: message }));
      onNotify(message, "error");
    }
  };

  const hotkeyRow = (action: HotkeyAction, label: string, value: string | null) => {
    const status = hotkeyStatuses.find((item) => item.action === action);
    return <div className="hotkey-row" key={action}><span>{label}</span><button type="button" className="hotkey-capture" onKeyDown={(event) => {
      event.preventDefault(); event.stopPropagation();
      if (event.key === "Backspace" || event.key === "Delete") { void setHotkey(action, null); return; }
      if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) return;
      const modifiers = [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Super"].filter(Boolean);
      const key = event.key === " " ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key;
      void setHotkey(action, [...modifiers, key].join("+"));
    }}>{value ?? "未设置"}</button>{value && <button type="button" className="hotkey-clear" aria-label={`清除${label}`} onClick={() => void setHotkey(action, null)}><X size={14} /></button>}<em className={hotkeyError[action] || status?.state === "conflict" || status?.state === "invalid" ? "is-error" : ""}>{hotkeyError[action] || status?.message || (status?.state === "active" ? "已生效" : "点击后按下组合键")}</em></div>;
  };

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
        <section className="setting-row setting-row--stack">
          <div className="setting-copy"><span className="setting-icon"><Keyboard size={19} strokeWidth={1.6} /></span><div><strong>全局快捷键</strong><p>冲突时保留原快捷键，Backspace 可清除</p></div></div>
          <div className="hotkey-list">
            {hotkeyRow("mainWindow", "主窗口", settings.hotkeys.mainWindow)}
            {hotkeyRow("quickLaunch", "快速启动", settings.hotkeys.quickLaunch)}
            {hotkeyRow("toggleContainers", "显示 / 隐藏全部容器", settings.hotkeys.toggleContainers)}
            {data.containers.map((container) => hotkeyRow(`container:${container.id}`, `打开「${container.name}」`, container.hotkey))}
          </div>
        </section>
        <section className="setting-row setting-row--stack">
          <div className="setting-copy"><span className="setting-icon"><FolderOpen size={19} strokeWidth={1.6} /></span><div><strong>Everything 文件搜索</strong><p>{everything?.message ?? "正在检测 Everything"}</p></div></div>
          <div className="everything-settings">
            <label className="switch"><input type="checkbox" checked={settings.everything.enabled} onChange={async (event) => {
              const enabled = event.target.checked; const detection = everything ?? await platform.detectEverything();
              patch({ everything: { enabled, executablePath: enabled ? (settings.everything.executablePath ?? detection.executablePath) : settings.everything.executablePath } });
            }} /><span /><em>{settings.everything.enabled ? "已启用" : "已关闭"}</em></label>
            <button type="button" className="button button--ghost" onClick={() => void platform.detectEverything().then(setEverything)}><RefreshCw size={15} />重新检测</button>
            <button type="button" className="button button--ghost" onClick={() => void platform.pickPath().then((path) => {
              if (!path) return;
              if (!/(?:^|[\\/])Everything\.exe$/i.test(path)) { onNotify("请选择 Everything.exe", "error"); return; }
              patch({ everything: { ...settings.everything, executablePath: path } });
              setEverything({ installed: true, running: everything?.running ?? false, executablePath: path, message: "已确认 Everything 程序路径" });
            })}><FolderOpen size={15} />选择程序</button>
            <button type="button" className="button button--ghost" onClick={() => void platform.refreshSystemAppCatalog().then(() => onNotify("应用目录已刷新", "success")).catch((error) => onNotify(`刷新失败：${String(error)}`, "error"))}><RefreshCw size={15} />刷新应用目录</button>
          </div>
          {settings.everything.enabled && !settings.everything.executablePath && <p className="setting-warning">未找到 Everything.exe；文件搜索会保持禁用，其他搜索不受影响。</p>}
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
