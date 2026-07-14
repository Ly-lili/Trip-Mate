# TripMate Agent 面试讲解文档

> 一份面向技术面试的 Agent 项目讲解：从整体架构到五大核心模块（规划与推理、工具调用、记忆机制、上下文管理、Prompt 工程），所有专业术语逐一解释。
>
> 覆盖代码：[src/agent/runtime.ts](src/agent/runtime.ts)、[src/tools/registry.ts](src/tools/registry.ts)、[src/tools/health.ts](src/tools/health.ts)、[src/tools/memory-tool.ts](src/tools/memory-tool.ts)、[src/tools/mcp.ts](src/tools/mcp.ts)、[src/session/compactor.ts](src/session/compactor.ts)、[src/session/store.ts](src/session/store.ts)、[src/session/memory-store.ts](src/session/memory-store.ts)、[src/llm/client.ts](src/llm/client.ts)。

---

## 0. 一句话项目定位

**TripMate** 是一个生产级形态的**单 Agent（Single-Agent）旅行规划助手**：用户用中文多轮对话给出出发地/预算/日期，Agent 调用真实工具（12306 火车票、变飞航班、高德地图、必应搜索等 MCP 服务）拿到一手数据，最终生成按天展开的结构化行程并支持导出 PDF。

底层栈：**DeepSeek**（OpenAI 兼容协议）+ **MCP**（模型上下文协议）+ **SQLite**（持久化），CLI 与 Next.js 双入口。

> **Single-Agent**：只有一个 LLM 主循环负责决策（"下一步该做什么、调谁"）。所有工具都是被动端点（passive endpoints），自身没有自主性。这是 Claude Code、Cursor 主流采用的工程形态——简单、可控、易调试，是当前 B2C Agent 产品的稳健选择。

---

## 1. 总体架构（一张图回忆代码）

```
            ┌─────────────────────────────────────────────┐
            │          入口层  CLI / Next.js Web           │
            └──────────────────┬──────────────────────────┘
                               │ user message
                ┌──────────────▼──────────────┐
                │           Agent             │  ← 单 Agent 主循环
                │     runtime.ts (心脏)        │     流式 + 工具调度
                └────┬───────────────┬────────┘
                     │               │
        ┌────────────▼───┐    ┌──────▼─────────┐
        │   LLMClient    │    │  ToolRegistry  │
        │  DeepSeek 调用  │    │ 注册/路由/熔断  │
        └────────┬───────┘    └────┬───────────┘
                 │                 │
                 ▼          ┌──────┴─────────┐
        ┌──────────────┐    ▼                ▼
        │  OpenAI SDK  │  ┌─────────────┐  ┌──────────────┐
        │ chat.stream  │  │ MemoryTool  │  │ MCPProvider  │
        └──────────────┘  │ 长期记忆工具 │  │ 12306/amap.. │
                          └─────────────┘  └──────────────┘

   ┌───────────────┐  ┌──────────────┐  ┌─────────────────┐
   │ SessionStore  │  │  Compactor   │  │  Metrics+Logger │
   │ + SQLite 后端 │  │  上下文压缩  │  │  token/费用/延时 │
   └───────────────┘  └──────────────┘  └─────────────────┘
```

**搭建顺序（生产中真实写代码的顺序）**：
1. 接 LLM → 跑通最简单的 chat loop；
2. 加流式 + AsyncGenerator → CLI/Web 都能用同一个事件流；
3. 加 Tool 抽象（`ToolProvider` 接口）→ 接 MCP 拿真实数据；
4. 加 Session + 持久化（SQLite）→ 多轮对话不丢；
5. 加 Memory 工具与启动注入 → 跨 session 记住偏好；
6. 加 Compactor → 长对话不超 token；
7. 加 Metrics + 熔断 + 重试 → 能上线。

---

## 2. 规划与推理（Planning & Reasoning）

### 2.1 主循环：单 Agent 的 ReAct 实现

`Agent.turn()` 在 [src/agent/runtime.ts:72](src/agent/runtime.ts:72) 是一个 `AsyncGenerator<TurnEvent>`，最多迭代 `maxIterations=10` 次：

```
1. 取/建会话 (SessionStore.getOrCreate)
2. (仅首次) 冻结一份长期记忆快照 memorySnapshot
3. 把用户消息 push 到 session.messages
4. for 循环 (≤10 次):
   a. 拼请求 messages = [system] + [memory pair] + [compaction pair] + 历史
   b. llm.openai.chat.completions.stream(...)
   c. 边收边 yield 'text' (实时打字机)
   d. 流结束 → finalChatCompletion(),记录 usage
   e. assistant 消息 push 回历史 (含 reasoning_content + tool_calls)
   f. 没有 tool_calls → yield 'done' 退出
   g. 有 tool_calls → Promise.all 并发执行
   h. tool 结果 push 回历史 → 进入下一次循环
5. fireCompaction (异步,不阻塞)
```

这就是 **ReAct（Reason + Act）模式**的实现：每一轮 LLM 既可以"想"（生成文本/reasoning_content），也可以"做"（发起 tool_calls），结果回喂下一轮，循环直到 LLM 决定 `finish_reason='stop'`。

### 2.2 思考链与 Reasoning Effort

DeepSeek pro/reasoner 系列是 **推理模型（Reasoning Model）**：模型在给最终回答前，会先输出一段不可见的"思考链"（chain-of-thought），通过 `delta.reasoning_content` 字段流出。

代码 [runtime.ts:114](src/agent/runtime.ts:114) 在请求里带了 `reasoning_effort: 'high'`，让模型更"努力地想"再回答（low / medium / high 三档，分别对应越来越长的内部思考预算）。

**关键 Quirk 处理**（[runtime.ts:182-191](src/agent/runtime.ts:182)）：OpenAI SDK 的 stream helper **不会**自动把 `reasoning_content` 累计回 `finalChatCompletion()`，所以代码自己用 `streamedReasoning` 累计，并在下一轮请求里把 `reasoning_content` 跟着 assistant 消息一起回传——否则 DeepSeek 会 400。这是工程上很容易踩的坑。

### 2.3 停止条件（Stop Reasons）

`mapFinishReason()` 在 [runtime.ts:330](src/agent/runtime.ts:330) 把 OpenAI 的 `finish_reason` 映射成自家的 `StopReason`：

| OpenAI | 含义 | 我们的 StopReason |
|---|---|---|
| `stop` | 模型自己说"我说完了" | `end_turn` |
| `length` | 撞到 `max_tokens` | `other` |
| `content_filter` | 触发安全 | `refusal` |
| `tool_calls` | 还要继续调工具 | (循环继续) |

外加 `max_iterations`（迭代上限保护，防止模型陷入"永远调工具"的死循环）。

### 2.4 决策权 100% 交给 LLM

注意：**这个项目没有独立的 Planner 模块、没有手写的 if-else 状态机**。"下一步是问用户、调工具、还是出方案"完全由 LLM 看着 system prompt + 历史对话自主决定。

工程上代码只负责：
- 把可用工具的 JSON Schema 喂给模型；
- 把工具调用的结果忠实回喂；
- 防止模型陷入死循环（`maxIterations`）、超 token（`Compactor`）、调用坏工具（熔断器）。

这是**单 Agent 架构的核心哲学**：相信 LLM 的规划能力，工程负责"保姆"。

### 2.5 并行工具调用（Parallel Tool Use）

[runtime.ts:231](src/agent/runtime.ts:231)：

```ts
const executed = await Promise.all(
  functionToolCalls.map(async (tc) => { ... })
);
```

模型在一个 turn 里可能要求并发查 N 个城市的天气（OpenAI 协议允许一次返回多个 `tool_calls`），用 `Promise.all` 让它们一起跑，把端到端延迟从 `N × T` 压成 `max(T)`。

### 2.6 流式（Streaming）+ AsyncGenerator

`chat.completions.stream()` 返回一个**异步迭代器（async iterator）**，token 一到就 yield；CLI 用 `for await` 消费 → 用户看到的是打字机效果。同时也避免了"模型生成长输出时被 HTTP 超时切断"的问题。

整个 `Agent.turn()` 也是一个 `AsyncGenerator<TurnEvent>`，对外发出 `text / tool_call / tool_result / usage / done` 五种事件，CLI 和 Web SSE 用同一份代码消费——这是非常干净的解耦。

---

## 3. 工具调用（Tools / Actions）

### 3.1 工具抽象：`ToolProvider`

[src/agent/types.ts:23](src/agent/types.ts:23) 定义了**工具提供方**这一抽象：

```ts
interface ToolProvider {
  readonly name: string;
  listTools(): Promise<ToolDefinition[]>;
  callTool(name, input, ctx): Promise<ToolCallResult>;
}
```

实际有两个实现：
- `MemoryToolProvider`（本地记忆，[src/tools/memory-tool.ts](src/tools/memory-tool.ts)）
- `MCPToolProvider`（远端 MCP server，[src/tools/mcp.ts](src/tools/mcp.ts)）

**面试要点**：通过接口而不是具体实现暴露给上层，方便 mock、方便接新协议。

### 3.2 Tool Use / Function Calling 协议

OpenAI 兼容协议中两种关键消息：

1. **Tool Call**（assistant → 调用方）
   ```json
   { "role": "assistant",
     "tool_calls": [{ "id": "call_x", "type": "function",
                      "function": { "name": "12306__search_train",
                                    "arguments": "{\"from\":\"北京\"}" } }] }
   ```
2. **Tool Result**（调用方 → assistant，喂回历史）
   ```json
   { "role": "tool", "tool_call_id": "call_x", "content": "G1次..." }
   ```

每个工具的 `description` + `parameters`（JSON Schema）会被打到 system 之后，作为请求的一部分送给 LLM——LLM 看到这些 schema 才知道有哪些工具、各自参数长什么样。

### 3.3 MCP 协议接入

**MCP（Model Context Protocol）** 是 Anthropic 主推的开放协议，规定 LLM 客户端如何与外部工具/数据源通信。本项目通过它接入：12306、高德、必应、Rollinggo、变飞航班五个外部服务。

[src/tools/mcp.ts](src/tools/mcp.ts) 支持三种传输：

| Transport | 含义 | 适用 |
|---|---|---|
| `stdio` | 子进程标准输入输出 | 本地工具进程 |
| `http` | 标准 HTTP 请求-响应 | 普通远端 API |
| `sse` | Server-Sent Events 服务端推送 | 长连接、流式工具 |

工具名加了**前缀（namespacing）**：`{server.name}__{tool.name}`（例如 `12306__search_train`），防多源同名冲突。

### 3.4 ToolRegistry：工具的统一调度器

[src/tools/registry.ts](src/tools/registry.ts) 是所有工具调用的"总线"，承担五件事：

1. **注册（register）**：[L42](src/tools/registry.ts:42) 按名字防冲突地把 ToolProvider 加进来。
2. **可见性（openaiTools）**：[L62](src/tools/registry.ts:62) 把工具列表序列化成 OpenAI 兼容 schema。
3. **执行（execute）**：[L89](src/tools/registry.ts:89) 加超时 + 重试 + 熔断 + 度量。
4. **健康观察（healthSnapshot）**：暴露各 provider 的熔断状态。
5. **优雅关闭（shutdown）**：进程退出前关闭所有 MCP 连接。

#### 字典序排序（Byte-stable Tools List）

[L74](src/tools/registry.ts:74) `sorted = [...visible].sort(...)` 按工具名字典序排序后再发给 LLM。**目的是让请求体字节稳定**，让 DeepSeek 服务端的 prefix cache 命中（详见 §5.3 ②）。

### 3.5 Tool Safety 分级 → 重试策略

`ToolDefinition.safety` 字段（[types.ts:10](src/agent/types.ts:10)）告诉系统该工具的副作用语义：

| Safety | 含义 | 最大重试次数 |
|---|---|---|
| `read` | 纯查询，重试无副作用（默认） | 3 次 |
| `idempotent_write` | 幂等写（如按 id 删除，做几次都一样） | 2 次 |
| `write` | 非幂等写（如下单、发邮件） | 1 次（不重试） |

[registry.ts:124](src/tools/registry.ts:124) 据此动态选 `maxAttempts`。**幂等性（idempotency）** 是工程基本功——非幂等操作重试可能导致"下两次单"，是真实事故来源。

### 3.6 重试 + 指数退避（Exponential Backoff with Jitter）

[health.ts:130](src/tools/health.ts:130) `withRetry`：

```
delay = baseDelayMs × 3^(attempt-1) × jitter(0.8 ~ 1.2)
```

- **指数退避（Exponential Backoff）**：每次重试等待时间几何增长（200ms → 600ms → 1800ms），让下游有时间恢复。
- **抖动（Jitter）**：在等待时间上加随机扰动（0.8~1.2 倍），避免大量客户端同步重试形成"惊群效应（thundering herd）"。
- **可重试错误判断**：[isTransientError](src/tools/health.ts:112) 只对 ECONNRESET / 超时 / 503 等**瞬态错误（transient errors）** 重试，业务错误（如"该日期没有车"）不重试。

### 3.7 熔断器（Circuit Breaker）

[src/tools/health.ts:37](src/tools/health.ts:37) 实现两态熔断（closed / open，省掉 half-open 简化并发逻辑）：

- **closed**（正常）：放行调用；
- **open**（熔断）：在 cooldown 窗口内**直接 fail-fast**，不真实发请求。

触发条件：`failureWindowMs=60s` 内**连续失败** `failureThreshold=3` 次 → 翻到 open，停 `cooldownMs=30s` 起步，**每次再次打开 cooldown 翻倍**（指数退避，封顶 5 min），干净成功后才重置。

**关键设计**：[registry.ts:62-70](src/tools/registry.ts:62) 熔断打开时，从 `openaiTools()` 返回值里**临时把这个 provider 的工具藏掉**——LLM 根本看不到这些工具，就不会反复尝试调用一个已知挂掉的服务，节省 token 与时间。

> **熔断器原理**：来自 Netflix Hystrix。核心思想是"快速失败胜过慢慢挂"——当下游已经病了的时候，继续打它只会让你也病。

### 3.8 端到端工具调用时序

```
LLM yield tool_call (12306__search_train)
   ▼
ToolRegistry.execute()
   ├─ 熔断器 canCall() ?  (open → 直接 fail-fast)
   ├─ withTimeout(30s)
   └─ withRetry(read=3次, base=200ms, 指数×3, jitter)
      └─ MCPToolProvider.callTool()
            ├─ HTTP/stdio → 远端 MCP server
            └─ 返回 [{type: 'text', text: '...'}]
   ▼
breaker.onSuccess() / onFailure()
metrics.recordToolCall()
   ▼
yield tool_result {content, latencyMs}
   ▼
session.messages.push({role:'tool', tool_call_id, content})
```

---

## 4. 记忆机制（Memory）

> **关键洞察**：Agent 有两套"记忆"，必须分开理解。

### 4.1 短期记忆 = Session（一次对话内）

`Session`（[src/session/store.ts:25](src/session/store.ts:25)）持有这一轮对话的全部状态：

```ts
interface Session {
  id: string;
  userId?: string;
  messages: ChatMessage[];        // ← 完整对话历史
  constraints?: TripConstraints;  // 抽出的领域硬约束
  itinerary?: Itinerary;          // 最终行程
  memorySnapshot?: string;        // 长期记忆的快照(冻结)
  compaction?: CompactionState;   // 压缩状态
  createdAt; updatedAt;
}
```

每次工具调用、每条消息都 append 进 `session.messages`，再 `await sessions.save(sessionId)` 落盘到 SQLite。这就是模型在多轮内"记得"上下文的方式——**短期记忆即上下文窗口本身**。

`SessionStore` ([store.ts:54](src/session/store.ts:54)) 是双层结构：内存 Map 做缓存 + 可插拔 backend 做持久化（默认 `SqliteBackend`）。

### 4.2 上下文压缩（Context Compaction）

随着对话变长，messages 会持续增长直到撑爆 token 上限。[Compactor](src/session/compactor.ts) 解决这个问题：

**触发条件**（[compactor.ts:40](src/session/compactor.ts:40)）：上一轮请求的 `prompt_tokens >= 75_000`。

**压缩动作**（[compactor.ts:45](src/session/compactor.ts:45)）：
1. 保留最近 `recentTurnsKept=6` 条消息原文不动；
2. 把更早的（`compactedThrough` 到 `keepFrom` 之间）一起喂给 **fast 模型**，按固定 JSON schema 总结：
   ```
   { user_constraints, user_preferences, decisions_locked,
     tool_findings, open_questions }
   ```
3. 把摘要存到 `session.compaction.summary`；
4. 下一轮请求时（[runtime.ts:104](src/agent/runtime.ts:104)），用 `compactionPair()` 把摘要包成"虚拟 user/assistant 对话对"插入，并 `slice(compactedThrough)` 跳过原始旧消息。

**三个工程化细节**：
- **Fire-and-forget**：[runtime.ts:268](src/agent/runtime.ts:268) `fireCompaction` 不 await，**不阻塞用户响应**，下一轮才生效。
- **In-flight guard**：[compactor.ts:46](src/session/compactor.ts:46) 用 `Set<string>` 防止同一 session 多次重叠压缩。
- **只升不降**：[compactor.ts:130](src/session/compactor.ts:130) 新摘要会跟旧摘要合并（`existingSummary` 一起喂给模型），事实不丢。
- **用 fast 模型做摘要**：摘要任务对智商要求不高，用便宜模型省钱。

### 4.3 长期记忆 = Memory Tool（跨 session）

[src/tools/memory-tool.ts](src/tools/memory-tool.ts) 给 LLM 暴露 3 个工具，按 `userId` 隔离持久化到 SQLite 的 `memories` 表：

| 工具 | safety | 用途 |
|---|---|---|
| `memory__remember` | `write` | 写入一条原子事实（"用户吃素"） |
| `memory__recall` | `read` | 列出所有事实 |
| `memory__forget` | `idempotent_write` | 按 ID 删除 |

**写入纪律**（system prompt 里写死的规则）：
- ✅ 只写**稳定偏好**（饮食、过敏、交通偏好）
- ❌ 不要写**临时细节**（这次行程的日期、今天的天气）
- ✅ 一次一条**原子事实**

### 4.4 记忆注入（Memory Injection on Session Start）

[runtime.ts:86](src/agent/runtime.ts:86) 在每个 session 第一轮就**冻结一份记忆快照**：

```ts
if (session.userId && session.memorySnapshot === undefined) {
  session.memorySnapshot = (await this.buildMemoryBlock(session.userId)) ?? '';
}
```

`buildMemoryBlock`（[runtime.ts:291](src/agent/runtime.ts:291)）取 top-12 条记忆，渲染成：

```
Known about user (long-term memory; do not re-ask):
- #3 [饮食]: 用户吃素,只吃蛋奶素
- #5 [交通]: 偏好高铁,避免红眼航班
```

然后通过 `contextPair()`（[runtime.ts:281](src/agent/runtime.ts:281)）把它包成一对**虚拟 user/assistant 对话**插在 system 之后：

```
[system]    travel agent prompt
[user]      Known about user: ...   ← 注入
[assistant] 好的,我会基于以上偏好继续对话。 ← 占位回复
[user]      五一想去成都...        ← 真实用户消息
```

**为什么不直接塞进 system prompt**？因为 system prompt 必须**字节稳定**才能命中 prefix cache（详见 §5.3 ②）。记忆每个用户都不同、每次写入都变，塞进 system 会让缓存全 miss。

**为什么是"快照（snapshot）而不是实时读"**？同样为了 byte-stable：session 中途调了 `memory__remember` 也不刷新，下次新 session 才生效。这是一个**性能 vs 实时性的清晰取舍**。

### 4.5 记忆三层结构汇总

```
   生命周期             | 存储                  | 谁能读写
─────────────────────────────────────────────────────────
1. 当前轮上下文         | session.messages 数组 | LLM 自己看
2. Session 历史(SQLite) | sessions 表           | 跨进程不丢
3. 跨 session 长期记忆  | memories 表           | 通过 memory__* 工具
```

---

## 5. 上下文管理（Context Management）

> **核心问题**：LLM 一次只能看 `context_window` 个 token。多轮对话越拉越长、工具结果越塞越多、还要带长期记忆，**怎么在有限窗口里塞下"必要的信息"，同时控成本、保延迟、不让模型分心**？这就是上下文管理（Context Engineering）。

### 5.1 上下文管理的四个挑战

| 挑战 | 后果 | 本项目对策 |
|---|---|---|
| **窗口爆炸（Context Overflow）** | 超过 token 上限直接 400 | Compactor 上下文压缩 |
| **成本飙升（Cost Inflation）** | 每轮重复算前缀，输入 token 计费线性涨 | Prefix Cache + byte-stable prefix |
| **注意力稀释（Lost-in-the-Middle）** | 长上下文中间的信息模型容易"忘"，关键事实埋没在工具结果里 | 摘要替换 + 长期记忆注入 + 工具结果在历史里 |
| **分心 / 噪声（Context Pollution）** | 旧的、无关的、报错的内容干扰当前决策 | 熔断时藏掉坏工具 + 摘要丢冗余 + 工具结果截断 |

### 5.2 每一轮请求的上下文是怎么拼的

[runtime.ts:102-107](src/agent/runtime.ts:102) 的真实代码：

```ts
const messages = [
  { role: 'system', content: this.system },          // ① 系统指令(冻结)
  ...this.contextPair(session.memorySnapshot),       // ② 长期记忆快照(冻结)
  ...compactionPair(session.compaction),             // ③ 历史压缩摘要(偶尔变)
  ...session.messages.slice(compactedThrough),       // ④ 近期原文消息(每轮变)
];
```

视觉化：

```
请求 messages ──┬─ [system]              ← 永远字节相同
                ├─ [user: memory snap]   ← session 内冻结
                ├─ [assistant: "好的"]    ← 占位
                ├─ [user: compaction]    ← 仅压缩时变化
                ├─ [assistant: "理解"]    ← 占位
                └─ [真实历史 messages]    ← 仅尾部追加
                    ├─ user: "..."
                    ├─ assistant: "..." + tool_calls
                    ├─ tool: "..."
                    └─ assistant: "..."

      └────── 稳定前缀(命中 cache) ──────┘└─ 增量(每轮新算) ─┘
```

**设计原则一句话**：**稳定的放前面，易变的放后面，仅追加（append-only）不修改。** 这是命中 prefix cache 的核心要求。

### 5.3 四种上下文管理手段

#### ① 上下文压缩（Compaction） — 解决窗口爆炸

[Compactor](src/session/compactor.ts)：

- **触发**：上一轮 `prompt_tokens >= 75K` → fire-and-forget 异步启动；
- **保留**：最近 `recentTurnsKept=6` 条消息原文不动（最近的最重要）；
- **折叠**：更早的消息喂给 fast 模型，按固定 schema 总结成 JSON：
  ```
  { user_constraints, user_preferences, decisions_locked,
    tool_findings, open_questions }
  ```
- **替换**：下一轮请求里旧消息被 `slice(compactedThrough)` 跳过，摘要以"虚拟 user/assistant 对话对"形式插入。

**为什么用结构化 JSON 摘要而不是自由文本**？
- 字段约束让模型"该记什么"明确，不会乱总结；
- 后续可以程序化读取（比如 PDF 导出能直接拿 `decisions_locked`）；
- 增量摘要时，把"旧摘要 + 新对话"喂回去再总结，**fields 不会丢**。

**为什么是 fire-and-forget**？
- 用户响应优先，摘要不能让用户等；
- `inFlight` 集合防止同 session 重叠压缩；
- 失败 swallow（log warn 即可），下一轮再试。

#### ② Prefix Cache + 字节稳定 — 解决成本飙升

**Prompt Cache（提示词前缀缓存）**：DeepSeek 等服务端把"相同请求前缀"的中间计算结果缓存下来，下次同前缀的请求**输入 token 计费打 2~5 折**（pro: $0.55/M → $0.14/M），延迟也大幅下降。

**命中要求**：前缀逐字节相同，一个字节不一样就 miss。代码里为此做了**三件事**：

| 措施 | 在哪里 | 为什么 |
|---|---|---|
| 工具列表按字典序排序 | [registry.ts:74](src/tools/registry.ts:74) | 不同 register 顺序也能产出同一份序列化字符串 |
| 长期记忆 session 启动冻结 | [runtime.ts:86](src/agent/runtime.ts:86) | session 中途写记忆不刷新快照，前缀稳定 |
| 动态内容包成"虚拟对话对" | [runtime.ts:281](src/agent/runtime.ts:281), [compactor.ts:190](src/session/compactor.ts:190) | system 永远不动，记忆/摘要插在 system 之后 |

**核心反例**：如果把记忆塞进 system，每个用户的 system 都不同 + 每次写记忆都变 → 缓存几乎全 miss。

**计费直觉**（每轮 10K input、跑 100 轮）：
- 不缓存：100 × 10K × $0.55/M ≈ **$0.55**
- 80% 命中：(8K × $0.14 + 2K × $0.55) × 100 / 1M ≈ **$0.222**
- 省约 **60%**，量级直接掉一档。

#### ③ 上下文注入（Context Injection） — 解决"用户重复填表"

[runtime.ts:291](src/agent/runtime.ts:291) `buildMemoryBlock` 把 top-12 条长期记忆渲染成：

```
Known about user (long-term memory; do not re-ask):
- #3 [饮食]: 用户吃素,只吃蛋奶素
- #5 [交通]: 偏好高铁,避免红眼航班
```

[runtime.ts:281](src/agent/runtime.ts:281) `contextPair` 把它包成虚拟 user/assistant 对话插在 system 之后。同时 system prompt 明确："Treat it as established preferences — do not ask again about facts already listed there."

**这是"上下文管理"的另一面**：不仅要"减"（压缩、剔除），也要"加"（在合适位置注入合适信息）。

#### ④ 上下文裁剪（Truncation） — 控制单条消息体积

工具结果（特别是 MCP 拿回来的火车票/航班列表）经常很长。两个地方做了裁剪：

- [compactor.ts:159](src/session/compactor.ts:159) **送给摘要模型时**：tool result 截到 500 字，"过 500 字的内容很少是关键事实"；
- [compactor.ts:170](src/session/compactor.ts:170) **工具调用参数渲染**：args 截到 100 字。

主对话流里**不主动截工具结果**——这是有意的取舍：模型决策需要完整数据，截了可能丢关键信息。但摘要任务可以激进截断，因为摘要本身就是抽象。

### 5.4 上下文 = "只追加日志（Append-only Log）"模型

`session.messages` 在整个生命周期里**只 push、不修改**：

```ts
session.messages.push({ role: 'user', content: ... });        // 用户消息
session.messages.push(assistantParam);                         // assistant + tool_calls
session.messages.push({ role: 'tool', tool_call_id, ... });    // 工具结果
```

压缩时也不真的删旧消息，只是**移动一个指针** `compactedThrough`，下一轮请求构造时 `slice(compactedThrough)` 跳过。原始消息仍在 `session.messages` 里完整保留，落进 SQLite。

**这种 append-only 设计的工程价值**：
- ✅ 任何时候都可以"重放"出当前状态（debug 友好）；
- ✅ 字节稳定的前提（前面没变过）；
- ✅ 持久化简单（只需 append，不需要事务式修改历史）；
- ✅ 可审计（compaction 是记录在 `session.compaction.compactedAt` 里的事件，不是悄悄删数据）。

### 5.5 上下文管理的全景图

```
┌─────────────────────────────────────────────────────────┐
│         单轮请求要送给 LLM 的上下文 (有限窗口 ~128K)        │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  System Prompt (冻结)                                    │
│       ↑                                                  │
│  ┌────┴─────────────┐  注入                               │
│  │ Memory Snapshot  │ ← buildMemoryBlock (session 启动冻结)│
│  └──────────────────┘                                    │
│  ┌──────────────────┐  注入                               │
│  │ Compaction Sum.  │ ← Compactor (≥75K 时异步生成)       │
│  └──────────────────┘                                    │
│  ┌──────────────────┐  追加                               │
│  │ Recent Messages  │ ← session.messages.slice(...)      │
│  │ (user/asst/tool) │                                    │
│  └──────────────────┘                                    │
│                                                          │
└──────────────────────────────────────────────────────────┘
       ▲                  ▲                ▲
       │                  │                │
   [长期记忆库]        [压缩状态]       [Session 持久化]
   memories 表       session.compaction   sessions 表
   (跨 session)      (本 session 内累积)   (整体 JSON)
```

> 一句话总结上下文管理：**用 append-only 的事件日志 + 字节稳定的前缀 + 异步触发的摘要 + 启动时的记忆注入，在有限窗口里同时把"成本、延迟、信息密度、注意力"四件事拿捏住。**

---

## 6. Prompt 工程（Prompt Engineering）

### 5.1 System Prompt 怎么写

[runtime.ts:10](src/agent/runtime.ts:10) 的 SYSTEM_PROMPT 体现了**结构化提示词（Structured Prompting）**的几个最佳实践：

```
You are TripMate, a careful travel-planning assistant.

How you work:
1. First, understand hard constraints + soft preferences. Ask short
   clarifying questions when something critical is missing — do not
   invent values.
2. Then, call tools to gather concrete information. You may call
   multiple read-only tools in parallel.
3. Finally, propose a structured day-by-day itinerary. ...

Long-term memory:
- A "Known about user" block may appear at the start...
- When the user shares a *stable* preference, call `memory__remember`...
- Use `memory__recall` when...
- Use `memory__forget` only when explicitly asked.

Style: concise, structured, no filler. ...
```

**这里的 prompt 工程拆解**：

| 技巧 | 体现 |
|---|---|
| **角色定位（Role）** | "You are TripMate, a careful travel-planning assistant" |
| **任务分解（Task Decomposition）** | 三步：理解约束 → 调工具 → 出方案 |
| **正例/反例（Do/Don't）** | "do not invent values"、"Do NOT save ephemeral details" |
| **工具使用纪律** | 哪些情况调 `memory__remember`，哪些不调，写得很具体 |
| **风格约束（Style）** | "concise, structured, no filler. Prefer bullet lists." |
| **领域硬/软约束区分** | hard constraints (budget/dates) vs soft preferences (pace/cuisine) |

### 5.2 Prefix Cache 与字节稳定性（Byte-stable Prefix）

**Prompt Cache（提示词前缀缓存）** 是当前所有主流 LLM 厂商都提供的功能：服务端把"相同请求前缀"的中间计算结果缓存下来，下次同前缀的请求只算增量，**输入 token 计费打 2~5 折，延迟也大幅下降**。

但缓存命中要求**前缀逐字节相同**，一个字节不一样就 miss。代码里为此做了三件事：

#### ① 工具列表排序（[registry.ts:74](src/tools/registry.ts:74)）
```ts
const sorted = [...visible].sort((a,b) => a.name < b.name ? -1 : ...);
```
按字典序排序，无论 provider 注册顺序如何，序列化后字节稳定。

#### ② 记忆快照冻结（[runtime.ts:86](src/agent/runtime.ts:86)）
session 开始时拍一次快照，session 内不变。否则用户每写一条 memory 都会让 prefix 改变。

#### ③ 动态内容用"虚拟对话对"包裹（[runtime.ts:281](src/agent/runtime.ts:281), [compactor.ts:190](src/session/compactor.ts:190)）
```
请求结构：
[system]                   ← 永远字节相同 (cache hit)
[user: memory snapshot]    ← session 内冻结 (cache hit)
[assistant: "好的"]         ← 占位 (cache hit)
[user: compaction summary] ← 仅压缩时变化
[assistant: "理解"]         ← 占位
[真实历史 messages]
```

**核心原则**：让"易变的内容"放到尾巴，"稳定的内容"放在前面。每多保住几个稳定 token，就多一笔实打实的省钱。

### 5.3 工具描述（Tool Descriptions）也是 Prompt 工程

[memory-tool.ts:18](src/tools/memory-tool.ts:18) 的工具描述本身就是给 LLM 看的提示词：

```
'Save a long-term fact about the current user (preferences, constraints,
 recurring requests). Use this when the user shares something stable that
 should persist across sessions — e.g. "我吃素", "出差只住快捷酒店",
 "对花生过敏". Do NOT save ephemeral session details (current trip dates,
 this-week mood). Each call stores ONE atomic fact.'
```

**几个值得抄走的写法**：
- **何时用**（"when the user shares something stable"）；
- **何时不用**（"Do NOT save ephemeral...")，反例往往比正例重要；
- **典型例子**（"我吃素""快捷酒店"）让模型快速对齐意图；
- **粒度**（"ONE atomic fact"）防止模型一次塞一大段。

### 5.4 摘要任务用结构化输出（Structured Output）

[compactor.ts:114](src/session/compactor.ts:114) 用了两个技巧：

1. **强 JSON 模式**：
   ```ts
   response_format: { type: 'json_object' }
   ```
   服务端会保证返回是合法 JSON。

2. **明确 Schema**：
   ```
   Schema:
   { "user_constraints": [], "user_preferences": [],
     "decisions_locked": [], "tool_findings": [], "open_questions": [] }
   ```
   把字段语义写得清清楚楚，并配规则（"Each list contains short, single-fact strings. Be terse."）。

3. **增量摘要**：
   ```
   Earlier summary (incorporate, do not lose):
   {existingSummary}

   New conversation since earlier summary:
   {messagesText}
   ```
   告诉模型"你不是从头总结，是在旧摘要上 merge 新内容"。

### 5.5 同一个 Agent，多种"提示词"

整个项目里其实有 **3 套 prompt**：

| 场景 | Prompt | 模型 |
|---|---|---|
| 主对话 | SYSTEM_PROMPT (旅行规划纪律) | main (deepseek-v4-pro) |
| 上下文压缩 | "summarize earlier turns into JSON" | fast (deepseek-v4-flash) |
| PDF 提取 | "extract Itinerary from conversation" | fast |

**成本路由（Cost Routing）**：[LLMClient.modelFor()](src/llm/client.ts:23) 提供 `'main' | 'fast'` 两档，主对话要顶配，摘要/抽取这种"流水线"任务用便宜模型就够。

---

## 7. 关键专业术语速查表

| 术语 | 含义 |
|---|---|
| **Agent** | 由一个 LLM 主循环驱动、能自主决定调用哪些工具、何时停止的程序 |
| **Single-Agent** | 单 Agent 架构：一个智能体做决策，工具是被动端点 |
| **Multi-Agent** | 多 Agent 架构：多个智能体相互协作（本项目未采用，B2C 场景 ROI 不高） |
| **LLM (Large Language Model)** | 大语言模型，本项目用 DeepSeek-V4 |
| **ReAct** | Reason+Act：LLM 边推理边动作的循环范式，本项目主循环就是 ReAct |
| **Tool / Tool Use / Function Calling** | 模型在生成中要求执行外部函数，结果送回继续推理 |
| **MCP (Model Context Protocol)** | Anthropic 开放协议，规定 LLM 客户端如何与外部工具/数据源通信 |
| **MCP Server** | 实现 MCP 协议、提供工具的服务进程，stdio/http/sse 通信 |
| **stdio / http / sse** | MCP 的三种传输：本机进程标准输入输出 / HTTP / Server-Sent Events |
| **SSE (Server-Sent Events)** | 浏览器↔服务器单向流式协议，本项目 Web API 用它推事件给前端 |
| **Streaming** | 流式：模型边生成边返回，每个 token 立即可用，避免长输出超时 |
| **AsyncGenerator** | JS/TS 的 `async function*`，可用 `for await` 消费的异步流 |
| **Reasoning Model** | 推理模型：先输出"思考链"再给最终答案的模型（DeepSeek pro/reasoner） |
| **Reasoning Effort** | 推理强度参数（low/medium/high），高时模型做更长内部推理 |
| **Reasoning Content** | 思考链文本，多轮里需回传给模型才能维持思维连续性 |
| **Chain-of-Thought (CoT)** | 思维链：让模型显式写出推理步骤，提高复杂任务正确率 |
| **Tool Call / Tool Result** | OpenAI 协议两类消息：模型要求调工具 / 工具结果回喂 |
| **Parallel Tool Calls** | 一个 turn 内并发多个工具调用，运行时用 `Promise.all` |
| **Tool Safety (read/idempotent_write/write)** | 工具副作用分级，决定能否重试 |
| **Idempotency（幂等性）** | 同一请求执行 N 次效果同 1 次，幂等接口可放心重试 |
| **Retry with Exponential Backoff** | 失败重试 + 等待时间指数增长 |
| **Jitter（抖动）** | 在退避时间上加随机扰动，防止"惊群效应"（thundering herd） |
| **Transient Error（瞬态错误）** | 网络抖动/超时/503 等可重试错误，区别于业务永久错误 |
| **Circuit Breaker（熔断器）** | 连续失败到阈值后短路（fail-fast）一段时间，防故障扩大 |
| **Fail-Fast** | 已知会失败的调用立即返回错误，不浪费资源真发请求 |
| **Token / Prompt Token / Completion Token** | 模型最小语义单元，输入/输出分开计费 |
| **Prompt Cache / Prefix Cache** | 服务端把相同请求前缀的中间结果缓存，下次同前缀只算增量 |
| **Cache Hit Rate** | 命中前缀缓存的 token 占总输入 token 的比例 |
| **Byte-stable Prefix** | 字节级稳定的请求前缀，是命中 prefix cache 的前提 |
| **Context Window（上下文窗口）** | 模型一次能看的 token 上限 |
| **Context Engineering / Management** | 在有限窗口内编排"传给模型的内容"的工程，包括压缩/注入/裁剪/排序 |
| **Compaction（上下文压缩）** | 长对话超阈值时把旧消息总结成摘要替换原文 |
| **Context Injection（上下文注入）** | 把外部信息（长期记忆、检索结果等）显式写进 prompt 让模型可见 |
| **Context Truncation（上下文裁剪）** | 主动剪短超长内容（如工具结果），控制单条消息体积 |
| **Append-only Log** | 消息历史只追加不修改，压缩通过移动指针实现，原始数据完整保留 |
| **Lost-in-the-Middle** | 长上下文中部信息容易被模型忽略的现象，要尽量把关键信息放头尾 |
| **Context Pollution** | 旧的、错误的、无关的内容污染上下文导致模型决策变差 |
| **Fire-and-forget** | 启动异步任务但不等待结果，不阻塞主流程 |
| **Session** | 一次对话上下文（消息历史/约束/状态），按 ID 持久化 |
| **Long-term Memory** | 跨 session 的用户级事实存储（本项目 SQLite memories 表） |
| **Memory Injection** | 把长期记忆渲染进 prompt 头部，让模型不再追问已知信息 |
| **Snapshot（快照）** | 时间点冻结的副本，用于保证下游字节稳定 |
| **Structured Output / JSON Mode** | 强制模型返回合法 JSON，配合显式 schema |
| **Cost Routing** | 主/副模型分档，便宜任务走 fast 模型省钱 |
| **JSON Schema** | 描述 JSON 结构的标准（type/properties/required），工具参数都用它 |
| **Tool Namespacing** | 给工具加前缀防同名冲突（如 `12306__search_train`） |
| **Observability（可观测性）** | log + metrics + trace 三件套，本项目实现前两件 |
| **WAL (Write-Ahead Logging)** | SQLite 的并发友好写入模式，读不阻塞写 |
| **Singleton（单例）** | 整个进程只一份实例，本项目用它保证 SQLite/MCP 连接只初始化一次 |
| **Next.js App Router** | Next.js 13+ 新路由系统（`app/` 目录） |

---

## 8. 面试可能被追问的 9 个问题（附答题要点）

### Q1：为什么是 Single-Agent 而不是 Multi-Agent？
- B2C 场景下，决策路径基本是线性的（理解 → 调工具 → 出方案），不需要并行子任务专家；
- Multi-Agent 调试难度指数级上升、成本叠加，ROI 不划算；
- 这也是 Claude Code、Cursor、Devin（早期）等主流产品的选择。

### Q2：怎么防止模型陷入死循环（无限调工具）？
- `maxIterations=10` 硬上限；
- 熔断器把已知坏工具藏起来，模型看不见就不会再调；
- system prompt 明确"先问再调，缺关键信息要澄清而不是瞎试"。

### Q3：Prompt Cache 在 80% 命中时省多少钱？
- DeepSeek 缓存命中 token 通常打 1~3 折（pro: $0.55/M → $0.14/M）；
- 假设每轮 10K input token、80% 命中、跑 100 轮：
  - 不缓存：100 × 10K × $0.55/M = $0.55
  - 80% 缓存：(8K × $0.14 + 2K × $0.55) × 100 / 1M = $0.222
  - 省约 60%。

### Q4：长对话怎么不爆 token？
- 触发阈值 `prompt_tokens >= 75K` → fire-and-forget 启动 Compactor；
- 用 fast 模型把"除最近 6 条之外"压成结构化 JSON 摘要；
- 摘要以"虚拟 user/assistant 对话对"形式插入 prefix，下一轮起生效。

### Q5：怎么保证记忆不丢？
- 写入：`memory__remember` 工具落到 SQLite `memories` 表（按 user_id 隔离）；
- 读取：每个新 session 启动时拍 top-N 条快照注入 prompt；
- 删除：仅在用户明确要求时通过 `memory__forget` 删；
- 跟 session.messages（短期）严格分开，互不干扰。

### Q6：工具失败了怎么办？
- 三层防护：超时（30s）→ 重试（指数退避+jitter，按 safety 决定次数）→ 熔断（连续失败 3 次熔 30s+，冷却时间指数翻倍）；
- 永远把失败结果作为 `tool_result` 喂给 LLM，让 LLM 自己决定要不要换方案；
- **不**直接 throw 给用户，对话不被一个工具拖死。

### Q7：为什么记忆要冻结快照？
- prefix cache 命中要求字节级稳定；
- 如果实时读，session 中途任何 `memory__remember` 都会让 prefix 变 → 缓存全 miss；
- 取舍：损失了"当前 session 立即生效"的实时性，换来全程缓存命中（折算下来更值）；
- 中途写入下一次 session 才用，符合"长期记忆 = 跨 session"的语义。

### Q8：上下文管理（Context Engineering）做了哪几件事？
1. **拼装顺序**：system → memory snapshot → compaction summary → 历史消息（稳定的放前面）；
2. **窗口控制**：`prompt_tokens >= 75K` 触发 Compactor，把旧消息折叠成 JSON 摘要；
3. **缓存命中**：工具列表字典序排序 + 记忆快照 session 内冻结 + 动态内容包成虚拟对话对，让前缀字节稳定；
4. **注意力管理**：长期记忆显式注入避免重复问、工具结果送给摘要模型时截到 500 字；
5. **可审计**：messages 用 append-only 模型，压缩只移动指针不删原文。

> 核心一句话：**append-only 事件日志 + 字节稳定前缀 + 异步触发摘要 + 启动时记忆注入。**

### Q9：怎么知道 Agent 跑得好不好？
- `Metrics` 记录每次请求的 token in/out、cache 命中、延迟、估算费用（`$/M token` 表换算）；
- 工具维度：每个工具的调用次数、错误数、p50 延迟；
- `stats` 命令打印汇总；JSON 结构化日志可灌进 ELK/Loki；
- 熔断器健康快照可以发现"某个 MCP server 半小时内频繁挂"。

---

## 9. 一句话总结

> TripMate 是一个**麻雀虽小、五脏俱全的单 Agent 工程模板**：
>
> - **规划**：纯 LLM 驱动的 ReAct 主循环（无手写状态机），靠 `maxIterations` + 熔断器防死循环；
> - **工具**：`ToolProvider` 抽象 + ToolRegistry 调度（超时/重试/熔断）+ MCP 接真实数据源；
> - **记忆**：双层（session 内的 messages + 跨 session 的 SQLite memories）+ session 启动注入；
> - **上下文**：append-only 事件日志 + 字节稳定前缀 + 异步 Compactor 摘要 + 工具结果裁剪；
> - **Prompt**：结构化 system + byte-stable prefix（排序工具列表 + 冻结快照 + 虚拟对话对包动态内容）+ 成本路由。
>
> 把领域逻辑（旅行规划）替换掉，它就是任何垂直 Agent 产品的可用骨架。
