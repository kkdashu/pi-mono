---
name: site-skill-authoring
description: 为特定网站创建或修补技能目录。适用于在完成复杂网站任务后沉淀经验，或在执行中发现现有网站 skill 过时、遗漏、错误时进行修订。
---

# site-skill-authoring

这个 skill 用于维护网站级别的经验文档。

## 总体规则

- 一个网站域名对应一个顶层 skill 目录。
- `SKILL.md` 只做入口和索引，不要把所有任务细节都写进去。
- 共用知识写到 `shared/*.md`。
- 具体任务步骤写到 `tasks/*.md`。

## 什么时候创建网站 skill

- 第一次在某个网站上完成了复杂流程
- 同一个网站出现了明确可复用的导航规律、认证规则或失败信号
- 当前任务涉及 5 次以上浏览器动作，且未来很可能再次遇到

## 什么时候修补网站 skill

- 页面入口、按钮文案、URL 路径、表单结构变了
- 共享导航或登录规则变了
- 当前任务文档缺少关键步骤、失败信号或验证方式

## 目录结构

```text
site-example-com/
  SKILL.md
  shared/
    auth.md
    navigation.md
  tasks/
    change-password.md
```

## 创建流程

1. 确定网站域名，创建 `site-<domain>/`
2. 创建 `SKILL.md` 作为入口文档
3. 如果有共用知识，写入 `shared/*.md`
4. 为当前任务创建 `tasks/<task>.md`
5. 回到 `SKILL.md`，把共享文档和任务文档索引写清楚

## 修补流程

1. 先用 `read` 查看现有 `SKILL.md` 和相关文档
2. 如果是站点级共用规则变化，优先 patch `shared/*.md`
3. 如果是具体任务变化，patch 对应 `tasks/*.md`
4. 如当前任务还没有任务文档，则新建一个 `tasks/*.md`
5. 如新增了文档，更新 `SKILL.md` 的索引

## 最低质量要求

- `SKILL.md` 必须包含 frontmatter，至少要有 `name` 和 `description`
- `shared/` 和 `tasks/` 下只放 Markdown 文件
- `tasks/*.md` 应包含：
  - 适用条件
  - 前置条件
  - 操作步骤
  - 失败信号
  - 验证方式

## 提醒

- 成功完成复杂网站流程后，立即沉淀文档，不要等下次再补
- 发现文档过时后，立即修补；过时 skill 会成为负担

