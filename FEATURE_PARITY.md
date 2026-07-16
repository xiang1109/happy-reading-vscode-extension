# IDEA → VS Code 功能对照

| IDEA 插件功能 | VS Code 实现 |
| --- | --- |
| 右侧 Tool Window | Activity Bar 中的 `Happy Read book` Webview View |
| TXT / EPUB / PDF / MOBI / AZW3 | TypeScript 本地解析器；支持 UTF-8、GB18030、PalmDOC |
| 打开文件或递归扫描文件夹 | VS Code 原生打开对话框与递归书库扫描 |
| 小说书库与最近列表 | 自动扫描当前 VS Code 工作区；小说列表展示书库全部文件并合并最近 100 本 |
| 当前文件与进度恢复 | VS Code `globalState` 持久化 |
| 每页行数、每行字数与位置跳转 | 阅读设置与跳转输入框 |
| 章节识别、当前章节、点击跳转 | 可滚动章节目录并定位当前章 |
| 阅读区 / 底部栏 | Webview 阅读区 / 三个 VS Code Status Bar Item |
| `<<` / `>>` 状态栏翻页 | 底栏左右翻页按钮 |
| 状态栏宽度 | 设置滑杆和“调整底部栏宽度”命令 |
| Alt+方向键 | 全局 VS Code Keybindings |
| 阅读模式、双击退出 | Webview 沉浸模式与正文双击退出 |
| 鼠标静止自动翻页 | Webview 指针空闲计时器 |
| 工具区隐形拖动分隔条 | Webview 中的透明上下拖动区并持久化高度 |
| 纸书、暗夜、水墨、自定义主题 | 同名主题与自定义前景/背景色 |
| 字体、字号 | 自定义字体名称与 10–36 字号 |
| 选择正文、复制、保存书签 | 正文右键菜单 |
| 书签详情、复制、删除、双击回跳 | 书签弹窗与对应操作 |
| IDEA 最小化时隐藏 Tool Window | VS Code 最小化时整个工作台会由操作系统隐藏；扩展 API 不暴露“仅最小化”事件，无需也无法单独关闭 View |
| JetBrains Marketplace 试用/订阅 | VS Code 无 JetBrains 授权 API；VS Code 版不调用该接口，功能直接可用 |

VS Code 状态栏不允许扩展嵌入 Swing 式可拖动控件，也不允许自定义状态栏字体和颜色，因此宽度改为阅读设置滑杆/命令；状态栏沿用 VS Code 原生主题样式。
