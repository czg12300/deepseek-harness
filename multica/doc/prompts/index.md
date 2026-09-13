# 生成提示词

本目录保存页面生成和修订的完整提示词。使用内置 image_gen，未使用 CLI 或用户 API Key。提示词用于重现设计方向，不保证再次生成相同像素。

当前图片与提示词以[设计清单](../design-manifest.json)为准；[设计图索引](../design-catalog.md)展示当前版本和历史参考。

## 专业助手修订

01–12 页的 `agent-v2` 提示词分别参考该页面的旧版图片，将右侧改为专用 agent 对话。12 页采用[agent-v3 校对](12-review-center-agent-v3.txt)，其参考图为校对前的 agent-v2。16 页使用[Agent 配置提示词](16-agent-configuration.txt)生成。

新版提示词包含角色、当前对象、示例对话、修改提案、Skills、工具和人工授权要求。实际能力与权限以[专业 Agent 工作区](../agent-workspaces.md)为准。

## 原始页面资料

01–03 页的原始生成参考项目首页与分镜页；04 页参考分镜页；05–07、09–15 页使用文字规格。00 项目首页和 08 分镜页的首次完整提示词未保存，其原始功能摘要见[页面规格](../page-specifications.md)。08 页当前的专业助手修订提示词已保存。

项目设置采用[v2 提示词](15-project-settings-v2.txt)，结合[首版提示词](15-project-settings.txt)和历史图片阅读。旧提示词只解释相应历史图片，不覆盖现行功能方案。
