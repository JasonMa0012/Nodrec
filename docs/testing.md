# 验收场景

已有蓝图存储／运行单测、React 前端测试和 Release WebView 真实无声 H.264 录屏闭环；音频和回放尚未实现。以下场景用于澄清“做到什么程度算可用”，工具、性能阈值和环境在实践中确定。

文档与旧原型清理验证（2026-10-27）：`npm run verify:unit` 通过 55 项模型及 28 项 Rust 测试，lint 有既存的 RegionTool effect 警告；前端构建、无安装包 Release 构建及签名 NSIS 构建通过。隔离内置蓝图的 Release WebView 已启动并显示 Screen recording 和控制栏，截图见 [README 界面图](images/desktop-overview.png)；本轮未重新实录或做完整硬件验收。

## 验收方向

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

## 自动化验证框架

在 `apps/desktop` 下运行命令。`npm run verify` 先运行静态／单元检查和签名 Release 构建，再依序运行 UI 与录屏回归；需要项目更新签名私钥、可见且正在刷新的 Windows 桌面及可用的 H.264 硬件编码器。

从仓库根目录运行时使用 `npm --prefix apps/desktop run test:touchpad-nodrec`；构建使用 `npm --prefix apps/desktop run tauri:build`。根目录没有 package.json。

也可双击根目录 `tests` 中对应的 BAT；脚本自动切换工作目录、显示退出码并保留窗口。`tauri-build.bat` 构建 Release，`verify.bat` 执行完整验收；各 UI 单项脚本使用已构建的 Release。自动调用时设置 `NODREC_TEST_NO_PAUSE=1` 可跳过暂停。

触摸板异常已暂停排查，主分支已移除原生采集、硬件 BAT 和外部官方 Demo 测试；实验分支、最新反馈与恢复方法见 [触摸板平移异常](bugs/touchpad-axis-lock.md)。合成回归不能关闭该缺陷。

触摸板方向切换回归先检查画布能真正取消默认滚动，再注入竖直→斜向→水平及水平→斜向→竖直序列，逐步检查两轴位移和缩放不变。此检查不代替真实硬件的连续手势：人工需保持双指不离开触摸板完成上述两组转向，并确认节点／空白区域均正常。

| 命令 | 覆盖范围 |
| --- | --- |
| `npm run verify` | 单元检查、签名 Release 构建及 Overview、图交互、蓝图运行、实录、选区工具和触摸板合成回归 |
| `npm run verify:unit` | lint、React 模型单测和 Rust 单测 |
| `npm run build` | TypeScript 检查和 Vite 前端构建 |
| `npm run test:overview-drag` | Release WebView 的 Overview 拖放与尺寸回归；先构建 Release |
| `npm run test:graph-interactions` | 隔离蓝图的 Release WebView 节点、连线和自动整理回归；先构建 Release |
| `npm run test:blueprint-runtime` | Release WebView 的蓝图、Details、节点编辑和录制状态回归；先构建 Release |
| `npm run test:recording` | 真实显示器录制、MP4 解码和输出保护；先构建 Release，需要硬件编码器 |
| `npm run test:region-tool` | 区域工具、原生命中穿透与实录排除；先构建 Release，需要硬件编码器 |
| `npm run test:touchpad-nodrec` | 启动 Nodrec Release WebView，验证常规鼠标滚轮缩放、像素滚动平移、捏合缩放和右键拖动；先构建 Release |
| `npm run test:update -- "<测试安装的旧版 exe>" <公开的新版本号>` | 真实更新指定安装并覆盖其内置模板；不属于 `verify`，使用限制见 [发布与更新](releases.md) |
| `npm run test:model` | React 模型单测 |
| `npm run test:rust` | Rust 库单测 |

触摸板测试通过 CDP 的 `Input.dispatchMouseEvent(mouseWheel)` 注入可信像素滚轮事件；普通 mouse wheel 用较大 delta，精细两指滚动用小 delta，捏合用 Ctrl+滚轮。Nodrec 将非 Ctrl、像素模式且绝对 delta 小于 80 CSS px 的滚轮事件解释为连续触摸板平移，其余滚轮事件保留缩放路径。测试结束会关闭其启动的进程，蓝图运行验收会恢复临时修改的内置蓝图。

Nodrec 脚本另用 `Input.synthesizePinchGesture`（`gestureSourceType: mouse`）覆盖 Chromium 触摸板手势入口，检查画布缩放且页面比例不变。仅注入 Ctrl+wheel 会绕过 WebView2 原生手势开关，不能作为捏合入口可用的证据。Tauri 的 `zoomHotkeysEnabled` 必须开启：当前 Wry 同时用它设置 `IsPinchZoomEnabled`。

这些测试验证合成事件在浏览器／WebView 中的处理结果，不会模拟实际触摸板硬件，也不能证明 macOS 的 WKWebView 行为。人工验收必须在新构建的应用中分别执行双指平移、张合缩放、鼠标滚轮缩放和右键平移，并记录应用路径和版本；未完成时不得标记真实触摸板已通过。当前阈值是缺少输入设备来源字段时使用的启发式；真实设备 delta 落在另一侧时需现场校准。全量 `verify` 适用于 Windows x64 开发机。

## 历史验证记录

### 真实录屏验证（2026-10-21）

- 构建：`npm run tauri:build`；单测：`npm run verify:unit`。录屏专项：`npm run test:recording`，自动构建原生探针并在独立 target 目录复制 Release exe／蓝图，不改用户安装旁蓝图。
- 专项覆盖非零物理坐标、897×360→898×360、原生硬件编码器名、开始／暂停／继续／停止、暂停扣时、暂停时直接停止、MP4 完整解码及画面变化、越界区域、已有最终／部分文件保护，以及录制时重复关闭窗口后的文件完成。产物、UI 截图和 JSON 结果留在 `src-tauri/target/recording-check-*`。也可运行 `tests/test-recording.bat`；完整 `verify` 已包含录屏专项。
- `cargo run --release --manifest-path src-tauri/Cargo.toml --example recording-smoke -- <唯一绝对路径.mp4> <秒数> hardware 1080` 可执行设备实录；将 hardware 改为 software、1080 改为 odd／1440 可测软件、奇数区域和 1440p。最后追加 pause 测暂停／继续；`recording-smoke verify <路径.mp4>` 使用系统解码器读取至 EOS 并导出首帧 BMP、统计画面变化。探针要求可见桌面；可解码不等于画面正确，仍需检查首帧。
- 本机：Windows x64、AMD Radeon 8060S、显示器 2880×1800／225% DPI。硬件和软件奇数区域短录均可解码且首帧目视正确；软件路径扣除了 2 秒暂停。AMD 1440p60 短录完成，停止约 9 ms。Release 区域端到端停止约 7–8 ms。
- 早期一分钟探针虽能解码但画面全黑，不能作为正确录屏证据；已修复编码前 GPU 命令未 Flush 的原因，再次验证首帧。后续长录制以修复后的产物为准。
- 修复后的 1080p60 长录制：612.434 秒、36,747 帧，停止／MP4 发布 17 ms；系统解码器读至 EOS 得到全部 36,747 帧，末帧 PTS 612.433 秒，首帧目视正确。产物为 `src-tauri/target/recording-1080p60-10min.mp4`，日志同目录 `.log`。原生探针私有内存抽样：约 1 分钟 108.5 MB、2.5 分钟 109.1 MB、5.3 分钟 111.1 MB、9.8 分钟 111.5 MB；不包含 WebView 和 GPU 显存，也不是 UE／游戏负载对测。
- 独立一分钟复测：1080p60、60.019 秒、3,602 帧，停止／发布 37 ms；完整解码至 EOS、末帧 PTS 60.017 秒，产物为 `recording-1080p60-1min-valid.mp4`。当时 `verify:unit` 包含 23 项模型测试和 22 项 Rust 测试。
- 尚未验证：30 分钟独立停止、真实 UE／游戏与 Bandicam 各 3 次的匹配负载对测、NVIDIA／Intel、副屏／混合 DPI／旋转、显示器断开、磁盘写满、HDR 拒绝的真实设备场景。1080p60 平均 FPS 降幅 ≤5%、相对 Bandicam 多降 ≤2 个百分点和正常停止 ≤3 秒均是验收目标，不是性能承诺。

### 区域工具验收（2026-10-23）

`npm run test:region-tool` 在独立 target 测试目录启动 Release 应用。覆盖真实 WebView 框选、普通边框拖动、角点缩放、尺寸菜单、隐藏恢复、过期令牌拒绝、双位置共享控件、录制锁定、暂停计时及无 UI 注册的独立工具；验证 Selected／Cancelled 后续执行输出。

原生探针检查实际窗口区域、内部 WindowFromPoint 命中和两个辅助窗口的显示亲和性；不能用纯 JS 点击替代此证据。已在 2880×1800／225% DPI、AMD Radeon 8060S 上验证；全屏选区内放置工具条，硬件编码生成并完整解码 MP4，工具条区域 144 个采样点保留底层已知背景色。暂停冻结、恢复与停止完成通过；一轮 121 帧、停止 28ms，不是性能承诺。

桌面休眠／停止刷新时 WGC 可能仅产生黑帧；验收必须先确认原生窗口捕获可见测试画面，不能把全黑视频算作 UI 排除通过。混合 DPI、副屏负坐标、热拔插和不同驱动仍需相应设备实测；数学边界测试不等于这些设备已通过。

区域工具补充回归已通过：捕获排除开关关闭／开启、隐藏恢复保留开关状态，以及圆形把手与 3 CSS px 虚线中心对齐（允许 DPI 像素舍入）。开关切换时回读 Windows 捕获亲和性；开启后的实录排除检查通过，关闭后的第三方截图未逐一验证。

区域工具关闭与菜单回归通过：关闭后工具会话为空且主窗口不出现恢复按钮，选区节点可重新打开并保留已确认区域；More 下拉只有捕获排除开关，实际宽度小于 280 CSS px、高度小于 60 CSS px，隐藏时收起。Release WebView 截图检查通过，区域实录排除回归通过。

选区恢复回归通过：26 项 Rust 测试覆盖合法区域恢复及缺失、越界、过小、显示器不匹配、类型错误的回退；Release WebView 验证关闭后恢复、合法 Initial Region 直接确认、过小 Initial Region 自动进入拖动框选。快速切换工具时等待旧窗口标签释放，避免异步销毁与重建竞争。区域实录回归通过；实际显示器热拔插仍未验证。

浮动面板布局回归（2026-10-23）：31 项模型测试、26 项 Rust 测试、lint、TypeScript/Vite 与 Tauri Release 编译通过；Release WebView 检查标题空白处双击最大化／还原的事件处理、面板开合时原生窗口边界及工具条锚点稳定、八项区域字段和屏幕百分比转换、轮询保留编辑状态、比例锁定同步到边框会话，以及二级菜单横向布局。原生穿透探针、捕获排除和实录完整解码通过。未做物理鼠标双击、逐帧闪烁测量或混合 DPI 多屏验收。

最终布局版本通过窗口边界、面板避让、菜单横向布局及比例同步断言并保存截图；该轮运行到原生捕获校准时为黑帧，因此最终一轮实录未判通过。此前三轮实录与完整解码通过，需屏幕处于活动状态再复测最终版本。

未保存提示与快捷保存回归（2026-10-23）：TypeScript/Vite、lint（保留 RegionTool 原有警告）、Tauri Release 和 `test:blueprint-runtime` 通过。验证未修改标签无圆点、修改后同一蓝图各标签及列表显示圆点，输入框聚焦时 Ctrl+S 使 Order 实际落盘并清除圆点；原有保存按钮及工作流回归通过。快捷键通过 WebView2 CDP 输入验证，未使用物理键盘验收。

### 节点自动整理

- `npm run test:model` 包含 `graph-layout.test.mjs`：覆盖执行链／分叉汇合、严格选区、单参数 Helixing／多参数左排、共享归属、独立媒体图、固定锚点／范围外节点、手动路径边界、未完成测量、循环、配置引用隔离和重复整理稳定性。
- `npm run test:graph-interactions` 使用隔离的 Release exe 和临时蓝图，已接入 `npm run verify`。除了原有图交互，检查真实渲染尺寸和动态引脚、鼠标框选后 Shift+F 的严格范围及边界路径保留、F／Shift+F、文本输入与重复按键保护、Event 固定、视口／选区保持、节点不重叠、内部路径清理、函数图隔离、Ctrl+S／重载及重复整理不产生未保存状态。截图在 `apps/desktop/src-tauri/target/graph-interactions-check/layout-before.png` 和 `layout-after.png`。
- `test:blueprint-runtime` 的 F 适配视图测试显式清空选择，避免与新增整理快捷键冲突。物理键盘、不同 DPI 和大规模图性能未作验收；没有通用撤销或完整连线避障承诺。

2026-10-24 验证通过：50 项模型测试（含 19 项排版测试）、TypeScript/Vite、Tauri Release、`test:graph-interactions` 与完整 `test:blueprint-runtime`。Lint 无错误，仅保留 RegionTool 既有警告。Release 截图已检查单参数位于使用节点下方，执行链水平对齐且无节点重叠。新增引脚刷新仅在端口集合变化时执行，避免初次挂载逐节点测量让初始 fitView 只包含首个节点。

参数排列顺序修正（2026-10-25）：上一轮实时连线避障、附带修改和相关文档说明已撤销，保留原有 Subway／Ribbon 路由。新增模型用例先复现按节点 ID 误排为 Bitrate／Encoding Mode／Fps／Resolution，再验证按目标引脚排列为 Fps／Resolution／Bitrate／Encoding Mode；同时覆盖节点与边数组反转、嵌套参数树及纯数据消费节点。52 项模型测试（含 21 项排版测试）、lint（既有 RegionTool 警告）、TypeScript/Vite、Tauri Release、图交互及完整蓝图回归通过。Release 实际鼠标选择后按 F，验证 Encode 四个参数与 Output Path 的 Directory／Filename 顺序正确，使用节点保持原位，重复整理稳定；截图位于 `graph-interactions-check/parameter-order.png`。未修改用户蓝图资产，尚未验证任意复杂图的全局最少交叉。

参数间距与扇入通道（2026-10-25）：53 项模型测试、lint（既有 RegionTool 警告）、TypeScript/Vite、Tauri Release、图交互和完整蓝图回归通过。左侧参数列与使用节点至少间隔 120，参数行至少间隔 40；上行／下行的有序扇入按几何顺序分配通道。模型测试检查两个方向的圆角曲线路径不相交及输入数组反转后的确定性；Release 实测节点边界间距，并使用 SVG 原生曲线每 3 个画布单位采样检查 Encode 参数线两两无交叉。截图已目视检查。手动路径和顺序本身相反的端点不在有序扇入保证内，不引入实时节点避障。

主线通道留白（2026-10-26）：54 项模型测试、lint（既有 RegionTool 警告）、TypeScript/Vite、Tauri Release 和图交互验收通过。新增 Capture→Encode→Write 与嵌套 Output Path 场景，验证 F 后所有参数节点顶部位于相应主节点执行／媒体引脚区域下方至少 25 个画布单位，参数顺序、120／40 间距、固定锚点、重复整理及无交叉扇入仍通过；主线引脚未完成测量时延后整理。`parameter-order.png` 已目视检查蓝色主线从参数组上方通过。只在整理范围内应用，未验证任意复杂跨分支主线遮挡。

多分支执行输出（2026-10-26）：通用显示规则见 UI 规范。TypeScript/Vite、lint（既有 RegionTool 警告）、Tauri Release、图交互和完整蓝图回归通过。实际渲染验证 Branch 的 True／False、Select Region 的 Selected／Cancelled 均在正文右侧逐行显示；标题仅保留执行入口，单输出节点仍使用标题输出。检查分支行高至少 22 CSS px、文字与引脚同行、连接／空心状态及端口 ID 保持原义；`graph-interactions-check/branch-pins.png` 已目视检查。完整回归首轮在无关的侧栏拖宽还原等待处超时，重试通过；未修改该侧栏逻辑，未做其他 DPI 验证。

### 触摸板实验归档与清理（2026-10-19）

- 原生触点采集、宿主输入补丁、硬件与官方 Demo 对照脚本保存在 `codex/fix-touchpad-axis-lock`；主分支移除这些诊断入口及直接 Windows API 依赖，保留 `test:touchpad-nodrec` 合成回归。
- 清理后完整 `npm run verify` 复跑通过：lint、19 项模型测试、16 项 Rust 测试、前端与 Tauri Release x64 构建、Overview 拖放、蓝图运行及 Nodrec 合成手势回归。启动日志没有原生触摸板诊断输出。
- 首轮 Rust 的 `deleted_blueprints_are_recoverable_without_startup_resurrection` 在删除后列表应为空的断言失败；未修改存储代码，完整复跑时通过。该次失败原因未定位，不能据复跑通过认定已修复。
- 未重新验收真实触摸板或 MacBook。归档与清理不解决初始轴锁定、横向过快和不跟手，最新用户反馈及原始日志位置见 [排查记录](bugs/touchpad-axis-lock.md)。

### 蓝图存储与模拟运行（2026-10-14）

- `apps/desktop/src-tauri` 中 `cargo test --lib`（16 项）验证缺失目录不被启动扫描创建、文件保存／重载、revision 冲突、危险 ID、删除／撤销、节点目录和图连接、条件分支求值、输入端覆盖参数默认值、九种 UE 标量 Make 节点及 Byte 范围、Make 输入端保持 UE 类型约束、Order 整数约束、路径菜单组装和稳定排序；实际内置配置也由同一 schema 校验。
- 在 `apps/desktop` 执行 `npm run test:blueprint-runtime`，需先运行 `npm run tauri:build`。脚本启动 Release Nodrec，以 WebView2 CDP 验证单项路径菜单悬停展开、菜单互斥及空白收起，蓝图列表收起后工作区仍可见、最大宽度下 Overview 卡片保持并排且高度贴合字段，统一滚动条样式、Details 高度随内容增长／调宽／把手悬停显隐／参数行对齐和完整标签、节点画布贴到右边界、NodeType 与标题编辑、左拖框选、移除缩放按钮后 F 适配视图、右键平移和滚轮缩放；随后验证初始化注册控件、模拟帧开始／暂停／恢复／停止和延迟期间取消，并关闭测试进程。
- 同一 Release WebView 检查 Overview 与节点参数改动后显示默认值还原按钮、还原后隐藏；框选两个 Register Control 后 Details 实时更新，Order 异值显示 `Multiple values`，重置和批量编辑都作用于两节点并保存。复制出的 Register Control 修改后原节点参数不变，删除副本后原节点仍在。
- Release WebView 还验证默认双标签、蓝图列表调宽／复位、更多菜单留在视口内、干净蓝图不显示 Save、编辑后出现星号和行内 Save；将 Register Control 的 Order 改为 4 后总控栏相应重排，保存文件里的值也是 4。测试先备份发布目录中的蓝图，结束后还原原文件。
- Events、Functions、Parameters、Variables 分区标题可展开／折叠，初始展开且切换不标记蓝图为未保存。Branch 节点可在画布空白处右键添加并落在指针位置；Boolean／Byte／Integer／Integer64／Float／Double／Name／String／Text Make 节点可从同一菜单创建。Register Control 的 Order 输入开关显示与 UE 配色一致的 Integer 引脚，关闭后引脚移除。执行引脚位于节点标题栏且不占参数区，显示为无名称白色三角形。Details 中 Control 使用无边框 Header，同级参数与 Header 对齐，仅嵌套 Header 缩进；Register Control 没有嵌套 Children 编辑入口。Ctrl+C／Ctrl+V 和自定义右键菜单通过 WebView 验收；Operation recording 预览按钮保持禁用。模拟录制实际产生帧；暂停期间帧数保持不变，恢复后增加，Stop 结束运行；延迟启动取消后状态保持 Ready。没有测试真实采集、编码或媒体文件。
- 该次检查通过：Rust 单测 16 项、模型测试 19 项、Oxlint、TypeScript／Vite、Tauri Release x64 和 `npm run test:blueprint-runtime`。旧蓝图没有 Order 时以注册序号作内存默认；旧递归菜单会在加载时转换成路径注册节点。序列化会忽略 React Flow 的选中、拖动和测量状态，选中节点本身不会标记为未保存。WebView CDP 结果不代表物理鼠标／键盘、标题栏、无障碍或其他 DPI 验收。

### Overview 卡片拖动验证（2026-10-13）

- 入口：在 `apps/desktop` 执行 `npm run test:overview-drag`；需先构建 Release。脚本启动 Nodrec Release 窗口，在回环地址开启临时 WebView2 DevTools 端口，用 CDP `Input.dispatchMouseEvent` 验证同行插入、上方／下方／末尾插入、宽度把手显隐及样式。截图在忽略目录 `out/ui-tests/overview-drag-*.png`。
- 根因：DPR 2.25 时 viewport 为 1200×760 CSS px，Overview 内容宽约 950 px（实测 961 px）。1250 px 断点让窗口始终单列，拖动命中正常但侧向插入分支被关闭。降至 900 CSS px，并等容器测量完成后显示网格后，自动化验证 Audio 成功插到 Recording settings 右侧。
- Release 拖动验收曾发现底部空白区没有实际落点：落点的 `useDroppable` 在所属 `DndContext` 外调用，未进入碰撞注册。移入 DnD 子组件后，运行时 rect 列表包含 `overview:end`，可在卡片区外追加到末尾。
- `npm run lint`、12 项模型测试、TypeScript／Vite、Tauri Release x64 和 WebView 拖动脚本通过。实测 1200×760 CSS px、DPR 2.25：三卡同行铺满网格；上下插入及末尾追加均有预览、指示并改变布局；卡片中央悬停时缩放把手隐藏、靠近边缘时显示，斜纹已移除。CDP 验证 Tauri WebView 鼠标事件／DOM 链路，不代表物理鼠标硬件或窗口标题栏输入。
- Overview Inline Rows 采用同一 Release 脚本注入长参数名验收：标签完整换行、编辑控件收窄但不小于 84px，卡片内无裁切；编译、模型测试和 Release 构建结果见 Desktop 模块当次记录。
- Overview 宽度把手复验（2026-10-13）：Release WebView 鼠标事件验证 84px 把手／52px 握柄居中显示在卡片间隙、宽度拖动生效且占位提示为蓝色；释放后 Overview 无横向溢出。外侧列把手保持在卡片边缘内。

### 旧 IMGUI 原型验证（2026-10-12）

当时 Release x64 构建、自检和四个 DX11 界面快照通过，并在 225% DPI 下目视检查布局；没有完成真实拖放、窄窗口或窗口缩放验收。原型源代码已于 2026-10-27 从仓库移除，该记录仅用于保留历史证据，不代表当前桌面应用的验证。

React + Tauri 交互修复（2026-10-12）：lint、TypeScript／Vite 和 Tauri Release 构建通过；Release 窗口验证了窗口按钮、变量暴露以及卡片参数的鼠标拖动、固定状态和列宽。该次没有覆盖全部窗口尺寸或键盘交互。
