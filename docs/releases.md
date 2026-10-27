# Windows 发布与更新

## 打包和发布

- Windows x64：双击根目录 `Release.bat`，输入版本号和描述；或在 `apps/desktop` 执行 `npm run release -- 0.1.2 "Release notes"`。需要项目 Node/Rust 依赖、MSVC 工具链及有本仓库 Release 写权限的 `MOOATOON_ENGINE_TOKEN`（也接受 `GITHUB_TOKEN`）。令牌仅用于本地 GitHub API 发布，不进入安装包。
- 版本同步到 Tauri、Cargo、npm 及锁文件；不会自动提交或推送源码。GitHub 在远端默认分支创建 Release 标签，安装包来自本地工作区；需要源码对应时应先自行提交和推送。
- 只打包：`npm run tauri:build`。输出 `apps/desktop/src-tauri/target/release/bundle/nsis/Nodrec_<version>_x64-setup.exe` 和 `.sig`。发布先创建草稿，上传安装器、签名和 `latest.json` 后才公开；失败的草稿应检查并删除后重试。
- 原始更新私钥位于 `%USERPROFILE%/.tauri/nodrec.key`，相邻 `.pub` 为公钥；只有公钥进入仓库。务必备份私钥，更换密钥会使旧版无法验证更新。可用 `TAURI_SIGNING_PRIVATE_KEY` 指定密钥文件路径，`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 指定密码。
- 更新签名不是 Windows Authenticode 证书，目前安装器未配置 Windows 代码签名证书。
- 2026-10-27 用户明确选择将现有 `JasonMa0012/Nodrec` 改为 public，已通过 GitHub API 修改并确认。应用匿名读取同一仓库的 Release；发布脚本仍拒绝向私有仓库发布，避免生成无法匿名更新的版本。早期 v0.1.0／v0.1.1 为链路测试包，正式使用应选择最新版本。

## 安装和数据

NSIS 当前用户安装，默认创建开始菜单图标，不选桌面快捷方式，完成页默认启动。静默／被动安装也不默认创建桌面快捷方式。更新被动安装后自动重启原路径程序。

每次安装／升级覆盖 `blueprints/builtin/` 中的发行模板；普通启动不补回已删除模板。`blueprints/user/` 和 `.trash/` 不作为安装资源覆盖。保留内置修改需要先 Duplicate 成用户蓝图。

## 设置和更新链路

- General：启动检查默认启用，只通知可用更新，用户点击后安装。
- Network：默认系统代理，支持直连和自定义 HTTP(S)/SOCKS5 代理 URL。设置原子写入 Tauri 当前用户配置目录 `com.nodrec.desktop/settings.json`，升级不覆盖。
- About：版本、项目链接、手动检查、说明和更新按钮；先保存设置再检查，录制／保存中禁止更新。
- 检查和下载分别通过当前代理访问 `ipwho.is`，失败再尝试 `ipapi.co`；仅用国家代码 CN 判断实际出口。定位失败先直连，再尝试加速，不阻塞更新。
- CN 依次尝试 `gh-proxy.com` → `ghfast.top` → `ghproxy.vip` → `ghfile.geekertao.top` → `gh-proxy.org`，全部失败后最后回退 GitHub 直连；其他出口保持 GitHub 优先，失败再尝试这些加速。检查和下载共用列表；网络错误、无效清单、越界安装地址或下载签名失败均继续尝试下一条。`gh-proxy.org` 是 GH-Proxy 的备用域名，不视为独立运营方；`ghfile.geekertao.top` 本次下载重定向至 `gh.dpik.top`。免费第三方服务无长期可用性保证。参考：[GH-Proxy 说明](https://gh-proxy.com/en/docs/github-accelerator/)。
- 最新版本读取 GitHub 最新 Release 附件 `latest.json`，Tauri 做语义版本比较，不自动降级。安装 URL 限制为本项目 Release 的 EXE，所有线路均通过内置公钥验证签名，失败不安装。参考：[Tauri updater](https://v2.tauri.app/plugin/updater/)。
- 点击更新先逐项保存所有蓝图，沿用 revision 冲突检查，任一失败即中止。下载验证完成后停止核心、安装、重启；期间禁止编辑。下载失败保留应用和已保存内容，支持重试。

## 验收

2026-10-27 备用线路复验：5 条线路均通过 `curl --noproxy '*'` 读取实际 0.1.2 更新清单并完整下载 3,445,425 字节安装包，SHA-256 都为 `073386aa1c5cbe4b92046e3f33fca6722a8d7ac77707a677374755ccda295565`，与发布包一致。下载耗时约 7–30 秒，记录在 `out/proxy-backups-check.json`。候选 `ghproxy.net`、`gh.llkk.cc` 等当次超时／失败，未纳入。Rust 回归约束大陆线路最后且仅一次直连，所有备份完整保留，非大陆／定位失败的原有直连优先策略保持。

0.1.3 已发布。真实 Release 应用故障注入：临时本地 HTTP CONNECT 代理只对上述 5 个加速域名返回 502，其余请求透传至真实网络；App 定位 CN，按完整顺序尝试 5 条备份后，成功从原始 GitHub URL 读取清单，返回 `currentVersion: 0.1.3, version: null, route: GitHub`。结果在 `out/backup-fallback/result.json`，结束后恢复原设置。此轮未重复安装／重启专项，相关链路已在上一版本验证。

实际发布、安装和升级结果见 [Desktop](modules/desktop.md)，不以编译成功代替升级验证。

2026-10-27：公开 v0.1.2 已发布，修复版已安装 0.1.1 → 0.1.2 的真实自动升级通过；App Direct connection 定位 CN，检查和下载均经 `gh-proxy.com`，签名校验、保存冲突保护、自动保存／安装／重启、用户数据保留与内置覆盖均通过。测试后恢复系统代理。旧 v0.1.0／早期 v0.1.1 存在 TLS provider 初始化问题，请直接安装 v0.1.2 或更新版本。

验收命令：`npm run test:update -- "<已安装旧版exe绝对路径>" <已公开的新版本号>`。测试临时新增 `update-acceptance` 用户蓝图，恢复原代理设置并清理该用户蓝图；会真实更新指定安装、修改并覆盖它的内置 Screen recording 模板，应只针对测试安装运行。结果位于 `src-tauri/target/update-acceptance/`。`--settings-only` 仅验证设置／代理／内置图标和检查请求，不安装更新。
