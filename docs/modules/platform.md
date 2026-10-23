# Platform：平台适配

## 当前实现

Windows 捕获／编码后端封装在 `recording/windows.rs`，通过仅 Windows 启用的 `windows` crate 调用 WGC、D3D11 和 Media Foundation。通用 `RecordingPlan`／`RecordingSession` 边界不向前端暴露 Windows 句柄；非 Windows 启动录屏返回不支持。已在本机 AMD／Windows x64 验证，不代表其他 OS、GPU 或 Windows 版本通过。

## 职责与边界

承接捕获、音频、输入、语义、解码和权限等 OS 能力。

## 一期目标

- 第一阶段 Windows，核心设计保留跨平台边界。
- 说明实际可用和受限能力，不把平台版本当作功能已支持的证明。
- 待确认：核心语言、系统／架构范围、后端资源边界和其他平台时间表。

## 验收

T10：实际 Windows 路径有效，核心依赖边界可检查，不支持的能力有明确反馈。

## 未来规划

macOS／Linux 等适配，更多设备和系统架构。
