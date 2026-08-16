import { Minus, X } from "lucide-react";
import { platform } from "../services/platform";
import { IconButton } from "./IconButton";

export function TitleBar() {
  const startDragging = (event: React.MouseEvent<HTMLElement>) => {
    if (
      event.button !== 0 ||
      (event.target as HTMLElement).closest("[data-window-control]")
    ) {
      return;
    }
    void platform.startDragging();
  };

  const stopDragPropagation = (event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

  const handleMinimize = async () => {
    console.log("最小化按钮被点击");
    try {
      await platform.minimize();
      console.log("最小化调用成功");
    } catch (error) {
      console.error("最小化失败:", error);
    }
  };

  const handleClose = async () => {
    console.log("关闭按钮被点击");
    try {
      await platform.close();
      console.log("关闭调用成功，窗口将隐藏到托盘");
    } catch (error) {
      console.error("关闭失败:", error);
    }
  };

  return (
    <header className="titlebar" onMouseDown={startDragging}>
      <div className="brand">
        <span className="brand__mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <strong>DeskBox</strong>
        <span className="brand__hint">桌面快捷收纳</span>
      </div>
      <div className="window-controls" onMouseDown={stopDragPropagation}>
        <IconButton
          data-tauri-drag-region="false"
          data-window-control="minimize"
          label="最小化"
          onClick={handleMinimize}
        >
          <Minus size={17} strokeWidth={1.7} />
        </IconButton>
        <IconButton
          data-tauri-drag-region="false"
          data-window-control="close"
          label="关闭"
          tone="danger"
          onClick={handleClose}
        >
          <X size={17} strokeWidth={1.7} />
        </IconButton>
      </div>
    </header>
  );
}
