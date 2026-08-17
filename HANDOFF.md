# DeskBox 项目交接文档

> 更新日期：2026-08-17
>
> 应用版本：0.3.0
>
> 数据格式：v6
>
> 仓库：`https://github.com/chengziyuan2025-spec/mydesk`

## 1. 项目定位

DeskBox 是 Windows 桌面快捷方式收纳工具。主页负责容器管理、整理、搜索和设置；每个容器可以打开一个独立悬浮工作区。Tauri 负责原生窗口、文件系统、托盘、快捷键和持久化，React 负责界面与乐观状态。

当前重点已经从“补齐基础能力”转为“稳定多窗口交互和大数据量性能”。本轮完成了设置页内嵌、悬浮窗关闭前保存、缩放卡死修复、贴边隐藏恢复，以及操作级跨窗口同步。

## 2. 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面运行时 | Tauri v2、Rust 2021 |
| 前端 | React 18、TypeScript 5.7、Vite 6 |
| 状态 | Zustand 5、操作归约、乐观更新 |
| 拖拽/虚拟化 | dnd-kit、react-window |
| 搜索 | pinyin-pro、mathjs、Everything Query2 IPC |
| Windows API | windows-rs、ShellExecute、IShellLink、IDesktopWallpaper |
| 存储 | 本地 JSON、原子替换、延迟落盘与轮转备份 |

运行要求：Windows 10/11、WebView2 Runtime、Node.js 20+、Rust stable 和 Visual Studio C++ Build Tools。

## 3. 架构与所有权

```text
React 窗口（main / quick-launch / container-*）
  -> useDeskBox：加载、乐观更新、通知、跨窗口版本同步
  -> platform.ts：Tauri invoke/listen 与浏览器降级
  -> Rust commands.rs：命令边界和输入校验
  -> DataState / container_windows：业务数据与窗口布局
  -> storage.rs：原子写入、迁移和备份
```

关键文件：

- `src/App.tsx`：根据窗口 label 选择主页、快速启动或悬浮工作区；主页设置路由也在这里。
- `src/components/FloatingContainer.tsx`：悬浮工具栏、设置面板、拖放、贴边恢复和重新隐藏计时器。
- `src/components/SettingsPanel.tsx`：主页和悬浮工作区共用的设置视觉与控件。
- `src/hooks/useDeskBox.ts`：业务操作入口、乐观状态及 `app-data-changed` 同步。
- `src/stores/useDeskBoxStore.ts`：Zustand 状态，减少多组件无关重渲染。
- `src/data/operations.ts`：前端操作归约，必须与 Rust `operations.rs` 行为一致。
- `src/data/performance.ts`：长列表、搜索和虚拟化阈值配置。
- `src/components/VirtualGrid.tsx`：大量快捷方式时的网格虚拟化。
- `src/services/platform.ts`：所有原生能力的统一前端接口；组件不应散落直接 `invoke`。
- `src-tauri/src/app_state.rs`：内存中的权威数据、revision 和延迟持久化。
- `src-tauri/src/container_windows.rs`：窗口创建、显示、隐藏、几何、停靠和布局文件。
- `src-tauri/src/models.rs` / `operations.rs`：Rust 数据模型、迁移目标和原子操作。
- `src-tauri/src/storage.rs`：数据路径、原子写入、损坏恢复、每日/迁移/导入前备份。
- `src-tauri/src/lib.rs`：应用启动、命令注册、托盘、单实例和退出 flush。

## 4. 数据与持久化

应用标识是 `com.deskbox.app`，Tauri 路径解析到应用专属目录。主要持久化内容：

| 内容 | 位置 |
| --- | --- |
| 业务数据 | 应用数据目录 `deskbox-data.json` |
| 悬浮窗布局 | 应用数据目录 `deskbox-container-windows.json` |
| 自动备份 | 应用数据目录 `backups/` |
| 背景资源 | 应用数据目录 `assets/` |
| 图标缓存 | 应用缓存目录 `icons/` |

业务数据当前为 v6，包含 `revision`、容器、设置、外部启动项和回收站。读取旧数据时由 Rust 迁移并补齐默认字段；更改模型时必须同步：

1. `src/types.ts` 的 TypeScript 类型。
2. `src/data/defaults.ts` 和浏览器归一化逻辑。
3. `src-tauri/src/models.rs` 的 Rust 类型与版本迁移。
4. 前后端操作归约及对应测试。

写入使用临时文件加替换的原子方式。业务操作先提交内存并递增 revision，再延迟合并写盘；正常进程退出时强制 flush。导入、迁移和损坏恢复都有独立备份。

背景资源导出 JSON 时不会打包二进制文件。跨机器导入后若资源路径不存在，会回退到普通背景，不影响其他配置。

## 5. 跨窗口状态

前端提交 `AppOperation`，Rust 在内存中应用操作并广播：

```text
app-data-changed { revision, operation? }
```

接收窗口若 revision 正好连续，直接本地归约该操作；版本跳跃或没有操作负载时重新加载完整数据。这样既降低大 JSON 的广播与反序列化成本，也保证窗口失步后可以恢复。

新增业务操作时，TypeScript 与 Rust 的枚举、序列化命名、归约结果和测试必须保持一致。不要绕过 `useDeskBox` 直接修改组件局部业务副本。

## 6. 设置界面

主页设置不再使用单独的 Tauri 窗口。标题栏、托盘或全局设置快捷键触发 `open-settings`，主页切换到设置视图；返回按钮恢复之前页面，因此不存在两个关闭按钮或关不掉的独立设置窗口。

悬浮工作区仍使用同一窗口内的锚定设置面板，以保持工作区上下文。它沿用主页设置的颜色、分组和控件风格，并支持以下关闭方式：

- 点击面板关闭按钮
- 按 `Esc`
- 点击面板外区域

改动设置 UI 时应同时检查主页宽屏、窄屏和悬浮窗口尺寸，避免只修一处样式。

## 7. 悬浮窗口生命周期

窗口 label 为 `container-{id}`。主页点击容器时调用 `create_container_window`：已存在则恢复并显示，不存在则按保存布局创建。关闭请求会被拦截为隐藏，不销毁窗口、不删除容器。

隐藏前会同步读取实际 `outer_position` / `outer_size` 并保存，再执行 hide。移动和缩放期间只更新内存，并经过防抖后写盘，避免 WebView2 高频事件造成主线程阻塞。退出应用时再次 flush。

几何数据统一使用物理像素：

- 使用 `PhysicalPosition` / `PhysicalSize` 创建和恢复。
- 不要把前端 CSS 像素或 logical size 直接写进布局文件。
- 恢复时按 `monitorKey` 选择显示器，并约束到当前 work area。
- 显示器移除、DPI 改变或分辨率变化后，旧坐标会被修正到可见区域。

悬浮窗口刻意不启用 Tauri `transparent` 原生透明合成。视觉透明度由窗口 opacity 和页面样式完成；重新开启原生透明窗口会让 Windows/WebView2 在连续 resize 时出现冻结风险。

## 8. 贴边隐藏与恢复

`autoHide` 开启时，窗口拖到当前显示器左/右工作区边缘会进入 dock 状态，并只保留约 10px 的热区。`docked` 和 `dockSide` 与几何一起持久化。

恢复路径有三种：

- 鼠标进入屏幕边缘热区，调用 `reveal_container_window_dock`。
- 从主页再次点击该容器。
- 使用容器或全部工作区快捷键显示。

从主页或快捷键显式打开时必须主动展开，不能只显示仍处于屏幕外的隐藏坐标。鼠标离开展开窗口约 1 秒且没有按压/拖动时，调用 `dock_container_window` 再次隐藏。

Dock 状态下临时关闭鼠标穿透，让热区可接收输入；展开后恢复用户配置。程序性 reveal 也会触发 `Moved`，状态机必须区分它与用户再次拖到边缘，否则窗口会立即重新隐藏。

## 9. 窗口选项

每个容器独立保存：显示器、位置、尺寸、折叠高度、锁定、透明度、鼠标穿透、吸附边、自动隐藏、停靠边、布局、任务栏显示和全部虚拟工作区可见。

透明度更新走专用轻量命令，不应重设位置或完整重建窗口。锁定只控制移动/缩放交互，不应阻塞关闭和设置。鼠标穿透开启后，需要依赖全局恢复入口，避免所有窗口永久无法点击。

## 10. 搜索与性能

搜索覆盖 DeskBox 项目、容器、系统应用、Everything 文件和离线计算。拼音索引使用 `pinyin-pro`，支持中文全拼和首字母。外部路径只能通过类型化启动接口打开，禁止把搜索输入作为 shell 命令执行。

性能策略：

- 业务变化使用小型 `AppOperation`，避免每次保存整份 JSON 并全窗口广播。
- Rust 内存状态是权威源，磁盘写入防抖合并。
- Zustand selector 让组件只订阅需要的数据。
- 大量快捷方式使用 `react-window` 虚拟网格。
- 搜索索引、图标和派生结果尽量复用缓存。

调整阈值或虚拟化布局后，应同时测试少量数据和大列表，尤其关注拖拽目标、右键菜单定位和动态窗口宽度。

## 11. 常用命令与事件

窗口相关命令包括：创建/隐藏容器窗口、显示/隐藏/切换全部窗口、读取/更新窗口配置、单独更新透明度、列出显示器、恢复鼠标交互、Dock 展开/收起。

数据与系统命令包括：加载数据、应用操作、启动/定位目标、解析 `.lnk`、图标提取、桌面监听、隐藏/恢复源文件、导入导出、背景资源和壁纸主色。

主要事件：

- `app-data-changed`：业务数据 revision/操作同步
- `desktop-entry-created`：桌面监听产生新项目
- `open-settings`：让主页进入设置视图
- `quick-launch-reset`：快速启动窗口每次显示时重置输入

新增命令后必须在 `src-tauri/src/lib.rs` 的 `generate_handler!` 注册，并在 `platform.ts` 封装。

## 12. 验证与发布

日常完整检查：

```powershell
npm run check
cargo test --manifest-path src-tauri/Cargo.toml
git diff --check
```

发布构建：

```powershell
npm run tauri build
```

安装包位于 `src-tauri/target/release/bundle`。发布前还应在原生 WebView2 中人工检查：

1. 连续拖动和缩放悬浮窗后不卡死。
2. 调整透明度不改变位置。
3. 隐藏后重新打开恢复此前位置和大小。
4. 左右 Dock 可通过热区、主页和快捷键恢复。
5. 设置页可返回；悬浮设置可通过关闭、Esc 和外部点击退出。
6. 多显示器、不同 DPI 和移除显示器后的窗口可见性。
7. 鼠标穿透与全局恢复入口。

本次提交前基线：前端 24 项测试通过；Rust 28 项通过、1 项 Everything 实机测试按设计忽略；前端构建、Cargo 检查和 diff whitespace 检查通过。最终推送前会重新执行同一套检查。

## 13. 已知限制与后续优先级

- 主要支持和验证平台是 Windows；非 Windows 只有有限降级能力。
- 背景视频格式取决于本机 WebView2 解码能力。
- Everything 搜索要求本机 Everything 启用 Query2 IPC。
- 导出文件不包含背景媒体，需要跨机器迁移时手动复制 `assets/`。
- 自动分类规则和开机自启动尚未实现。
- Dock、DPI、鼠标穿透和虚拟桌面组合依赖 Windows 原生行为，发布前仍需要真实桌面回归，浏览器测试不能替代。

下一阶段优先级建议：先补窗口状态机的 Windows 集成测试与崩溃恢复，再做自动分类和开机自启动，最后评估背景资源打包导出。
