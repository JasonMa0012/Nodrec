# Desktop：预设与节点界面

## 当前实现

Windows UI 交互原型已实现；它验证界面布局和内存中的编辑状态，不是产品桌面应用。

- 入口：[一键构建并运行](../../_Build_And_Run.bat)、[main.cpp](../../prototypes/imgui/main.cpp)、[构建脚本](../../prototypes/imgui/build.ps1)、[UI 状态](../../prototypes/imgui/ui_state.h)、[界面](../../prototypes/imgui/ui.cpp)、[英文文案表](../../prototypes/imgui/ui_text.h)。
- 使用 Win32／DX11、Dear ImGui 1.90.9 和 imgui-node-editor 0.9.4；通过 [蓝图节点绘制器](../../prototypes/imgui/blueprint_node_builder.cpp)适配上游 Blueprint 示例样式，没有更换依赖分支。
- 首页包含左侧蓝图列表、置顶总控、标签页和可复用参数卡片。示例蓝图支持新建、重命名、复制、删除／撤销；每个蓝图分别保存本次运行中的标签页、选择、文件夹展开、卡片布局和模拟状态。关闭应用后恢复内置示例。
- Blueprint 与卡片编辑器按实际左栏、详情栏及最小工作区宽度切换左右／上下布局，避免高 DPI 下固定阈值误触发窄屏布局。
- Blueprint 标签显示 Events、Functions、Parameters、Variables 和 Details。列表支持文件夹、拖放分组及选中详情；参数由变量显式暴露，编辑器中以独立卡片呈现，可通过拖拽把手排序、固定、并列和调整列宽，也可从 Variables 直接拖入卡片。Overview、卡片详情与卡片编辑器读取同一份布局和值；窄区域的卡片参数改为单列。
- 总控与 Capture Screen／Audio 节点按钮仅改变模拟状态；Select Region 暂无行为。节点、连线、键鼠采集、编码、录制和回放均没有产品执行逻辑。

验证记录（2026-10-12）：

- ./prototypes/imgui/build.ps1：Release x64 构建及自检通过。新输出目录为忽略的 out/imgui-interaction/，未触碰仍在运行的旧版 out/imgui-prototype/。
- 2026-10-12 拖拽回归修复：旧实现从可能没有稳定 ImGui ID 的分组启动拖放，触发 `imgui.cpp:13250` 断言；现从参数卡片的明确拖动把手启动，卡片区域和固定／未固定放置区接收拖放。变量可直接拖入卡片并按落点排序；自检通过，`--snapshot-card` 在高 DPI 下显示完整参数控件。
- 2026-10-12 蓝图分栏断点改为左栏、详情栏和最小工作区宽度之和；独立 Release x64 构建的 `--snapshot-blueprint` 在 225% DPI 下确认恢复左右三栏。构建输出放在 `out/imgui-layout-check/`，以保留仍运行中的旧版程序。
- 自检覆盖连线校验、节点删除时清理连线、蓝图副本隔离、变量暴露／重复拒绝／默认独行、卡片行列顺序、固定状态和宽度比例。
- NodrecUiPrototype.exe --snapshot、--snapshot-blueprint、--snapshot-card、--snapshot-details 均正常退出，并从 DX11 后缓冲生成 prototype-overview.bmp、prototype-blueprint.bmp、prototype-card.bmp、prototype-card-details.bmp。快照在 225% DPI 下目视检查。
- 快照：[Overview](../../out/imgui-interaction/prototype-overview.bmp)、[Blueprint](../../out/imgui-interaction/prototype-blueprint.bmp)、[卡片编辑](../../out/imgui-interaction/prototype-card.bmp)、[卡片详情](../../out/imgui-interaction/prototype-card-details.bmp)。
- 当前证据不包含真实鼠标拖拽、菜单操作、窗口缩放或窄窗口运行测试；本次环境未提供桌面原生输入自动化，因此拖放回归仍需人工运行验证。代码实现和渲染快照不等于真实交互已验证。截图和可执行文件留在 out/，不纳入版本控制。

## 职责与边界

桌面模块负责预设导航、卡片参数编辑、蓝图编辑器及结果展示；采集和工作流执行由后续产品模块负责，MCP 应通过共享能力提供同等产品操作。

## 一期目标

- 不进入节点编辑器也能完成常用录制与回放配置。
- 参数卡片、节点、事件和函数支持直观编辑；英文 UI，并为多语言替换保留集中入口。
- Windows 先行，同时控制其他平台重复开发成本；最终 UI 框架仍待实践验证。

## 验收

T08 的产品验收尚未通过。本原型已验证构建、自检和四类页面的后缓冲渲染；蓝图切换、创建菜单、拖拽排序、列宽调整、DPI／缩放和键盘交互还需真实交互验证。不得把原型截图或模型自检当作产品功能验收。

## 未来规划

完成真实输入验证后，再确认最终 UI 方案；补齐产品状态持久化、键盘可用性、无障碍、多语言和其他平台适配。
