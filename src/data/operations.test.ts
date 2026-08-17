import { describe, expect, it } from "vitest";
import { createDefaultData } from "./defaults";
import { applyOperation, migrateBrowserData } from "./operations";

describe("DeskBox operations", () => {
  it("migrates v1 active and trashed shortcuts to v4", () => {
    const legacy = createDefaultData() as unknown as Record<string, unknown>;
    legacy.version = 1;
    delete legacy.revision;
    const active = (legacy.containers as Array<{ shortcuts: Array<Record<string, unknown>> }>)[0].shortcuts[0];
    delete active.source;
    delete active.arguments;
    delete active.workingDirectory;
    const trashed = { ...active, id: "trashed" };
    legacy.trash = [
      { kind: "shortcut", id: "trash-shortcut", deletedAt: 1, originalIndex: 0, originalContainerId: "sample-container", item: trashed },
      { kind: "container", id: "trash-container", deletedAt: 1, originalIndex: 0, item: { id: "old", name: "Old", hidden: false, pinned: false, shortcuts: [{ ...active, id: "nested" }] } },
    ];
    const migrated = migrateBrowserData(legacy);
    expect(migrated.version).toBe(4);
    expect(migrated.settings.hotkeys.mainWindow).toBe("Ctrl+Shift+H");
    expect(migrated.externalLauncherEntries).toEqual([]);
    expect(migrated.containers[0].shortcuts[0]).toMatchObject({ source: "manual", arguments: null, workingDirectory: null });
    expect(migrated.trash[0].kind === "shortcut" && migrated.trash[0].item.source).toBe("manual");
    expect(migrated.trash[1].kind === "container" && migrated.trash[1].item.shortcuts[0].workingDirectory).toBeNull();
  });

  it("migrates v2 shortcut metadata defaults", () => {
    const legacy = createDefaultData() as unknown as Record<string, unknown>;
    legacy.version = 2;
    const shortcut = (legacy.containers as Array<{ shortcuts: Array<Record<string, unknown>> }>)[0].shortcuts[0];
    delete shortcut.source;
    delete shortcut.arguments;
    delete shortcut.workingDirectory;
    expect(migrateBrowserData(legacy).containers[0].shortcuts[0]).toMatchObject({ source: "manual", arguments: null, workingDirectory: null });
  });

  it("moves a shortcut before a stable anchor", () => {
    const data = createDefaultData();
    const [first, second] = data.containers[0].shortcuts;
    const next = applyOperation(data, { type: "moveShortcut", shortcutId: second.id, targetContainerId: data.containers[0].id, beforeShortcutId: first.id });
    expect(next.containers[0].shortcuts.map((item) => item.id)).toEqual([second.id, first.id]);
  });

  it("persists container pinned state", () => {
    const data = createDefaultData();
    const next = applyOperation(data, { type: "setContainerPinned", containerId: data.containers[0].id, pinned: true });
    expect(next.containers[0].pinned).toBe(true);
  });

  it("restores a shortcut into a fallback container", () => {
    let data = createDefaultData();
    const shortcut = data.containers[0].shortcuts[0];
    data = applyOperation(data, { type: "deleteShortcut", containerId: data.containers[0].id, shortcutId: shortcut.id, trashId: "trash", deletedAt: 1 });
    data.containers = [];
    data.settings.defaultContainerId = "";
    data = applyOperation(data, { type: "restoreTrash", trashId: "trash" });
    expect(data.containers[0].name).toBe("已恢复");
    expect(data.containers[0].shortcuts[0].id).toBe(shortcut.id);
  });
});
