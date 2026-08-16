import type { AppData } from "../types";

export const createId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const createDefaultData = (): AppData => ({
  version: 3,
  revision: 0,
  containers: [{
    id: "sample-container",
    name: "示例",
    hidden: false,
    pinned: false,
    shortcuts: [
      { id: "sample-calculator", name: "计算器", path: "C:\\Windows\\System32\\calc.exe", source: "manual", arguments: null, workingDirectory: null, icon: null, createdAt: 0, launchCount: 0, lastLaunchedAt: null },
      { id: "sample-notepad", name: "记事本", path: "C:\\Windows\\System32\\notepad.exe", source: "manual", arguments: null, workingDirectory: null, icon: null, createdAt: 0, launchCount: 0, lastLaunchedAt: null },
    ],
  }],
  settings: { theme: "light", autoCollect: true, deleteSource: false, defaultContainerId: "sample-container" },
  trash: [],
});
