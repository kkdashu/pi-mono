# MiniMax 图片理解扩展方案

## 问题说明

当前项目里，pi 本身已经支持用户在 TUI 中粘贴图片、拖拽图片和在 prompt 中附带 `images`。但是当当前模型是 `MiniMax-M2.7` / `MiniMax-M2.7-highspeed` 这类通过 Anthropic 兼容接口接入的文本模型时，图片内容不会真正到达模型。

现有链路的行为是：

- `packages/coding-agent` 会把用户输入和图片附件组装为 user message
- `packages/ai` 中的模型元数据将 MiniMax M2.7 标记为 `input: ["text"]`
- `packages/ai/src/providers/anthropic.ts` 会在模型不支持 `image` 输入时过滤掉 `type === "image"` 的 block

因此，当前不是 “图片上传失败”，而是 “图片输入被按模型能力正确忽略”。在不改 MiniMax Anthropic 兼容 provider 行为的前提下，要让 agent 在使用 `MiniMax-M2.7` 时“支持图片”，唯一合理方案是：

1. 在扩展层检测当前模型是否支持图片
2. 若不支持，调用外部图片理解能力
3. 将图片理解结果转换为文本并拼接到用户消息
4. 清空图片附件，让后续模型调用保持纯文本

本次方案使用 MiniMax 的 `understand_image` MCP 工具完成图片理解。

根据用户要求，本次实现不修改 `pi-mono` 的 `packages/` 下任何代码，只在项目根目录新增一个扩展目录：

- `extensions/minimax_understand_image/`

## 对现有项目的影响

本方案不修改 `packages/agent` 的核心 agent loop，也不修改 `packages/ai` 中 Anthropic provider 的图片过滤逻辑，也不修改 `packages/coding-agent` 的源码。改动只集中在项目根目录新增的本地扩展。

受影响的目录如下：

- `extensions/minimax_understand_image/`
  - 实现完整扩展逻辑
  - 内部接入 `@modelcontextprotocol/sdk/client`
  - 使用 stdio 方式连接 `uvx minimax-coding-plan-mcp -y`
  - 负责 input event 拦截、图片理解、文本拼接、错误处理、会话关闭清理
- `extensions/minimax_understand_image/package.json`
  - 仅为该本地扩展声明依赖
- `extensions/minimax_understand_image/README.md`
  - 说明如何安装依赖、如何加载扩展、需要的环境变量、适用场景与限制

可能新增的环境变量：

- `MINIMAX_API_KEY`
- `MINIMAX_API_HOST`，默认 `https://api.minimaxi.com`
- `MINIMAX_MCP_COMMAND`，默认 `uvx`
- `MINIMAX_MCP_ARGS` 暂不做自由文本配置，先在扩展实现中固定为 `["minimax-coding-plan-mcp", "-y"]`

## 实现方案

### 1. 仅通过本地扩展实现 input 拦截

扩展目录建议为：

- `extensions/minimax_understand_image/`

扩展入口在：

- `extensions/minimax_understand_image/index.ts`

职责：

- 在 `pi.on("input")` 中拦截用户输入
- 当且仅当满足以下条件时执行图片理解：
  - `event.source !== "extension"`，避免扩展自己注入消息时再次触发
  - `event.images?.length > 0`
  - `ctx.model` 存在
  - `ctx.model.input` 不包含 `"image"`
- 若当前模型支持图片，则直接返回 `{ action: "continue" }`
- 若当前模型不支持图片，则逐张调用 `understandImage(...)`
- 将识别结果拼成结构化文本，返回：
  - `{ action: "transform", text: 新文本, images: [] }`

这里返回 `images: []` 而不是省略 `images`，原因是 `emitInput()` 中省略 `images` 会保留原始图片；只有显式返回空数组，才会真正清掉附件。

### 2. 图片理解后的文本格式

为了让主模型获得稳定、可复用的上下文，转换后的文本不直接覆盖用户原始问题，而是在原始文本前后追加一段结构化说明。

建议格式：

```text
[Image preprocessing]
The current model does not support direct image input.
The following image understanding results were generated before this request:

Image 1:
<understand_image 返回内容>

Image 2:
<understand_image 返回内容>

[User request]
<用户原始文本>
```

如用户原始文本为空，也应保留一个最小占位，例如：

```text
[User request]
Please use the image understanding results above to continue.
```

这样可以避免只发送图片分析结果而没有显式用户意图。

### 3. MiniMax MCP 客户端放在扩展目录内部

新增扩展目录：

- `extensions/minimax_understand_image/`

目录结构预计为：

- `extensions/minimax_understand_image/index.ts`
- `extensions/minimax_understand_image/mcp-client.ts`
- `extensions/minimax_understand_image/README.md`
- `extensions/minimax_understand_image/package.json`

其中：

- `index.ts`
  - 从 `@mariozechner/pi-coding-agent` 导入扩展 API
  - 创建 `MiniMaxUnderstandImageMcpClient`
  - 注册 `input` 事件处理
  - 在 `session_shutdown` 时关闭 MCP transport
- `mcp-client.ts`
  - 基于你提供的参考代码实现
  - 使用 `@modelcontextprotocol/sdk/client`
  - 使用 `StdioClientTransport`
  - 校验 `understand_image` 工具是否存在
  - 提供：
    - `resolveMiniMaxUnderstandImageMcpConfig()`
    - `buildUnderstandImageToolArguments()`
    - `extractToolTextContent()`
    - `MiniMaxUnderstandImageMcpClient`
- `README.md`
  - 写清楚如何安装 `uvx`
  - 如何设置 `MINIMAX_API_KEY`
  - 如何在项目根目录通过 `pi -e ./extensions/minimax_understand_image` 加载

`package.json` 仅为该本地扩展声明依赖，不把 MCP SDK 加进 `packages/coding-agent` 主包依赖，避免污染核心 runtime。

### 4. 错误处理策略

扩展需要尽量 fail-open，避免图片理解能力不可用时直接把主对话打死。

建议行为：

- 若没有图片：`continue`
- 若当前模型支持图片：`continue`
- 若 `MINIMAX_API_KEY` 未设置：
  - 不抛错中断整个 prompt
  - 使用 `ctx.ui.notify(...)` 提示一次
  - 返回 `continue`
- 若 MCP 连接失败或 `understand_image` 失败：
  - 记录 warning
  - 在有 UI 时提示用户图片预处理失败
  - 返回 `continue`

这样即使扩展不可用，用户仍然可以继续使用 MiniMax 文本能力，只是这轮图片不会被解释成文字。

如果后续希望更严格，也可以新增可选项支持 fail-closed，但第一版不做。

### 5. 验证方案

本方案是纯本地扩展实现，不改 `packages/` 源码，因此第一版不在 `pi-mono` 仓库内新增测试文件。

验证方式以手动集成为主：

- 在项目根目录安装扩展依赖
- 用 `pi -e ./extensions/minimax_understand_image` 启动
- 选择 `MiniMax-M2.7`
- 附加图片并输入文本问题
- 确认模型收到的是扩展拼接后的文本，而不是原始图片 block
- 确认当前模型若本身支持图片，则扩展不介入

如果后续需要把这套逻辑沉淀成可复用能力，再考虑把它上移到 `packages/coding-agent` 并补正式测试。

### 6. 文档方案

文档只放在扩展目录内部：

- `extensions/minimax_understand_image/README.md`
  - 提供最短启动命令
  - 解释它只在当前模型不支持图片时才会介入
  - 说明需要安装的依赖和环境变量

## 文件改动计划

预计新增以下文件：

- `extensions/minimax_understand_image/index.ts`
- `extensions/minimax_understand_image/mcp-client.ts`
- `extensions/minimax_understand_image/package.json`
- `extensions/minimax_understand_image/README.md`

## 不做的内容

第一版明确不做以下内容：

- 不改 `packages/ai` 的 MiniMax 模型能力声明
- 不伪造 `MiniMax-M2.7` 为视觉模型
- 不改 Anthropic provider 的 image 过滤逻辑
- 不改 `packages/coding-agent`、`packages/agent` 或其他 `packages/` 下的任何源码
- 不自动切换到其他视觉模型
- 不增加新的内建命令或 UI 面板
- 不在 `pi-mono` 仓库内新增测试文件

## Todo List

- [ ] 在项目根目录新增 `extensions/minimax_understand_image/`
- [ ] 在扩展中实现 MiniMax `understand_image` MCP 客户端
- [ ] 在扩展中实现 input event 图片转文本逻辑
- [ ] 在扩展中实现会话关闭时的 MCP 连接清理
- [ ] 编写扩展目录内 `README.md`
- [ ] 安装扩展依赖并做手动验证
