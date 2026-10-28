# 项目知识库

面向使用者的安装、录制和开发入口见 [README](../README.md)。首次参与开发先读总体规划与开发规则，再按任务查阅模块、接口和验收记录。

| 文档 | 内容 |
| --- | --- |
| [总体规划](project-plan.md) | 用户需求、阶段草案与待澄清问题 |
| [架构讨论](architecture.md) | 技术方案比较、当前路线和待确认事项 |
| [跨模块接口](contracts.md) | 需要协调的数据与接口议题 |
| [开发规则](development.md) | 文档同步、证据、决策与交接 |
| [Windows 发布与更新](releases.md) | EXE 安装器、一键 Release、代理与签名更新 |
| [Desktop UI 规范](ui-guidelines.md) | 字体密度、Details 参数行和 Blueprint 画布交互 |
| [节点自动整理](node-layout.md) | BA 排版研究、节点整理实现和边界 |
| [验收场景与记录](testing.md) | 测试入口、历史证据、验证范围及尚未完成的场景 |
| [触摸板平移异常](bugs/touchpad-axis-lock.md) | 暂停排查的现象、证据、实验分支和恢复步骤 |
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

各模块维护自己的实现状态，不在此重复。规划、候选方案和验收目标不是已实现或已通过的结论；历史记录只证明当次测试范围。
