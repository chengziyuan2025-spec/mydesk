# DeskBox

DeskBox 是一个基于 Tauri v2、React 18 和 TypeScript 的 Windows 桌面快捷方式收纳工具。

## 已实现功能

- 透明无边框主窗口、拖拽标题栏、关闭隐藏到托盘
- 主窗口、快速启动、全部容器和单个容器的可配置全局快捷键，冲突时保留旧绑定并明确提示
- 单实例保护，重复启动只唤醒主窗口
- 托盘显示/隐藏与退出菜单
- 容器创建、双击重命名、隐藏、恢复和确认删除
- 主页概览/整理视图、容器排序、快捷方式排序与跨容器移动
- 快捷方式添加、文件选择、启动、右键定位和确认删除
- Windows 关联图标自动提取、磁盘缓存和数据回填
- 桌面 `.lnk` / `.exe` 文件监听、自动归类与重复事件过滤
- 收纳后保留源文件或移入系统回收站
- 桌面源文件可单项或按容器批量隐藏与恢复；隐藏使用 Windows Hidden + System 属性，不删除或移动文件
- 亮色/暗色主题、默认容器和自动收纳设置
- 应用内回收站、即时撤销、恢复和永久删除
- v1-v3 到 v4 的数据迁移、原子写入、每日轮转备份、导入和导出
- 统一快速启动：拼音首字母、自定义别名、收藏、最近、高频和容器直达
- 搜索开始菜单与已安装应用，并可选通过 Everything Query2 IPC 搜索本机文件
- 搜索结果内收藏、改别名、移动、定位和移入 DeskBox 回收站；不删除外部磁盘文件
- 离线四则计算、百分比及常用单位换算
- 支持 HTTP(S)、绝对路径和 UNC 路径，禁止把搜索输入作为 Shell 命令执行
- 浏览器开发模式的 `localStorage` 降级，便于独立调试界面

## 开发

```powershell
npm install
npm run tauri dev
```

只调试 React 界面：

```powershell
npm run dev
```

## 构建

```powershell
npm run check
npm run tauri build
```

Windows 安装包会生成到 `src-tauri/target/release/bundle`。

## 目录结构

```text
src/
  components/      界面组件与交互弹层
  data/            首次启动默认数据
  hooks/           状态、自动保存和桌面事件编排
  services/        Tauri / 浏览器平台适配层
src-tauri/src/
  commands.rs      前端可调用的系统命令
  icons.rs         Windows 图标提取与缓存
  models.rs        持久化数据模型
  storage.rs       数据读取、备份与保存
  watcher.rs       桌面目录监听
```

用户数据保存在系统应用数据目录的 `com.deskbox.app/deskbox-data.json`，图标缓存位于系统应用缓存目录的 `com.deskbox.app/icons`。

## 开发交接

完整的架构说明、功能状态、验证记录、已知风险和后续迭代建议见 [HANDOFF.md](./HANDOFF.md)。
