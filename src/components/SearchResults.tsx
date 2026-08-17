import { useState } from "react";
import { AppWindow, Calculator, File, Folder, FolderInput, FolderOpen, FolderSearch, Globe2, MoreHorizontal, Pencil, Star, Trash2 } from "lucide-react";
import type { SearchResult } from "../data/search";
import type { ContainerItem } from "../types";

export type SearchAction = "favorite" | "aliases" | "reveal" | "delete";
interface SearchResultsProps {
  results: SearchResult[]; activeIndex: number; onSelect: (result: SearchResult) => void;
  onHover?: (index: number) => void; compact?: boolean; containers?: ContainerItem[];
  onAction?: (result: SearchResult, action: SearchAction) => void;
  onMove?: (result: SearchResult, containerId: string) => void;
}

function iconFor(result: SearchResult) {
  if (result.kind === "container") return FolderOpen;
  if (result.kind === "calculation") return Calculator;
  if (result.kind === "externalFile") return result.item.isDirectory ? Folder : File;
  if (result.kind === "direct") return result.target.startsWith("http") ? Globe2 : Folder;
  return AppWindow;
}

export function SearchResults({ results, activeIndex, onSelect, onHover, compact = false, containers = [], onAction, onMove }: SearchResultsProps) {
  const [menu, setMenu] = useState<string | null>(null);
  if (!results.length) return <div className="search-results__empty">没有匹配结果</div>;
  let section = "";
  return <div className={`search-results ${compact ? "search-results--compact" : ""}`} role="listbox">
    {results.map((result, index) => {
      const Icon = iconFor(result);
      const heading = result.section !== section ? (section = result.section) : null;
      const canManage = !!onAction && !["direct", "calculation"].includes(result.kind);
      const canReveal = result.kind === "shortcut" || result.kind === "externalFile" || (result.kind === "systemApp" && !!result.item.sourcePath);
      const showReveal = result.kind === "shortcut" || result.kind === "systemApp" || result.kind === "externalFile";
      const available = result.kind !== "systemApp" && result.kind !== "externalFile" ? true : result.available;
      const canPlace = result.kind === "shortcut" || ((result.kind === "systemApp" || result.kind === "externalFile") && result.available);
      return <div className="search-result-group" key={result.id}>
        {heading && <h3>{heading}</h3>}
        <div className={`search-result-row ${index === activeIndex ? "is-active" : ""}`} onMouseEnter={() => onHover?.(index)}>
          <button type="button" role="option" aria-selected={index === activeIndex} className="search-result-row__primary" disabled={!available} onClick={() => onSelect(result)}>
            <span className="search-result__icon">
              {result.kind === "shortcut" && result.shortcut.icon ? <img src={result.shortcut.icon} alt="" /> : result.kind === "systemApp" && result.item.icon ? <img src={result.item.icon} alt="" /> : <Icon size={21} strokeWidth={1.55} />}
            </span>
            <span className="search-result__copy"><strong>{result.title}</strong><em>{result.subtitle}</em></span>
            <kbd>{!available ? "不可用" : result.kind === "calculation" ? "复制" : result.kind === "container" ? "打开" : "启动"}</kbd>
          </button>
          {canManage && <>
            <button type="button" className={`search-result-row__tool ${result.favorite ? "is-favorite" : ""}`} aria-label={result.favorite ? "取消收藏" : "收藏"} title={result.favorite ? "取消收藏" : "收藏"} onClick={() => onAction?.(result, "favorite")}><Star size={15} fill={result.favorite ? "currentColor" : "none"} /></button>
            <button type="button" className="search-result-row__tool" aria-label="更多操作" title="更多操作" onClick={() => setMenu((current) => current === result.id ? null : result.id)}><MoreHorizontal size={16} /></button>
            {menu === result.id && <div className="search-result-menu" role="menu">
              <button type="button" onClick={() => { onAction?.(result, "aliases"); setMenu(null); }}><Pencil size={15} />编辑别名</button>
              {showReveal && <button type="button" disabled={!canReveal} title={canReveal ? undefined : "此系统应用没有可定位的文件"} onClick={() => { onAction?.(result, "reveal"); setMenu(null); }}><FolderSearch size={15} />{canReveal ? "在文件管理器中定位" : "无可定位文件"}</button>}
              {canPlace && containers.length > 0 && <label><FolderInput size={15} /><select defaultValue="" onChange={(event) => { if (event.target.value) onMove?.(result, event.target.value); setMenu(null); }}><option value="" disabled>{result.kind === "shortcut" ? "移动到容器" : "添加到容器"}</option>{containers.map((container) => <option key={container.id} value={container.id}>{container.name}</option>)}</select></label>}
              {result.kind === "shortcut" && <button type="button" className="is-danger" onClick={() => { onAction?.(result, "delete"); setMenu(null); }}><Trash2 size={15} />移入 DeskBox 回收站</button>}
            </div>}
          </>}
        </div>
      </div>;
    })}
  </div>;
}
