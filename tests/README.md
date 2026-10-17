# 一键验收

双击对应 BAT 即可运行，无需手动切换目录；窗口显示退出码并等待按键。

- `verify.bat`：完整验收，包含 Release 构建。
- `verify-unit.bat`：lint、模型及 Rust 单测。
- `test-*.bat`：对应同名 npm 单项测试；UI 测试先运行 `tauri-build.bat`。
- `test-touchpad-hardware.bat`：打开 Release，记录 30 秒实际触摸板输入到 `out/ui-tests/touchpad-hardware.json`；在画布上执行先垂直再水平及先水平再垂直的连续手势。这是采集入口，不是自动验收。
- `test-touchpad-demo-hardware.bat`：在相同 WebView2 宿主中载入官方 Demo，对比连续手势；日志为 `out/ui-tests/touchpad-demo-hardware.json`。需要网络。
- `lint.bat`、`build.bat`、`tauri-build.bat`：静态检查、前端构建、Release 构建。

需要 Node/npm、Rust 和项目构建依赖；Demo 测试需要 Edge 和网络。自动调用可设置 `NODREC_TEST_NO_PAUSE=1`，脚本保留 npm 退出码。

覆盖范围和人工验收限制见 [验收文档](../docs/testing.md)。
