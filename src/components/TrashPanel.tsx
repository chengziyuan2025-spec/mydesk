import { ArchiveRestore, Trash2 } from "lucide-react";
import { useState } from "react";
import type { AppData } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { Modal } from "./Modal";

interface TrashPanelProps {
  data: AppData;
  onRestore: (id: string) => Promise<unknown>;
  onPermanentDelete: (id: string) => Promise<unknown>;
  onEmpty: () => Promise<unknown>;
  onClose: () => void;
}

export function TrashPanel({ data, onRestore, onPermanentDelete, onEmpty, onClose }: TrashPanelProps) {
  const [confirm, setConfirm] = useState<{ kind: "item"; id: string; name: string } | { kind: "all" } | null>(null);
  const entries = [...data.trash].sort((a, b) => b.deletedAt - a.deletedAt);
  return (
    <>
      <Modal title="回收站" description={`${entries.length} 个项目，可恢复到原来的位置。`} onClose={onClose}>
        <div className="trash-panel">
          {entries.length ? entries.map((entry) => (
            <div className="trash-item" key={entry.id}>
              <span className="trash-item__icon"><Trash2 size={18} strokeWidth={1.6} /></span>
              <div><strong>{entry.item.name}</strong><p>{entry.kind === "container" ? `容器 · ${entry.item.shortcuts.length} 个快捷方式` : "快捷方式"} · {new Date(entry.deletedAt).toLocaleString()}</p></div>
              <button className="button button--ghost" type="button" onClick={() => void onRestore(entry.id)}><ArchiveRestore size={16} />恢复</button>
              <button className="icon-button icon-button--danger" type="button" aria-label="永久删除" title="永久删除" onClick={() => setConfirm({ kind: "item", id: entry.id, name: entry.item.name })}><Trash2 size={16} /></button>
            </div>
          )) : <div className="trash-empty"><ArchiveRestore size={28} /><span>回收站为空</span></div>}
          {entries.length > 0 && <button type="button" className="button button--danger trash-empty-button" onClick={() => setConfirm({ kind: "all" })}>清空回收站</button>}
        </div>
      </Modal>
      {confirm?.kind === "item" && <ConfirmDialog title={`永久删除「${confirm.name}」？`} message="此操作无法撤销，不会删除电脑中的原始文件。" confirmText="永久删除" onConfirm={() => void onPermanentDelete(confirm.id)} onClose={() => setConfirm(null)} />}
      {confirm?.kind === "all" && <ConfirmDialog title="清空回收站？" message="回收站中的所有项目将被永久移除，此操作无法撤销。" confirmText="全部删除" onConfirm={() => void onEmpty()} onClose={() => setConfirm(null)} />}
    </>
  );
}
