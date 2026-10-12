# Nodrec

AI 原生的计算机操作录制、回放与验证平台：简单预设用于录屏和键鼠录制／回放，节点编辑器用于自定义工作流，MCP 用于 Agent 接入。

第一阶段 Windows、英文 UI，后续明确开发其他平台；手柄后续考虑。当前桌面 UI 使用 React + Tauri，产品录制／回放／验证尚未实现。

- [总体规划](docs/project-plan.md)
- [知识库索引](docs/index.md)
- [AI 开发入口](AGENTS.md)

## 桌面应用

需要 Node.js、Rust stable MSVC 工具链、Visual Studio C++ Build Tools 和 Windows SDK。

```bat
_Build_And_Run.bat
```

该入口在首次运行时安装前端依赖，然后编译并启动 Tauri 开发版。单独构建前端：

```powershell
cd apps/desktop
npm ci
npm run build
```

当前示例数据只在会话内保留；录制、回放、节点执行、MCP 和持久化尚未实现。用户提出的 200 MB UI 内存目标待实测。

## 旧 UI 原型

Dear ImGui + imgui-node-editor 原型保留在 `prototypes/imgui` 供实现参考，可以单独构建，但不再是默认启动入口。第三方源码和构建产物放在忽略的 `out/`。当前实现与验证限制见 [Desktop](docs/modules/desktop.md)。
