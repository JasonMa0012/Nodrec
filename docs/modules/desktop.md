# Desktop：预设与节点界面

## 当前实现

React + Tauri 桌面 UI 已接入蓝图文件索引、显式保存和 Rust 工作流运行器；实际媒体仍为模拟。

- 默认入口：[一键构建并运行](../../_Build_And_Run.bat)。应用代码位于 [apps/desktop](../../apps/desktop)，使用 React、TypeScript、Vite、Tauri 2、React Flow 和 Lucide。
- 自定义标题栏将品牌下拉菜单与蓝图注册的总控按钮合并在顶行，标签页置于其下；菜单由 Register Control Menu 节点逐项注册，使用 `Start`、`Start/Start after 3s` 这样的路径表达层级。运行期间只允许蓝图逻辑打开的控制操作，禁止切换与编辑；蓝图支持新建、重命名、复制、按蓝图显式保存、删除和撤销删除。侧边蓝图列表可拖动调整宽度；未保存项在名称前显示 `*` 并只显示该项的 Save 按钮；默认同时打开 Overview 和 Blueprint。标题栏不显示全局 Save。
- 无边框窗口的最小化、最大化、关闭及拖动权限在 `src-tauri/capabilities/default.json` 按窗口显式开放；调用失败会写入 WebView 控制台。
- Overview、卡片详情和卡片布局编辑器共用参数值及布局。布局编辑器使用 `@dnd-kit/core` 提供拖动传感器、跟随指针的 DragOverlay 和投放命中，使用 `react-resizable-panels` 调整同行参数宽度；上下投放新建一行，左右投放将目标列分半，因此组合第三个参数不需要先缩放。布局用稳定参数 ID、行列顺序、固定状态和列宽比例表示；移走参数后会压紧空位。窄窗口改为单列。布尔参数使用卡片自然高度，避免固定网格行高裁切 Toggle。变量可以拖到参数卡片；已暴露到任一卡片的变量从 Variables 列表隐藏。创建菜单、文件夹选择／展开、事件／函数元数据和 Details 已实现。
- Overview 卡片使用 React-Grid-Layout 管理每个蓝图独立的响应式位置与宽度，拖动复用参数编辑器的 dnd-kit 传感器、拖动预览和行列插入逻辑。网格测量完成后才显示；中央投放交换位置，侧向投放插入同一行并自动分配整行宽度，上下投放插入独立行，底部空白区可追加到末尾；列宽可继续手动调整。卡片高度通过 ResizeObserver 测量标题和字段正文，正文不再拉伸填满多余空间。顶部中央的横向点阵无按钮底框，卡片悬停时显示；宽度把手仅在鼠标接近或键盘聚焦时显示。内容宽度低于 900 CSS px 时保持单列，达到 900 px 使用 12 列网格。
- Overview 参数采用 Inline Rows：参数名与控件同行，参数名为 14px、控件文字为 13px；名称优先完整换行，编辑控件收窄但至少保留 84px。布尔项只显示紧凑开关，不拉伸成整行输入框。卡片标题栏收至 44px；字段行序、分列和比例仍来自共享布局，卡片详情与布局编辑器保持原样。
- 卡片参数放置由卡片自身处理，阻止外层区域重复放置；窄工作区将 Overview 卡片切为单列，标签栏隐藏滚动条并保留横向滚动。
- Blueprint 使用 React Flow 的 Rust 节点目录，可在画布空白处右键并按鼠标位置添加节点，以可视化控件编辑参数、连线、移动和删除；空白处左键拖动框选，右键拖动画布。触摸板的细粒度像素滚动平移、捏合缩放；常规鼠标滚轮缩放，右键拖动仍平移，按 F 适配视图。像素滚轮单次绝对增量小于 80 CSS px 时按触摸板平移处理，较大增量及行／页模式滚轮走画布缩放；真实触摸板仍有已知异常，见下方暂停排查记录。节点右键菜单提供复制、重复、删除和粘贴，Ctrl+C／Ctrl+V 可复制／粘贴选中节点，粘贴副本与原节点的数据互不共享。可暴露参数前的右箭头导入按钮创建同类型输入端口；按钮启用时字段只读，连线值覆盖参数默认值。Boolean、Byte、Integer、Integer64、Float、Double、Name、String、Text 分别有 Make 节点，Region、Path 和媒体流由对应领域节点构造或产出。引脚和连线采用 UE 默认 GraphEditorSettings 类型颜色，通配值为灰色。执行引脚显示在节点标题栏左右侧，输入和输出箭头分别朝外，垂直居中；未连接时为空心三角形，不占用节点参数区。Register Control 每个节点只注册一个总控按钮；菜单项由 Register Control Menu 节点逐项注册，以路径表达层级。Register Control 的整数 Order 控制总控栏按钮顺序，相同值保持图中注册顺序。框选后的 Details 实时显示当前选择；多选时只显示共同且类型兼容的参数，异值显示 `Multiple values`，编辑作用于全部选中节点。可编辑参数偏离默认值时显示还原按钮。Details 参数采用对齐的单行 Label／Field，自适应显示完整 Label；输入按钮位于参数名与控件之间，Toggle 在控件列左对齐且不显示外围字段框；分组使用可折叠的 UE 风格标题栏。NodeType 在标题右侧，节点标题可在 Details 标题单击或画布节点标题双击重命名。Details 面板随内容调整高度、宽度可拖动；它覆盖在延伸到工作区右边界的节点画布上。Blueprint 采用高密度布局，蓝图列表作为独立侧栏默认展开，画布路径显示当前蓝图名称和 `Events`。字体和交互按 [Desktop UI 规范](../ui-guidelines.md) 执行。运行前由 Rust 复核类型、循环、引用和媒体管线。
- 缺少 Order 字段的旧蓝图在加载时按注册顺序推导内存默认值，不自动写回文件；用户显式保存后才持久化。
- Tauri 窗口最小尺寸为 490×310 CSS px。
- 启动只扫描 exe 旁 `blueprints/builtin/` 和 `blueprints/user/`，不补建缺失文件。Source templates 位于 `apps/desktop/blueprints/builtin/`，`tauri:dev`／`tauri:build` 构建时仅复制缺少的内置文件。内置和用户蓝图都能保存与删除。
- 内置 Screen recording 可跑通模拟帧／日志、暂停、恢复、停止及延迟取消；Operation recording 是不可运行预览。没有真实采集、编码、键鼠记录／回放、像素比较或 MCP。
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

蓝图逻辑实现与 Release 验证（2026-10-14）：

- 两个内置蓝图为单文件 JSON；Rust 存储位于 exe 旁，首次运行只扫描。显式保存使用 revision 冲突检查和原子替换；内置／用户删除移至 `.trash/` 并提供撤销，缺失配置不会在启动时恢复。
- 总控按钮由 On Initialize 的 Register Control 节点生成；菜单动作分别派发蓝图 Event。React Flow 读取 Rust 类型端口目录，Rust 执行 Event、日志、延迟、控件更新、参数／常量／比较／Branch 和模拟媒体流。
- `npm run test:blueprint-runtime` 在 Release WebView 中验证路径菜单层级、开始／暂停／恢复／停止、模拟帧持续、暂停时帧数稳定及 3 秒延迟期间取消。`npm run test:overview-drag` 回归通过。
- 此次逻辑框架验证时，Rust 单测（10 项）、模型测试（13 项）、Oxlint、TypeScript／Vite 和 Tauri Release x64 构建通过。Vite 提示约 647 KB 的 JavaScript chunk 超过 500 KB；实际屏幕捕获、编码和文件输出仍未实现。

蓝图编辑与总控栏更新（2026-10-14）：

- Release WebView 验证蓝图列表分隔器拖动并复位、更多菜单不越出窗口、初始双标签、干净状态隐藏 Save、修改后显示星号和行内 Save，以及 Register Control 的 Order 编辑、总控栏重排和保存落盘。自动化结束后恢复发布目录里的测试蓝图原文件。
- 同一脚本验证节点参数显示为表单控件、Branch 布尔参数可视化、执行三角引脚全部位于标题栏且不占参数区、Details 组以 Header 和缩进呈现且无气泡边框、Register Control 不提供 Children／子菜单创建、Ctrl+C／Ctrl+V 和自定义右键菜单；原有模拟录制流程与路径菜单层级通过。
- 最新检查通过：Rust 单测 12 项、模型测试 18 项、Oxlint、TypeScript／Vite、Tauri Release x64、`npm run test:blueprint-runtime` 和 `npm run test:overview-drag`。Vite 提示未压缩 JavaScript chunk 超过 500 KB。
- Details 面板覆盖节点画布，宽度拖动与内容高度已实现；概览卡片按内容高度布局，最小窗口调整为 490×310 CSS px。实际采集、视频编码、物理鼠标／键盘和其他 DPI 仍未验证。

多选与默认值还原（2026-10-15）：

- Release WebView 验证 Overview 和节点参数的还原按钮仅在值偏离默认值时出现；还原后值复位、按钮隐藏。框选两个 Register Control 后 Details 更新为多选，Order 的混合值显示 `Multiple values`；还原后批改 Order 并保存，两个节点均落盘为 7。
- Ctrl+C／Ctrl+V 复制 Register Control 后修改副本 Order、删除副本，原节点 Order 保持 4 且仍存在。粘贴对节点和连线分别按值克隆。
- `npm run test:blueprint-runtime` 和 `npm run test:overview-drag` 通过；`npm run lint`、`npm run build` 和 18 项模型测试通过。WebView CDP 验收不覆盖物理输入或多 DPI。

Details 布局与配色复验（2026-10-15）：

- `npm run test:blueprint-runtime` 现在在 Release WebView 检查 Details 表单及分组的实际宽度、行内标签／导入按钮／控件／还原按钮顺序、无换行和横向溢出，Toggle 左对齐且没有外围字段框，输入激活后字段只读、分组可折叠；还检查 Overview 图标、开关、主动作和焦点边框均使用粉色，并核对蓝图路径及执行引脚连接方向／空心状态。
- 验收脚本在 `out/ui-sketches/` 保存真实 Release WebView 的 Overview 和 Details 截图。Details 布局检查覆盖浏览器 `<details>` 内容容器，避免只看到外层面板尺寸而漏掉内部网格列宽崩塌。
- Release WebView 验收通过；当前窗口环境下的截图和 DOM/CDP 检查不覆盖物理输入、多 DPI 或其他窗口尺寸。

卡片参数样式与缩放把手复验（2026-10-15）：

- Card Details 与卡片布局编辑器的参数统一为同行 Label／Field；标签可换行、字号至少 12px，控件保留最小宽度，Boolean Toggle 左对齐且不带外框。布局编辑器改用紧凑单行参数项。
- Overview 相邻卡片把手分别锚在各自边缘，命中区不相交；侧栏默认展开。
- Release WebView 的 `npm run test:overview-drag` 验证 Card Details／布局编辑器的行列尺寸、字体、Toggle 和主题表面色，并验证把手相对卡片边缘的坐标及命中区间距；截图保存在忽略目录 `out/ui-tests/`。`npm run test:blueprint-runtime` 验证蓝图侧栏默认展开及收起／展开后的可用区域。
- 其他 DPI、窗口尺寸与物理鼠标操作仍待现场验证。

节点画布滚轮／触摸板手势与回归验收（2026-10-17）：

- 双指平移使用画布外层的原生非被动 wheel 捕获监听，取消网页默认滚动；用户在 WebView2 中复测仍有初始轴锁定。注入序列无法仿真操作系统的真实手势轴转换，所以自动通过不等于硬件验收通过。
- 画布原生 wheel 处理统一接管缩放，保持鼠标位置对应的画布点不变；鼠标滚轮用 React Flow 默认速度，触控板捏合使用四倍速度，范围为 1%–160%。Release 回归检查倍率、缩放下限及页面比例不变。
- 真实硬件对照（用户操作）：Nodrec 和同一 WebView2 宿主中的官方 React Flow Demo 都锁定初始轴；用户在外部浏览器的官方 Demo 可自由转向。Nodrec 采集 222 个 wheel 事件，宿主中的 Demo 采集 314 个，两份都没有同时含两轴非零增量的事件。问题在页面收到输入之前；具体是 Windows 手势转换还是 WebView2 内部处理尚未确定。
- 2026-10-19 暂停触摸板排查。开启宿主输入处理后，最新硬件反馈为横向平移过快、不跟手；原生指针帧仍为零。实验、完整日志和 Wry 源码保存在 `codex/fix-touchpad-axis-lock`，主分支移除原生采集钩子与硬件／官方 Demo 测试入口。现象、证据及恢复步骤统一见 [触摸板平移异常](../bugs/touchpad-axis-lock.md)。

- 真实 Windows 触摸板反馈：平移正常、捏合无响应。排查发现 Tauri 默认关闭 `zoomHotkeysEnabled`，Wry 会同时关闭 WebView2 的 `IsPinchZoomEnabled`；现已开启。新增 Chromium 触摸板来源的合成捏合入口检查通过，画布缩放且页面比例不变；真实设备需重新人工确认，之前 Ctrl+wheel 检查不足以覆盖这个入口。

- Release WebView 根据像素滚轮 delta 增量区分细粒度触摸板滚动和平常的粗粒度滚轮；触摸板滚动平移、Ctrl+滚轮捏合缩放、普通滚轮缩放、右键拖动平移。
- `npm run test:touchpad-nodrec` 对 Nodrec Release WebView 验证鼠标滚轮、垂直／水平像素平移、捏合缩放和右键拖动画布，并检查页面比例不变；官方 Demo 对照仅保存在触摸板实验分支。
- `npm run verify` 依次运行 lint、模型／Rust 单测、Tauri Release 构建、Overview 拖动、蓝图运行及触摸板手势验收；各项脚本可单独调用，完整用法见 [自动化验证框架](../testing.md#自动化验证框架)。
- 测试使用 WebView2/CDP 合成输入，能回归 WebView 收到的 WheelEvent 语义，不等同于真实触摸板。像素 delta 阈值是浏览器无法报告输入设备来源时的启发式；本机 Win 触摸板及 MacBook 硬件仍待人工验收。

## 职责与边界

桌面模块负责应用导航、预设参数编辑、蓝图编辑器及结果展示；采集和工作流执行由后续产品模块负责，MCP 应通过共享能力提供同等产品操作。

## 一期目标

- 不进入节点编辑器也能完成常用录制与回放配置。
- 参数卡片、节点、事件和函数支持直观编辑；英文 UI，并为多语言替换保留集中入口。
- Windows 先行，同时控制其他平台重复开发成本；React + Tauri 是当前实现路线，跨平台捕获／输入仍需逐平台实现。

## 验收

T08 部分通过：Release 已验证蓝图读取、运行菜单及模拟工作流；蓝图删除／撤销的桌面交互、键盘／无障碍、窄窗口与多 DPI、内存目标仍待验收。模拟媒体不代表真实录制能力。

## 未来规划

在 Windows 原生运行中检查样式、窗口操作、交互和内存；根据结果决定是否把当前路线冻结为产品框架。后续补齐持久化、键盘可用性、无障碍、多语言和其他平台适配。
