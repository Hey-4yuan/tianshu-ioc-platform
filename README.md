# 天枢 · 智能运维中枢平台（Tianshu IOC）· 三维机房演示 Demo

> 北斗天枢，运筹帷幄——三维机房 + 六大运维页面 + 语音巡检助手「小维」。

一个可本地运行的智能运维（IOC）演示系统：三维机房 + 六大运维页面 + 语音巡检助手「小维」。  
机房与设备数据**全部为模拟演示数据**，非真实机房上线系统。对话智能由可切换的多家 LLM 供应商提供；  
**未配置任何 API Key 时，系统自动进入「离线模式·内置规则」，同样可以走完全部演示（移动、查询、建议、派单、复测、切页）。**

---

## 一、环境要求

- **Node.js 18 及以上**（使用原生 `fetch`），推荐 Node 18/20/22。
- 唯一运行时依赖：`express`（`npm install` 安装）。
- 现代浏览器（Chrome / Edge / Firefox 较新版本）。
- 无需数据库、无需构建框架、无需登录。
- 语音功能依赖浏览器的 `webkitSpeechRecognition`（中文语音输入）与 `speechSynthesis`（zh-CN 播报）；  
  无麦克风时，输入框与按钮可完成全部能力。

> 若没有 Node 环境，可按任务约定改用 Python3 标准库零依赖后端（本交付默认提供 Node 方案）。

---

## 二、启动命令

```bash
# 1. 安装依赖（仅 express）
npm install

# 2. 启动服务
npm start
# 或
node server.js
```

启动后访问： **<http://localhost:3000>**

- 首次打开播放约 10 秒纯代码片头，可点「跳过片头」。
- 健康检查：`GET http://localhost:3000/api/health` 返回 `{"ok":true,...}`。
- 自定义端口：`PORT=8080 node server.js`。

---

## 三、多供应商 LLM 适配层

所有供应商统一走 **OpenAI 兼容协议**：`POST {baseUrl}/chat/completions`，协议逻辑只实现一套，差异由 profile 配置消化。

### 内置供应商与 Key 申请

| id          | 名称         | baseUrl                                             | 默认模型                                  | 环境变量                | Key 申请                                  |
| ----------- | ---------- | --------------------------------------------------- | ------------------------------------- | ------------------- | --------------------------------------- |
| `deepseek`  | DeepSeek   | `https://api.deepseek.com`                          | `deepseek-chat`                       | `DEEPSEEK_API_KEY`  | <https://platform.deepseek.com/>        |
| `ark`       | 豆包（火山方舟）   | `https://ark.cn-beijing.volces.com/api/v3`          | `doubao-seed-1-6-250615`（或 `ep-` 接入点） | `ARK_API_KEY`       | <https://console.volcengine.com/ark>    |
| `dashscope` | 通义千问       | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus`                           | `DASHSCOPE_API_KEY` | <https://dashscope.console.aliyun.com/> |
| `zhipu`     | 智谱 GLM     | `https://open.bigmodel.cn/api/paas/v4`              | `glm-4-plus`                          | `ZHIPU_API_KEY`     | <https://open.bigmodel.cn/>             |
| `moonshot`  | Kimi（月之暗面） | `https://api.moonshot.cn/v1`                        | `moonshot-v1-8k`                      | `MOONSHOT_API_KEY`  | <https://platform.moonshot.cn/>         |
| `qianfan`   | 文心一言（千帆）   | 按任务给定地址配置                                           | `ernie-4.0-8k`                        | `QIANFAN_API_KEY`   | <https://qianfan.cloud.baidu.com/>      |
| `minimax`   | MiniMax    | `https://api.minimax.chat/v1`                       | `MiniMaxText-01`                      | `MINIMAX_API_KEY`   | <https://platform.minimaxi.com/>        |
| `openai`    | OpenAI（可选） | `https://api.openai.com/v1`                         | `gpt-4o-mini`                         | `OPENAI_API_KEY`    | <https://platform.openai.com/>          |

### 配置 Key（三选一）

1. **环境变量（推荐）**：
   ```bash
   export DEEPSEEK_API_KEY=sk-xxxx
   export ARK_API_KEY=xxxx
   node server.js
   ```
2. **本地私有文件**：在 `config/providers.local.json` 中配置（已加入 `.gitignore`，写入权限强制 `600`）。
3. **界面配置自定义中转站**：右下角「自定义中转站」弹窗填写 名称 / baseUrl / Key / 模型，保存后写入 `config/providers.local.json`。

> **安全约定**：API Key 只存在于后端（环境变量或 `config/providers.local.json`），  
> `GET /api/providers` 只返回「是否已配置」的布尔值与模型/能力，**绝不返回 Key**；  
> 服务端日志中的 Key 一律脱敏为 `sk-***`。

### 自定义中转站 / 模型覆盖

- 「自定义中转站」可配置任意 OpenAI 兼容的第三方中转，**可配置多个**；id 形如 `relay-<base36>`。
- 前端模型框支持**手动输入**任意模型名。
- 复制 `config/providers.example.json` 为 `config/providers.json`，可覆盖内置供应商的 `baseUrl` / `defaultModel` / `models`。

**配置优先级**：环境变量 ＞ `providers.local.json` ＞ `providers.json` ＞ 内置 profile。  
只有解析到 Key 的供应商才会在面板标记为「可用」。

---

## 四、Failover 与工具能力三级降级

### Failover（故障切换）

- 未指定供应商（「自动 Failover」）时，按 `priority` 选择首个可用供应商。
- 出现以下情况自动切换到下一个供应商并重试：**网络错误、15 秒超时、HTTP 429、5xx、401/402**。
- SSE 流式输出中途断流也会自动切换重试。
- 所有供应商均失败时返回离线结果，前端进入「离线模式·内置规则」。
- 面板会标注**实际供应商 / 模型**以及**切换记录**（含失败原因）。

### 工具能力三级降级

1. **原生 Function Calling**：供应商支持 tools 时直接返回工具调用。
2. **JSON 动作协议**：不支持 tools 时，把工具清单与 JSON 协议  
   `{"thought":"…","actions":[{"tool":"go_to_rack","args":{"rackId":"A-02"}}]}`  
   写入 system prompt，由前端容错解析执行，再进行第二轮生成口语回复。
3. **纯对话兜底**：JSON 也不稳定时仅进行对话，并提示「当前供应商不支持动作联动」。

任何一级都**不会把协议错误直接抛给用户**。

---

## 五、页面与工具一览

- **片头**：约 10 秒，纯代码三维机房镜头推进 + 标题发光，无外部视频素材。
- **六个导航页**：总览 / 机房监控 / 资产管理 / 能效管理 / 告警中心 / 运维工单。
- **设备检视子页**：机柜环绕特写、开合柜门、柜内分层模块、巡检报告。
- **右侧常驻「小维 · 巡检助手」**：对话/设备详情 Tab、供应商与模型选择、连接状态、快捷指令、语音开关。

小维可用工具（LLM 驱动，无固定剧本；离线模式由关键词意图引擎驱动同一套工具）：

| 工具                                | 作用                                         |
| --------------------------------- | ------------------------------------------ |
| `go_to_rack(rackId)`              | 校验机柜，机器人沿通道移动、进度显示、镜头跟随，到达高亮并打开设备详情，返回完整状态 |
| `get_rack_status(rackId)`         | 不移动，返回实时状态                                 |
| `list_alarms(severity)`           | 返回告警列表与统计                                  |
| `get_rack_advice(rackId)`         | 按告警类型返回知识库建议（温度/网络/PDU/风扇）                 |
| `create_ticket(rackId, assignee)` | 为未确认告警创建工单，默认负责人 张工/李工/王工                  |
| `run_retest(rackId)`              | 模拟复测（22–25℃ 随机正常值），解除告警、工单完成归档             |
| `navigate(page)`                  | 切换页面并返回该页关键指标                              |

**行为红线（已写入 system prompt 与离线逻辑）**：告警信号不能直接确定根因；现场检查必须人工完成，  
小维**不会声称已远程修复**；派单不等于解决，告警保留到复测通过。

### 外部 API 扩展位（默认关闭，配置即开启）

- 和风天气（`QWEATHER_KEY`）：联动制冷 / PUE 提示。
- 飞书 / 钉钉 / 企业微信 webhook（`FEISHU_WEBHOOK` / `DINGTALK_WEBHOOK` / `WECOM_WEBHOOK`）：生成工单与复测时推送卡片。
- RAG 知识库、视觉识别、联网搜索：作为后续可选工具的**预留接口**，本版本未实现。
- 通过 `GET /api/extensions` 可查看各扩展开关状态。

---

## 六、目录结构

```
ioc-platform/
├── server.js                     # Express 后端：静态托管 + /api/* 接口
├── package.json                  # 仅依赖 express
├── llm/
│   ├── providers.js              # 供应商 profile、配置优先级、key 解析（不回传 key）
│   ├── router.js                 # failover、三级降级、SSE 流式
│   └── prompt.js                 # system prompt、工具定义、JSON 协议兜底
├── config/
│   ├── providers.example.json    # 模型/baseUrl 覆盖示例
│   └── providers.local.json      # 私有配置（gitignore，权限 600，交付默认不含）
└── public/
    ├── index.html
    ├── css/style.css
    ├── vendor/                   # 自托管 echarts / three（离线可用）
    └── js/
        ├── data.js               # 单一数据源（模拟数据，确定性生成）
        ├── soft3d.js             # Canvas2D 软件 3D 渲染兜底
        ├── scene.js              # Three.js 主渲染器（WebGL 可用时）
        ├── charts.js             # ECharts 图表
        ├── voice.js              # 语音识别 / TTS
        ├── agent.js              # 对话编排、工具执行、离线意图
        └── main.js               # 布局、导航、页面渲染、弹卡
```

---

## 七、已知限制与实现说明（如实记录）

1. **三维渲染兜底**：本交付的自检浏览器以 `--disable-gpu` 启动、无法创建 WebGL 上下文。  
   为此新增 `public/js/soft3d.js`（Canvas2D 软件 3D：透视投影、背剔 + 画家算法、文字标签、ray-AABB 拾取），  
   由 `scene.js` 在 WebGL 不可用时自动委托。**在有 GPU 的正常机器上，Three.js 仍是主渲染器**；  
   Three.js 路径在本无 GPU 环境中未能直接截图验证，仅做了代码与静态检查。
2. **前端库自托管**：自检环境中 Three.js / ECharts 的公网 CDN 经代理隧道加载失败，  
   故将 `echarts` 与 `three` 的产物放入 `public/vendor/` 自托管，断网也能打开；`package.json` 依赖仍只有 `express`。
3. **告警严重级别口径**：任务规格中告警中心统计写作「严重 2 / 一般 2」，  
   但监控页与知识库逐柜枚举的 4 条告警为 A-02、D-07、C-05 三条「严重」+ E-05 一条「一般」。  
   为保证界面内部一致，采用更具体的逐柜口径，即 **4 / 严重 3 / 一般 1 / 已确认 1（初始）**。
4. 语音识别与 TTS 取决于浏览器/系统是否提供中文语音能力与麦克风权限；不可用时文字与按钮链路完整。
5. 天气与 IM webhook 为扩展位，需配置对应环境变量才启用；RAG / 视觉 / 联网搜索本版本仅预留接口。
6. 所有数据为确定性模拟数据，仅用于演示，不代表真实机房、不构成任何运维决策依据。

---

## 八、许可证

MIT（演示项目）。第三方库 echarts / three 遵循其各自开源许可证。
