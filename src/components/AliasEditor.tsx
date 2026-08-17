import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Modal } from "./Modal";

export function AliasEditor({ title, initial, onSave, onClose }: { title: string; initial: string[]; onSave: (aliases: string[]) => void; onClose: () => void }) {
  const [aliases, setAliases] = useState(initial);
  const [draft, setDraft] = useState("");
  const add = () => {
    const values = draft.split(/[,，]/).map((item) => item.trim()).filter(Boolean).slice(0, 12);
    setAliases((current) => [...new Set([...current, ...values])].slice(0, 12));
    setDraft("");
  };
  return <Modal title={`编辑「${title}」的别名`} description="别名会参与拼音与模糊搜索。" onClose={onClose}>
    <div className="alias-editor">
      <div className="alias-editor__tags">
        {aliases.map((alias) => <span key={alias}>{alias}<button type="button" aria-label={`删除 ${alias}`} onClick={() => setAliases((current) => current.filter((item) => item !== alias))}><X size={12} /></button></span>)}
        {!aliases.length && <em>尚未设置别名</em>}
      </div>
      <div className="alias-editor__input"><input autoFocus value={draft} maxLength={64} placeholder="例如 ps、修图" onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} /><button type="button" onClick={add} aria-label="添加别名"><Plus size={17} /></button></div>
      <footer><button type="button" className="button button--ghost" onClick={onClose}>取消</button><button type="button" className="button button--primary" onClick={() => { onSave(aliases); onClose(); }}>保存</button></footer>
    </div>
  </Modal>;
}
