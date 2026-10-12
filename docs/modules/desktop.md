# Desktop：预设与节点界面

## 当前实现

React + Tauri 桌面 UI 已起步；当前是内存中的交互示例，不是录制产品。

- 默认入口：[一键构建并运行](../../_Build_And_Run.bat)。应用代码位于 [apps/desktop](../../apps/desktop)，使用 React、TypeScript、Vite、Tauri 2、React Flow 和 Lucide。
- 自定义标题栏、可折叠导航与蓝图列表、Overview／Blueprint／Runs／Settings 页面、蓝图切换和每蓝图独立标签页已实现。蓝图支持新建、重命名、复制、删除和撤销删除；标题栏控件右对齐，默认窗口为 1200×760，避免初始尺寸超出常见工作区。
- 无边框窗口的最小化、最大化、关闭及拖动权限在 `src-tauri/capabilities/default.json` 按窗口显式开放；调用失败会写入 WebView 控制台。
- Overview、卡片详情和卡片布局编辑器共用参数值及布局。布局编辑器使用 `@dnd-kit/core` 提供拖动传感器、跟随指针的 DragOverlay 和投放命中，使用 `react-resizable-panels` 调整同行参数宽度；上下投放新建一行，左右投放将目标列分半，因此组合第三个参数不需要先缩放。布局用稳定参数 ID、行列顺序、固定状态和列宽比例表示；移走参数后会压紧空位。窄窗口改为单列。布尔参数使用卡片自然高度，避免固定网格行高裁切 Toggle。变量可以拖到参数卡片；已暴露到任一卡片的变量从 Variables 列表隐藏。创建菜单、文件夹选择／展开、事件／函数元数据和 Details 已实现。
- 卡片参数放置由卡片自身处理，阻止外层区域重复放置；窄工作区将 Overview 卡片切为单列，标签栏隐藏滚动条并保留横向滚动。
- Blueprint 使用 React Flow 显示固定示例节点，支持移动、缩放、选择、连线和删除；连线校验端口类型并拒绝自连接、重复连接和已占用输入。画布顶部工具行已移除，节点目录暂时不能从 UI 新增。Capture Screen／Audio 与顶部总控只改变示例状态，Select Region 点击无行为。
- 所有示例状态只保存在当前会话，重启恢复内置数据。没有节点执行、采集、编码、键鼠录制／回放、像素对比、MCP 或产品文件格式。
- 之前的 Dear ImGui 原型及独立构建脚本保留在 `prototypes/imgui` 作为参考，不再是默认启动入口。

验证记录（2026-10-12）：

- `apps/desktop/npm run build`：TypeScript 检查及 Vite Release 前端构建通过；生成 470 KB JavaScript（gzip 145 KB）。
- `apps/desktop/npm run tauri:build`：Tauri Release x64 原生构建通过，生成 `apps/desktop/src-tauri/target/release/nodrec-desktop.exe`。
- 前次验证没有覆盖 Tauri 窗口运行、真实 UI 交互和内存；本次修复后的验证边界见下。用户希望 UI 私有工作集控制在 200 MB 内；此为待测目标，不是已达到的结果。

本次验证（2026-10-12）：

- `npm run lint`、`npm run test:model`（3 项）和 Tauri Release x64 构建通过；模型测试覆盖拖入现有行生成第三列、移出后压紧并重算宽度、跨固定区移动。前端包 gzip 约 171 KB；Vite 对未压缩 555 KB 的 JS chunk 给出 500 KB 提示。
- Release 实际启动并打开 Recording settings 卡片布局编辑器；Show Cursor Toggle 在卡片范围内显示，没有原截图中的溢出。
- Windows 自动化拖动触发了 dnd-kit 的拾取／放下通告，但尝试的右侧和上侧投放均未改变布局。自动化接口没有提供拖动中途的指针状态，无法据此判断命中区域是否收到 hover；真实鼠标下的拖动预览、插入线、排序、跨区固定同步和分隔器手感仍需现场验证。
- 本轮按截图定位为命中提示被 body Portal 中的 DragOverlay 覆盖、细线对比不足；仅将命中提示提到预览层上方并加粗，拖放判定与布局模型未改，拖动预览宽度上限由 420px 降至 320px。lint、3 项模型测试、前端构建及 Tauri Release x64 构建通过。尝试进行窗口检查时 Windows 桌面处于锁屏，按规则停止 UI 操作，因此真实鼠标拖动的视觉效果仍待现场确认。
- 本轮没有实现录制、回放或节点执行，也未测量内存、DPI／缩放、窄窗口或键盘交互。

## 职责与边界

桌面模块负责应用导航、预设参数编辑、蓝图编辑器及结果展示；采集和工作流执行由后续产品模块负责，MCP 应通过共享能力提供同等产品操作。

## 一期目标

- 不进入节点编辑器也能完成常用录制与回放配置。
- 参数卡片、节点、事件和函数支持直观编辑；英文 UI，并为多语言替换保留集中入口。
- Windows 先行，同时控制其他平台重复开发成本；React + Tauri 是当前实现路线，跨平台捕获／输入仍需逐平台实现。

## 验收

T08 的产品验收尚未通过。React 前端、布局数据模型测试及 Tauri Release 构建通过；Release 窗口已运行且 Toggle 溢出已修正。dnd-kit 拖动／投放和 react-resizable-panels 分隔器尚未通过真实鼠标验收；蓝图切换、菜单、多个标签溢出、DPI／缩放、键盘交互和 200 MB 内存目标也未完成验证。旧 ImGui 快照不能证明新界面或产品能力。

## 未来规划

在 Windows 原生运行中检查样式、窗口操作、交互和内存；根据结果决定是否把当前路线冻结为产品框架。后续补齐持久化、键盘可用性、无障碍、多语言和其他平台适配。
