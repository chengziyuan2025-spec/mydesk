import { useState, type FormEvent } from "react";
import { Modal } from "./Modal";

interface AddContainerModalProps {
  onAdd: (name: string) => void;
  onClose: () => void;
}

export function AddContainerModal({ onAdd, onClose }: AddContainerModalProps) {
  const [name, setName] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = name.trim();
    if (!value) return;
    onAdd(value);
    onClose();
  };

  return (
    <Modal title="新建容器" description="给一组相关的快捷方式留一个固定位置。" onClose={onClose} width="small">
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>容器名称</span>
          <input autoFocus maxLength={24} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：设计工具" />
        </label>
        <div className="form-actions">
          <button className="button button--ghost" type="button" onClick={onClose}>取消</button>
          <button className="button button--primary" type="submit" disabled={!name.trim()}>创建容器</button>
        </div>
      </form>
    </Modal>
  );
}
