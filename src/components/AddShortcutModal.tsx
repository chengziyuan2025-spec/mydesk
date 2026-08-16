import { useState, type FormEvent } from "react";
import { FolderSearch } from "lucide-react";
import { platform } from "../services/platform";
import { Modal } from "./Modal";

interface AddShortcutModalProps {
  containerName: string;
  onAdd: (name: string, path: string) => Promise<void>;
  onClose: () => void;
}

const nameFromPath = (path: string) => {
  const file = path.split(/[\\/]/).pop() ?? "";
  return file.replace(/\.[^.]+$/, "");
};

export function AddShortcutModal({ containerName, onAdd, onClose }: AddShortcutModalProps) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const browse = async () => {
    const selected = await platform.pickPath();
    if (!selected) return;
    setPath(selected);
    if (!name.trim()) setName(nameFromPath(selected));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !path.trim()) return;
    setSubmitting(true);
    await onAdd(name.trim(), path.trim());
    onClose();
  };

  return (
    <Modal title="添加快捷方式" description={`添加到「${containerName}」，程序图标会自动提取并缓存。`} onClose={onClose}>
      <form className="form" onSubmit={(event) => void submit(event)}>
        <label className="field">
          <span>显示名称</span>
          <input autoFocus maxLength={40} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：Photoshop" />
        </label>
        <label className="field">
          <span>文件或程序路径</span>
          <div className="path-input">
            <input value={path} onChange={(event) => setPath(event.target.value)} placeholder="C:\\Program Files\\..." />
            <button type="button" className="browse-button" onClick={() => void browse()} title="选择文件">
              <FolderSearch size={18} strokeWidth={1.65} />
              <span>浏览</span>
            </button>
          </div>
        </label>
        <div className="form-actions">
          <button className="button button--ghost" type="button" onClick={onClose}>取消</button>
          <button className="button button--primary" type="submit" disabled={submitting || !name.trim() || !path.trim()}>
            {submitting ? "正在提取图标..." : "添加快捷方式"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
