import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { searchDeskBox, type SearchResult } from "../data/search";
import { useDeskBox } from "../hooks/useDeskBox";
import { platform } from "../services/platform";
import { appWindowStore } from "../stores/useAppStore";
import { SearchResults } from "./SearchResults";

export function QuickLauncher() {
  const { data, actions } = useDeskBox({ enableDesktopWatcher: false });
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => data ? searchDeskBox(data, query, 10) : [], [data, query]);

  useEffect(() => { setActiveIndex(0); }, [query]);
  useEffect(() => {
    let unlisten: () => void = () => undefined;
    void platform.onQuickLaunchReset(() => {
      setQuery(""); setActiveIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 20);
    }).then((stop) => { unlisten = stop; });
    inputRef.current?.focus();
    return () => unlisten();
  }, []);

  const select = async (result: SearchResult) => {
    if (result.kind === "shortcut") await actions.launchShortcut(result.shortcut.id);
    else if (result.kind === "container") await appWindowStore.showContainerWindow(result.container.id);
    else await actions.launchPath(result.target);
    await platform.hide();
  };

  return (
    <main className="quick-launcher">
      <div className="quick-search">
        <Search size={22} strokeWidth={1.65} />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索快捷方式、容器、路径或网址"
          onKeyDown={(event) => {
            if (event.key === "Escape") void platform.hide();
            if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((value) => Math.min(value + 1, results.length - 1)); }
            if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((value) => Math.max(value - 1, 0)); }
            if (event.key === "Enter" && results[activeIndex]) {
              event.preventDefault();
              if (event.ctrlKey && results[activeIndex].kind === "shortcut") void actions.reveal(results[activeIndex].shortcut.path);
              else void select(results[activeIndex]);
            }
          }}
        />
        <button type="button" aria-label="关闭" title="关闭" onClick={() => void platform.hide()}><X size={18} /></button>
      </div>
      <SearchResults results={results} activeIndex={activeIndex} onHover={setActiveIndex} onSelect={(result) => void select(result)} compact />
      <footer><span>DeskBox</span><span>Alt + Space</span></footer>
    </main>
  );
}
