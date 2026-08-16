# DeskBox 项目交接文档

> 文档日期：2026-08-16
> 当前版本：0.2.0（数据格式 v3）
> 项目路径：`E:\vibecoding\hoverDesk`
> 最新交接：优先阅读第 18 章“原生拖放实现与运行态修复”

## 1. 项目概况

DeskBox 是一个面向 Windows 的桌面快捷方式收纳工具。应用使用 Tauri v2 提供窗口、托盘、全局快捷键、文件系统监听和本地文件操作，使用 React 18 + TypeScript 实现界面和业务状态。

0.2.0 已完成快速启动、应用内拖拽整理、Windows 原生文件拖入、持久回收站、单实例、数据迁移与备份。规则分类等增强功能尚未实现。

## 2. 技术栈与运行环境

| 模块 | 技术 |
| --- | --- |
| 桌面框架 | Tauri 2.11.x |
| 前端 | React 18.3、TypeScript 5.7、Vite 6.4 |
| 图标组件 | lucide-react |
| Rust edition | 2021 |
| 文件监听 | notify 8 |
| 文件选择 | rfd 0.15 |
| 源文件回收 | trash 5 |
| 数据格式 | 本地 JSON |

已验证环境：Windows、Node.js 24.18、npm 11.16、Rust/Cargo 1.96。开发机需要安装 Microsoft Edge WebView2 Runtime。

## 3. 功能完成情况

### 3.1 已完成

- 透明无边框主控台窗口，顶部标题栏通过 Tauri `startDragging()` 手动拖动。
- 每个容器拥有独立的无边框、透明、置顶悬浮窗口；可在桌面拖动、移动和调整大小。
- 悬浮窗口会记住各自的位置与尺寸；关闭或系统关闭请求均只隐藏窗口，不退出程序。
- 主界面完整贴合原生窗口边缘，无额外透明外边距。
- `Ctrl+Shift+H` 全局显示/隐藏主窗口。
- 系统托盘显示/隐藏和退出菜单。
- 关闭窗口时隐藏到托盘，进程继续运行。
- 创建、显式按钮或双击重命名、隐藏、恢复和确认删除容器。
- 主页只显示容器概览；点击容器卡片会创建或显示其对应的悬浮工作区。
- 悬浮工作区显示容器快捷方式，支持添加、启动、右键定位/删除和原地重命名容器。
- 添加快捷方式，支持名称、路径和 Windows 文件选择框。
- 单击启动程序/打开路径。
- 快捷方式右键菜单：删除、在文件管理器中定位。
- Windows 关联图标提取、磁盘缓存和数据回填。
- 监听桌面中新建的 `.lnk` 和 `.exe` 文件。
- 自动放入默认容器，并过滤重复路径和连续重复事件。
- 自动收纳后保留源文件或移入系统回收站。
- 亮色/暗色主题、自动收纳开关、源文件处理和默认容器设置。
- 隐藏容器在设置面板中可恢复。
- 所有增删改操作防抖自动保存，并通过 `app-data-changed` 事件同步到其他窗口。
- 首次启动创建“示例”容器以及“计算器”“记事本”快捷方式。
- 数据文件损坏时备份为 `deskbox-data.corrupt.json`，随后恢复默认数据。
- 浏览器开发模式使用 `localStorage`，可脱离 Tauri 调试界面。
- 主界面快捷方式搜索。
- 所有独立悬浮容器支持从 Windows 资源管理器原生拖入 EXE、LNK、文件夹、普通文件和多选路径。
- 悬浮容器通过 DOM 事件尽力接收浏览器地址栏拖出的 HTTP(S) URL；文件拖入只由 Tauri 原生事件处理，避免重复添加。
- `.lnk` 使用 Windows `IShellLinkW + IPersistFile` 解析目标、参数和工作目录；启动时使用 `ShellExecuteW` 分别传递这些字段。
- 外部拖入支持目标去重、逐项容错、结果汇总、无布局偏移的拖入覆盖提示和可选 `onBeforeAdd` 回调。

### 3.2 部分完成

- 快速搜索已集成主页和 `Alt+Space` 独立窗口；当前不支持拼音索引或任意系统命令。
- 非 Windows 平台保留了部分 `xdg-open` 降级逻辑，但图标提取、托盘和整体体验仅在 Windows 验证。
- 文件夹路径可以手动输入并打开，但当前选择对话框主要用于选择文件。

### 3.3 尚未实现

- 规则自动分类。
- 开机自启动。
- 悬浮窗透明度、鼠标穿透、边缘吸附和场景切换。

## 4. 目录结构

```text
hoverDesk/
├─ public/                         浏览器静态资源
├─ src/
│  ├─ components/                 React 界面组件和弹层
│  │  ├─ FloatingContainer.tsx    容器独立悬浮工作区
│  ├─ data/defaults.ts            浏览器模式默认数据与 ID 生成
│  ├─ hooks/useDeskBox.ts          核心状态、自动保存和桌面事件编排
│  ├─ services/platform.ts         Tauri/浏览器平台适配层
│  ├─ stores/useAppStore.ts        已打开容器窗口的前端请求状态
│  ├─ App.tsx                      页面组合与弹层路由
│  ├─ styles.css                   全局主题、布局和响应式样式
│  └─ types.ts                     前端数据类型
├─ src-tauri/
│  ├─ capabilities/default.json   Tauri 权限声明
│  ├─ icons/                       应用图标和安装包图标
│  ├─ src/
│  │  ├─ commands.rs              前端可调用的系统命令
│  │  ├─ container_windows.rs     动态容器窗口、关闭行为和布局持久化
│  │  ├─ icons.rs                 Windows 图标提取与缓存
│  │  ├─ lib.rs                   Tauri 启动、托盘、热键和窗口事件
│  │  ├─ models.rs                Rust 持久化数据模型
│  │  ├─ storage.rs               数据读取、备份和保存
│  │  └─ watcher.rs               桌面文件夹监听
│  ├─ Cargo.toml
│  └─ tauri.conf.json
├─ package.json
├─ README.md                       快速使用说明
└─ HANDOFF.md                      本交接文档
```

## 5. 关键架构与数据流

前端以 `useDeskBox` 为唯一业务状态入口。组件只接收数据和操作回调，不直接调用 Tauri 命令。

```text
主页窗口 / 容器悬浮窗口
   ↓
useDeskBox（乐观状态、原子操作、通知、跨窗口刷新）
   ↓
platform.ts（Tauri/浏览器适配、窗口 API）
   ↓ invoke / event
commands.rs / container_windows.rs
   ↓
storage / icons / watcher / Windows 系统能力
```

重要原则：

- Rust 的 `deskbox-data.json` 是权威业务状态；前端先乐观应用操作，再以 Rust 返回的最新 revision 校准。
- 所有业务写入通过 `apply_app_operation` 在 Rust 互斥锁内读取、修改、备份和保存，不再由各窗口整包覆盖数据。
- 原子操作完成后广播带 revision 的 `app-data-changed`；其他窗口只在事件版本更新时重新读取。
- 动态窗口的真实生命周期由 Rust 管理；前端 `appWindowStore` 只避免同一渲染器重复请求。
- 桌面监听器只发送 `desktop-file-created` 事件；归类、去重和保存由前端完成。
- 浏览器模式不会启动本地程序或访问文件系统，仅用于界面调试。

## 6. 数据模型

```ts
interface AppData {
  version: 3;
  revision: number;
  containers: ContainerItem[];
  settings: Settings;
  trash: TrashEntry[];
}

interface ContainerItem {
  id: string;
  name: string;
  hidden: boolean;
  pinned: boolean; // 预留字段，当前没有置顶行为
  shortcuts: ShortcutItem[];
}

interface ShortcutItem {
  id: string;
  name: string;
  path: string;
  source: "drag_drop" | "manual";
  arguments: string | null;
  workingDirectory: string | null;
  icon: string | null; // 当前保存为 PNG data URI
  createdAt: number;
  launchCount: number;
  lastLaunchedAt: number | null;
}

interface Settings {
  theme: "light" | "dark";
  autoCollect: boolean;
  deleteSource: boolean;
  defaultContainerId: string;
}
```

Windows 数据位置：

- 主数据：`%APPDATA%\com.deskbox.app\deskbox-data.json`
- 容器窗口布局：`%APPDATA%\com.deskbox.app\deskbox-container-windows.json`
- 损坏数据备份：`%APPDATA%\com.deskbox.app\deskbox-data.corrupt.json`
- 图标缓存：`%LOCALAPPDATA%\com.deskbox.app\icons`
- WebView2 缓存：`%LOCALAPPDATA%\com.deskbox.app\EBWebView`

首次启动默认数据同时在 Rust 的 `models.rs` 和浏览器模式的 `src/data/defaults.ts` 中存在。修改初始化内容时需要同步更新两处。

## 7. Tauri 命令与事件

| 命令/事件 | 方向 | 作用 |
| --- | --- | --- |
| `load_app_data` | 前端 → Rust | 读取或初始化 JSON 数据 |
| `apply_app_operation` | 前端 → Rust | 在后端原子执行增量业务操作并返回最新 AppData |
| `launch_shortcut` | 前端 → Rust | 按 ID 启动并原子更新最近使用与次数 |
| `show_quick_launch` | 前端 → Rust | 显示并聚焦快速启动窗口 |
| `export_backup` / `import_backup` | 前端 → Rust | 导出或验证、迁移并导入 JSON 备份 |
| `open_backup_directory` | 前端 → Rust | 打开每日备份目录 |
| `create_container_window` | 前端 → Rust | 创建或显示 `container-{id}` 悬浮窗口 |
| `hide_container_window` | 前端 → Rust | 隐藏指定容器窗口 |
| `pick_shortcut_path` | 前端 → Rust | 打开 Windows 文件选择框 |
| `extract_icon` | 前端 → Rust | 提取并缓存关联图标，返回 data URI |
| `resolve_shortcut` | 前端 → Rust | 通过 Windows Shell COM 解析 `.lnk` 的目标、参数和工作目录 |
| `is_directory` | 前端 → Rust | 判断拖入的绝对路径是否为目录 |
| `get_file_name` | 前端 → Rust | 获取拖入路径的末级完整文件名 |
| `launch_path` | 前端 → Rust | 启动程序或打开路径 |
| `reveal_in_explorer` | 前端 → Rust | 在文件管理器中定位目标 |
| `configure_desktop_watcher` | 前端 → Rust | 启用或停止桌面监听 |
| `recycle_source` | 前端 → Rust | 将桌面源文件移入系统回收站 |
| `desktop-file-created` | Rust → 前端 | 报告新出现的 `.lnk`/`.exe` 路径 |
| `app-data-changed` | Rust → 前端 | 携带最新 revision，通知其他窗口按需刷新 |

## 8. 开发、检查与打包

首次安装：

```powershell
npm install
```

启动完整桌面应用：

```powershell
npm run tauri dev
```

只启动 React 界面：

```powershell
npm run dev
```

完整编译检查：

```powershell
npm run check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

生成 Windows 安装包：

```powershell
npm run tauri build
```

产物目录：`src-tauri/target/release/bundle`。

如果需要删除 `node_modules`，必须先通过托盘退出 DeskBox，并停止 Vite/Tauri 开发进程，否则 Windows 可能因文件句柄占用而报 `EBUSY`：

```powershell
Remove-Item -LiteralPath .\node_modules -Recurse -Force
npm install
```

保留 `package.json` 和 `package-lock.json`。

## 9. 已完成的验证

截至 2026-08-16，完成以下验证：

- `npm run build`：通过。
- `cargo check --manifest-path src-tauri/Cargo.toml`：通过。
- `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`：通过，零警告。
- Tauri Windows 开发版实机启动：通过。
- 首次启动 JSON 数据创建：通过。
- 计算器和记事本图标提取、缓存、数据回填：通过。
- 发送窗口关闭消息后进程继续存活、窗口隐藏：通过。
- `Ctrl+Shift+H` 从隐藏状态重新显示窗口：通过。
- Playwright 验证创建容器、打开设置、切换暗色主题：通过。
- 1036px 桌面布局和 390px 窄屏布局截图检查：无文字溢出或控件遮挡。
- 移除窗口四周 12px 透明空隙后重新构建：通过。
- 多窗口架构：`npm run check`、`cargo clippy -- -D warnings` 通过。
- Playwright：主页容器概览、悬浮工作区、添加快捷方式弹层和容器重命名流程通过。
- 原生拖放改动：`npm run check` 通过，当前包含 9 个 Vitest 测试和 12 个 Rust 测试。
- Rust 临时创建真实 `.lnk` 后成功解析目标、参数和工作目录。
- Windows 原生窗口自动化验证：工作区“1”首次打开成功；最小化后再次点击卡片可恢复为可见且非最小化状态。

Playwright 临时产物位于 `output/playwright`，该目录已被 `.gitignore` 忽略。

## 10. 已知风险与注意事项

### 10.1 桌面文件事件兼容

监听器当前只处理 `notify::EventKind::Create`。部分软件把文件先写入临时目录再重命名或移动到桌面，此时 Windows 可能产生 Rename 事件而不是 Create，自动收纳可能漏掉。建议下一步同时处理目标位于桌面的 Rename/Modify 事件，并保留现有路径去重。

### 10.2 多实例（已在 0.2.0 解决）

已接入 Tauri single-instance 插件；第二实例会退出并唤醒主窗口。

### 10.3 数据迁移（已在 0.2.0 解决）

已建立 v1→v2 迁移器、迁移前备份和未来版本拒绝策略；新增版本必须继续采用逐版本迁移。

### 10.4 图标缓存

缓存键只基于路径的 SHA-256。同一路径程序升级并更换图标后不会自动失效。后续可以把文件修改时间或文件版本加入缓存键，并避免把完整 data URI 长期重复写入 JSON。

### 10.5 安全配置

`tauri.conf.json` 当前设置 `csp: null`，便于开发和显示 data URI 图标。正式发布前应配置最小 CSP，并复核 Tauri capability 权限范围。

### 10.6 自动收纳删除行为

“删除源文件”实际调用系统回收站，不是永久删除。文件仍在写入或被其他程序占用时，回收可能失败；前端会显示错误并保留源文件。

### 10.7 自动化测试

仓库已有 Vitest 与 Rust 单元测试，覆盖数据操作、v1/v2→v3 迁移、回收站嵌套快捷方式迁移、URL 解析、外部路径命名和去重、命令输入校验以及 `.lnk` 解析。原生 OLE 拖放仍需要 Windows 真实鼠标手工验收，浏览器地址栏 URL 拖入受 WebView2 数据转交行为限制，只能作为尽力功能。

### 10.8 多窗口保存冲突（已在 0.2.0 解决）

业务写入已统一通过 Rust `apply_app_operation` 在互斥锁内原子执行，并用递增 `revision` 防止窗口接收旧状态。

## 11. 推荐后续迭代顺序

1. 扩展桌面 Rename/Move 事件处理，并为事件去重添加测试。
2. 收紧 CSP 和 Tauri capability，完成正式安装包测试。
3. 增加开机自启动以及可配置全局快捷键。
4. 实现规则分类和待整理收件箱。
5. 增加悬浮窗透明度、鼠标穿透、边缘吸附和工作场景。

## 12. 故障排查

### 端口 1420 被占用

先确认是否已经有 Vite/Tauri 开发进程运行：

```powershell
netstat -ano | Select-String ':1420'
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*hoverDesk*' } |
  Select-Object ProcessId, CommandLine
```

只终止确认属于本项目的进程，不要批量结束系统中的所有 Node 进程。

### 窗口关闭后找不到

窗口关闭默认隐藏到托盘。使用 `Ctrl+Shift+H` 或托盘菜单“显示 / 隐藏”恢复。

### 图标没有显示

检查 `%LOCALAPPDATA%\com.deskbox.app\icons` 是否可写，并确认 PowerShell 和 `System.Drawing` 可用。删除单个缓存 PNG 后重启应用会重新提取缺失图标。

### 数据无法恢复

先备份 `%APPDATA%\com.deskbox.app`。应用检测到无效 JSON 时会保留 `.corrupt.json` 并恢复默认数据，旧内容需要从备份中人工修复。

### 窗口顶部无法拖动

当前实现不再使用 `data-tauri-drag-region`。排查时依次确认：

1. `src-tauri/capabilities/default.json` 必须包含 `core:window:allow-start-dragging`。
2. `TitleBar.tsx` 的 `<header>` 必须保留 `onMouseDown`，并调用 `platform.startDragging()`。
3. `platform.ts` 中的 `startDragging()` 必须在 Tauri 环境调用 `getCurrentWindow().startDragging()`。
4. 标题栏 CSS 不应添加 `pointer-events: none` 或 `-webkit-app-region: no-drag`。

标题栏处理器只响应鼠标左键，并通过 `[data-window-control]` 排除最小化、隐藏和重命名控件。主页和悬浮窗口均使用这套手动拖拽逻辑。浏览器预览中 `platform.startDragging()` 会安全地空操作。

### 容器悬浮窗口没有显示

1. 在主页点击容器概览卡片；该操作会调用 `create_container_window`。
2. 已存在但隐藏的窗口会被 Rust 端 `show()` 并聚焦，不会重复创建。
3. 被移出可见屏幕时，先退出 DeskBox，然后备份并删除 `%APPDATA%\com.deskbox.app\deskbox-container-windows.json`，下次打开容器会采用默认位置。

### 调试窗口显示 `ERR_CONNECTION_REFUSED`

这表示 Tauri 调试进程仍在运行，但其开发地址 `http://127.0.0.1:1420` 对应的 Vite 服务已经退出。先运行：

```powershell
npm run dev
```

确认端口恢复后刷新 DeskBox 窗口。若窗口隐藏在托盘，使用 `Ctrl+Shift+H` 显示。不要重复启动多个 `deskbox.exe`，否则全局快捷键注册会报 `HotKey already registered`。

## 13. 2026-08-16 窗口拖动修复记录

本次对话专门排查并修复了无边框透明窗口无法拖动的问题。

### 已确认的问题

- `src-tauri/capabilities/default.json` 原先缺少 `core:window:allow-start-dragging`，已经补充。
- 原来的声明式拖动属性虽然存在于 `<header>`、品牌容器和部分文字节点，但品牌图标内部的实际 DOM 节点没有全部带上属性，存在命中不稳定问题。
- `src/styles.css` 未发现标题栏或父元素使用 `-webkit-app-region: no-drag`。
- CSS 中的 `pointer-events: none` 只用于窗口边框伪元素、隐藏的开关输入和 Toast 容器，不会拦截标题栏鼠标事件。

### 最终实现

- `src/components/TitleBar.tsx` 已移除全部 `data-tauri-drag-region`。
- 标题栏通过 React `onMouseDown` 调用 `platform.startDragging()`。
- `src/services/platform.ts` 新增 `startDragging()`，桌面环境调用 `getCurrentWindow().startDragging()`。
- 标题栏事件会过滤非左键以及来自窗口控制按钮的事件。
- capability 中保留 `core:window:allow-start-dragging`，这是手动调用 Tauri API 所必需的权限。

### 验证情况

- `npm run check`：通过，包括 TypeScript、Vite 生产构建和 `cargo check`。
- `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`：通过，零警告。
- 新 capability 已被 Tauri schema 正确识别，调试二进制可以成功编译和启动。
- 尝试用 PowerShell 注入鼠标事件做原生窗口坐标测试，但诊断证明合成输入没有进入 WebView 的 React `mousedown` 事件，因此这项自动化结果无效，不能用于判断真实鼠标拖动是否成功。
- 下一位接手者应首先使用真实鼠标在标题栏空白区和品牌区域拖动窗口，并分别确认最小化、隐藏按钮仍可正常点击。

### 开发进程注意事项

本次对话结束前曾分别启动 Vite 和 `cargo run` 调试进程，但这些进程可能随 Codex 会话结束而退出。若页面显示连接拒绝，按以下顺序恢复：

```powershell
npm run dev
cargo run --manifest-path src-tauri/Cargo.toml
```

如果 `cargo run` 报调试可执行文件被占用或 `HotKey already registered`，先通过托盘退出已有 DeskBox，或确认进程路径确实位于本项目的 `src-tauri/target/debug/deskbox.exe` 后再结束该进程。不要批量终止所有 Node 或 DeskBox 进程。

## 14. 交接结论

当前 0.2.0 已具备长期使用所需的核心闭环：主页管理、快速启动、独立置顶容器窗口、应用内拖拽整理、Windows 原生文件拖入、持久回收站、自动监听桌面、原子数据写入、迁移备份、设置和托盘驻留。后续仍应保持组件只负责展示，把规则和系统能力放入独立数据模块或 Rust 模块。

## 15. 2026-08-16 多窗口架构交接

### 主页窗口

- 窗口标签为 `main`，由 `Ctrl+Shift+H` 和托盘“显示 / 隐藏”控制。
- 主页显示容器概览卡片，不再在主页内部渲染全部快捷方式网格。
- 点击卡片会调用 `appWindowStore.showContainerWindow(id)`；Rust 端负责复用或创建真实窗口。
- 卡片右上角提供重命名、隐藏、删除；标题双击也可重命名。

### 容器悬浮窗口

- 由 `src-tauri/src/container_windows.rs` 动态创建，标签为 `container-{containerId}`。
- 配置为 `decorations(false)`、`transparent(true)`、`always_on_top(true)`、`resizable(true)`。
- `FloatingContainer.tsx` 通过 `getCurrentWindow().label` 解析容器 ID，并用同一份 `AppData` 找到内容。
- 标题栏空白区域可拖动。重命名、最小化和隐藏按钮均通过 `data-window-control` 排除拖拽。
- 关闭图标调用 `hide()`；原生 `CloseRequested`（例如 Alt+F4）也被 Rust 拦截并隐藏窗口。
- 所有窗口的标题均可通过按钮或双击进入编辑；Enter/失焦保存，Escape 取消。

### 持久化与同步

- 业务数据仍使用原有 `deskbox-data.json`，没有迁移到 `tauri-plugin-store`，避免影响已有用户数据和 Rust 的恢复、图标、监听逻辑。
- `deskbox-container-windows.json` 仅保存每个容器窗口的物理坐标和客户区尺寸。
- 每次移动或调整大小都会更新布局文件；损坏布局文件会被忽略，窗口使用默认偏左居中位置。
- 任何窗口的 `AppOperation` 原子提交成功后，Rust 发送带 revision 的 `app-data-changed`。其他窗口由 `useDeskBox` 按版本重新读取数据。
- 悬浮窗口禁用了桌面监听器，只有主页启动监听，避免多窗口重复收纳同一文件。

### 当前开发进程

截至本次交接，已启动本项目的 Vite 与 Tauri 调试进程。主控台隐藏时可按 `Ctrl+Shift+H` 显示。若需重新启动，请在项目根目录执行：

```powershell
npm run tauri dev
```

## 16. 2026-08-16 核心 0.2.0 交接

- 数据已升级为 v2，包含 `revision`、持久回收站和快捷方式使用统计。真实 v1 数据迁移及迁移前备份已验证。
- 所有业务修改通过 Rust `AppOperation` 原子执行；浏览器模式有同语义执行器用于界面测试。
- `Alt+Space` 打开独立 `quick-launch` 窗口，支持快捷方式、容器、HTTP(S)、绝对路径和 UNC 路径；不执行任意命令。
- 主页新增概览/整理视图，支持真实指针拖拽容器排序、快捷方式排序及跨容器移动；右键“移动到”是精确替代入口。
- 删除容器和快捷方式会进入应用内回收站，并支持即时撤销、恢复、永久删除和清空。
- 设置新增数据导出、导入和备份目录；每日首次修改前创建备份并保留最近 7 份。
- 已验证 `npm run test` 5 项前端测试、Rust 4 项测试、生产构建、Clippy 零警告、单实例和原生全局快捷键。
- Playwright 截图位于 `output/playwright/core-home.png`、`core-manage.png`、`core-trash.png` 和 `core-quick-launch.png`。

## 17. 2026-08-16 本次对话最终交接（最新）

> 本章优先级高于前面关于 0.1.0、整包保存和“尚未实现”的历史描述。

### 本次对话做了什么

1. 先阅读本文件并完成产品评估，确定 DeskBox 的核心价值是“快速启动 + 自动整理 + 场景化悬浮工作区”。
2. 按核心 1.0 方案完成实现：v2 数据层、单实例、`Alt+Space` 启动器、主页整理视图、拖拽排序/跨容器移动、持久回收站、数据备份导入导出。
3. 修复拖拽界面的嵌套交互控件问题：快捷方式使用独立拖拽把手，启动按钮保持单独的可访问控件。
4. 更新 README 和本交接文档，并创建 Git 仓库、提交和推送到 GitHub。

### 当前版本与 Git 状态

- 应用版本：`0.2.0`。
- 远端：`https://github.com/chengziyuan2025-spec/mydesk.git`。
- 分支：`main`。
- 核心实现提交：`936db27 feat: release DeskBox 0.2.0`。
- 本地 Git 用户：`chengziyuan2025-spec <chengziyuan2025-spec@users.noreply.github.com>`。
- `.gitignore` 已排除 `node_modules/`、`dist/`、`src-tauri/target/`、`.playwright-cli/`、`output/playwright/` 和日志。
- 最新文档修改需要继续提交并推送；不要重新初始化仓库或覆盖 `main` 历史。

### 已实现的代码边界

- Rust 数据和系统能力：`src-tauri/src/models.rs`、`operations.rs`、`storage.rs`、`commands.rs`、`lib.rs`。
- 前端状态与平台适配：`src/types.ts`、`src/data/operations.ts`、`src/data/search.ts`、`src/hooks/useDeskBox.ts`、`src/services/platform.ts`。
- 主界面：`src/App.tsx`、`ManageView.tsx`、`QuickLauncher.tsx`、`TrashPanel.tsx`、`SearchResults.tsx`。
- 所有业务修改使用 `AppOperation`：Rust 端在互斥锁中执行，前端浏览器模式使用同语义的本地执行器。
- `save_app_data` 已不再作为常规业务入口；不要重新引入窗口整包覆盖。

### 数据与运行时行为

- `AppData.version` 固定为 2，包含 `revision`、`trash`；快捷方式包含 `launchCount` 和 `lastLaunchedAt`。
- v1 数据首次加载时自动迁移，迁移前写入 `%APPDATA%\\com.deskbox.app\\backups\\migration-*.json`；未来版本数据拒绝加载，不覆盖原文件。
- 每个本地日首次修改前创建 `daily-*.json`，保留最近 7 份。导入前会备份当前数据。
- 删除容器或快捷方式进入应用回收站；快捷方式恢复优先回原容器和原位置，原容器不存在时进入默认容器，必要时创建“已恢复”。
- 快速启动窗口标签为 `quick-launch`，固定 680x460，置顶、不进任务栏，失焦或 `Esc` 隐藏。
- 快速启动允许已有快捷方式/容器、HTTP(S)、Windows 绝对路径和 UNC 路径；不允许任意协议、PowerShell 或系统命令。
- `Alt+Space` 已在 Windows 实机注册成功；主页“快速启动”按钮是快捷键不可用时的备用入口。
- 第二个 `deskbox.exe` 实例会退出并唤醒已有主窗口；已实测进程数保持为 1。

### 已执行验证

- `npm run check`：通过；包含 5 个 Vitest 测试、TypeScript 检查、Vite 生产构建和 Cargo check。
- `cargo test --manifest-path src-tauri/Cargo.toml`：4 个测试通过。
- `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`：零警告。
- Playwright 浏览器模式：搜索直接启动结果、概览/整理切换、真实指针拖拽快捷方式跨容器、容器排序、右键移动、回收站删除/恢复均已验证。
- Windows 原生：v1→v2 迁移备份、`Alt+Space` 唤起、第二实例保护均已验证。
- 当前开发服务通常是 Vite `127.0.0.1:1420` 加 `cargo run --manifest-path src-tauri/Cargo.toml`；如果会话结束，按原交接中的启动命令重启。

### 已知限制与下一步

- 桌面监听器目前仍主要处理 Create，Rename/Move 事件兼容和对应测试尚未补齐。
- 开机自启动、规则自动分类、场景切换、悬浮窗透明度/鼠标穿透/边缘吸附仍未实现。
- 正式发布前仍需收紧 `tauri.conf.json` 的 `csp: null`，复核 capability 权限，并完成安装包测试。
- 浏览器模式的导入功能不打开本地文件选择框，完整导入导出能力只在 Tauri 桌面环境可用。
- 快速启动当前没有拼音索引，也不执行任意系统命令。
- 后续修改数据字段时必须同时更新 Rust 模型、Rust 迁移器、`src/types.ts`、浏览器默认数据和对应测试。

## 18. 2026-08-16 原生拖放实现与运行态修复（当前最新）

> 本章记录本次对话完成的工作，并覆盖前文关于数据 v2、没有单元测试及悬浮窗显示行为的旧描述。

### 18.1 用户目标与完成范围

- 仅独立悬浮容器窗口接受外部拖入；主页和快速启动窗口不启用这一交互。
- 支持从 Windows 资源管理器拖入 `.exe`、`.lnk`、文件夹、普通文件和多选路径。
- 支持从浏览器地址栏尽力拖入 HTTP(S) URL；WebView2 不把文本交给 DOM 时不会生效，这是平台限制。
- 同一容器按规范化目标路径去重；同一批拖入中的重复项也会跳过。
- 每个路径独立处理，单项失败不会阻断其余项目；完成后汇总添加、重复、取消和失败数量。
- `FloatingContainer` 暴露可选异步 `onBeforeAdd(candidate)`，默认直接添加，为后续确认对话框预留接口。

### 18.2 前端实现

- `src/components/FloatingContainer.tsx` 使用 `getCurrentWebview().onDragDropEvent()`，按当前 Tauri API 的 `enter / over / drop / leave` payload 处理原生路径，组件卸载时注销监听。
- 未使用 React `onDrop/onDragOver` 处理文件。窗口级 DOM `dragover/drop` 只处理 `text/uri-list` 或 `text/plain` 的 HTTP(S) URL；发现 `dataTransfer.files` 或 file item 时立即忽略。
- `src/data/externalDrop.ts` 集中实现 URL 校验/提取、显示名规则、目标规范化和去重；`externalDrop.test.ts` 覆盖这些纯函数。
- 路径命名规则：文件夹使用末级目录名；EXE 去扩展名；普通文件保留完整文件名；LNK 显示链接文件名；URL 使用完整 URL。
- `useDeskBox.actions.addShortcut` 新增兼容式 options 参数，支持 `source`、`arguments`、`workingDirectory`、预取图标和关闭单项通知；原有添加弹窗调用无需修改。

### 18.3 Rust 与 Windows 实现

- `container_windows.rs` 对动态容器 Builder 设置 `.visible(true)`，并在 Windows 设置 `.drag_and_drop(true)`。保存的尺寸和位置在 `build()` 前写入 Builder，避免窗口创建后跳动。
- 已存在窗口重新打开时执行 `unminimize() + show() + set_focus()`；新建窗口在注册事件后也显式 `show()`。此补丁已用 Windows UI Automation 验证最小化恢复。
- 新命令 `resolve_shortcut`、`is_directory`、`get_file_name` 已在 `lib.rs` 注册，并在 `platform.ts` 提供类型化封装。
- `.lnk` 使用 `IShellLinkW + IPersistFile` 无界面解析。COM 初始化兼容线程已初始化和 `RPC_E_CHANGED_MODE` 情况，只在本调用成功初始化时执行 `CoUninitialize()`。
- Windows 启动改用 `ShellExecuteW`，目标、参数和工作目录分开传递，保留开始菜单快捷方式的启动语义。
- `Cargo.toml` 的 `windows` crate 已启用 `Win32_Storage_FileSystem`、`Win32_System_Com`、`Win32_UI_Shell` 和 `Win32_UI_WindowsAndMessaging`。

### 18.4 数据 v3 与迁移

- `ShortcutItem` 新增 `source: "drag_drop" | "manual"`、`arguments` 和 `workingDirectory`；Rust 字段对应 `ShortcutSource`、`arguments`、`working_directory`。
- 当前 `AppData.version` / `CURRENT_DATA_VERSION` 为 3。
- Rust 存储与浏览器存储均支持旧数据升级；活动快捷方式、回收站快捷方式以及回收站容器内的嵌套快捷方式统一补 `source: manual`，启动元数据补 `null`。
- 默认数据、手动添加和桌面自动收纳标记为 `manual`；本次外部文件与 URL 拖入标记为 `drag_drop`。
- 开发机真实数据 `%APPDATA%\com.deskbox.app\deskbox-data.json` 已迁移到 v3，迁移后容器和原快捷方式均保留。

### 18.5 Capability 兼容性决定

- `capabilities/default.json` 的窗口范围包含 `main`、`container-*` 和 `quick-launch`，并保留 `core:event:default`。
- 不要添加计划中提到的 `core:webview:allow-drag-drop-event`：本项目实际解析到的 Rust Tauri 2.11 schema 不定义该 permission，添加后构建会直接失败。
- 当前版本的 `onDragDropEvent()` 在现有 `core:event:default` 下已能注册；外部文件接收由动态窗口的 `.drag_and_drop(true)` 控制。

### 18.6 本次故障根因

- 用户曾观察到工作区“1”不显示、向“示例”拖文件夹提示添加失败。
- 当时新版 Vite 前端仍连接旧的 `src-tauri/target/debug/deskbox.exe`。旧 Rust 进程没有注册 `is_directory/get_file_name/resolve_shortcut`，所以前端拖入路径识别全部失败。
- 已终止旧进程并通过 Tauri dev 启动 `src-tauri/target/dragdrop-dev/debug/deskbox.exe`。不要同时运行多个不同 target 目录的 DeskBox 调试进程。
- 窗口“1”当时实际已创建但处于隐藏状态；恢复后保持可见。随后又补充并验证了最小化窗口的 `unminimize()` 恢复路径。
- 如果未来再次出现“前端有拖入提示但添加全部失败”，第一步检查运行中的 `deskbox.exe` 路径和启动时间，而不是先修改前端拖放代码。

### 18.7 验证结果

- `npm run check`：通过；3 个 Vitest 文件共 9 个测试通过，TypeScript/Vite 生产构建通过，Cargo check 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：12 个 Rust 测试通过，其中包含真实临时 `.lnk` 创建和解析。
- `git diff --check`：通过，仅有 Git 的 LF→CRLF 工作区提示，无空白错误。
- Playwright 已验证外部拖入辅助函数和 URL drop 备用流程的界面行为。
- Windows UI Automation 已验证点击工作区“1”会创建并显示 `DeskBox - 1`；将其最小化后再次点击卡片，窗口从 `minimized=true` 恢复为 `false`。

### 18.8 下一次对话的首要事项

1. 先运行 `git status` 和 `git log -1`，确认本章对应提交已经存在，不要重复实现原生拖放。
2. 需要调试桌面功能时只运行一个 `npm run tauri dev`，并确认进程来自当前仓库预期 target 目录。
3. 用真实鼠标分别拖入文件夹、TXT/PDF/JPG、多选文件、EXE、传统 LNK 和开始菜单 LNK，检查覆盖提示、单次添加、图标和双击启动。
4. Chrome/Edge 地址栏 URL 拖入只做尽力验收；失败时记录 WebView2 是否提供 DOM 文本，不要改成依赖 HTML5 文件拖放。
5. 如需发布，继续执行 `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` 和安装包实机测试；本次已执行 `npm run check` 与 Rust 测试，但未生成发布安装包。
