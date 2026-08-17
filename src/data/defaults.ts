import type { AppData } from "../types";

export const createId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const createDefaultData = (): AppData => ({
  version: 5,
  revision: 0,
  containers: [{
    id: "sample-container",
    name: "示例",
    hidden: false,
    pinned: false,
    aliases: [], favorite: false, openCount: 0, lastOpenedAt: null, hotkey: null,
    shortcuts: [
      { id: "sample-calculator", name: "计算器", path: "C:\\Windows\\System32\\calc.exe", targetType: "path", aliases: [], favorite: false, sourcePath: null, source: "manual", arguments: null, workingDirectory: null, icon: null, createdAt: 0, launchCount: 0, lastLaunchedAt: null },
      { id: "sample-notepad", name: "记事本", path: "C:\\Windows\\System32\\notepad.exe", targetType: "path", aliases: [], favorite: false, sourcePath: null, source: "manual", arguments: null, workingDirectory: null, icon: null, createdAt: 0, launchCount: 0, lastLaunchedAt: null },
    ],
  }],
  settings: {
    theme: "light",
    appearance: { accentColor: null, background: { kind: "none", assetPath: null, assetName: null, overlay: 34 } },
    autoCollect: true,
    deleteSource: false,
    defaultContainerId: "sample-container",
    hotkeys: { mainWindow: "Ctrl+Shift+H", quickLaunch: "Alt+Space", toggleContainers: null },
    everything: { enabled: false, executablePath: null },
  },
  externalLauncherEntries: [],
  trash: [],
});
