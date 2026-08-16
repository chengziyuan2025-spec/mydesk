import { Command, LayoutGrid, ListTree, Plus, Search, Settings2, Trash2 } from "lucide-react";

interface ToolbarProps {
  query: string;
  visibleCount: number;
  totalCount: number;
  trashCount: number;
  view: "overview" | "manage";
  onViewChange: (view: "overview" | "manage") => void;
  onQueryChange: (query: string) => void;
  onAddContainer: () => void;
  onOpenSettings: () => void;
  onOpenTrash: () => void;
  onOpenQuickLaunch: () => void;
}

export function Toolbar(props: ToolbarProps) {
  return (
    <div className="toolbar">
      <div className="toolbar__intro">
        <p className="eyebrow">WORKSPACE</p>
        <div className="toolbar__heading"><h1>我的桌面盒子</h1><span>{props.visibleCount} 个容器 · {props.totalCount} 个快捷方式</span></div>
        <div className="view-tabs" aria-label="主页视图">
          <button type="button" className={props.view === "overview" ? "is-active" : ""} onClick={() => props.onViewChange("overview")}><LayoutGrid size={15} />概览</button>
          <button type="button" className={props.view === "manage" ? "is-active" : ""} onClick={() => props.onViewChange("manage")}><ListTree size={15} />整理</button>
        </div>
      </div>
      <div className="toolbar__controls">
        <label className="search-box"><Search size={17} strokeWidth={1.65} /><input value={props.query} onChange={(event) => props.onQueryChange(event.target.value)} placeholder="搜索并启动" aria-label="搜索并启动" /></label>
        <button type="button" className="icon-command" aria-label="快速启动" onClick={props.onOpenQuickLaunch} title="快速启动"><Command size={18} /><span>Alt Space</span></button>
        <button type="button" className="icon-command icon-command--badge" aria-label={`回收站，${props.trashCount} 个项目`} onClick={props.onOpenTrash} title="回收站"><Trash2 size={18} />{props.trashCount > 0 && <em aria-hidden="true">{props.trashCount}</em>}</button>
        <button type="button" className="icon-command" aria-label="设置" onClick={props.onOpenSettings} title="设置"><Settings2 size={18} /></button>
        <button type="button" className="button button--primary button--icon-command" onClick={props.onAddContainer}><Plus size={18} strokeWidth={1.7} /><span>新建容器</span></button>
      </div>
    </div>
  );
}
