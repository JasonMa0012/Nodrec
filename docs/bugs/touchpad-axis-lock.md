# Windows 触摸板画布平移异常

状态：2026-10-19 暂停排查，未修复。实验保存在 `codex/fix-touchpad-axis-lock` 分支；主分支移除原生诊断和硬件／官方 Demo 采集入口，保留 Nodrec 合成交互回归。

## 复现与期望

- 在当前 Windows 笔记本上，双指保持接触，先垂直平移再画圆；重复水平起步再画圆，并与斜向起步比较。
- 未启用宿主输入处理时，Nodrec 和同一 WebView2 宿主中的官方 React Flow Demo 都出现初始轴锁定；外部浏览器中的官方 Demo 可自由转向。
- 启用宿主输入处理的实验曾让横向平移开始响应，但用户反馈卡顿、偏慢，捏合过快；调整滚轮分类／捏合倍率后，仍报告过初始轴锁定。
- 最新一次运行 `tests/test-touchpad-hardware.bat` 后，用户反馈横向平移特别快、不跟手。期望是保持连续双轴平移并与手指位移一致，鼠标滚轮保持 1 倍缩放、右键平移，触摸板捏合保持此前用户认可的速度。

## 已验证证据

- 早期同宿主对照：Nodrec 222 条、官方 Demo 314 条 wheel 事件，均无两轴同时非零的增量。这支持异常发生在页面接收输入之前，但没有定位到 Windows 或 WebView2 的具体函数。
- 2026-10-17 开启 `AllowHostInputProcessing` 的记录包含 1,354 条 wheel 事件、零条原生指针消息。前端旧分类把绝对增量 ≥80 的事件当鼠标滚轮，可能丢掉较大横向平移或误触缩放；实验改为仅把粗粒度整数纵向增量归为鼠标滚轮，并归一化 Windows 粗粒度捏合。合成回归通过，硬件效果没有通过验收。
- 最新采集开始于 `2026-10-19T03:20:39.454Z`（北京时间 11:20）。共 1,414 条 wheel：1,360 条非 Ctrl 平移事件，其中两轴同时非零 1,035 条、仅 X 169 条、仅 Y 156 条；54 条 Ctrl 捏合事件，deltaY 为 -100（31 条）或 +100（23 条）。非 Ctrl 单次绝对增量最大 X≈284.72、Y≈88.33；缺少时间戳和手指原始位移，不能由此推导物理灵敏度或延迟。
- 最新启动日志明确记录宿主输入处理已启用；原生 pointer message、touchpad pointer message 和 pointer frame 数量仍全部为零。因此这次异常不能解释为“忘记启用测试开关”。
- WebView2 的 `Chrome_RenderWidgetHostHWND` 等子窗口属于 Edge 进程；现有采集仅对 Nodrec 自有 HWND 注册和挂钩，跳过外进程窗口。注册成功不等于收到原始触摸板输入。
- 完整最新日志保存在实验分支的 `docs/bugs/evidence/touchpad-hardware-2026-10-19.json`。其中只有浏览器 wheel 增量，未捕获触点帧或原始 HID 报告。

## 实验实现与边界

- 实验分支的 `vendor/wry-0.57.0-host-input` 保存完整 Wry 0.57.0 crate 和许可证；Cargo 使用该目录覆盖 crates.io Wry，检出分支不依赖被忽略的 `out/` 源码。
- 只有启动环境包含 `NODREC_TOUCHPAD_TEST` 时，Wry 才设置 `ICoreWebView2ControllerOptions4::SetAllowHostInputProcessing(true)`；硬件 BAT 经 `--manual` 设置该变量，普通启动不设置。此差异可能解释部分历史表现，但不能解释最新已启用该选项的异常。
- `src-tauri/src/touchpad.rs` 注册窗口并采集 `WM_POINTER`，没有识别手势或驱动画布。前端接收到的原生事件只用于诊断；实际平移仍使用 wheel 的 deltaX／deltaY。
- 主分支恢复标准 Wry 依赖，保留原有画布滚轮处理和合成回归；实验性的粗粒度捏合校准与分类调整仅保存在实验分支。暂停不代表锁轴或灵敏度已解决。

## 公开资料与推断

- [Microsoft Precision Touchpad 概览](https://learn.microsoft.com/en-us/windows/win32/input-precisiontouchpad/precision-touchpad-portal)：应用默认通常不直接接收手势输入；默认 ninput.dll 路径通常生成鼠标滚轮消息。注册触摸板能力后可接收 WM_POINTER，再获取触点信息。部分 API 文档仍带预发布提示，需验证目标 Windows 的实际可用性。
- [Microsoft 原生示例](https://learn.microsoft.com/en-us/windows/win32/input-precisiontouchpad/precision-touchpad-guide)：展示注册、读取历史帧、Interaction Context 和惯性；示例显式启用 RAILS_X／Y。Nodrec 诊断代码没有创建 Interaction Context，不能将样例的 rails 设置当成本项目根因。
- [WebView2 AllowHostInputProcessing](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2controlleroptions.allowhostinputprocessing)：默认 false，用于让输入先经过宿主；不保证提供原始触点或取消轴约束。
- [WebView2 #2482](https://github.com/MicrosoftEdge/WebView2Feedback/issues/2482)：横向触摸板滚动转成纵向滚动；维护者评论指 UWP 异常而 Win32 示例正常，与 Nodrec 的 Win32 宿主不完全相同。
- [WebView2 #5658](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5658)：WinUI／UWP 中触摸板滚动比 Edge 滞后。相似症状，不是本项目的根因证明。
- [Wry #1836](https://github.com/tauri-apps/wry/issues/1836)／[PR #1850](https://github.com/tauri-apps/wry/pull/1850)：暴露宿主输入选项的提议；截至本次查询仍开放。[WebView2 #5375](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5375) 和 [#5613](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5613) 记录该选项相关的选择滚动／拖放输入问题，启用后需单独回归。

当前推断：WebView2／Windows 手势转换路径是重点排查对象；尚无证据定位具体锁轴函数。宿主输入选项改变了事件流，但未实现稳定的硬件手感。

## 恢复排查与验收

1. 检出实验分支，先运行 `tests/tauri-build.bat`，再运行 `tests/test-touchpad-hardware.bat`；同宿主 Demo 用 `tests/test-touchpad-demo-hardware.bat`。构建会覆盖本地 Release 程序，应核对运行路径及启动日志。
2. 先补充采集事件时间戳、构建标识、DPI、窗口和焦点信息；每次采集另存日志，避免覆盖历史。分别标记垂直起步、水平起步、斜向起步、捏合及鼠标滚轮，比较增量与真实画布位移。
3. 用最小原生 Win32 示例验证是否能收到 PT_TOUCHPAD 帧，再与标准 WebView2、宿主输入选项开启／关闭作对照。不要仅用窗口注册成功判断 Precision Touchpad 已接通。
4. 只有真实硬件连续转向、灵敏度和捏合均通过，才可关闭缺陷；CDP 注入的双轴 wheel／捏合事件只能证明页面处理，无法验证设备、Windows 手势转换或输入时序。MacBook／WKWebView 也尚未验收。
