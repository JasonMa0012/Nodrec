# Desktop UI 规范

本规范记录用户已确认的通用且持久的桌面交互与布局要求, 不要记录单次或临时需求。

## Resize 把手

- Resize 把手保留可操作的命中区域，但可视标记只在鼠标悬停到把手附近时显示；键盘聚焦时也显示。
- 卡片与侧栏把手不得造成横向溢出。


## 参数行

- Details/卡片等中的参数统一采用 Label 与 Field 同行的布局，Field 在各行中对齐。
- Label 列按内容自适应并允许换行完整显示；空间不足时优先保留完整 Label，再压缩 Field。
- Details 中同一级的 Header 与参数左边缘对齐；仅嵌套 Header 相对上一级缩进，以表达层级。不要用带边框、背景的嵌套气泡占用横向空间。
- 每个可修改参数的右侧提供还原默认值按钮；仅当前值偏离默认值时显示，点击后恢复该参数默认值。
- 多选 Details 只显示所有选中对象共有且类型兼容的参数；不同值用 `Multiple values` 提示，修改应用到全部选中对象。

## 蓝图节点

- 执行线引脚放在节点标题栏左右两侧，以白色三角形显示；执行引脚不显示参数名，也不占用节点参数区。
- 可作为数据输入的节点参数前提供紧凑开关；启用后显示同类型输入引脚，连线值覆盖字段默认值。引脚和连线按 UE 默认 GraphEditorSettings 类型颜色显示，通配值使用灰色。
- Boolean、Byte、Integer、Integer64、Float、Double、Name、String、Text 使用独立 Make 节点；Region、Path 和媒体流继续由对应的领域节点构造或产出。
- 每个 Register Control 节点只注册一个总控按钮。菜单项通过独立的 Register Control Menu 节点注册，并用路径（如 `Start/Start after 3s`）表示层级；Details 不提供 Children 或递归子菜单编辑器。

## 字体与空间

- 所有字体最小为 12 CSS px.
- 优先用可读字体与内容自适应布局填满面板, 提高利用率，避免小字和固定空白占位。
- 蓝图库的 Events、Functions、Parameters、Variables 分区标题保持紧凑并支持展开／折叠；添加菜单保持独立可用。
