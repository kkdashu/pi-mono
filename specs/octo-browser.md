# octo-browser 实现规格

## 问题定义

`apps/octo-browser` 的目标是做一个基于 `packages/coding-agent` 的专用浏览器 Agent 应用，但它不重新包装浏览器能力，也不改 `packages/*` 内核。

这里有两个明确前提：

1. 浏览器控制能力直接来自 `agent-browser` CLI。
2. `agent-browser` 在 `octo-browser` 里不是一组自定义 tool，而是一个 skill。模型通过 skill 指引，使用 pi 现有的 `bash` / `read` / `write` / `edit` 等能力去调用 `agent-browser`。

在这个前提下，`octo-browser` 的特殊价值不在“封装浏览器动作”，而在“网站经验闭环”：

1. 用户让 `octo-browser` 操作某个网站，例如“去 `xxxx.com` 修改我的密码”。
2. Agent 首次完成复杂流程后，可以把该网站的经验沉淀成可复用 skill。
3. 下次遇到同网站任务时，优先复用这个网站 skill。
4. 如果执行中发现 skill 已过时、步骤不完整或错误，Agent 要在本次任务内自行修正 skill。

这个闭环参考了 [`apps/octo-browser/docs/hermes_agent_post.md`](/Users/wmeng/work/kkdashu/pi-mono/apps/octo-browser/docs/hermes_agent_post.md) 中 Hermes 的思路，但实现方式会尽量贴合 pi 的哲学：

- 用 skill，而不是重新发明一套浏览器 tool
- 用现有文件工具管理 skill，而不是重写一套 skill 存储协议
- 用扩展做“资源发现、候选匹配、上下文注入”，而不是改 agent 内核

首版范围聚焦：

- 一个可运行的 `octo-browser` CLI
- 一个内置的 `agent-browser` skill
- 一套“每网站一个 skill 目录”的生成、匹配、加载、修补闭环
- 最少必要的测试与检查

首版暂不做：

- 自定义 browser tool 封装
- 自己实现浏览器 session/profile 持久化
- embedding 检索、向量库或远程 skill 同步
- skill 历史版本回滚 UI

## 对现有项目的影响

本方案以“新增 app + 新增扩展/skill”为主，不修改 `packages/coding-agent`、`packages/agent`、`packages/ai` 内核逻辑。

预计会新增或修改：

- [`package.json`](/Users/wmeng/work/kkdashu/pi-mono/package.json)
  - 将 `apps/octo-browser` 纳入 workspace
- `apps/octo-browser/package.json`
  - app 依赖与脚本
- `apps/octo-browser/tsconfig.json`
  - app 本地 TypeScript 配置
- `apps/octo-browser/src/cli.ts`
  - CLI 入口
- `apps/octo-browser/src/runtime.ts`
  - 组装 `createAgentSessionRuntime()` 与 `InteractiveMode`
- `apps/octo-browser/src/extensions/site-skills/index.ts`
  - 负责 skill 路径发现、站点 skill 匹配、上下文注入和行为 guidance
- `apps/octo-browser/src/skills/catalog.ts`
  - 扫描和解析本地生成的网站 skill
- `apps/octo-browser/src/skills/matcher.ts`
  - 基于域名匹配候选网站 skill，并辅助定位任务文档
- `apps/octo-browser/src/skills/template.ts`
  - 生成网站 skill 模板与约束说明
- `apps/octo-browser/skills/agent-browser/SKILL.md`
  - 内置 skill，教模型如何用 `agent-browser`
- `apps/octo-browser/skills/site-skill-authoring/SKILL.md`
  - 内置 skill，教模型如何创建和修补网站 skill
- `apps/octo-browser/test/*.test.ts`
  - 单测，覆盖 catalog / matcher / template / 注入逻辑

运行时会使用一个用户态目录存放网站经验 skill，不进入仓库：

- `~/.pi/agent/octo-browser/skills/generated/`
  - 存放自动沉淀的网站 skill

浏览器 session/profile 持久化不由 `octo-browser` 自己实现，直接依赖 `agent-browser` 已有能力，例如：

- `--session`
- `--session-name`
- `--profile`
- `--auto-connect`

## 实现方案

### 1. 总体架构

`octo-browser` 是一个“专用 pi 运行时 + 专用 skills + 一个轻扩展”：

1. **Runtime 层**
   - 使用 `packages/coding-agent` SDK 启动专用会话
2. **Bundled Skills 层**
   - `agent-browser` skill：告诉模型如何调用 `agent-browser`
   - `site-skill-authoring` skill：告诉模型如何创建、更新网站经验 skill
3. **Extension 层**
   - 做资源发现、候选 skill 匹配、上下文注入、行为 guidance
4. **Generated Skills 层**
   - 用户运行过程中沉淀出来的网站 skill 目录

这里的关键架构决定是：

- 浏览器动作不通过 `pi.registerTool()` 暴露
- 模型直接通过 skill 指令，使用内置 `bash` 调 `agent-browser`
- 网站 skill 的创建和修补直接通过内置 `write` / `edit` 完成

### 2. Runtime 层：保留 pi 原生能力，只换运行时组合

`octo-browser` 本身只负责组装一个带有专用资源的 `pi` 会话，不去重写交互模式。

预期骨架：

```ts
// apps/octo-browser/src/runtime.ts
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  type CreateAgentSessionRuntimeFactory,
  InteractiveMode,
  SessionManager,
} from "@mariozechner/pi-coding-agent";

export async function startOctoBrowser(cwd: string) {
  const createRuntime: CreateAgentSessionRuntimeFactory = async ({
    cwd,
    sessionManager,
    sessionStartEvent,
  }) => {
    const services = await createAgentSessionServices({ cwd });
    return {
      ...(await createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
      })),
      services,
      diagnostics: services.diagnostics,
    };
  };

  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd,
    sessionManager: SessionManager.create(cwd),
  });

  await runtime.session.bindExtensions({});

  const mode = new InteractiveMode(runtime, {
    migratedProviders: [],
    modelFallbackMessage: undefined,
    initialMessage: "",
    initialImages: [],
    initialMessages: [],
  });

  await mode.run();
}
```

首版不改 pi 的基础工具组合，建议保留：

- `bash`
- `read`
- `write`
- `edit`
- `grep`
- `find`
- `ls`

原因很直接：

- `agent-browser` skill 依赖 `bash`
- 网站 skill 的创建/修补依赖 `write` / `edit`
- `read` / `grep` / `find` 可以帮助模型查看本地 skill 内容和仓库文档

### 3. `agent-browser` 作为内置 skill，而不是 browser tool

这是本次需求调整后的核心。

`octo-browser` 不实现：

- `browser_open`
- `browser_click`
- `browser_fill`
- `browser_snapshot`
- 任何其他 `browser_*` 自定义 tool

取而代之的是一个内置 skill，例如：

- `apps/octo-browser/skills/agent-browser/SKILL.md`

这个 skill 的职责是告诉模型：

1. 何时应该使用 `agent-browser`
2. 基础操作顺序是什么
3. 如何在页面变化后重新 snapshot
4. 如何使用 `--session` / `--session-name` / `--profile`
5. 遇到慢页面、弹窗、重定向时的处理原则

这个 skill 会显式引用现有的 [`apps/octo-browser/AGENTS.md`](/Users/wmeng/work/kkdashu/pi-mono/apps/octo-browser/AGENTS.md) 约定，但把它补全成真正可执行的 skill 文档。

此外，需要补一个本地调试友好的 Chrome 启动脚本，并把它纳入 `agent-browser` skill 的推荐流程。

新增内容：

- `apps/octo-browser/skills/agent-browser/scripts/launch_local_chrome.sh`
- `apps/octo-browser/skills/agent-browser/scripts/resolve_browser.sh`

目标行为：

1. 启动本机 Chrome 或 Chromium
2. 显式设置 `--user-data-dir`
3. 显式设置 `--remote-debugging-port`
4. 返回后台 Chrome 进程 PID，方便用户自行关闭
5. 后续 `agent-browser` 不直接新开浏览器，而是通过 `agent-browser --cdp <port>` 连接这个已打开的本机浏览器

脚本预期形态接近：

```bash
#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

browser_path="${1:-}"
if [[ -z "${browser_path}" ]]; then
  browser_path="$("${script_dir}/resolve_browser.sh")"
fi

user_data_dir="${2:-${OCTO_BROWSER_USER_DATA_DIR:-$HOME/.octo/default_user_data}}"
cdp_port="${3:-${OCTO_BROWSER_CDP_PORT:-8888}}"
extra_args="${OCTO_BROWSER_EXTRA_CHROME_ARGS:-}"

mkdir -p "${user_data_dir}"

declare -a command_args
command_args=(
  "${browser_path}"
  "--user-data-dir=${user_data_dir}"
  "--remote-debugging-port=${cdp_port}"
)

if [[ -n "${extra_args}" ]]; then
  read -r -a extra_args_array <<<"${extra_args}"
  command_args+=("${extra_args_array[@]}")
fi

command_args+=("about:blank")

"${command_args[@]}" >/dev/null 2>&1 &
printf '%s\n' "$!"
```

`resolve_browser.sh` 负责按本机常见路径探测可用浏览器。首版至少覆盖 macOS 本机路径，优先查找：

- `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
- `/Applications/Chromium.app/Contents/MacOS/Chromium`
- `Google Chrome for Testing`
- PATH 中可执行的 `google-chrome`、`chromium`、`chromium-browser`

如果找不到浏览器，要明确报错并退出非零状态。

示意内容：

```md
---
name: agent-browser
description: 使用 agent-browser CLI 执行浏览器自动化。适用于打开网页、获取交互元素、点击、填写、等待和截图等任务。
---

# agent-browser

## 何时使用
- 需要控制真实网页
- 需要查找页面元素并进行交互

## 核心流程
1. `agent-browser open <url>`
2. `agent-browser snapshot -i`
3. 使用 `click` / `fill` / `type` / `press`
4. 页面变化后重新 `snapshot -i`
5. 必要时 `screenshot` / `get title` / `get url` / `console`

## 会话建议
- 同一任务尽量复用同一个 `--session`
- 需要长期登录态时，优先使用 `agent-browser` 自带的 `--profile` 或 `--session-name`
```

但针对 `octo-browser` 的本地可视化调试场景，要在 skill 中额外强调：

1. 如果用户需要看到真实浏览器过程，优先启动本机 Chrome 调试实例
2. 启动后统一复用同一个 CDP 端口，例如 `8888`
3. 执行浏览器命令时优先带上 `agent-browser --cdp "$OCTO_BROWSER_CDP_PORT"` 或显式 `--cdp 8888`
4. 不要在已经连着本机调试浏览器的任务里再随意新开独立 profile/无头实例，避免用户看不到真实操作过程

### 4. 网站经验 skill 也是普通 skill 文件

网站经验 skill 同样不通过专用管理 tool 持有，而是标准 skill 目录。

存储目录：

```text
~/.pi/agent/octo-browser/skills/generated/
  site-x-com/
    SKILL.md
    shared/
      auth.md
      navigation.md
    tasks/
      change-password.md
      enable-2fa.md
```

每个网站只有一个顶层 skill 目录，例如：

- `site-x-com`
- `site-github-com`
- `site-vercel-com`

但这不意味着把所有任务操作都堆进 `SKILL.md`。目录职责拆分为：

1. `SKILL.md`
   - 网站 skill 的入口文档
   - 描述何时使用
   - 告诉模型先读哪些共享文档，再读哪些任务文档
2. `shared/`
   - 放网站级共用知识
   - 例如登录规则、导航结构、常见弹窗、风控/验证码、失败信号
3. `tasks/`
   - 每个任务一个独立 Markdown 文档
   - 例如 `change-password.md`、`enable-2fa.md`

这样做的原因：

- 用户心智更自然：一个网站就是一个能力包
- 共用规则可以复用，不必每个任务重复写
- 某个任务变化时，可以只 patch 对应 `tasks/*.md`
- `SKILL.md` 保持轻量，避免变成巨型操作手册

### 5. `site-skill-authoring` 作为第二个内置 skill

为了让模型稳定地“自己创建/修补网站 skill”，首版不走自定义 `octo_skill_manage` tool，而是再提供一个明确的内置 skill：

- `apps/octo-browser/skills/site-skill-authoring/SKILL.md`

这个 skill 的职责是定义：

1. 什么时候值得创建一个网站顶层 skill 目录
2. 共享知识写到 `shared/`，任务步骤写到 `tasks/`
3. `SKILL.md` 只做入口和索引，不承载所有任务细节
4. 什么情况下 patch 共享文档，什么情况下 patch 任务文档
5. 什么情况下为同一网站新增新的任务文档

关键 guidance 参考 Hermes，但改成浏览器场景：

```text
After completing a complex browser workflow on a website, save the approach
as a reusable site skill.

When using an existing site skill and finding it outdated, incomplete, or wrong,
patch it immediately in the same task. Outdated site skills become liabilities.
```

该 skill 还会约束生成格式，例如：

```md
---
name: site-x-com
description: x.com 网站操作 skill。适用于在 x.com 上执行账户设置、内容发布、安全设置等任务。
metadata:
  octo:
    domain: x.com
    updatedAt: 2026-04-15T00:00:00.000Z
---

# x.com

## 何时使用
- 用户要求在 x.com 上执行任意网页操作

## 先读这些共享文档
- `shared/navigation.md`
- `shared/auth.md`

## 常见任务文档
- 修改密码：`tasks/change-password.md`
- 开启 2FA：`tasks/enable-2fa.md`

## 使用规则
- 先读共享文档，再读当前任务最相关的任务文档
- 如果当前任务没有文档，但成功完成了复杂流程，就在 `tasks/` 下新增文档
- 如果共享导航或登录规则变化，优先 patch `shared/` 下文档
```

### 6. 扩展层只负责“发现、匹配、注入”，不负责执行浏览器动作

`apps/octo-browser/src/extensions/site-skills/index.ts` 的职责要刻意保持窄：

1. 通过 `resources_discover` 暴露 skill 路径
2. 在 `before_agent_start` 阶段，根据当前用户请求匹配候选网站 skill
3. 命中时把 skill 内容注入当前对话
4. 在 system prompt 上追加少量行为 guidance，要求模型在成功后创建 skill、在失效时修补 skill

它不做：

- 调 `agent-browser`
- 写 skill 文件
- patch skill 文件

这些都仍由模型通过现有工具完成。

示例：

```ts
pi.on("resources_discover", () => {
  return {
    skillPaths: [
      bundledSkillRoot,
      generatedSkillRoot,
    ],
  };
});

pi.on("before_agent_start", async (event) => {
  const match = await findBestSiteSkill(event.prompt);
  if (!match) return;

  return {
    message: {
      customType: "octo-site-skill",
      content: `Loaded site skill: ${match.name}\n\n${match.content}`,
      display: true,
    },
    systemPrompt:
      event.systemPrompt +
      "\n\nUse agent-browser through its skill. " +
      "If a loaded site skill is outdated, patch it immediately using the file tools.",
  };
});
```

### 7. Skill 召回策略

首版不做 embedding 检索，采用规则型召回。

处理顺序：

1. 从用户输入提取 URL、域名或品牌名
2. 从生成 skill 中找同域名候选
3. 命中单个高置信候选时，直接注入该网站的 `SKILL.md`
4. 由 `SKILL.md` 指引模型继续读取 `shared/` 和 `tasks/` 中的具体文档
5. 若未命中，再依赖 `agent-browser` + `site-skill-authoring` 完成新流程并沉淀

为什么首版不完全依赖模型自己找：

- 网站任务里漏用 skill 的代价很高
- 域名是非常强的规则信号
- 首版优先做稳定、可解释的匹配

但实际运行中已经暴露出一个缺口：用户经常不会直接说域名，而是说网站品牌名，例如“打开小红书网站”“去 GitHub 看一下”。如果 matcher 只认 URL 和域名，就会漏掉已经存在的网站 skill。

因此需要把召回策略从“只认域名”扩展成“域名优先，品牌名/别名兜底”。

修正后的处理顺序：

1. 从用户输入提取 URL 和域名
2. 若命中域名，则直接匹配对应网站 skill
3. 若未提取到域名，则尝试用品牌名/别名匹配网站 skill
4. 命中后继续根据任务文档标题、文件名和已有文档顺序给出推荐任务文档
5. 若仍未命中，再按原流程让模型依赖 `agent-browser` 从零完成并沉淀 skill

别名来源包括：

- frontmatter 中显式声明的 `metadata.octo.aliases`
- `SKILL.md` 一级标题中的品牌名
- 标题或正文中出现的域名
- 技能目录名（例如 `site-xiaohongshu-com`）推导出的域名

同时需要兼容“旧格式”或“模型自行写出的宽松格式”网站 skill。也就是说，catalog 不能只依赖严格的：

- `name: site-<domain>`
- `metadata.octo.domain`

而应当按更宽松的优先级推断网站域名：

1. `metadata.octo.domain`
2. frontmatter `name`
3. 技能目录名
4. 标题中包含的域名

这样即便模型写出了像 `name: xiaohongshu-com` 这样的旧格式 skill，也仍然能被加载和复用。

### 8. 网站 skill 的创建与修补方式

这里的关键变化是：

- 不实现 `octo_skill_manage`
- 直接让模型用 `write` / `edit` 管理 `SKILL.md`

所以 `site-skill-authoring` skill 必须非常明确地告诉模型：

1. 创建网站 skill 时写入哪个目录
2. `SKILL.md`、`shared/`、`tasks/` 的职责分别是什么
3. 修补现有 skill 时优先用 `read` 读原文件，再用 `edit`
4. 创建或修补后要自检 frontmatter、索引和文档结构

建议的创建触发条件：

- 第一次遇到某网站时，创建该网站顶层 skill 目录和 `SKILL.md`
- 当前网站任务涉及 5+ 次浏览器动作，且属于一个可复用的新任务
- 出现了明显可复用的导航路径、校验方法或失败信号

建议的 patch 触发条件：

- 已加载网站 skill，但共享导航/登录行为发生变化，则 patch `shared/*.md`
- 当前任务对应文档存在，但步骤、入口、按钮文案或验证方式变化，则 patch 对应 `tasks/*.md`
- 当前任务没有对应文档，但已成功完成复杂流程，则在 `tasks/` 下新增文档

### 9. 浏览器 session/profile 持久化完全交给 `agent-browser`

`octo-browser` 不实现自己的浏览器状态持久层，也不包装一层 state store。

这里只做两件事：

1. 在 `agent-browser` skill 中明确说明可用能力
2. 在系统 guidance 中建议模型在适当场景下使用这些能力

例如：

- 短任务内复用：`--session`
- 多轮任务或长期登录态：`--session-name`
- 明确 profile 复用：`--profile`
- 需要复用本机已登录 Chrome：`--auto-connect`

也就是说，`octo-browser` 只提供“如何用”的规则，不提供“怎么存”的实现。

### 10. 文件系统约束与最小安全边界

虽然首版不做 Hermes 那种高强度安全扫描，但仍然需要最小边界，至少保证生成 skill 不会写乱。

建议由扩展在 `tool_call` 上做轻量防护：

- 如果模型试图在生成网站 skill 时写出 `generated/` 目录之外，阻止并提示
- 如果生成的网站目录名不符合命名规则，阻止并提示
- 如果 `SKILL.md` 缺少最基本 frontmatter，阻止并提示
- 如果 `shared/` 或 `tasks/` 下写入了非 Markdown 文件，阻止并提示

这里的目的不是彻底接管 skill 生命周期，而是给模型一个“护栏”。

### 11. 首版测试策略

由于不再包装 `agent-browser` CLI，也不新增 browser tool，测试范围可以明显缩小。

首版测试包括：

1. **catalog / matcher 单测**
   - skill 目录扫描
   - frontmatter 解析
   - 按域名匹配候选并定位任务文档
2. **template / validation 单测**
   - 网站目录模板生成
   - skill 名称合法性
   - 路径约束
3. **extension 行为单测**
   - `resources_discover` 是否暴露了 bundled + generated skill 路径
   - `before_agent_start` 是否能对命中 skill 进行注入
4. **兼容性回归单测**
   - 旧格式网站 skill 仍然能被 catalog 加载
   - 用户只说品牌名（例如“小红书”）时，也能命中已有网站 skill

不会测试：

- 真实网站自动化
- 真实 `agent-browser` 行为
- 浏览器 profile/session 持久化

## 关键架构决策

### 决策 1：`agent-browser` 是 skill，不是 tool

原因：

- 这是用户明确要求
- `agent-browser` 本身已经是完整 CLI，不需要再封装一层
- 让模型通过 skill + `bash` 使用 CLI，更符合 pi 的能力边界

### 决策 2：网站经验 skill 走“每网站一个 skill 目录”的普通 skill 结构，不走专用 skill 管理 tool

原因：

- 可以最大化复用 pi 现有 `read` / `write` / `edit` 能力
- 降低 app 自己需要维护的接口数量
- 网站级共享知识和任务级知识可以自然拆分
- `SKILL.md` 保持轻量，只做入口和索引

### 决策 3：扩展只做匹配和注入，不做浏览器动作代理

原因：

- 这样扩展职责最小
- 避免 app 里堆积大量与 `agent-browser` CLI 同步的包装代码
- 后续 `agent-browser` CLI 升级时，app 适配成本最低

### 决策 4：浏览器状态持久化完全依赖 `agent-browser`

原因：

- 用户明确要求不自己实现
- `agent-browser` 已有 `--session` / `--session-name` / `--profile` / `--auto-connect`
- 避免重复实现和状态不一致

### 决策 5：首版仍然做规则型 site-skill 匹配

原因：

- 域名是强信号
- 规则匹配最可解释
- 后续若需要再加语义召回，不影响现有结构

## 分阶段 Todo

### Phase 1：项目脚手架

- [x] 将 `apps/octo-browser` 纳入 workspace
- [x] 创建 `apps/octo-browser/package.json`
- [x] 创建 `apps/octo-browser/tsconfig.json`
- [x] 创建 `apps/octo-browser/src/cli.ts`
- [x] 创建 `apps/octo-browser/src/runtime.ts`

### Phase 2：内置 skills

- [x] 创建 `apps/octo-browser/skills/agent-browser/SKILL.md`
- [x] 创建 `apps/octo-browser/skills/site-skill-authoring/SKILL.md`
- [x] 在 skill 中写清楚 `agent-browser` 使用规范
- [x] 在 skill 中写清楚“每网站一个 skill 目录”的创建/修补模板与规则

### Phase 6：本机 Chrome 调试接入

- [x] 在 `apps/octo-browser/skills/agent-browser/scripts/` 下新增浏览器探测脚本
- [x] 在 `apps/octo-browser/skills/agent-browser/scripts/` 下新增本机 Chrome 启动脚本
- [x] 更新 `apps/octo-browser/skills/agent-browser/SKILL.md`，把“本机 Chrome + CDP 连接”写成推荐调试流程
- [x] 在 skill 中约定 `user-data-dir`、`remote-debugging-port` 和 `agent-browser --cdp <port>` 的使用方式

### Phase 3：站点 skill 发现与注入

- [x] 创建 `apps/octo-browser/src/skills/catalog.ts`
- [x] 创建 `apps/octo-browser/src/skills/matcher.ts`
- [x] 创建 `apps/octo-browser/src/skills/template.ts`
- [x] 创建 `apps/octo-browser/src/extensions/site-skills/index.ts`
- [x] 用 `resources_discover` 暴露 bundled + generated skill 路径
- [x] 用 `before_agent_start` 注入命中的网站 `SKILL.md`
- [x] 增加“成功后创建、过时后修补”的行为 guidance

### Phase 4：最小护栏

- [x] 为网站 skill 目录定义固定路径规则
- [x] 在扩展中增加轻量 `tool_call` 护栏，限制生成 skill 的写入路径
- [x] 校验生成 skill 的最小 frontmatter 结构
- [x] 限制 `shared/` 和 `tasks/` 只允许 Markdown 文档

### Phase 5：测试与验证

- [x] 为 catalog 编写单测
- [x] 为 matcher 编写单测
- [x] 为 template / validation 编写单测
- [x] 为 extension 注入逻辑编写单测
- [x] 运行新增测试
- [x] 运行 `npm run check`

### Phase 7：网站 skill 品牌名匹配与旧格式兼容

- [x] 调整 `catalog.ts`，兼容旧格式 skill 的域名推断
- [x] 为 catalog 增加网站 alias 提取能力
- [x] 调整 `matcher.ts`，增加品牌名/别名匹配兜底逻辑
- [x] 增加回归测试，覆盖“小红书”命中 `site-xiaohongshu-com`
- [x] 运行 `apps/octo-browser` 的相关测试
- [x] 再次运行 `npm run check`

## 风险与待确认项

1. 首版是否只做交互式 CLI，还是同时支持 `-p/--mode rpc`。
2. 网站 skill 已调整为“每域名一个 skill 目录”，目录内再拆 `shared/` 和 `tasks/`。
3. 首版对生成 skill 的护栏是否只做轻量路径/格式约束，还是还要额外限制内容模式。
4. `octo-browser` 是否需要预置默认模型；当前规格还没锁定。
5. 当一个网站下任务文档越来越多时，是否需要额外的任务目录摘要缓存；首版先直接把任务索引维护在 `SKILL.md`。
