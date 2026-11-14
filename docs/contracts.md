# 跨模块接口

## 蓝图与节点动作

- 蓝图仅接受 `schemaVersion: 2`，保存为单个 `.nodrec.json`。`graphs` 保存稳定 ID、名称、节点和数据边；节点有 enabled 状态及可选 actionOrder，用于节点控件排序。事件、函数和执行线模型已移除，旧文件显示不兼容，不转换或执行。原文件保存保护见 [Storage](modules/storage.md)。
- `controls` 保存 id、label、icon、enabled、targets 和 `{graphId,nodeId,action}` 绑定，`controlOrder` 按显示目标保存控件 ID 数组，不保存控件坐标或尺寸。Overview 参数布局独立保存。节点目录返回字段默认值、端口、可接线参数、动作、Provider 和 choices。
- `displays` 的 status／elapsed 由 Screen Capture 提供，保存对应 `{graphId,nodeId,action:"record"}` 绑定。它们与按钮一起进入 `controlOrder`，按目标混合排序。删除快捷方式不影响节点显示；删除源录屏节点清理其按钮和只读快捷方式。已有 V2 未绑定的显示项在读取时绑定文档首个录屏节点，补齐目标顺序；未保存前不改写原文件。后端校验显式绑定必须指向录屏节点。
- 总控栏是节点动作快捷方式：拖入已有绑定时复用控件 ID，主窗口删除只移除 main 目标；无剩余目标才删除控件定义。节点删除会清理失效绑定及顺序，选区节点删除会清理其工具条显示目标。标签为编辑瞬态，Overview 与 Blueprint 固定不可关闭。
- 主窗口调用 `activate_blueprint`、`dispatch_node_action`、`runtime_snapshot`；动作包含录屏 start/pause/resume/stop 和选区 select。激活、添加节点或编辑参数不会启动录制。一次只运行一个录屏会话，开始后冻结本次参数，运行期间拒绝修改活动文档。
- 编码 Provider 由节点类型确定，当前为 `encode_media_foundation`。codec 为参数，实际支持 H.264；前端选项和后端预检共用目录 choices，不展示 FFmpeg 或 H.265 为可运行选项。
- 数据节点按需求值。命名值通过 Define Value 单一定义，Read Value 引用定义 ID，读取形成依赖，重复名称、缺失定义或循环被拒绝。参数在图中不可写。
- 边的可选 `data.routePoints: {x,y}[]` 仅供图表布线；执行仍使用 source/target 和 handle。节点的 measured/selected 等编辑瞬态不写入文件。

## Windows 无声录制

- `list_displays` 返回 `{id,name,width,height,x,y,hdr}[]`。尺寸、区域和显示器内位置使用物理像素，UI 布局使用逻辑像素。HDR 不支持，无法唯一解析显示器时要求重新选择。
- 当前图通过 region → screen → encode_media_foundation → write 数据链解析显示器、采集、编码和路径配置。录屏节点拥有 fps、cursor 和 startDelaySeconds；编码节点拥有 codec、resolution、bitrate、encodingMode，帧率继承采集。Screen 的 region 对象和 Write 的 path 对象提供本地内联默认值；连接 region/path 数据输入时覆盖并锁定本地配置，断线恢复。局部字段合并保留其他默认值，三个媒体节点即可录制。
- 从被操作的录屏根收集有有效写入用途的分支。同一编码节点按 ID 分组，只创建一个编码实例；支持一源多编码和一编码多写入。启动预检拒绝输出及 partial 路径冲突，无有效输出时不创建会话。禁用节点只在唯一、同类型输入输出可对应时旁路，不能将原始帧旁路到 MP4。
- 采集、GPU 转换及硬件编码在 D3D11 设备所属线程调度。每个编码分支拥有独立资源；Writer 消费与 Provider 无关的编码格式和带 PTS/duration/关键帧标记的数据包。帧不经过 WebView/JSON，压缩包字节在写入端间共享。
- 每个写入端具有独立线程和有界队列，同时限制约两秒包数量和 64 MiB。队列满使该端失败，不阻塞其他端，不静默丢弃压缩包。编码器忙时仅跳过该分支原始帧并统计。写入失败影响自身，编码失败关闭其下游；无消费者组件释放，全部输出失败后停止采集。
- 会话共用暂停时钟，时间戳单位为 100 ns，暂停时间不计入媒体时长。停止依次关闭采集、排空编码、完成写入并发布成品；不覆盖既有成品或 partial，失败保留已写部分，不自动由硬件回退软件。
- `runtime_snapshot.recording` 包含 encoder/adapter、width/height/fps、durationMs、encodedFrames/droppedFrames/repeatedFrames、outputPath/partialPath、stopMs、error/finished，以及逐文件 outputs。encodedFrames 在多编码时为各编码器产出之和，不能当成一个输出的帧率。成功必须等文件发布；整体部分失败时，健康端仍可发布，逐文件结果是判断产物成功的依据。
- 快照 nodeErrors 返回 `{graphId,nodeId,message}[]`，根据本次编译的稳定输出路径映射定位写入及编码节点，录屏根承载会话错误；控件的临时 error 随同快照发往主窗口和浮动工具条，不写入蓝图。outputs.encoderError 区分编码分支故障，避免把普通单端写入失败标为编码器故障。停止即使失败也先保留最终统计，再报告错误。
- 真实单／多路、故障与性能证据见 [Media Output](modules/media-output.md) 和 [性能报告](recording-performance.md)。音频、窗口采集、操作回放、原始帧／序列帧写入尚未接入。

## 选区工具

- `select_region` 是纯数据／动作节点：Region 输出、Initial Region 输入，以及 select 动作。没有 Execute、Selected 或 Cancelled 执行端口。`get_selected_region` 的 Selected Region 输入优先读取显式连线；旧 V2 文件未连接时按 toolId 读取当前选区。Selected Region 模式缺少选区时拒绝录制，其他模式使用 fallback。确认选区时主窗口同步 display、x、y、width、height 和 regionMode 参数；取消不提交。
- `dispatch_node_action` 在主窗口打开选区；浮动工具条调用 `region_tool_node_action`，携带当前 token、controlId 和 action，由 Rust 校验窗口、工具会话、控件目标及绑定。过期 token 被拒绝。区域变更、比例和显示设置在录制期间被锁定。
- 每次打开重新校验上次区域；有效 Initial Region 或会话区域直接恢复，无效区域清除并等待框选。区域仅保留在当前蓝图运行时，不跨应用重启保存。DPI 或显示器几何变化使其失效。
- `region_tool_layout` 更新窗口边界；`region_tool_shape` 更新可见控件原生命中区域；`region_tool_ratio` 同步有限非负比例，0 表示解锁。浮动工具条与主窗口共享录制状态和时钟。

## 存储、更新与后续接口

Tauri 蓝图命令提供索引、原子保存、revision 冲突检测、删除与恢复；内置模板替换前备份。设置通过 `get_settings`／`save_settings` 保存，更新使用 `check_update`／`install_update` 和 `update-progress`。Rust 保留最近检查的更新对象，前端不能提交任意下载地址；安装前保存修改，录制期间拒绝更新安装。详见 [发布与更新](releases.md)。

音频、输入／回放、验证基线及 MCP 边界仍属于后续工作，不将计划视为已实现接口。

## 桌面路径操作

- `open_folder({path})` 仅允许主窗口调用，接受已存在且可访问的绝对目录路径，拒绝空路径、相对路径、文件路径、缺失目录及 NUL 字符。通过 Windows Shell 打开目录，保留空格和 Unicode；错误通过 IPC 返回并显示在字段旁。
- 目录选择继续使用原生 dialog，取消保留原值。打开目录按钮独立于选择动作，读取连接值时不修改配置。`open_project` 与目录打开共用 Shell 入口。

## 应用日志

`app-log` 事件与主窗口 `get_logs` 返回同一会话的日志项，字段为 sequence、timestampMs、level、source、blueprintId、runId、message。sequence 全应用递增，前端先订阅再读取快照，按序号合并，避免初始加载与多线程事件交错导致丢失或重复。runtime_snapshot.logs 保留最近 300 条工作流日志供既有调用方使用，序号来自统一日志服务；应用 Logs 窗口通过 app-log／get_logs 读取本次会话全部来源的日志。

各 WebView 通过 app_log 提交 debug／info／warn／error 文本，原生工作流与录制直接写入日志服务；前端统一 invoke 入口记录命令失败并保留原异常。get_logs 和 open_logs_folder 仅供主窗口读取及打开日志目录，区域工具仍不展示录制错误详情。
