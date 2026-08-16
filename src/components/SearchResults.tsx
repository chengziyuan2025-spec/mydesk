import { AppWindow, Folder, FolderOpen, Globe2 } from "lucide-react";
import type { SearchResult } from "../data/search";

interface SearchResultsProps {
  results: SearchResult[];
  activeIndex: number;
  onSelect: (result: SearchResult) => void;
  onHover?: (index: number) => void;
  compact?: boolean;
}

export function SearchResults({ results, activeIndex, onSelect, onHover, compact = false }: SearchResultsProps) {
  if (!results.length) return <div className="search-results__empty">没有匹配结果</div>;
  return (
    <div className={`search-results ${compact ? "search-results--compact" : ""}`} role="listbox">
      {results.map((result, index) => {
        const Icon = result.kind === "container" ? FolderOpen : result.kind === "direct" ? (result.target.startsWith("http") ? Globe2 : Folder) : AppWindow;
        return (
          <button
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            className={index === activeIndex ? "is-active" : ""}
            key={result.id}
            onMouseEnter={() => onHover?.(index)}
            onClick={() => onSelect(result)}
          >
            <span className="search-result__icon">
              {result.kind === "shortcut" && result.shortcut.icon
                ? <img src={result.shortcut.icon} alt="" />
                : <Icon size={21} strokeWidth={1.55} />}
            </span>
            <span className="search-result__copy"><strong>{result.title}</strong><em>{result.subtitle}</em></span>
            <kbd>{result.kind === "container" ? "打开" : "启动"}</kbd>
          </button>
        );
      })}
    </div>
  );
}
