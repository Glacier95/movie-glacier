# Movie Glacier

把磁盘里的电影和剧集整理成一座可以浏览的私人片库。Movie Glacier 是一款 Windows 本地影视库应用：以海报墙展示收藏，整合中英文影片资料与评分，通过交互图表回顾片库，并使用 PotPlayer 播放本地原文件。基于 Electron、React、TypeScript 和 SQLite 构建，提供中文和英文界面。

Turn the movies and series on your drives into a personal library you can explore. Movie Glacier is a Windows desktop app for browsing poster collections, finding bilingual metadata and ratings, exploring your collection through interactive charts, and playing original local files with PotPlayer. Built with Electron, React, TypeScript, and SQLite, it offers Chinese and English interfaces.

[下载安装包 / Download](https://github.com/Glacier95/movie-glacier/releases/latest) · [反馈问题 / Issues](https://github.com/Glacier95/movie-glacier/issues) · [MIT 许可证 / License](LICENSE)

## 功能亮点 · Features

- **本地影视整理 / Local media library** — 扫描电影、剧集与完整蓝光目录，识别季集并管理同片多版本。Scan movies, series, and Blu-ray folders, recognize seasons and episodes, and keep multiple versions of a title together.
- **海报浏览 / Poster browsing** — 以海报墙浏览片库，支持收藏、筛选、排序，以及片名、导演和演员的中英文搜索。Browse a poster grid with favorites, filters, sorting, and Chinese or English search for titles, directors, and cast.
- **影片资料与评分 / Metadata and ratings** — 从 TMDB、OMDb 与豆瓣补充海报、演职员、简介及 IMDb／豆瓣评分，也可手动修正匹配结果。Retrieve artwork, credits, summaries, and IMDb/Douban ratings through TMDB, OMDb, and Douban, with manual corrections when needed.
- **片库统计 / Collection insights** — Overview 展示类型、年代、地区、评分分布与导演／演员榜单，点击图表可查看相关作品。Explore genres, release years, production regions, rating distributions, and director/cast rankings, then click charts to find related titles.
- **可调节的界面 / Customizable appearance** — 海报背景、毛玻璃面板和 Overview 动态海报墙均可调整，支持全屏浏览。Adjust poster backgrounds, glass panels, and the animated Overview poster wall, with fullscreen browsing available.
- **原文件播放 / Original-file playback** — 使用单独安装的 PotPlayer 播放本地资源；媒体目录只读。Play local media in a separately installed PotPlayer; source media folders are read-only.

## 界面预览 · Screenshots

### 海报片库 · Poster library

用海报浏览电影，按中英文片名、导演或演员搜索，并通过收藏、筛选与排序找到想看的作品。背景随当前悬停的海报柔和变化。

Browse movies by their posters, search by title, director, or cast in Chinese or English, and find something to watch with favorites, filters, and sorting. The background adapts softly to the poster under your pointer.

![Movie Glacier 海报片库：海报浏览、搜索、收藏与筛选 / Poster library with search, favorites, and filters](pictures/1.png)

### 片库概览 · Collection overview

在动态海报墙前查看收藏规模与电影／剧集构成，通过类型分布和类型交织图了解片库。向下还可探索年代、地区、评分和演职员统计。

See your collection size and movie/series breakdown against an animated poster wall, then explore genre distributions and relationships. Further down, discover release years, production regions, ratings, and director/cast statistics.

![Movie Glacier Overview：片库计数、类型分布与类型交织 / Collection overview with title counts, genre distribution, and genre relationships](pictures/2.png)

## 快速开始 · Quick start

1. 从 [GitHub Releases](https://github.com/Glacier95/movie-glacier/releases/latest) 下载并安装 Windows x64 安装包，另行安装 PotPlayer。Download and install the Windows x64 installer from Releases, and install PotPlayer separately.
2. 首次启动时选择影视目录、确认播放器路径，并填写自己的 OMDb API Key 或 TMDB 读取令牌。On first launch, select your media folders, confirm the player path, and enter your own OMDb API key or TMDB read access token.
3. 完成扫描后浏览片库；有新文件时点击“更新库”。在设置中可切换中文／英文界面。Browse after the initial scan, click “Update library” when new files arrive, and choose Chinese or English in Settings.

## 本地数据 · Local data

媒体目录只读。软件设置、SQLite 数据库、海报、网页会话及缓存统一保存在安装目录下的 `user-data` 文件夹中。开发运行使用项目目录下的 `user-data`；测试使用独立目录。

Source media folders are read-only. Settings, the SQLite database, artwork, browser sessions, and caches are stored in `user-data` inside the installation directory. Development uses `user-data` in the project directory; tests use separate directories.

## 使用

从 [GitHub Releases](https://github.com/Glacier95/movie-glacier/releases/latest) 下载 `Movie Glacier Setup 0.6.7.exe` 并安装；源码构建后的安装包位于 `release/`。首次打开会显示配置向导：可一次选择多个影视目录，也能反复添加，确认 PotPlayer 路径，填写至少一种资料源凭据。无代理电脑可先只填写 OMDb API Key；TMDB 令牌可选，配置后会优先使用 TMDB，连接失败时自动改用 OMDb。完成初次设置后开始建库；以后启动时直接显示上次的片库，不自动扫描，新增影片由你点击“更新库”入库。在设置中添加目录并保存时，也会扫描新目录。IMDb 不需要登录。

随后将新影片放入已配置目录，在设置首行点击“更新库”即可增量入库。“重新扫描整个库”核对所有本地资源；“刷新全部资料”重新获取海报、演职员和评分。更新提示可以点 × 关闭，下次更新时会重新显示。主页排序使用独立的深色菜单。换电脑时重新安装并选择新目录建库即可。

TMDB 和 OMDb 凭据分别从 [TMDB API 设置](https://www.themoviedb.org/settings/api) 与 [OMDb Key 页面](https://www.omdbapi.com/apikey.aspx)申请。IMDb 无需登录。电影的中文片名、中文简介与中文类型标签从豆瓣条目读取并保存在本地；评分优先按条目 ID 读取，Top250 从完整榜单读取。豆瓣片名搜索无结果时，软件可用已有的 IMDb ID 在 Wikidata 的编号对照中寻找豆瓣条目 ID；豆瓣详情页若要求登录或验证，仍须在软件内完成验证才能抓取资料。豆瓣需要验证时，点击设置中的“登录 / 验证”，在软件打开的豆瓣网页自行登录，之后使用“重试失败任务”。软件仅保存网页会话，不保存豆瓣密码。豆瓣搜索显示“访问太频繁”时，软件暂停豆瓣队列并在日志注明原因；至少十分钟后可重试。已有电影、海报和 IMDb 资料仍可浏览，不用其他来源冒充豆瓣评分。

保存的 TMDB/OMDb 凭据不会在设置页回显，页面会显示“已加密保存”；输入框留空会保持原值。设置页提供“测试连接与凭据”，可以区分无法连接、凭据无效等问题。代理地址留空时按 Windows 网络设置连接，无系统代理时直接连接。若当前电脑直连失败，可填写代理软件提供的本地 HTTP 或 SOCKS5 地址，例如 `http://127.0.0.1:7890`。实测本机直连 OMDb 成功；另一台无代理电脑仍需在首次配置时点击连接测试，因为服务可达性取决于该电脑的网络。OMDb 备用资料可提供海报、英文片名、演职员与 IMDb 评分；豆瓣中文资料独立抓取，不依赖 TMDB 或 OMDb 是否可用；访问受限时保留已有结果，并在抓取日志中注明待重试。设置首行的“抓取日志”每部影片只显示最新一次抓取状态，成功后不再显示旧失败记录；保存新的凭据或代理后会自动重试，点击“更新库”也会重试失败任务。

软件自动从文件名识别片名并匹配资料；如果匹配有误，在影片详情页点击“编辑资料”，可搜索并选择正确的 TMDB 条目，或修改片名、年份、简介及 IMDb/豆瓣条目 ID。修改后的文字会保留到后续资料刷新。电影详情可切换同片版本；播放按钮下方会显示当前版本的源文件或原盘文件夹名称与 GB 大小，原盘目录的大小在下次扫描时更新为完整目录大小。剧集详情按季播放单集。海报右上角的星标可收藏或取消收藏；主页“收藏”可筛选收藏作品，状态重启后保留。海报下方以英文名为主标题，以中文名和年份为副标题；鼠标悬停海报时，背景会平滑切换该海报的柔和色彩，设置中的“背景效果”可实时预览并保存模糊程度。详情页延续此背景，标题左侧展示、清晰海报置于右侧；搜索栏支持片名、导演和演员的中英文名称，并可点右侧 × 清空。点击详情中的导演或演员姓名会搜索库内相关作品。右键点击海报可在资源管理器中定位可用资源，点击“Shooter字幕”会用默认浏览器按电影英文名搜索字幕，也可只对该影片分别从 OMDb、TMDB 或豆瓣重新抓取，结果写入抓取日志。右上角可进入全屏，F11 切换、Esc 退出。关闭主窗口会直接退出程序，包括正在使用的豆瓣网页窗口。

安装包仍包含 Electron 的 Chromium 和 Node 运行时。已只保留中英文语言资源，并避免把构建时才用的 React 依赖与 SQL.js 其他版本重复放入安装包。当前安装包约 98.5 MB，安装后约 322 MB；十几 MB 的安装包需要改用依赖系统 WebView2 等不同架构。


## 0.6.7 榜单与展开收起修复

Overview 的导演、演员榜单均改为 Top 10，人数不足十位时显示实际人数。榜单图表高度按人数确定，展开“查看数据与作品”只增加明细区高度；收起后卡片和页面恢复原高度，反复操作不会累计撑长。

## 0.6.6 浏览与评分统计

从电影或剧集详情点击“返回片库”会恢复进入前的滚动位置。重复点击当前 Movies、Series 或 Overview 导航会回到页面顶部，并保留当前筛选与排序。

Overview 05 默认按 0.5 分统计，可切换到 0.1 分或 1 分，聚焦实际评分区间或查看完整 0–10 范围，也可拖动底部滑条调整范围。卡片显示两站已评分数量、平均分、中位数、8 分以上占比与覆盖进度；双站均有评分的同一批作品单独计算平均分差。悬停显示区间数量和站内占比，点击节点或展开数据可查看对应作品。区间含下限、不含上限，最后一档包含 10 分；缺失评分不计入均分或分布。

新增验证：`node tests/browsing-ratings.mjs`（支持 `FILM_LIBRARY_PACKAGED=1` 验证打包程序）。

## 0.6.5 识别修复

修复数字片名被截断、剧集归入电影、第三季无法匹配首播年份，以及短片名加同年份造成误识别的问题。升级后点击“重新扫描整个库”，会修正能可靠判断的旧自动识别条目并重新抓取；手动确认和手动编辑的条目保留。已关联 IMDb ID 的作品遇到年份差异时保留本地年份，并在抓取日志说明；按片名自动搜索仍校验年份。NFO 只读取与影片对应的文件或剧集的 `tvshow.nfo`，避免从共享目录借用其他影片或单集的 IMDb ID。

## 0.6.4 界面与 Overview

“抓取日志”和“更新库”位于设置首行。左上角名称下方显示构建所用的实际版本号。设置、日志、Overview 卡片及其他面板恢复透明毛玻璃效果，排序下拉菜单稍微增加不透明度。海报左上角不再显示 Top 标识；详情中的豆瓣 Top250 排名位于豆瓣、IMDb 评分之后。

Overview 使用本地 Apache ECharts 展示七张图表，桌面保持三行：第一行是类型饼图与 02“类型交织”弦图，第二行是年代柱状图与国家／地区气泡点图，第三行是半宽的 IMDb／豆瓣评分双折线，以及各占四分之一宽度的导演、演员 Top 10。较窄窗口自动重排，手机为单栏。

弦图显示作品数量最多的八种类型之间的共同作品，弦宽表示同一作品同时属于两种类型的数量，不表示方向；同一作品可参与多个不同类型组合，每个组合内只计一次。悬停可突出关联，点击弦带查看共同作品，点击外环查看该类型作品。没有共同类型时显示空状态。地区点图不使用地图、地理坐标或边界：点面积与作品数成正比，细线表示同一作品包含两个制作国家／地区，支持拖动、缩放及点击查看作品；未关联地区仍保留独立的点。所有关系均来自当前库数据。

可切换全部、电影或剧集范围，点击图表或展开数据表查看对应作品。统计按作品去重，包含离线资源，合并常见类型、地区名称及演职员别名；缺失年份归入未知，不以文件版本重复计数。评分按左闭右开的 1 分区间统计，最后一档 9–10 包含 10 分；缺失评分不计入零分。图表模块在首次进入 Overview 时加载。

Overview 背景轮播库中全部有海报的电影，相邻列错开半张海报、反向缓慢滚动。连续位移与屏幕外行更新在同一帧完成，保留可见图片节点，避免原先每 14 秒重置动画和换图产生的闪烁。仅保留视口附近图片，后台及系统减少动态效果时自动停止运动。设置中的“Overview · 海报墙”可调整模糊（0–50 px）、不透明度（0–100%）、滚动速度（0–200%，100% 为默认速度，0% 静止）和色彩饱和度（0–200%），步长均为 1。Overview 中可实时预览，取消恢复原值，保存后重启仍保留；也可恢复默认效果。原有视觉默认值分别为 3 px、25%、100%、65%。背景模糊滑块范围为 0–50 px，步长 1 px，保存后持久化。

设置中的“界面面板 · 毛玻璃”可调节全界面面板的模糊程度（0–50 px）和背景不透明度（0–100%），默认分别为 8 px 和 18%。Overview 图表卡片、设置和其他面板同时预览。“主页与详情 · 海报背景”可调整模糊（0–50 px）、不透明度（0–100%）、饱和度（0–200%）和亮度（0–100%）。新用户背景模糊默认 10 px，已有保存值保留；设置中用当前影片或库内海报预览。两组都支持实时预览、取消恢复、持久化和独立恢复默认。

## 数据存储、升级与卸载

安装后数据位于 `<安装目录>\user-data\`，其中 `library.sqlite` 保存设置、源目录、影片资料与收藏，`images` 保存图片，`Partitions` 与 `Local Storage` 保存会话和本地偏好。首次运行新版时，若本地没有数据库，会从旧版 AppData 自动复制数据及加密所需的 Local State；旧目录保留为迁移备份，不再用于新版写入。迁移失败会报告错误，不会静默创建空库或退回 AppData。

升级安装保留用户数据。交互式卸载会询问“是否删除所有用户信息”，默认选“否”；选“是”会清理安装目录的 `user-data` 及当前 Windows 用户的旧版 AppData 备份。静默卸载和升级不弹此提示，均保留数据。卸载按程序文件清单删除，不会递归清空安装目录，也不会删除影视源文件。选择保留后，在原目录重新安装即可恢复数据。

如果安装到 Program Files 并选择所有用户，安装器仅赋予 `user-data` 文件夹写入权限。这个安装目录内的片库与偏好由使用该安装的 Windows 用户共享；系统加密的凭据仍需原 Windows 用户解密，换用户或换电脑时须重新填写。备份时先退出软件，然后复制整个 `user-data` 文件夹。

设置新增“界面语言”，默认中文。保存为 English 后，界面、操作说明、状态与日志提示切换为英文，并隐藏中文片名、中文简介及中文标签；中文原始数据仍保留，随时可切回。用户文件名、路径和外部网页保留原文。按钮、顶栏、信息面板和弹窗采用半透明毛玻璃背景，导演筛选滚动区保留悬停及焦点所需的边距。

## 构建与验证

需要 Node.js 24、pnpm 11，以及 Windows 10/11 x64。

```powershell
pnpm install
pnpm build
pnpm test
pnpm test:smoke
node tests/recognition-rescan.mjs
node tests/ui-preferences.mjs
node tests/overview-ui.mjs
node tests/poster-wall-settings.mjs
node tests/appearance-settings.mjs
pnpm dist
node tests/uninstall-data.mjs
```

`pnpm dist` 生成安装包。`pnpm test:smoke` 启动 Electron 并用临时测试片库验证界面和增量扫描。打包环境若无法访问 GitHub，可设置受信任的 Electron 与 electron-builder 二进制镜像；构建工具会按校验值验证下载文件。

可选的实际数据检查：`node tests/sample-library.mjs` 只读检查 `D:\pt`（可用 `FILM_LIBRARY_SAMPLE_DIR` 改目录）；`node tests/douban-twinpeaks.mjs` 通过软件内豆瓣浏览器验证公开搜索页上的《双峰》三季与电影评分；`node tests/douban-access.mjs` 核对公开 Top250 列表。

## 当前识别范围

- 电影文件：MKV、MP4、M4V、AVI、MOV、WMV、TS、M2TS、MPG、MPEG、WEBM、RMVB。
- 完整蓝光目录：包含 `BDMV/index.bdmv` 的文件夹作为一个资源处理。
- 剧集：支持 `S01E01`、`1x02`、`E01`、`第1集`、`第三季`，仅有集号的文件可从附近的剧集／季文件夹继承片名。已补充《请回答1988》及《爱，死亡和机器人》的中英文别名与数字季号；不会将普通电影续集的数字自动当作季号。
- 支持 NFO 中的 IMDb ID、同片多版本、混合电影和剧集目录；跳过 `Sample`、预告和常见花絮目录。

首版不自动挂载 ISO，也不读取 PotPlayer 播放进度。

## 开源与第三方服务

项目源码采用 [MIT 许可证](LICENSE)。第三方依赖保留各自许可证。PotPlayer 需单独安装；本项目不包含影视文件、用户片库、海报缓存、API 密钥或网页登录会话。TMDB、OMDb、豆瓣、IMDb 与 Wikidata 的数据及服务由相应提供方管理，使用时请遵守各自的服务条款、访问限制和内容授权。

提交问题时请移除日志、截图中的 API 密钥、Cookie 和私人媒体路径。欢迎通过 Issue 和 Pull Request 反馈或改进。
