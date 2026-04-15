---
name: agent-browser
description: 使用 agent-browser CLI 执行浏览器自动化。适用于打开网页、抓取交互元素、点击、填写、等待、截图和调试网页流程。
---

# agent-browser

在需要真实控制网页时使用这个 skill。

## 核心原则

- 优先使用 `agent-browser`，不要临时拼凑浏览器自动化方案。
- 使用 `bash` 调用 `agent-browser`。
- 页面发生变化后，要重新 `agent-browser snapshot -i`。
- 在 `octo-browser` 里，如果用户希望看到实际发生的情况，优先连接到本机可见的 Chrome，而不是开一个自己看不到的浏览器实例。

## 推荐调试流程

如果用户希望观察真实浏览器行为，先启动本机 Chrome 调试实例：

```bash
bash apps/octo-browser/skills/agent-browser/scripts/launch_local_chrome.sh
```

默认约定：

- `user-data-dir`: `~/.octo/default_user_data`
- `remote-debugging-port`: `8888`
- 可通过 `OCTO_BROWSER_USER_DATA_DIR` 覆盖用户数据目录
- 可通过 `OCTO_BROWSER_CDP_PORT` 覆盖 CDP 端口
- 可通过 `OCTO_BROWSER_EXTRA_CHROME_ARGS` 传递额外 Chrome 参数

脚本会输出 Chrome 后台进程 PID，便于用户后续关闭或排查。

启动后，优先通过 `agent-browser --cdp <port>` 连接该浏览器执行所有动作，例如：

```bash
agent-browser --cdp 8888 open https://example.com
agent-browser --cdp 8888 snapshot -i
agent-browser --cdp 8888 click @e3
agent-browser --cdp 8888 fill @e6 "user@example.com"
agent-browser --cdp 8888 press Enter
```

如果当前任务已经在使用一个本机调试浏览器，就持续复用同一个 CDP 端口，不要中途改成别的会话方式。

## 基础流程

1. 如需可视化调试，先启动本机 Chrome 调试实例
2. `agent-browser --cdp <port> open <url>`
3. `agent-browser --cdp <port> snapshot -i`
4. 使用 `click`、`fill`、`type`、`press`
5. 页面变化后重新 `snapshot -i`
6. 必要时使用 `get title`、`get url`、`screenshot`、`console`、`errors`

## 常用命令

```bash
agent-browser --cdp 8888 open https://example.com
agent-browser --cdp 8888 snapshot -i
agent-browser --cdp 8888 click @e3
agent-browser --cdp 8888 fill @e6 "user@example.com"
agent-browser --cdp 8888 press Enter
agent-browser --cdp 8888 wait 1000
agent-browser --cdp 8888 get url
agent-browser --cdp 8888 screenshot /tmp/page.png
```

## 会话建议

- 当前任务需要可视化调试时，优先使用 `--cdp <port>` 连接你自己能看到的本机 Chrome
- 单次任务中，如果不走 `--cdp`，尽量复用同一个 `--session`
- 多轮任务或需要长期登录态时，优先考虑 `--session-name`
- 需要指定持久目录时，使用 `--profile`
- 需要复用一个已经运行中的 Chrome，但端口不明确时，可考虑 `--auto-connect`

## eval 命令说明

`agent-browser eval` 用于执行 JavaScript 代码，对复杂页面结构（如小程序嵌套页面）或需要精确定位元素时特别有用。

### 重要：eval 返回 null 不代表失败

使用 `eval` 执行 `HTMLElement.click()` 等方法时，返回值通常是 `null`，但这**不代表点击失败**。

示例：
```bash
# 小红书点赞（点击成功，但返回 null）
agent-browser --cdp 8888 eval "document.querySelector('#noteContainer .like-wrapper.like-active').click()"
# 输出: null

# 验证方法：检查页面状态变化
agent-browser --cdp 8888 screenshot /tmp/like_check.png
agent-browser --cdp 8888 eval "document.querySelector('[class*=\"like\"]')?.className"
```

**判断成功的依据**：
- 截图显示按钮状态变化（如心形图标变为实心/空心）
- 页面 URL 变化
- 元素 class 变化（如 `like-active` 出现或消失）
- 页面内容更新

不要仅凭 `null` 返回值判定失败。

## 调试建议

- 页面慢时，显式 `wait`
- 如果元素找不到，先重新 `snapshot -i`
- 遇到异常重定向、JS 报错或权限问题时，查看 `console` 和 `errors`
- 重要步骤后可截图留证
- 如果当前是本机可见 Chrome 调试流程，保持浏览器窗口前台可见，方便用户确认实际行为
- 如果网页依赖现有登录态或扩展，优先通过启动脚本的 `user-data-dir` 保持连续状态，而不是频繁切换 profile

## 不要做的事

- 不要假设页面结构没有变化
- 不要在没有重新 snapshot 的情况下盲目复用旧的 `@e*` 引用
- 不要把所有浏览器命令挤进一条超长 shell 命令里，分步骤执行更稳
- 不要在已经使用 `--cdp <port>` 连接本机 Chrome 的同一任务中，再随意切回另外一个无头或隐藏实例
- 不要修改用户的日常 Chrome 默认数据目录；调试时优先使用约定好的独立 `user-data-dir`
