# 通义（DashScope / 阿里百炼）API 接口文档

本文档描述本项目中使用的阿里云百炼（DashScope）接口：地址、方法、请求/响应格式及错误码。  
认证方式：`Authorization: Bearer <api_key>`。  
错误码详见：[阿里云错误信息](https://help.aliyun.com/zh/model-studio/error-code)。

---

## 1. LLM 对话（Chat Completions，兼容 OpenAI）

### 接口基本信息

| 项目 | 说明 |
|------|------|
| 地址 | `{baseURL}/chat/completions`，如 `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions` |
| 方法 | POST |
| 类型 | OpenAI 兼容的对话补全接口 |

### 请求参数

| 参数 | 必填 | 类型 | 含义 |
|------|------|------|------|
| model | 是 | string | 模型 ID，如 `qwen-plus-2025-12-01`、`qwen-turbo` |
| messages | 是 | array | 对话消息列表，每项含 `role`、`content` |
| temperature | 否 | number | 采样温度，默认 0.1 |
| max_tokens | 否 | number | 最大生成 token 数，默认 20000 |

### 请求示例

```bash
curl -X POST 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -d '{
    "model": "qwen-plus-2025-12-01",
    "messages": [{"role": "user", "content": "你好"}],
    "temperature": 0.1,
    "max_tokens": 20000
  }'
```

### 响应格式

- **成功**：HTTP 200，JSON 体含 `choices[0].message.content`。
- **失败**：HTTP 4xx/5xx，JSON 如 `{"error": {"code": "...", "message": "..."}}` 或 `{"code": "...", "message": "..."}`。

### 响应关键字段

| 字段 | 说明 |
|------|------|
| choices[0].message.content | 助手回复文本 |
| usage | token 消耗（若有） |

### 核心错误码

| code / 情况 | 含义 |
|-------------|------|
| Model not exist / 模型不存在 | 模型名错误或不可用 |
| 401 | 未授权，API Key 无效 |
| 429 | 限流，需退避重试 |

---

## 2. 图像生成与图像编辑（T2I / Image Edit）

### 2.0 接口与协议族总览（重要）

DashScope 的图像相关能力在本项目中按“协议族”拆分为两类：

| 协议族 | 典型模型族 | 入口 | 同步/异步 | 说明 |
|---|---|---|---|---|
| **multimodal-generation** | `qwen-image*`、`qwen-image-edit*` | `POST https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation` | **同步** | 请求体采用 `input.messages` 结构，成功后直接返回 `output.choices[0].message.content[].image` |
| **image-generation + tasks** | `wan2.6-t2i` | `POST https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation` + `GET /api/v1/tasks/{task_id}` | **异步任务** | 提交返回 `task_id`，轮询 `/tasks/{task_id}` 获取最终图片 URL |

> 注意：`qwen-image` 在官方文档中也存在 `text2image/image-synthesis` 的异步接口形态，但本项目的主路径建议优先使用 `multimodal-generation` 的同步形态，以降低任务轮询与协议分歧。
>
> **最终规范（不做旧入口兼容）**：`qwen-image*` 与 `qwen-image-edit*` 只允许走 `multimodal-generation/generation`；`wan2.6-t2i` 只允许走 `image-generation/generation + /tasks`。禁止在工程内提供“单入口自动分流”的兼容模式，以免协议语义再次混淆。

### 2.1 文生图（`wan2.6-t2i`）异步

#### 接口基本信息

| 项目 | 说明 |
|------|------|
| 提交地址 | `https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation` |
| 轮询地址 | `https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}` |
| 方法 | 提交 POST（需加 `X-DashScope-Async: enable`），轮询 GET |
| 类型 | 异步任务：先提交得 `task_id`，再轮询取结果 |

#### 请求参数（提交）

| 参数 | 必填 | 类型 | 含义 |
|------|------|------|------|
| model | 是 | string | 如 `wan2.6-t2i` |
| input | 是 | object | 含 `messages`：`[{ role: "user", content: [{ text: "描述" }] }]` |
| parameters | 否 | object | 如 `size`、`n` 等，由业务传入 |

#### 请求示例（提交）

```bash
curl -X POST 'https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'X-DashScope-Async: enable' \
  -d '{
    "model": "wan2.6-t2i",
    "input": {
      "messages": [{ "role": "user", "content": [{ "text": "一只可爱的猫咪" }] }]
    },
    "parameters": {}
  }'
```

#### 轮询请求

```bash
curl -X GET 'https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}' \
  -H 'Authorization: Bearer YOUR_API_KEY'
```

#### 响应格式

- **提交成功**：HTTP 200，`{"output": {"task_id": "..."}}`。
- **轮询成功**：`output.task_status === "SUCCEEDED"`，图片 URL 在 `output.choices[0].message.content[]` 中。
- **轮询失败**：`output.task_status === "FAILED"`，`output.message` 为错误说明。

#### 核心错误码

| 情况 | 含义 |
|------|------|
| 提交非 2xx | 参数或鉴权错误，见 body |
| task_status=FAILED | 任务失败，见 `output.message` |
| 超时 | 轮询次数用尽仍未 `SUCCEEDED` |

### 2.2 图像编辑（DashScope 双模式）

本项目中的 `edit-image` **保留万象调用方式**，同时新增对 `qwen-image-edit-max` 的兼容，二者不会互相替换。

| 模型 | 接口地址 | 调用方式 | 本项目行为 |
|------|----------|----------|------------|
| `wan2.6-image` | `https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation` | **异步**：POST + `X-DashScope-Async: enable`，再轮询 `/api/v1/tasks/{task_id}` | 保留原有万象图像编辑流程 |
| `qwen-image-edit-max` / `qwen-image-edit-max-2025-12-01` | `https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation` | **同步**：HTTP 200 直接返回结果 | 优先按同步处理；若误走异步且被拒绝，会自动回退到同步 |

#### 模型选择规则（本项目）

1. 先看调用时显式传入的 `model`
2. 若未传，则使用 `backend/config/ai_models.json` 中的 **图像编辑能力块默认模型**（目标态：`dashscope.image_edit.default`）
3. 若传入 `wan2.6-t2i` 用于图片编辑，适配器会自动映射到 `wan2.6-image`
4. 若传入 `qwen-image-edit-max*`，适配器会按同步方式解析响应

#### 同步返回示例（`qwen-image-edit-max`）

```bash
curl -X POST 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -d '{
    "model": "qwen-image-edit-max",
    "input": {
      "messages": [
        {
          "role": "user",
          "content": [
            { "text": "参考图颜色与构图，生成一张简洁风格的水果插画" },
            { "image": "data:image/png;base64,..." }
          ]
        }
      ]
    },
    "parameters": {
      "size": "1280*1280",
      "n": 1,
      "prompt_extend": true,
      "watermark": false,
      "enable_interleave": false
    }
  }'
```

#### 同步响应关键字段

- 图片 URL 位于：`output.choices[0].message.content[].image`
- 某些响应里 **不一定带** `type: "image"`，因此解析时应以是否存在 `image` 字段为准

### 2.3 文生图（Qwen-Image 系列，同步推荐）

#### 接口基本信息

| 项目 | 说明 |
|------|------|
| 地址 | `POST https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation` |
| 类型 | 同步返回（推荐） |
| 模型族 | `qwen-image*`（含 `qwen-image-2.0-*` 等） |

#### 请求体约束（核心）

- `input.messages` 仅支持**单轮**，数组内只有一个 `role=user` 对象
- `content` 中必须且仅包含 **1 个** `{ "text": "..." }`（不传或传多个会报错）

#### 响应取图

- 图片 URL 位于：`output.choices[0].message.content[].image`（URL 通常为临时链接，需及时下载/转存）

### 2.4 图像编辑（Qwen-Image-Edit 系列，同步）

#### 接口基本信息

| 项目 | 说明 |
|------|------|
| 地址 | `POST https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation` |
| 类型 | 同步返回 |
| 模型族 | `qwen-image-edit*`（如 `qwen-image-edit-max*`） |

#### 请求体约束（核心）

- `input.messages` 单轮
- `content` 必须包含：
  - **1~3 个** `{ "image": "公网URL/oss临时URL/dataURL(base64)" }`
  - **且仅 1 个** `{ "text": "编辑指令" }`

#### 响应取图

- 图片 URL 位于：`output.choices[0].message.content[].image`

---

## 3. 语音合成（TTS，多模态接口）

### 接口基本信息

| 项目 | 说明 |
|------|------|
| 地址 | `https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation` |
| 方法 | POST |
| 类型 | 同步，返回 JSON 中含音频 URL，再 GET 该 URL 下载音频二进制 |

> 注意：旧地址 `/api/v1/services/audio/tts/synthesis` 已废弃，会返回「url error」。必须使用多模态 generation 接口。  
> 文档：[Qwen-TTS API](https://help.aliyun.com/zh/model-studio/qwen-tts-api)

### 请求参数

| 参数 | 必填 | 类型 | 含义 |
|------|------|------|------|
| model | 是 | string | 如 `qwen-tts`、`qwen3-tts-flash` |
| input | 是 | object | 含 `text`（必填）、`voice`（必填）、`language_type`（选填） |
| input.text | 是 | string | 待合成文本 |
| input.voice | 是 | string | 音色：Cherry / Ethan / Serena / Chelsie |
| input.language_type | 否 | string | 如 `Chinese`、`English`，默认 Auto |

### 请求示例

```bash
curl -X POST 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -d '{
    "model": "qwen-tts",
    "input": {
      "text": "你好，今天天气怎么样。",
      "voice": "Cherry",
      "language_type": "Chinese"
    }
  }'
```

### 响应格式

- **成功**：HTTP 200，JSON 含 `output.audio.url`（音频文件 URL，有效期约 24 小时）。再对该 URL 发 GET 得到音频二进制（如 wav）。
- **失败**：HTTP 4xx，如 `{"code": "InvalidParameter", "message": "url error, please check url！"}` 表示接口/URL 使用错误；429/503 表示限流或服务不可用，可重试。

### 响应关键字段

| 字段 | 说明 |
|------|------|
| output.audio.url | 音频文件下载地址 |
| output.audio.id | 音频 ID |
| output.audio.expires_at | URL 过期时间戳 |

### 核心错误码

| code / 情况 | 含义 |
|-------------|------|
| InvalidParameter / url error | 接口与模型不匹配或请求 URL 错误（如仍用旧 TTS synthesis 地址） |
| 429 / 503 | 限流或服务暂时不可用，建议退避重试 |
| 400 | 参数错误，见 message |

---

## 4. 视觉理解（VL，多模态对话）

### 接口基本信息

| 项目 | 说明 |
|------|------|
| 地址 | `{baseURL}/chat/completions`，如 `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions` |
| 方法 | POST |
| 类型 | 多模态 Chat Completions，content 中含图片与文本 |

### 请求参数

| 参数 | 必填 | 类型 | 含义 |
|------|------|------|------|
| model | 是 | string | 如 `qwen3-vl-plus` |
| messages | 是 | array | 一条 user 消息，content 为数组 |
| messages[].content[] | 是 | object | 项为 `{ type: "image_url", image_url: { url: dataUrl } }` 或 `{ type: "text", text: "..." }` |

- 本地图片需转为 Data URL：`data:image/png;base64,<base64>` 传入 `image_url.url`。  
- 图像宽高均不小于 10 像素，宽高比不超过 200:1 或 1:200。

### 请求示例

```json
{
  "model": "qwen3-vl-plus",
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "image_url", "image_url": { "url": "data:image/png;base64,iVBORw0KGgo..." } },
        { "type": "text", "text": "描述这张图的内容" }
      ]
    }
  ]
}
```

```bash
curl -X POST 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -d '{"model":"qwen3-vl-plus","messages":[{"role":"user","content":[{"type":"image_url","image_url":{"url":"data:image/png;base64,..."}},{"type":"text","text":"描述这张图"}]}]}'
```

### 响应格式

- **成功**：HTTP 200，与 LLM 一致，`choices[0].message.content` 为助手回复文本。
- **失败**：HTTP 4xx，JSON 中含 code、message。

### 响应关键字段

| 字段 | 说明 |
|------|------|
| choices[0].message.content | 视觉理解后的文本回复 |

### 核心错误码

| code / 说明 | 含义 |
|-------------|------|
| height:1 or width:1 must be larger than 10 | 图片尺寸过小 |
| The provided URL does not appear to be valid | URL 或 Data URL 格式无效 |
| 401 | 未授权 |

---

## 附录：本项目中使用的默认模型与地址

| 能力 | 默认模型 | 说明 |
|------|----------|------|
| LLM | qwen-plus-2025-12-01 | compatible-mode/v1 |
| T2I（文生图） | wan2.6-t2i | `image-generation/generation` + `/api/v1/tasks` |
| ImageEdit（当前 DashScope 配置） | qwen-image-edit-max | `multimodal-generation/generation`，同步返回图片 URL |
| ImageEdit（保留万象模式） | wan2.6-image | `multimodal-generation/generation` + `/api/v1/tasks` |
| TTS | qwen-tts | multimodal-generation/generation（非旧 synthesis） |
| VL | qwen3-vl-plus | compatible-mode/v1/chat/completions |
