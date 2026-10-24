# 一键验收

双击对应 BAT 即可运行，无需手动切换目录；窗口显示退出码并等待按键。

- `verify.bat`：完整验收，包含 Release 构建。
- `verify-unit.bat`：lint、模型及 Rust 单测。
- `test-*.bat`：对应同名 npm 单项测试；UI 测试先运行 `tauri-build.bat`。
- `test-touchpad-nodrec.bat`：Nodrec Release 的合成画布交互回归；不代表真实触摸板硬件验收。
- `test-region-tool.bat`：区域框、蓝图自定义控件、计时、原生命中穿透和实录排除检查；先确认真实桌面正在刷新，黑帧不能作为通过证据。
- `test-recording.bat`：真实 Windows 显示器区域录制、MP4 解码及文件保护；需要可用的 H.264 硬件编码器，产物保存在独立 target 测试目录。
- `lint.bat`、`build.bat`、`tauri-build.bat`：静态检查、前端构建、Release 构建。

需要 Node/npm、Rust 和项目构建依赖。自动调用可设置 `NODREC_TEST_NO_PAUSE=1`，脚本保留 npm 退出码。

触摸板硬件采集和官方 Demo 对照入口已从主分支移除，实验保存在 `codex/fix-touchpad-axis-lock`；恢复方法及未解决的问题见 [排查记录](../docs/bugs/touchpad-axis-lock.md)。

覆盖范围和人工验收限制见 [验收文档](../docs/testing.md)。
