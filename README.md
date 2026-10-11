# Nodrec

AI 原生的计算机操作录制、回放与验证平台：简单预设用于录屏和键鼠录制／回放，节点编辑器用于自定义工作流，MCP 用于 Agent 接入。

第一阶段 Windows、英文 UI，后续明确开发其他平台；手柄后续考虑。目前有 Dear ImGui + imgui-node-editor 的 Windows UI 验证原型，产品录制／回放／验证尚未实现。最终框架和媒体后端仍未定案。

- [总体规划](docs/project-plan.md)
- [知识库索引](docs/index.md)
- [AI 开发入口](AGENTS.md)

## UI 原型

需要 Visual Studio 2022 C++ 工具、Windows SDK、Git；首次构建下载固定版本的两个上游库到忽略的 `out/`，不安装系统组件。

```powershell
.\prototypes\imgui\build.ps1
.\out\imgui-prototype\NodrecUiPrototype.exe
```

可切换简单界面／节点编辑器，调整共享参数、拖动节点、创建／删除连线；预览为生成纹理，不是录屏。五个节点固定，不保存图或布局。

构建脚本运行图自检。图形自检使用 `--smoke-test` 渲染 120 帧后退出；`--snapshot` 额外保存程序实际渲染的 `prototype-render.bmp` 到可执行文件目录。GUI 程序的脚本测试使用 `Start-Process -Wait -PassThru` 获取退出码，不能只依赖调用后的 `$LASTEXITCODE`。

CodeGraph 已索引原型源码；第三方下载与构建产物不纳入 Git。入口与验证限制见 [Desktop](docs/modules/desktop.md)。
