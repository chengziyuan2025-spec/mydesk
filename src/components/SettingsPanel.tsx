import { useEffect, useState } from "react";
import { ArrowLeft, DatabaseBackup, Download, Eye, FolderOpen, ImagePlus, Keyboard, MonitorCog, Moon, Palette, RefreshCw, RotateCcw, SlidersHorizontal, Sun, Upload, X } from "lucide-react";
import type { AppData, BackgroundSettings, HotkeyAction, HotkeyStatus, Settings, Theme } from "../types";
import { platform, type EverythingDetection } from "../services/platform";

interface SettingsPanelProps {
  data: AppData;
  onChange: (settings: Settings) => Promise<unknown>;
  onRestoreContainer: (id: string) => void;
  onExport: () => void;
  onImport: () => void;
  onOpenBackupDirectory: () => void;
  onNotify: (message: string, type: "success" | "error" | "info") => void;
  onBack: () => void;
}

type SettingsSection = "appearance" | "hotkeys" | "automation" | "workspaces" | "searchData";

export function SettingsPanel({ data, onChange, onRestoreContainer, onExport, onImport, onOpenBackupDirectory, onNotify, onBack }: SettingsPanelProps) {
  const settings = data.settings;
  const hidden = data.containers.filter((container) => container.hidden);
  const patch = (value: Partial<Settings>) => onChange({ ...settings, ...value });
  const patchBackground = (value: Partial<BackgroundSettings>) => patch({ appearance: { ...settings.appearance, background: { ...settings.appearance.background, ...value } } });
  const [hotkeyStatuses, setHotkeyStatuses] = useState<HotkeyStatus[]>([]);
  const [hotkeyError, setHotkeyError] = useState<Record<string, string>>({});
  const [everything, setEverything] = useState<EverythingDetection | null>(null);
  const [section, setSection] = useState<SettingsSection>("appearance");
  const backgroundUrl = platform.backgroundUrl(settings.appearance.background.assetPath);
  const accentValue = settings.appearance.accentColor ?? (settings.theme === "dark" ? "#ef7557" : "#dc5a3c");
  const accentPresets = ["#dc5a3c", "#d34f70", "#8257d5", "#2879d0", "#138a72", "#b8781b"];
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

  const selectBackground = async () => {
    try {
      const selection = await platform.pickBackgroundMedia();
      if (!selection) return;
      const previousPath = settings.appearance.background.assetPath;
      await patchBackground({ kind: selection.kind, assetPath: selection.assetPath, assetName: selection.assetName });
      if (previousPath && previousPath !== selection.assetPath && !previousPath.startsWith("data:")) {
        await platform.deleteBackgroundAsset(previousPath).catch(() => undefined);
      }
      onNotify(`已应用${selection.kind === "video" ? "视频" : "图片"}背景`, "success");
    } catch (error) { onNotify(`导入背景失败：${String(error)}`, "error"); }
  };

  const removeBackground = async () => {
    const previousPath = settings.appearance.background.assetPath;
    try {
      await patchBackground({ kind: "none", assetPath: null, assetName: null });
      if (previousPath && !previousPath.startsWith("data:")) await platform.deleteBackgroundAsset(previousPath).catch(() => undefined);
      onNotify("背景已移除", "success");
    } catch (error) { onNotify(`移除背景失败：${String(error)}`, "error"); }
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

  const navigation: Array<{ id: SettingsSection; label: string; icon: typeof Palette }> = [
    { id: "appearance", label: "外观", icon: Palette },
    { id: "hotkeys", label: "快捷键", icon: Keyboard },
    { id: "automation", label: "自动收纳", icon: MonitorCog },
    { id: "workspaces", label: "工作区", icon: Eye },
    { id: "searchData", label: "搜索与数据", icon: DatabaseBackup },
  ];

  return (
    <section className="settings-window" aria-label="DeskBox 设置">
      <aside className="settings-window__nav" aria-label="设置分类">
        <div className="settings-window__brand"><strong>DeskBox</strong><span>设置</span></div>
        {navigation.map((item) => {
          const Icon = item.icon;
          return <button key={item.id} type="button" className={section === item.id ? "is-active" : ""} onClick={() => setSection(item.id)}><Icon size={17} /><span>{item.label}</span></button>;
        })}
      </aside>
      <div className="settings-window__content">
        <header className="settings-window__header"><div className="settings-window__heading"><button type="button" className="settings-back" onClick={onBack}><ArrowLeft size={17} /><span>返回</span></button><div><h1>{navigation.find((item) => item.id === section)?.label}</h1><p>修改会立即应用到所有 DeskBox 窗口。</p></div></div></header>
        <div className="settings-list">
        {section === "appearance" && <>
        <section className="setting-row setting-row--stack">
          <div className="setting-copy">
            <span className="setting-icon"><MonitorCog size={19} strokeWidth={1.6} /></span>
            <div><strong>界面主题</strong><p>选择更适合当前环境的显示方式</p></div>
          </div>
          <div className="segmented" aria-label="界面主题">
            {(["light", "dark"] as Theme[]).map((theme) => (
              <button key={theme} type="button" className={settings.theme === theme ? "is-active" : ""} onClick={() => void patch({ theme })}>
                {theme === "light" ? <Sun size={16} strokeWidth={1.7} /> : <Moon size={16} strokeWidth={1.7} />}
                {theme === "light" ? "亮色" : "暗色"}
              </button>
            ))}
          </div>
        </section>
        <section className="setting-row setting-row--stack">
          <div className="setting-copy">
            <span className="setting-icon"><Palette size={19} strokeWidth={1.6} /></span>
            <div><strong>主题色</strong><p>用于主操作、焦点和重点状态</p></div>
          </div>
          <div className="appearance-colors">
            <label className="appearance-color-input" title="自定义主题色"><input type="color" value={accentValue} onChange={(event) => void patch({ appearance: { ...settings.appearance, accentColor: event.target.value } })} /><span style={{ background: accentValue }} /></label>
            <div className="appearance-swatches" aria-label="主题色预设">
              {accentPresets.map((color) => <button key={color} type="button" aria-label={`使用 ${color} 主题色`} title={color} className={settings.appearance.accentColor === color ? "is-active" : ""} style={{ background: color }} onClick={() => void patch({ appearance: { ...settings.appearance, accentColor: color } })} />)}
            </div>
            <button type="button" className="button button--ghost appearance-reset" onClick={() => void patch({ appearance: { ...settings.appearance, accentColor: null } })}><RotateCcw size={15} />恢复默认</button>
            <label className="switch appearance-adaptive"><input type="checkbox" checked={settings.appearance.adaptiveAccent} onChange={(event) => void patch({ appearance: { ...settings.appearance, adaptiveAccent: event.target.checked } })} /><span /><em>自适应</em></label>
          </div>
        </section>
        <section className="setting-row setting-row--stack">
          <div className="setting-copy">
            <span className="setting-icon"><ImagePlus size={19} strokeWidth={1.6} /></span>
            <div><strong>背景媒体</strong><p>图片和视频会复制到 DeskBox 本地目录</p></div>
          </div>
          <div className="appearance-background">
            <div className={`appearance-preview ${backgroundUrl ? "is-active" : ""}`}>
              {backgroundUrl && settings.appearance.background.kind === "image" && <img src={backgroundUrl} alt="当前背景预览" />}
              {backgroundUrl && settings.appearance.background.kind === "video" && <video src={backgroundUrl} muted preload="metadata" playsInline />}
              {!backgroundUrl && <span>未设置背景</span>}
              {backgroundUrl && <em>{settings.appearance.background.assetName ?? "当前背景"}</em>}
            </div>
            <div className="appearance-background__actions">
              <button type="button" className="button button--ghost" onClick={() => void selectBackground()}><FolderOpen size={15} />{backgroundUrl ? "替换媒体" : "选择图片或视频"}</button>
              {backgroundUrl && <button type="button" className="button button--ghost" onClick={() => void removeBackground()}><X size={15} />移除背景</button>}
            </div>
          </div>
        </section>
        <section className="setting-row setting-row--stack">
          <div className="setting-copy">
            <span className="setting-icon"><SlidersHorizontal size={19} strokeWidth={1.6} /></span>
            <div><strong>背景遮罩</strong><p>增强文字与控件的可读性</p></div>
          </div>
          <label className="appearance-overlay"><span>{settings.appearance.background.overlay}%</span><input type="range" min="0" max="80" value={settings.appearance.background.overlay} onChange={(event) => void patchBackground({ overlay: Number(event.target.value) })} /></label>
        </section>
        </>}
        {section === "hotkeys" && <>
        <section className="setting-row setting-row--stack">
          <div className="setting-copy"><span className="setting-icon"><Keyboard size={19} strokeWidth={1.6} /></span><div><strong>当前可用快捷键</strong><p>点击绑定后按下组合键；冲突会保留原设置。</p></div></div>
          <div className="hotkey-list">
            {hotkeyRow("mainWindow", "主窗口", settings.hotkeys.mainWindow)}
            {hotkeyRow("quickLaunch", "快速启动", settings.hotkeys.quickLaunch)}
            {hotkeyRow("toggleContainers", "显示 / 隐藏全部容器", settings.hotkeys.toggleContainers)}
            {hotkeyRow("settings", "打开设置", settings.hotkeys.settings)}
            {data.containers.map((container) => hotkeyRow(`container:${container.id}`, `打开「${container.name}」`, container.hotkey))}
            <div className="hotkey-row hotkey-row--reserved"><span>恢复鼠标交互</span><kbd>Ctrl+Shift+M</kbd><em>系统保留</em></div>
          </div>
        </section>
        </>}
        {section === "searchData" && <>
        <section className="setting-row setting-row--stack">
          <div className="setting-copy"><span className="setting-icon"><FolderOpen size={19} strokeWidth={1.6} /></span><div><strong>Everything 文件搜索</strong><p>{everything?.message ?? "正在检测 Everything"}</p></div></div>
          <div className="everything-settings">
            <label className="switch"><input type="checkbox" checked={settings.everything.enabled} onChange={async (event) => {
              const enabled = event.target.checked; const detection = everything ?? await platform.detectEverything();
              void patch({ everything: { enabled, executablePath: enabled ? (settings.everything.executablePath ?? detection.executablePath) : settings.everything.executablePath } });
            }} /><span /><em>{settings.everything.enabled ? "已启用" : "已关闭"}</em></label>
            <button type="button" className="button button--ghost" onClick={() => void platform.detectEverything().then(setEverything)}><RefreshCw size={15} />重新检测</button>
            <button type="button" className="button button--ghost" onClick={() => void platform.pickPath().then((path) => {
              if (!path) return;
              if (!/(?:^|[\\/])Everything\.exe$/i.test(path)) { onNotify("请选择 Everything.exe", "error"); return; }
              void patch({ everything: { ...settings.everything, executablePath: path } });
              setEverything({ installed: true, running: everything?.running ?? false, executablePath: path, message: "已确认 Everything 程序路径" });
            })}><FolderOpen size={15} />选择程序</button>
            <button type="button" className="button button--ghost" onClick={() => void platform.refreshSystemAppCatalog().then(() => onNotify("应用目录已刷新", "success")).catch((error) => onNotify(`刷新失败：${String(error)}`, "error"))}><RefreshCw size={15} />刷新应用目录</button>
          </div>
          {settings.everything.enabled && !settings.everything.executablePath && <p className="setting-warning">未找到 Everything.exe；文件搜索会保持禁用，其他搜索不受影响。</p>}
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
        </>}
        {section === "automation" && <>
        <section className="setting-row">
          <div className="setting-copy">
            <span className="setting-index">01</span>
            <div><strong>桌面自动收纳</strong><p>监听桌面中新出现的 .lnk 与 .exe 文件</p></div>
          </div>
          <label className="switch">
            <input type="checkbox" checked={settings.autoCollect} onChange={(event) => void patch({ autoCollect: event.target.checked })} />
            <span /><em>{settings.autoCollect ? "已开启" : "已关闭"}</em>
          </label>
        </section>
        <section className={`setting-row ${!settings.autoCollect ? "is-disabled" : ""}`}>
          <div className="setting-copy">
            <span className="setting-index">02</span>
            <div><strong>收纳后处理源文件</strong><p>删除会将源文件移入系统回收站</p></div>
          </div>
          <div className="segmented segmented--compact">
            <button type="button" disabled={!settings.autoCollect} className={!settings.deleteSource ? "is-active" : ""} onClick={() => void patch({ deleteSource: false })}>保留</button>
            <button type="button" disabled={!settings.autoCollect} className={settings.deleteSource ? "is-active" : ""} onClick={() => void patch({ deleteSource: true })}>移至回收站</button>
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
            onChange={(event) => void patch({ defaultContainerId: event.target.value })}
          >
            {!data.containers.length && <option value="">暂无容器</option>}
            {data.containers.map((container) => <option value={container.id} key={container.id}>{container.name}{container.hidden ? "（已隐藏）" : ""}</option>)}
          </select>
        </section>
        </>}
        {section === "workspaces" && <>
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
        {!hidden.length && <div className="settings-empty">当前没有隐藏的工作区。</div>}
        </>}
      </div>
      </div>
    </section>
  );
}
