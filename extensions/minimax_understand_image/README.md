# MiniMax Understand Image Extension

这个扩展用于在当前模型不支持图片输入时，先调用 MiniMax 的 `understand_image` MCP，把图片转换成文本上下文，再把文本交给当前模型继续处理。

它的设计目标是：

- 继续使用 `MiniMax-M2.7` 这类文本模型
- 不修改 `pi-mono` 的任何 `packages/*` 源码
- 只在当前模型 `input` 不包含 `image` 时介入

## 前提

需要有：

- `uvx`
- MiniMax 的 `MINIMAX_API_KEY`
- 可运行的 `minimax-coding-plan-mcp`

## 安装依赖

在扩展目录执行：

```bash
cd extensions/minimax_understand_image
npm install
```

## 环境变量

最少需要：

```bash
export MINIMAX_API_KEY=your_key_here
```

可选：

```bash
export MINIMAX_API_HOST=https://api.minimaxi.com
export MINIMAX_MCP_COMMAND=uvx
```

当前实现默认执行：

```bash
uvx minimax-coding-plan-mcp -y
```

## 使用方式

在项目根目录启动：

```bash
pi -e ./extensions/minimax_understand_image
```

然后：

1. 选择 `MiniMax-M2.7` 或其他不支持图片输入的模型
2. 粘贴图片、拖拽图片，或通过附件方式发送图片
3. 输入你的问题

扩展会：

1. 检测当前模型是否支持图片
2. 若不支持，则处理两类输入：
   - 真正的图片附件
   - 文本中的本地图片路径，例如粘贴图片后自动插入的 `/var/folders/...png`
3. 对附件会先写入临时文件
4. 调用 MiniMax MCP 的 `understand_image`
5. 将识别结果拼接成文本
6. 清空图片附件，并把文本请求继续交给当前模型

## 行为说明

- 当前模型支持图片时，扩展不会介入
- 如果消息文本中包含本地图片文件路径，扩展会把这些路径当作图片输入处理
- `MINIMAX_API_KEY` 未设置时，扩展会跳过预处理并给出 warning
- MCP 调用失败时，扩展会 fail-open，不阻断主对话
- 图片会先写到系统临时目录，请求结束后立即删除

## 限制

- 当前实现依赖 `understand_image` MCP 工具存在
- 当前实现按顺序逐张处理图片，不做并发
- 当前实现不会自动切换到视觉模型
