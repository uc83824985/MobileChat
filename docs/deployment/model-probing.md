# 模型探测

MobileChat 使用独立脚本探测中转站里某个模型 ID 是否真实可用。探测的判定标准是：具体模型 + 具体协议 + 具体 endpoint 能接受一次最小文本请求。

## 副作用与成本

- 不存在模型、协议不支持、路由错误等失败请求通常不会产生输出 token，但会消耗一次网关请求，并可能计入限流或风控统计。
- 探测成功的请求会产生少量 input/output token。默认 prompt 是 `ping`，输出上限是 4 tokens。
- `GET /models` 只作为辅助信息，不保证完整、准确或有权限。
- 默认不探测联网工具、多模态、长上下文等能力，避免额外成本和协议差异。
- 建议默认按模型族分组探测，例如只探测 `grok` 或 `gemini`；全量探测适合手动批量验证。
- 默认单请求超时是 3000 ms；遇到慢网关可以手动提高 `--timeout-ms`，但不建议默认过长。

## 探测规则

规则文件位于：

```text
model-probe-rules/mainstream.json
```

规则不预生成候选 txt。脚本运行时读取规则并展开候选模型。

核心表达式：

```json
{
  "template": "gpt-{version}{arg1}",
  "dimensions": {
    "version": { "type": "minorTenths", "majors": ["5"], "from": 4, "to": 6 },
    "arg1": ["", "mini"]
  }
}
```

上面会展开为：

```text
gpt-5.4
gpt-5.4-mini
gpt-5.5
gpt-5.5-mini
gpt-5.6
gpt-5.6-mini
```

`from` / `to` 限制小版本区间，合法范围固定为 0~9。小版本为 0 时只输出大版本本身，例如 `grok-4`、`gemini-3`，不会输出 `grok-4.0`、`gemini-3.0`。留空时默认是 0~9，但不建议大分组默认全量探测。

需要 `claude-opus-4-8` 这类横线小版本时，可以在版本维度里配置 `"separator": "-"`，而不是把 `4-8` 写死在模板里。

`arg1` / `arg2` / ... 表示按顺序拼接的后缀段。空字符串表示该段不追加内容；非空词条会自动补 `-`，所以配置写 `mini` 会生成 `-mini`，配置写 `flash-lite` 会生成 `-flash-lite`。旧配置中已经带前导 `-` 的词条会先归一化，不会生成双横线。

## 运行

推荐用环境变量传入 API Key，避免写入命令历史：

```powershell
$env:MOBILECHAT_PROBE_API_KEY="sk-..."
npm run models:probe -- --base-url https://api.mnapi.com --rules-file .\model-probe-rules\mainstream.json --group grok --protocol both
```

保存报告：

```powershell
npm run models:probe -- --base-url https://api.mnapi.com --rules-file .\model-probe-rules\mainstream.json --group gemini --output artifacts\model-probe.json --markdown artifacts\model-probe.md
```

如果中转站不接受自动补 `/v1`，可以显式指定：

```powershell
npm run models:probe -- --base-url https://api.mnapi.com/v1 --route-mode as-is --rules-file .\model-probe-rules\mainstream.json --group grok
```

## 当前模型族

- `gpt`：GPT 5.x、GPT 5.x mini/pro、Sol/Terra/Luna。
- `gpt-codex`：GPT 5.x Codex high/medium/low。
- `anthropic`：Claude 当前主流固定规则。
- `gemini`：Gemini 3.x 的 pro / flash / flash-lite，后接 preview 和 thinking 主流后缀段。
- `grok`：Grok 4~4.3 与 fast / reasoning / fast-reasoning / thinking 后缀组合；不默认探测 `:origin` 等特殊别名。
- `deepseek`：DeepSeek v4 主流显式别名。
- `qwen`：Qwen 3.x max/plus/flash，并通过版本维度保留 coder 后缀规则。
- `kimi`：Kimi K2.x coding 系列，并通过版本维度保留 K3 主版本规则。
- `glm`：GLM 4.x / 5.x 主流文本后缀。

## 设置页 UI

设置页内置“模型探测”工作台：

1. 用户维护探测模型族，而不是维护预生成候选模型 txt。
2. 规则只负责生成可能有效的模型 ID，不绑定助手、模型配置或 API Key。
3. 每条规则可同时启用；规则内部通过表单维护版本区间和后缀段列表，不直接暴露原始 JSON、模板或规则说明。
4. 模型族本身没有启用状态；当前选择哪个模型族，就探测哪个模型族。
5. 实际探测直接复用“连接与模型”区域当前选中的连接，使用该连接的 Base URL、API Key 和协议发起最小文本请求。
6. 结果列表只显示成功项；失败项只进入完成统计和状态说明，避免噪声。
7. 设置页探测并发固定为 8，不暴露为普通配置项。
8. 成功项可以一键创建到所选连接的模型列表；不会自动绑定到任何助手，也不会修改当前对话默认模型。

探测结果不自动写入模型配置，避免把偶发成功、错误协议或临时别名误保存为长期配置。
