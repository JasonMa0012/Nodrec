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