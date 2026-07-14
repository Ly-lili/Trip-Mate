# TripMate Agent 项目讲解

一份面向工程师与产品同学的完整说明文档：从「这是什么」到「每一层为什么这样做」，并对所有关键专业名词逐一解释。

---

## 1. 项目是什么

**TripMate** 是一个**单 Agent（Single-Agent）** 形态的旅行规划助手。它接受用户的多轮中文对话输入（出发地、目的地、预算、人数、日期、口味偏好等），调用真实的工具（高德地图、12306 火车票、变飞航班、必应搜索等）拿到第一手数据，最终生成一份**结构化、按天展开**的行程方案，并能导出为 PDF。

它具备两种入口：
- **CLI**（[src/index.ts](src/index.ts)）：在终端里像 ChatGPT 一样对话；
- **Web UI**（[app/](app/) + [components/ChatUI.tsx](components/ChatUI.tsx)）：基于 Next.js 15 的网页前端，通过 SSE 流式输出。

底层用的是 **DeepSeek**（通过 OpenAI 兼容协议调用）作为大模型，**MCP（Model Context Protocol，模型上下文协议）** 作为工具接入标准，**SQLite** 作为本地持久化层。

---

## 2. 它能做到什么

| 能力 | 体现 |
|---|---|
| 多轮自然语言对话 | 一边追问一边规划，缺关键信息就主动澄清 |
| 调用真实数据源 | 火车票、机票、地图、天气等通过 MCP 工具拿到 |
| 流式输出 | 边想边写，不等待整段生成 |
| 长期记忆 | 跨会话记住"用户吃素""不坐红眼航班"等稳定偏好 |
| 上下文压缩 | 长对话不会超 token；旧消息会被自动总结 |
| 成本/性能可观测 | 每轮 token 消耗、缓存命中率、估算费用、工具时延都被记录 |
| 容错 | 工具超时、断流、外部服务挂掉时不会卡死整个对话 |
| PDF 导出 | 把最终行程导出成可分享的 PDF 文档 |

---

## 3. 总体架构

```
            ┌─────────────────────────────────────────────┐
            │           入口层 (CLI / Next.js Web)         │
            └──────────────────┬──────────────────────────┘
                               │ user message
                ┌──────────────▼──────────────┐
                │           Agent             │  ← 单 Agent 循环
                │     runtime.ts (核心)        │     流式 + 工具调度
                └────┬───────────────┬────────┘
                     │               │
        ┌────────────▼───┐    ┌──────▼─────────┐
        │   LLMClient    │    │  ToolRegistry  │
        │ DeepSeek 调用   │    │ 注册/路由/熔断   │
        └────────┬───────┘    └────┬───────────┘
                 │                 │
                 ▼          ┌──────┴─────────┐
        ┌──────────────┐    ▼                ▼
        │  OpenAI SDK  │  ┌─────────────┐  ┌──────────────┐
        │ chat.stream  │  │ MemoryTool  │  │ MCPProvider  │
        └──────────────┘  │ (本地记忆)   │  │ (12306/amap…)│
                          └─────────────┘  └──────────────┘

   ┌───────────────┐  ┌──────────────┐  ┌─────────────────┐
   │ SessionStore  │  │  Compactor   │  │  Metrics+Logger │
   │ + SQLite 后端 │  │  长对话压缩  │  │  token/费用/延时 │
   └───────────────┘  └──────────────┘  └─────────────────┘
```

**「单 Agent」的含义**：只有一个 LLM 驱动的主循环负责"下一步该做什么"。所有的工具（MCP server、记忆工具）都是被动端点（passive endpoints），自身没有"自主性"。这也是 Claude Code、Cursor 等产品采用的工程主流形态——简单、可控、易于调试。

---

## 4. 模块组成与职责

### 4.1 入口层

| 文件 | 作用 |
|---|---|
| [src/index.ts](src/index.ts) | CLI 入口，负责 readline 交互、session 命令、PDF 导出指令 |
| [app/page.tsx](app/page.tsx) + [components/ChatUI.tsx](components/ChatUI.tsx) | Next.js 网页 UI |
| [app/api/chat/route.ts](app/api/chat/route.ts) | Web API：把 Agent 的事件流封成 SSE 推给浏览器 |
| [lib/agent-singleton.ts](lib/agent-singleton.ts) | 单例 Runtime；保证整个 Node 进程只有一份 SQLite/MCP 连接 |

### 4.2 Agent 核心

| 文件 | 作用 |
|---|---|
| [src/agent/runtime.ts](src/agent/runtime.ts) | **整个项目的心脏**：流式工具调用循环（streaming tool-use loop） |
| [src/agent/types.ts](src/agent/types.ts) | 定义 `ToolProvider` / `TurnEvent` / `StopReason` 等类型契约 |

`Agent.turn()` 是一个 **AsyncGenerator（异步生成器）**：每读到一段文本/一次工具调用/一次工具结果都会 `yield` 一个事件，CLI 和 Web 都通过 `for await` 消费。

### 4.3 LLM 抽象

| 文件 | 作用 |
|---|---|
| [src/llm/client.ts](src/llm/client.ts) | 包装 OpenAI SDK，暴露 `main` / `fast` 两档模型路由 |

支持通过环境变量 `MAIN_MODEL` / `FAST_MODEL` / `DEEPSEEK_BASE_URL` 替换模型与端点。

### 4.4 工具系统

| 文件 | 作用 |
|---|---|
| [src/tools/registry.ts](src/tools/registry.ts) | 工具注册表：名字防冲突、超时、重试、熔断、指标 |
| [src/tools/mcp.ts](src/tools/mcp.ts) | MCP 客户端封装：支持 `stdio` / `http` / `sse` 三种传输 |
| [src/tools/memory-tool.ts](src/tools/memory-tool.ts) | 长期记忆工具：`memory__remember` / `__recall` / `__forget` |
| [src/tools/health.ts](src/tools/health.ts) | 熔断器（Circuit Breaker）+ 指数退避重试（exponential backoff retry） |

`MCP_SERVERS` 在 [src/index.ts:19](src/index.ts:19) 与 [lib/agent-singleton.ts:16](lib/agent-singleton.ts:16) 中静态配置，包含 12306、高德、必应、Rollinggo、变飞航班五个外部 MCP 服务。

### 4.5 会话与持久化

| 文件 | 作用 |
|---|---|
| [src/session/store.ts](src/session/store.ts) | `SessionStore`：内存缓存 + 可插拔 backend |
| [src/session/sqlite-backend.ts](src/session/sqlite-backend.ts) | SQLite 后端（同时实现 Session/Preference/Memory 三个接口） |
| [src/session/memory-store.ts](src/session/memory-store.ts) | 长期记忆数据接口与内存版默认实现 |
| [src/session/compactor.ts](src/session/compactor.ts) | **上下文压缩器（Context Compactor）**：长对话总结 |

### 4.6 领域模型

| 文件 | 作用 |
|---|---|
| [src/domain.ts](src/domain.ts) | `TripConstraints`（硬约束/软偏好）、`Itinerary`（按天行程）等强类型 |

### 4.7 可观测性

| 文件 | 作用 |
|---|---|
| [src/observability.ts](src/observability.ts) | JSON 结构化 Logger + `Metrics`（token、缓存命中率、估算费用、工具调用时延） |

### 4.8 PDF 导出

| 文件 | 作用 |
|---|---|
| [src/export/index.ts](src/export/index.ts) | 编排：先尝试结构化抽取，失败则回退到原文渲染 |
| [src/export/extract.ts](src/export/extract.ts) | 用 fast 模型把会话提取成 `Itinerary` 结构 |
| [src/export/pdf.ts](src/export/pdf.ts) | 用 PDFKit 渲染 |

---

## 5. 主流程（核心逻辑）

下面这一段是整个系统最值得理解的部分，对应 [src/agent/runtime.ts:72](src/agent/runtime.ts:72) 中的 `Agent.turn()`：

```
1. 取/建会话（SessionStore.getOrCreate）
2. （仅首次）冻结一份长期记忆快照 memorySnapshot
3. 把用户消息 push 到 session.messages
4. 进入 for 循环（最多 maxIterations=10 次）：
   a. 拼出本次请求的 messages：
      [system] + [memory pair] + [compaction pair] + [recent messages]
   b. llm.openai.chat.completions.stream(...) → 流式拉取
   c. 边收边 yield 'text' 事件（实时打字效果）
   d. 流结束后拿 finalChatCompletion()，记录 usage（tokens、cache hit）
   e. 把 assistant 消息（含 reasoning_content、tool_calls）push 回历史
   f. 如果没有 tool_calls → yield 'done'，退出
   g. 如果有 tool_calls → Promise.all 并发执行所有工具
      • 每个工具单独超时（默认 30s）
      • 失败按 safety 等级决定重试次数
      • 熔断器记录健康度
   h. 把 tool 结果 push 回历史，进入下一次循环
5. 触发 fireCompaction（不阻塞响应）
```

**关键设计点**：

### 5.1 流式（Streaming）
`chat.completions.stream()` 返回一个异步迭代器，token-level 的 delta 一到就 `yield`。这避免了"几十秒只看到光标闪"，也避免了模型生成长输出时被 HTTP 超时切断。

### 5.2 推理内容（Reasoning Content）
DeepSeek 的 reasoning 模型（带 `pro`/`reasoner` 名字的）会先"想"再"答"，思考链通过 `delta.reasoning_content` 流出。代码里有专门的 quirk 处理（[runtime.ts:182](src/agent/runtime.ts:182)）：OpenAI SDK 的 helper 不会自动把 reasoning 累计回 `finalChatCompletion()`，所以我们手动累积 + 在下一轮请求时再回传，否则 DeepSeek 会 400。

### 5.3 并行工具调用（Parallel Tool Use）
一个 assistant turn 可能要求并发查 N 个城市的天气。`Promise.all` 让它们一起跑而不是串行，把延迟从 N×T 压成 max(T)。

### 5.4 字节级稳定的请求前缀（Byte-stable Prefix）
DeepSeek 的服务端有**自动前缀缓存（Prompt Cache）**：相同的请求前缀按 token 计费会便宜 80% 左右。但只要前缀里有一个字节不一样，缓存就 miss。所以代码里做了几件事：
- 把 system prompt 单独拼，不做任何动态注入；
- `memorySnapshot` 在会话开始时**冻结**，session 中间不变（[runtime.ts:86](src/agent/runtime.ts:86)）；
- 工具列表按字典序排序后再发（[registry.ts:74](src/tools/registry.ts:74)）；
- 长期记忆 / 压缩摘要都以"虚拟 user/assistant 对"的形式插入，而不是塞进 system，避免 system 被高频改动。

这些都是为了让 prefix 多轮之间字节相同，从而命中缓存。

### 5.5 上下文压缩（Context Compaction）
当某轮的 `prompt_tokens >= 75000` 时，[Compactor](src/session/compactor.ts) 会被异步触发：用 `fast` 模型把"除最近 6 条之外的旧消息"总结成一段结构化 JSON（user_constraints / decisions_locked / tool_findings…），存进 `session.compaction.summary`。下一轮请求时，旧消息被替换成这段摘要 + 一对虚拟 user/assistant 对话。
- **不阻塞用户响应**：`fireCompaction` 是 fire-and-forget；
- **本会话下一轮才生效**：避免和当前流冲突；
- **只升不降**：摘要会跟新摘要合并，旧事实不丢。

### 5.6 长期记忆（Long-term Memory）
[MemoryToolProvider](src/tools/memory-tool.ts) 暴露三个工具给模型：
- `memory__remember`：写入一条原子事实（"用户吃素"）；
- `memory__recall`：列出已存事实；
- `memory__forget`：按 ID 删除。

这些事实存在 SQLite 的 `memories` 表，**按 user 隔离**，跨 session 持久。每个新 session 启动时会自动把 top-N 条注入到 prompt 头部（[runtime.ts:291](src/agent/runtime.ts:291)），下次模型直接看到，不再追问。

### 5.7 熔断器（Circuit Breaker）+ 重试（Retry）
[CircuitBreaker](src/tools/health.ts) 实现**两态熔断**：
- `closed`（正常）：放行调用；
- `open`（熔断）：在窗口期内（默认 30s 起步，指数退避封顶 5 min）所有调用直接 fail-fast 返回错误信息给模型。
- 熔断打开时，[ToolRegistry.openaiTools()](src/tools/registry.ts:62) 会把该 provider 的工具从模型可见列表里**临时移除**——避免模型反复尝试调用一个已知挂掉的工具。

`withRetry` 实现**指数退避**重试，并按 `safety` 字段区分：
- `read`（默认）：最多 3 次；
- `idempotent_write`：最多 2 次；
- `write`：1 次（不重试，避免重复副作用）。

### 5.8 Tool Safety 分级
[ToolDefinition.safety](src/agent/types.ts:10) 字段告诉系统该工具的副作用语义。这是工程里很常见的概念：纯读可以放心重试，幂等写可以重试，非幂等写不能重试（否则可能"下两次单"）。

---

## 6. 数据流：一条用户消息的生命周期

以"我五一想从北京去成都，预算 5000，2 个人"为例：

```
浏览器输入
   │
   ▼
POST /api/chat (Next.js Route)        [app/api/chat/route.ts]
   │
   ▼
agent.turn(sessionId, message)         [src/agent/runtime.ts]
   │
   ├─ 拼请求：system + 记忆快照 + 历史
   │
   ├─ stream → DeepSeek                [src/llm/client.ts]
   │     ↓ 边返回 token
   │     yield {type:'text', text:'…'}
   │
   ├─ 模型决定调 12306__search_train
   │     yield {type:'tool_call', name:'12306__search_train', input:{...}}
   │     │
   │     ▼
   │  ToolRegistry.execute()           [src/tools/registry.ts]
   │     ├─ 熔断器检查
   │     ├─ withTimeout(30s)
   │     ├─ withRetry(read=3次, 指数退避)
   │     ▼
   │  MCPToolProvider.callTool()       [src/tools/mcp.ts]
   │     ▼
   │  HTTP/stdio → 远端 MCP server → 返回车次列表
   │     ▼
   │  yield {type:'tool_result', content:'…', latencyMs:842}
   │
   ├─ 进入下一轮：把工具结果 push 进历史，再问 LLM
   │
   ├─ 模型可能再调 amap / variflight…（并发）
   │
   └─ 最终输出按天行程，yield {type:'done', reason:'end_turn'}

浏览器侧（SSE 监听）实时渲染每一个事件 → 用户看到打字机 + 工具进度
```

每一步的 token 用量和工具时延都被 `Metrics` 记下，`stats` 命令可以查看。

---

## 7. 持久化模型

SQLite 文件默认放在 `~/.tripmate/tripmate.db`，三张表：

```sql
sessions     (id, user_id, data JSON, created_at, updated_at)
preferences  (user_id, data JSON, updated_at)
memories     (id, user_id, content, tags, created_at)
```

- `sessions.data` 是把 `Session` 整体 JSON 序列化（messages、constraints、itinerary、compaction、memorySnapshot 一起）；
- 启用了 **WAL 模式（Write-Ahead Logging）** 和 `synchronous=NORMAL`，写性能更好；
- 用 `prepare`（预编译语句）+ `ON CONFLICT … DO UPDATE`（upsert）保证一致性。

---

## 8. 专业名词对照表

| 名词 | 含义 |
|---|---|
| **Agent** | 由一个 LLM 主循环驱动、能自主决定调用哪些工具、何时停止的程序。本项目是 single-agent。 |
| **Single-Agent** | 单 Agent 架构：只有一个智能体在做决策，工具是被动端点。 |
| **LLM (Large Language Model)** | 大语言模型，本项目用 DeepSeek-V4 系列。 |
| **Tool / Tool Use** | 模型在生成过程中要求执行外部函数（"function calling"），系统执行后把结果送回模型继续推理。 |
| **MCP (Model Context Protocol)** | Anthropic 主推的开放协议，规定 LLM 客户端如何与外部数据源/工具服务通信。本项目用它接入 12306、高德等。 |
| **MCP Server** | 实现 MCP 协议、提供工具的服务进程，通过 stdio/http/sse 通信。 |
| **stdio / http / sse** | MCP 三种传输（transport）：本机进程的标准输入输出 / 远端 HTTP / 服务端推送（Server-Sent Events）。 |
| **Streaming** | 流式：模型边生成边返回，每个 token 立即可用，避免长输出超时。 |
| **SSE (Server-Sent Events)** | 浏览器 ↔ 服务器的单向流式协议，本项目 Web API 用它把事件推给前端。 |
| **AsyncGenerator** | JS/TS 的 `async function*`，可用 `for await` 消费的异步流，是 `Agent.turn()` 的返回类型。 |
| **Prompt Cache / Prefix Cache** | 提示词前缀缓存：服务端把相同前缀的中间结果缓存，下次同前缀只算增量，省钱省时。 |
| **Reasoning Effort** | DeepSeek-pro/reasoner 模型的"思考强度"参数（low/medium/high），高时模型会做更长的内部推理。 |
| **Reasoning Content** | 思考链文本（不是给用户看的最终回答），需要在多轮里回传给模型才能维持思维连续性。 |
| **Tool Call / Tool Result** | OpenAI 兼容协议里两类消息：模型要求调用工具 / 工具执行后的结果。 |
| **Parallel Tool Calls** | 模型在一个 turn 内要求并发调多个工具，运行时用 `Promise.all` 并行。 |
| **Tool Safety (read / idempotent_write / write)** | 工具副作用分级，决定能不能重试。 |
| **Retry with Exponential Backoff** | 失败重试 + 等待时间按 base × 3^(n-1) 增长，并加入抖动（jitter）避免雪崩。 |
| **Circuit Breaker** | 熔断器：连续失败到阈值后短路（fast-fail）一段时间，防止把故障扩大；本项目实现两态版本。 |
| **Token / Prompt Token / Completion Token** | 模型最小语义单元；输入 token / 输出 token 分开计费。 |
| **Cache Hit Rate** | 命中前缀缓存的 token 占总输入 token 的比例。 |
| **Compaction（上下文压缩）** | 长对话超阈值后，把旧消息总结为一段摘要替换原文，保留语义又控制 token。 |
| **Session** | 一次对话上下文（消息历史、约束、行程、压缩状态等的集合），按 ID 持久化。 |
| **Long-term Memory** | 跨 session 的用户级事实存储（SQLite 中的 `memories` 表）。 |
| **TripConstraints** | 强类型领域模型：硬约束（预算/日期/人数）+ 软偏好（节奏/口味/酒店档次）。 |
| **WAL (Write-Ahead Logging)** | SQLite 的并发友好写入模式，读不阻塞写。 |
| **LRU Cache** | 最近最少使用缓存，本项目 `cache/lru.ts` 提供通用实现，给响应/工具结果做记忆化。 |
| **Observability** | 可观测性：log + metrics + trace 三件套，本项目实现了前两件。 |
| **Next.js App Router** | Next.js 13+ 的新路由系统（`app/` 目录），本项目 Web UI 用它。 |
| **Server-only Singleton** | 服务端单例，本项目用 `globalThis.__tripmateRuntime` 保证 SQLite/MCP 连接只初始化一次。 |

---

## 9. 设计取舍速览

| 选择 | 理由 |
|---|---|
| 单 Agent，不做 multi-agent 编排 | 简单、可调试；多 agent 在大多数 B2C 场景 ROI 不高 |
| 工具列表按字母排序 | 让 OpenAI 请求体字节稳定，命中前缀缓存 |
| 记忆快照在 session 启动时冻结 | 同上：保证 prefix 不变 |
| 压缩用 fast 模型 | 摘要任务不要求顶配；省钱 |
| 压缩异步、不阻塞响应 | 用户体验优先；摘要下一轮才用 |
| 熔断打开时把工具从模型视野移除 | 避免模型反复重试已知坏工具，浪费 token |
| Reasoning content 自己累积 + 回传 | 绕开 OpenAI SDK 不累积的 quirk，否则 DeepSeek 会 400 |
| 后端三接口由同一个 SqliteBackend 实现 | 减少连接、减少事务边界，简化部署 |

---

## 10. 如何运行

```bash
cp .env.example .env       # 填入 DEEPSEEK_API_KEY
npm install
npm run dev                # CLI
# 或
npm run dev:web            # 浏览器访问 http://localhost:3000
```

CLI 内置命令：`stats` / `reset` / `memories` / `forget <id>` / `history` / `export [session-id]` / `exit`。

---

## 11. 一句话总结

> TripMate 是一个**工程化完成度很高的单 Agent 模板**——它把"流式响应、并行工具、前缀缓存、熔断重试、长期记忆、上下文压缩、可观测性、可插拔持久化"这些生产级 Agent 必备的工程要素，用最直白的方式拼在了一个清晰的目录结构里，然后在最上层包了一个有用的产品语义（旅行规划）。把领域逻辑换掉，它就是任何垂直 Agent 产品的可用骨架。
