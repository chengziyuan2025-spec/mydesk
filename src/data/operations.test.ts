import { describe, expect, it } from "vitest";
import { createDefaultData } from "./defaults";
import { applyOperation, migrateBrowserData } from "./operations";

describe("DeskBox operations", () => {
  it("migrates v1 shortcuts with usage metadata", () => {
    const legacy = createDefaultData() as unknown as Record<string, unknown>;
    legacy.version = 1;
    delete legacy.revision;
    delete legacy.trash;
    const migrated = migrateBrowserData(legacy);
    expect(migrated.version).toBe(2);
    expect(migrated.containers[0].shortcuts[0].launchCount).toBe(0);
  });

  it("moves a shortcut before a stable anchor", () => {
    const data = createDefaultData();
    const [first, second] = data.containers[0].shortcuts;
    const next = applyOperation(data, { type: "moveShortcut", shortcutId: second.id, targetContainerId: data.containers[0].id, beforeShortcutId: first.id });
    expect(next.containers[0].shortcuts.map((item) => item.id)).toEqual([second.id, first.id]);
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
