# Tokeru 0.1.1

0.1.0 的修复版本：删除试卷后题库残留、模型列表不可见、导入拖放覆盖层常驻、复制提示词入口重复、自动分图精度、导入预览公式渲染。

## 交付物

| 文件 | 大小 | SHA-256 |
| --- | ---: | --- |
| `Tokeru_0.1.1_x64-setup.exe` | 6,809,113 B | `2e53c163b8ddb09bb5f16e3437b101f3e42ec8661de74ab5fdf469e48e65d4d7` |
| `Tokeru_0.1.1_x64_portable.zip` | 8,668,796 B | `7728976003bfeec85299c367dda57bb3574dc981f1a462a6c8a32b65f333708d` |
| `tokeru.exe`（release / 便携） | 22,415,872 B | `8eea891e7bd09af53aa4e47bec299121a0b94544669fbd6e005240c8fd89ceb5` |

安装版按当前用户安装到 `%LOCALAPPDATA%\Tokeru\app-0.1.1`，旧版本目录保留；卸载不会删除 `%APPDATA%\com.tokero.app` 中的数据。安装包与 exe 均未签名。

## 修复

- **删除试卷残留**：首页删除后失效 `sets`、`bank/all`、`tags`、`tagGroups`、`folders`、`records`、`mistakes` 与单卷缓存；浏览器 mock 同步过滤已删除试卷。
- **模型下拉不可见**：删除原生 `datalist`，获取模型后直接展开可点选列表；移除输入框里的示例模型。
- **拖放覆盖层常驻**：窗口级拖拽计数改为组件引用，内层 `drop` 同步清零；拖入 PDF 直接预加载。
- **重复的复制提示词**：只保留材料区一个「复制清洗提示词」与「预览提示词」入口。
- **自动分图精度**：支持 0–1/0–100/0–1000 归一化坐标与对象框；题号精确匹配、范围与多题共用图展开；越界页码丢弃；页面限宽 1800、整页 JPEG 0.86、裁图 0.92、自适应留白；视觉请求携带 `detail:high`，输出上限 6000 tokens。
- **导入预览公式**：校验表格的题干与答案改用 `richText` 渲染；原卷预览同样支持 LaTeX、表格和题图。

## 验证

- `pnpm exec tsc --noEmit`、`pnpm exec vitest run`（1 文件 / 6 用例）、`cargo test`（11 passed）通过。
- 非管理员静默安装 exit 0，注册表 `DisplayVersion=0.1.1`，安装目录 `%LOCALAPPDATA%\Tokeru\app-0.1.1`。
- 安装版空数据目录启动到首页：0 份试卷、0 道题、0 次练习。
- 测试构建逐项验证：删除试卷后题库只剩另一份试卷；获取模型展开 `mock-chat/mock-vision`；拖放后覆盖层消失；导入页只剩一个复制入口；含 `$...$` 的 JSON 在校验表格渲染 4 处 KaTeX、原卷预览渲染 10 处；自动分图对象框、`1-2` 范围、多题共用图与越界页丢弃均符合预期。
- 真实视觉模型未验收；自动分图的精度仍取决于所选多模态模型。

## 文件

- 变更：`CHANGELOG.md`
- 源码地图：`docs/SOURCE-MAP.md`
- MCP：`docs/MCP.md`
- 第三方声明：`THIRD_PARTY_NOTICES.md`
