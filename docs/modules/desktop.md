# Desktop：预设与节点界面

## 当前实现

React + Tauri 桌面 UI 已起步；当前是内存中的交互示例，不是录制产品。

- 默认入口：[一键构建并运行](../../_Build_And_Run.bat)。应用代码位于 [apps/desktop](../../apps/desktop)，使用 React、TypeScript、Vite、Tauri 2、React Flow 和 Lucide。
- 自定义标题栏将品牌下拉菜单与单行录制总控合并在顶行，标签页置于其下；菜单可切换 Workspace、Runs、Settings。左侧只保留可折叠蓝图列表，移除竖向导航、列表标题／搜索框、居中的页面名、状态行和 Overview 重复标题。蓝图切换和每蓝图独立标签页已实现；蓝图支持新建、重命名、复制、删除和撤销删除。默认窗口为 1200×760。
- 无边框窗口的最小化、最大化、关闭及拖动权限在 `src-tauri/capabilities/default.json` 按窗口显式开放；调用失败会写入 WebView 控制台。
- Overview、卡片详情和卡片布局编辑器共用参数值及布局。布局编辑器使用 `@dnd-kit/core` 提供拖动传感器、跟随指针的 DragOverlay 和投放命中，使用 `react-resizable-panels` 调整同行参数宽度；上下投放新建一行，左右投放将目标列分半，因此组合第三个参数不需要先缩放。布局用稳定参数 ID、行列顺序、固定状态和列宽比例表示；移走参数后会压紧空位。窄窗口改为单列。布尔参数使用卡片自然高度，避免固定网格行高裁切 Toggle。变量可以拖到参数卡片；已暴露到任一卡片的变量从 Variables 列表隐藏。创建菜单、文件夹选择／展开、事件／函数元数据和 Details 已实现。
- Overview 卡片使用 React-Grid-Layout 管理每个蓝图独立的响应式位置与宽度，拖动复用参数编辑器的 dnd-kit 传感器、拖动预览和行列插入逻辑。网格测量完成后才显示；中央投放交换位置，侧向投放插入同一行并自动分配整行宽度，上下投放插入独立行，底部空白区可追加到末尾；列宽可继续手动调整。顶部中央的横向点阵无按钮底框，卡片悬停时显示；宽度把手只在指针靠近把手时显示。内容宽度低于 900 CSS px 时保持单列，达到 900 px 使用 12 列网格。
- Overview 参数采用 Inline Rows：参数名与控件同行，参数名为 14px、控件文字为 13px；名称优先完整换行，编辑控件收窄但至少保留 84px。布尔项只显示紧凑开关，不拉伸成整行输入框。卡片标题栏收至 44px；字段行序、分列和比例仍来自共享布局，卡片详情与布局编辑器保持原样。
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

本次验证（2026-10-13）：

- `npm run lint`、`npm run build`、`npm run test:model`（3 项）和 Tauri Release x64 构建通过；Release 程序输出为 `apps/desktop/src-tauri/target/release/nodrec-desktop.exe`。Vite 提示未压缩 JS chunk 超过 500 KB。
- 尝试捕获运行窗口时只得到黑屏，未能检查新标题栏、下拉菜单、标签页和按钮的实际显示或交互；这些仍需桌面可见时验证。

Overview 卡片布局更新（2026-10-13）：

- 移除 Overview 卡片底部 Edit layout 控件；顶部中央悬停把手启动与参数布局编辑器相同的 dnd-kit 拖动体验，React-Grid-Layout 负责宽／窄布局和调宽。拖动时原卡片淡出、预览跟随指针、目标卡片描边高亮；松手交换卡片位置并保留各自宽高。
- 每个蓝图独立保存 wide（12 列）与 narrow（单列）布局，示例状态仍只在会话内保存；参数固定行数变化时按内容重算卡片高度。
- `npm run lint`、4 项 `npm run test:model`、TypeScript／Vite 构建及 Tauri Release x64 构建通过。前端 JS chunk 为 628 KB（gzip 191 KB），Vite 提示超过 500 KB。
- Release 实际启动后，UI Automation 树可读到四张 Overview 卡片、顶部拖动把手及卡片详情按钮；窗口截图接口返回全黑，因此未能目视样式，也未验证真实鼠标拖动和调宽。

Overview 卡片拖动修复与验收（2026-10-13）：

- 拖动复用参数编辑器的 dnd-kit Pointer／Keyboard sensor 配置和 DragOverlay；卡片中央投放交换位置，左右侧插入同一行并自动分配宽度，上下插入独立行，底部投放区把卡片追加到末尾。定位并修复了底部落点钩子在所属 DndContext 外注册的问题；模型覆盖上下插入、末尾移动与宽度重排。
- `npm run test:overview-drag` 启动 Release 程序并通过 WebView2 DevTools Protocol 发送分步鼠标事件，验证同排三卡自动宽度、上方／下方／末尾插入、指针跟随预览及反馈、宽度把手近边显隐和去除斜纹。脚本将截图存入忽略目录 `out/ui-tests/`，并关闭自己启动的 Release 进程。
- 同一 Release 验收还将一个长参数名注入 Overview 字段，检查名称无水平／垂直裁切、右侧控件收窄且保留最小宽度，并确认卡片内容未被容器裁切。
- 在 viewport 1200×760 CSS px、DPR 2.25、内容宽 961 px 的环境中，Release WebView 自动验收通过；`npm run lint`、12 项模型测试、TypeScript／Vite 和 Tauri Release x64 构建通过。Vite 仍提示未压缩 JS chunk 超过 500 KB。CDP 验证 WebView 鼠标事件链路，不代表物理鼠标硬件测试。
- 宽度把手复验：把手总高 84px、可视握柄高 52px，横向中心落在 14px 卡片间隙中线（误差 <0.01 CSS px）；实际拖动改变卡片宽度，缩放占位为蓝色且释放后无横向溢出。提高占位 CSS 选择器优先级以覆盖 react-grid-layout 后加载的默认红色规则。
- CDP 验证的是 Tauri WebView 鼠标事件／DOM 链路，不代表物理鼠标硬件或 Windows 标题栏输入测试。
- Vite 仍提示未压缩 JS chunk 超过 500 KB。

## 职责与边界

桌面模块负责应用导航、预设参数编辑、蓝图编辑器及结果展示；采集和工作流执行由后续产品模块负责，MCP 应通过共享能力提供同等产品操作。

## 一期目标

- 不进入节点编辑器也能完成常用录制与回放配置。
- 参数卡片、节点、事件和函数支持直观编辑；英文 UI，并为多语言替换保留集中入口。
- Windows 先行，同时控制其他平台重复开发成本；React + Tauri 是当前实现路线，跨平台捕获／输入仍需逐平台实现。

## 验收

T08 的产品验收尚未通过。React 前端、布局模型与 Overview 的 WebView 拖动链路已有自动验收；蓝图切换、菜单、多个标签溢出、物理鼠标、窄窗口与其他 DPI／缩放、键盘交互、参数编辑器分隔器和 200 MB 内存目标仍未完成验证。旧 ImGui 快照不能证明新界面或产品能力。

## 未来规划

在 Windows 原生运行中检查样式、窗口操作、交互和内存；根据结果决定是否把当前路线冻结为产品框架。后续补齐持久化、键盘可用性、无障碍、多语言和其他平台适配。
