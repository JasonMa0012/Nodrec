# 跨模块接口议题

已实现的蓝图存储及 Rust 运行接口见下表；Windows 首版媒体接口见下；音频、回放和多路产物接口仍待确定。

| 协作边界 | 需要表达的内容 |
| --- | --- |
| Workflow ↔ Runtime | Rust 节点目录提供类型与端口；蓝图事件及执行／数据／媒体流连接传入运行器。值节点按需求值；函数与子图未实现 |
| Capture／Audio ↔ Media Output | 帧／音频格式、时间、缓冲所有权、输出规格及结束行为 |
| Input ↔ Replay | 键鼠事件顺序、时间、绝对／相对位置、UI 树和定位材料 |
| Runtime ↔ Storage | Tauri 命令列举、保存、删除与恢复 `.nodrec.json`；revision 用于防止磁盘外部修改覆盖。运行产物关系未实现 |
| Replay／Storage ↔ Verification | 帧时间轴、环境信息、配对条件、逐帧与汇总统计 |
| Desktop／MCP ↔ 应用能力 | Desktop 调用 Tauri 蓝图索引、保存、激活、事件派发和运行快照；MCP 尚未接入 |
| 核心 ↔ Platform | 目标／设备、能力可用性、平台资源与权限限制 |

优先解决容易导致模块误解的问题：桌面像素和 UI 布局单位、视频与输入的时间关联、GPU 缓冲生命周期、帧缺口、运行中编辑的影响、基线保护及部分失败。具体策略属于待确认设计，不从旧草案继承默认值。

### 连线路径布局

蓝图事件图与函数图的边允许可选 `data.routePoints: { x: number; y: number }[]`，坐标为图表坐标。该字段仅用于编辑器布线，执行器仍使用原边的 source／target 与 handle；缺失时自动布线，无需迁移旧文件。

### 第一版无声录屏接口

- `list_displays` 返回 `{ id, name, width, height, x, y, hdr }[]`：id 是稳定监视器接口标识；尺寸和桌面位置为物理像素。Screen Region 的 x/y 是显示器内坐标。
- `RecordingPlan` 是开始时冻结的显示器／矩形／鼠标／输出尺寸／FPS／码率／硬软模式／路径配置。保留 `region → screen → encode → write` 类型和端口 ID；一次运行只解析一个屏幕源、编码器和输出，音频连接明确拒绝。
- GPU 纹理由原生录制线程和 MF 样本分配器持有；只有压缩包字节、PTS、duration、关键帧标记进入有界写入队列，不把帧序列化进 JSON。编码不重排 B 帧；时间戳为单调时钟导出的 100 ns 单位，暂停时间扣除。
- `runtime_snapshot.recording` 为可空统计对象，包含 encoder/adapter、width/height/fps、durationMs、encodedFrames/droppedFrames/repeatedFrames、outputPath/partialPath、stopMs、error/finished。frameCount 对应已产出的编码帧；最终成功必须等 MP4 完成，`.partial.mp4` 不作为成功产物。
- 旧 schemaVersion 1 文件保持可读；缺少 region.mode 的旧节点按 Rectangle 解释。旧 Display 1 仅在唯一显示器时解析；无法唯一对应时要求重选。新增参数默认值不自动写盘。Overview Value 扩展支持 number；数字参数按数值类型连接，旧字符串值保持原样。
### 区域工具与蓝图 UI

- `select_region`（Select Region）：Execute 输入，Selected／Cancelled 执行输出，Region 数据输出；配置稳定 `toolId`、显示器与可选 initialRegion，另有可连接的 Initial Region 输入。Selected 在框选确认后继续，工具保持打开；恢复已有工具直接返回 Selected，后续移动更新会话区域。
- `get_selected_region`：通过 toolId 按需求值最新 Region。mode 为 Selected Region 时缺少选区明确报错；Full Display／Rectangle 从 fallback Region 输入读取原参数，并使用所选模式。默认蓝图的 Capture mode 控制该选择，不自动保存选区。
- `register_control.control.targets`、`register_display.display.targets` 是非空且不重复的目标数组；`main` 表示主窗口，`region:<toolId>` 表示本蓝图工具。旧按钮缺少 targets 时默认 `["main"]`。同一 ID 共用按钮状态、菜单、事件及 Order，Update Control 不修改 ID 或目标。
- `register_display.display` 包含 id、targets、整数 order、source、format。source 为 status 时 format=text；elapsed 时 format=HH:mm:ss。显示项不派发事件、不需要蓝图定时循环；runtime_snapshot 增加 displays 数组，controls 继续只返回按钮。
- 选取工具 ID、UI ID、显示数据源和目标引用在激活时校验。按钮与显示项 ID 不可重复；工具引用不能跨蓝图。运行时选择值仅注入求值副本，不进入持久化图。
- `region_tool_state` 返回 `{tool,runtime}`；工具含 token、blueprintId、toolId、display、物理 rect／work、scale、picking、visible、captureExclusion（用户开关）和 excluded（已应用排除）。action（ready／select／change／reselect／cancel／hide／show／close／exclude-capture／allow-capture）、layout、dispatch 都校验会话；dispatch 还校验按钮启用状态、显示目标及菜单事件。
- 浮层使用原生窗口区域实现内部穿透；窗口显示不抢焦点，显示后按开关重新应用并回读 WDA_EXCLUDEFROMCAPTURE 或 WDA_NONE。排除失败时隐藏相关窗口；未确认 API 返回值不能当作“不入镜”的实录证明。DPI 或显示器几何变化使选区失效。

Select Region 每次打开按当前显示器重新校验上次区域；合法时直接输出 Selected 并显示选区工具，无效时清除旧区域并等待拖动框选。有效 Initial Region 也可直接恢复。区域仍只保留在当前蓝图运行时会话，不写入蓝图文件或跨应用重启保存。

区域工具内部布局：`region_tool_layout` 仅在边界变化时移动／缩放窗口；`region_tool_shape` 只接受当前工具条会话，按物理像素更新可见控件的原生命中区域；`region_tool_ratio` 将有限且非负的长宽比同步至工具条与边框，0 表示解锁，录制期间拒绝修改。
