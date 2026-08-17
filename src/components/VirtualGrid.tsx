import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { FixedSizeGrid } from "react-window";

interface VirtualGridProps<T> {
  items: T[];
  className?: string;
  minimumColumnWidth: number;
  rowHeight: number;
  overscanRows?: number;
  trailingItem?: ReactNode;
  renderItem: (item: T) => ReactNode;
}

function useGridSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => setSize({ width: node.clientWidth, height: node.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

export function VirtualGrid<T>({ items, className, minimumColumnWidth, rowHeight, overscanRows = 2, trailingItem, renderItem }: VirtualGridProps<T>) {
  const [ref, size] = useGridSize();
  const allItems = trailingItem ? [...items, trailingItem as T] : items;
  const columnCount = Math.max(1, Math.floor(size.width / minimumColumnWidth));
  const rowCount = Math.max(1, Math.ceil(allItems.length / columnCount));
  const height = Math.min(Math.max(rowHeight, rowCount * rowHeight), 480);
  const columnWidth = size.width ? Math.floor(size.width / columnCount) : minimumColumnWidth;

  return <div ref={ref} className={`${className ?? ""} virtual-grid`} style={{ height }}>
    {size.width > 0 && <FixedSizeGrid width={size.width} height={height} columnCount={columnCount} columnWidth={columnWidth} rowCount={rowCount} rowHeight={rowHeight} overscanRowCount={overscanRows}>
      {({ columnIndex, rowIndex, style }: { columnIndex: number; rowIndex: number; style: React.CSSProperties }) => {
        const index = rowIndex * columnCount + columnIndex;
        const item = allItems[index];
        return <div style={style} className="virtual-grid__cell">{item === undefined ? null : index < items.length ? renderItem(item) : trailingItem}</div>;
      }}
    </FixedSizeGrid>}
  </div>;
}
