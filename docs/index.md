# 项目知识库

首次进入项目先读总体规划和开发规则；具体任务再读受影响的模块。

| 文档 | 内容 |
| --- | --- |
| [总体规划](project-plan.md) | 用户需求、阶段草案与待澄清问题 |
| [架构讨论](architecture.md) | 技术方案比较；未确认，不作为实施定案 |
| [跨模块接口](contracts.md) | 需要协调的数据与接口议题 |
| [开发规则](development.md) | 文档同步、证据、决策与交接 |
| [验收场景](testing.md) | 功能验证方向；不是已通过测试 |
| [技术决策](decisions.md) | 仅收录用户选择并确认的方案 |

## 模块文档

| 模块 | 职责 |
| --- | --- |
| [Runtime](modules/runtime.md) | 会话与运行协调 |
| [Workflow](modules/workflow.md) | 节点、事件、函数、子图与预设 |
| [Capture](modules/capture.md) | 屏幕、窗口、区域与图像帧 |
| [Audio](modules/audio.md) | 音频采集与混合 |
| [Media Output](modules/media-output.md) | 编码、封装与写入 |
| [Input](modules/input.md) | 键鼠、UI 树与语义记录 |
| [Replay](modules/replay.md) | 模拟输入并同时录屏 |
| [Verification](modules/verification.md) | 像素差异与统计 |
| [Storage](modules/storage.md) | 工作流、录制和报告的保存 |
| [Platform](modules/platform.md) | 平台能力与适配 |
| [Desktop](modules/desktop.md) | 预设界面、节点编辑与多语言 |
| [MCP](modules/mcp.md) | Agent 接入与能力对等 |

当前尚无完成的产品模块；UI 路线原型和证据见 Desktop。各模块维护自己的实现状态，不在此重复。规划与候选方案不是实现事实，未确认细节不具有约束力。
