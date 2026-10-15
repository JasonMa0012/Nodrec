# 验收场景

已有蓝图存储／运行单测、Release WebView 模拟录制闭环及 React 前端测试；真实媒体和回放尚未实现。以下场景用于澄清“做到什么程度算可用”，工具、性能阈值和环境在实践中确定。

## 蓝图存储与模拟运行（2026-10-14）

- `apps/desktop/src-tauri` 中 `cargo test --lib`（16 项）验证缺失目录不被启动扫描创建、文件保存／重载、revision 冲突、危险 ID、删除／撤销、节点目录和图连接、条件分支求值、输入端覆盖参数默认值、九种 UE 标量 Make 节点及 Byte 范围、Make 输入端保持 UE 类型约束、Order 整数约束、路径菜单组装和稳定排序；实际内置配置也由同一 schema 校验。
- 在 `apps/desktop` 执行 `npm run test:blueprint-runtime`，需先运行 `npm run tauri:build`。脚本启动 Release Nodrec，以 WebView2 CDP 验证单项路径菜单悬停展开、菜单互斥及空白收起，蓝图列表收起后工作区仍可见、最大宽度下 Overview 卡片保持并排且高度贴合字段，统一滚动条样式、Details 高度随内容增长／调宽／把手悬停显隐／参数行对齐和完整标签、节点画布贴到右边界、NodeType 与标题编辑、左拖框选、移除缩放按钮后 F 适配视图、右键平移和滚轮缩放；随后验证初始化注册控件、模拟帧开始／暂停／恢复／停止和延迟期间取消，并关闭测试进程。
- 同一 Release WebView 检查 Overview 与节点参数改动后显示默认值还原按钮、还原后隐藏；框选两个 Register Control 后 Details 实时更新，Order 异值显示 `Multiple values`，重置和批量编辑都作用于两节点并保存。复制出的 Register Control 修改后原节点参数不变，删除副本后原节点仍在。
- Release WebView 还验证默认双标签、蓝图列表调宽／复位、更多菜单留在视口内、干净蓝图不显示 Save、编辑后出现星号和行内 Save；将 Register Control 的 Order 改为 4 后总控栏相应重排，保存文件里的值也是 4。测试先备份发布目录中的蓝图，结束后还原原文件。
- Events、Functions、Parameters、Variables 分区标题可展开／折叠，初始展开且切换不标记蓝图为未保存。Branch 节点可在画布空白处右键添加并落在指针位置；Boolean／Byte／Integer／Integer64／Float／Double／Name／String／Text Make 节点可从同一菜单创建。Register Control 的 Order 输入开关显示与 UE 配色一致的 Integer 引脚，关闭后引脚移除。执行引脚位于节点标题栏且不占参数区，显示为无名称白色三角形。Details 中 Control 使用无边框 Header，同级参数与 Header 对齐，仅嵌套 Header 缩进；Register Control 没有嵌套 Children 编辑入口。Ctrl+C／Ctrl+V 和自定义右键菜单通过 WebView 验收；Operation recording 预览按钮保持禁用。模拟录制实际产生帧；暂停期间帧数保持不变，恢复后增加，Stop 结束运行；延迟启动取消后状态保持 Ready。没有测试真实采集、编码或媒体文件。
- 当前检查通过：Rust 单测 16 项、模型测试 19 项、Oxlint、TypeScript／Vite、Tauri Release x64 和 `npm run test:blueprint-runtime`。旧蓝图没有 Order 时以注册序号作内存默认；旧递归菜单会在加载时转换成路径注册节点。序列化会忽略 React Flow 的选中、拖动和测量状态，选中节点本身不会标记为未保存。WebView CDP 结果不代表物理鼠标／键盘、标题栏、无障碍或其他 DPI 验收。

## 当前原型验证记录（2026-10-12）

- Release x64 构建和自检通过；自检覆盖节点／连线校验及删除清理、蓝图副本隔离、变量暴露／重复拒绝／默认独行、卡片行列顺序、固定状态和宽度比例。
- --snapshot、--snapshot-blueprint、--snapshot-card、--snapshot-details 四种运行模式均正常退出，分别生成 Overview、Blueprint、卡片编辑和卡片详情的 DX11 后缓冲图像，存放于忽略的 out/imgui-interaction/。
- 在 225% DPI 下目视检查上述布局。拖拽源已从无稳定 ID 的分组移到明确的参数卡片把手；本次没有真实拖放验证（当前环境无桌面原生输入接口），鼠标菜单、连线拖放、参数排序、列宽拖拽、窄窗口重排和窗口缩放仍待人工验收；渲染快照不代表交互通过。
- 蓝图左右／上下断点调整后，独立 Release x64 构建和 `--snapshot-blueprint` 在 225% DPI 下显示事件列表、画布和 Details 左右排列；旧版交互进程仍运行，默认输出目录尚未覆盖。
- React + Tauri 交互修复（2026-10-12）：`npm run lint`、TypeScript／Vite 和 Tauri Release x64 构建通过。Release 窗口运行确认默认 1200×760 尺寸下右上角显示最小化／最大化／关闭按钮；标签页保存状态／帮助与蓝图画布顶部工具行已移除；运行时创建一个变量并通过卡片菜单暴露后，它出现在 Parameters、从 Variables 消失。
- 卡片参数拖动修复（2026-10-12）：前端构建、lint、Tauri Release x64 构建通过；Release 实际鼠标拖动确认参数排序、跨固定区并同步图钉、拖成同行及调整列宽。切回 Overview 和卡片详情确认共用布局一致。窗口缩放断点、键盘交互与变量拖入卡片仍待验证。
- 可复现入口见 prototypes/imgui/build.ps1；构建脚本运行 Release x64 并执行模型自检，不自动启动交互窗口。

## Overview 卡片拖动验证（2026-10-13）

- 入口：在 `apps/desktop` 执行 `npm run test:overview-drag`；需先构建 Release。脚本启动 Nodrec Release 窗口，在回环地址开启临时 WebView2 DevTools 端口，用 CDP `Input.dispatchMouseEvent` 验证同行插入、上方／下方／末尾插入、宽度把手显隐及样式。截图在忽略目录 `out/ui-tests/overview-drag-*.png`。
- 根因：DPR 2.25 时 viewport 为 1200×760 CSS px，Overview 内容宽约 950 px（实测 961 px）。1250 px 断点让窗口始终单列，拖动命中正常但侧向插入分支被关闭。降至 900 CSS px，并等容器测量完成后显示网格后，自动化验证 Audio 成功插到 Recording settings 右侧。
- Release 拖动验收曾发现底部空白区没有实际落点：落点的 `useDroppable` 在所属 `DndContext` 外调用，未进入碰撞注册。移入 DnD 子组件后，运行时 rect 列表包含 `overview:end`，可在卡片区外追加到末尾。
- `npm run lint`、12 项模型测试、TypeScript／Vite、Tauri Release x64 和 WebView 拖动脚本通过。实测 1200×760 CSS px、DPR 2.25：三卡同行铺满网格；上下插入及末尾追加均有预览、指示并改变布局；卡片中央悬停时缩放把手隐藏、靠近边缘时显示，斜纹已移除。CDP 验证 Tauri WebView 鼠标事件／DOM 链路，不代表物理鼠标硬件或窗口标题栏输入。
- Overview Inline Rows 采用同一 Release 脚本注入长参数名验收：标签完整换行、编辑控件收窄但不小于 84px，卡片内无裁切；编译、模型测试和 Release 构建结果见 Desktop 模块当次记录。
- Overview 宽度把手复验（2026-10-13）：Release WebView 鼠标事件验证 84px 把手／52px 握柄居中显示在卡片间隙、宽度拖动生效且占位提示为蓝色；释放后 Overview 无横向溢出。外侧列把手保持在卡片边缘内。

| ID | 验证方向 |
| --- | --- |
| T01 | 参数连线、事件、函数和子图能运行；无效图可解释；预设使用真实工作流 |
| T02 | 全屏／区域／窗口画面、鼠标开关、分辨率／fps；多显示器／DPI／窗口变化的行为 |
| T03 | 视频可解码、音轨正确、音画同步；输出冲突、权限和写入失败 |
| T04 | 键鼠、快捷键、拖拽、滚轮及相对移动的记录顺序与时间 |
| T05 | UI 树与事件关联；窗口移动后语义定位；缺失、歧义和超时 |
| T06 | 普通桌面与受控 UE 场景实际接收回放输入，同时录屏；可中止并检查残留按键 |
| T07 | 同图与已知变化、缺帧／错位／尺寸变化；统计和可查询帧一致 |
| T08 | 简单界面可完成流程，节点可编辑；英文 UI、多语言准备、键盘与无障碍 |
| T09 | 真实 MCP 客户端完成编辑→录制→回放→帧／报告查询；覆盖 UI 产品能力 |
| T10 | 核心的平台依赖边界；不支持能力、设备变化、运行退出和数据重载 |
| T11 | Overview 卡片可拖动重排和调宽；宽屏／窄屏切换、蓝图切换后各自布局保留，详情值和卡片布局同步 |

真实运行记录目标应用、OS、硬件、权限及必要的初始状态。单测、编译和硬件／界面运行验证分别报告；未测的环境保留限制说明。实际测试入口与结果由相关模块文档维护。
