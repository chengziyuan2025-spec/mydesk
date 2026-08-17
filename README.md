# DeskBox

DeskBox 是一个面向 Windows 的桌面快捷方式收纳工具。它使用 Tauri v2、React 18 和 TypeScript 构建，可以把常用程序、文件夹、文件和网址整理到独立的悬浮工作区中。

## 功能

- 容器式快捷方式管理：创建、重命名、排序、隐藏、恢复和回收
- 独立悬浮工作区：拖动、缩放、锁定、折叠、透明度和鼠标穿透
- 悬浮布局：紧凑、网格和列表模式，可控制任务栏显示及多工作区可见性
- 窗口记忆：关闭前保存大小、位置和配置；再次打开时恢复，并自动修正到当前显示器工作区
- 左右贴边自动隐藏：靠近屏幕边缘停靠，触碰保留热区恢复；从主页或快捷键打开时也会主动展开
- 主页内设置：设置采用返回式页面，不再创建重复的独立设置窗口
- 快速启动：支持拼音、别名、收藏、最近使用、高频项目和容器直达
- 系统搜索：开始菜单、已安装应用，以及可选的 Everything Query2 IPC 文件搜索
- 桌面自动收纳：监听新建的 `.lnk` / `.exe`，可保留源文件、移入系统回收站或隐藏源文件
- 外观：亮色/暗色、主题色、壁纸自适应主题色及图片/视频背景
- 数据安全：原子写入、版本迁移、每日备份、导入导出、应用内回收站和即时撤销
- Windows 集成：托盘、全局快捷键、单实例、关联图标提取和资源管理器定位

## 使用悬浮工作区

在主页点击容器即可打开对应的悬浮工作区。关闭按钮只隐藏窗口，不删除容器；位置、尺寸和窗口选项会在隐藏前写入布局文件。

开启“贴边自动隐藏”后，把窗口拖到屏幕左侧或右侧即可收起。屏幕边缘会保留约 10 像素的可触发区域，鼠标移入即可恢复。也可以回到主页再次点击该容器，或使用容器/全部工作区快捷键主动展开。

## 开发环境

- Windows 10/11
- Node.js 20 或更高版本
- Rust stable 与 Cargo
- Microsoft Edge WebView2 Runtime
- Visual Studio C++ Build Tools（用于 Windows Rust/Tauri 构建）

安装并启动原生应用：

```powershell
npm install
npm run tauri dev
```

只调试 React 界面：

```powershell
npm run dev
```

浏览器模式使用 `localStorage` 作为降级存储，部分 Windows 原生能力不可用。

## 检查与构建

```powershell
npm run check
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build
```

`npm run check` 会依次运行前端测试、TypeScript/Vite 构建和 `cargo check`。Windows 安装包输出到 `src-tauri/target/release/bundle`。

## 目录

```text
src/
  components/       页面、悬浮工作区和交互组件
  data/             默认数据、操作归约、搜索和性能策略
  hooks/            数据加载、乐观更新和跨窗口同步
  services/         Tauri / 浏览器平台适配
  stores/           Zustand 细粒度状态订阅
src-tauri/src/
  commands.rs       前端可调用的系统命令
  container_windows.rs  悬浮窗口生命周期与布局持久化
  app_state.rs      内存数据、操作提交与延迟落盘
  models.rs         数据模型与迁移目标版本
  storage.rs        原子写入、备份和资源目录
  hotkeys.rs        全局快捷键注册
  icons.rs          Windows 图标提取与缓存
  watcher.rs        桌面目录监听
```

## 本地数据

应用标识为 `com.deskbox.app`。主要文件位于系统应用数据目录：

- `deskbox-data.json`：业务数据，当前格式版本 v6
- `deskbox-container-windows.json`：各悬浮工作区的位置、尺寸和窗口选项
- `backups/`：每日、迁移前和导入前备份
- `assets/`：导入的图片和视频背景

关联图标缓存位于系统应用缓存目录的 `icons/`。更完整的架构、注意事项和维护流程见 [HANDOFF.md](./HANDOFF.md)。
