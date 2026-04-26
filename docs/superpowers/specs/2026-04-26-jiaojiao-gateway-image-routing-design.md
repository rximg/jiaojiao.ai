# jiaojiao-gateway 图像路由对齐方案（对齐 DashScope 两协议族）

日期：2026-04-26  
状态：Draft（供网关仓库实现）  
范围：**仅方案文档**。不在本仓库对 `deploy/jiaojiao-gateway` 做实现改动。

---

## 目标

让应用侧可以在 **DashScope 直连** 与 **jiaojiao-gateway** 之间做到“图像接口层面无缝切换”，核心要求：

- 对外暴露两条路由，分别对应 DashScope 的两类图像协议族：
  - **同步 multimodal**：`/api/v1/services/aigc/multimodal-generation/generation`
  - **异步任务 image-generation**：`/api/v1/services/aigc/image-generation/generation` + `/api/v1/tasks/{task_id}`
- 网关内部完成 local/online 分流与必要的协议适配（“路由内部统一”）。

---

## 外部契约（网关对外 API）

### 1) 同步 multimodal-generation

- **POST** `/api/v1/services/aigc/multimodal-generation/generation`
- **承载模型族**：
  - 文生图：`qwen-image`*
  - 图像编辑：`qwen-image-edit*`
  -（可选）TTS/VL：若网关希望进一步统一多模态能力，可继续承载，但本方案的“必须”只覆盖图像能力
- **请求体形态**：与 DashScope 官方一致（`model` + `input.messages` + `parameters`）
- **响应形态**：同步返回 `output.choices[0].message.content[].image`

### 2) 异步 image-generation

- **POST** `/api/v1/services/aigc/image-generation/generation`
- **承载模型族**：
  - 文生图：`wan2.6-t2i`（以及其他仍采用 task 模式的模型）
- **请求头**：
  - `X-DashScope-Async: enable`（对 online 上游保持一致；对 local 可由网关兼容忽略）
- **响应形态**：
  - 提交返回 `output.task_id`
  - 查询用 `GET /api/v1/tasks/{task_id}`

### 3) 任务查询 tasks

- **GET** `/api/v1/tasks/{task_id}`
- **路由规则**：
  - 任务前缀（如 `qi_` / `qe_`）→ local unified
  - 其他 task_id → online（DashScope）

---

## 协议族与模型族映射（权威规则）


| 模型族             | 示例                              | 协议族                          | 对外路由                                                         |
| --------------- | ------------------------------- | ---------------------------- | ------------------------------------------------------------ |
| Qwen-Image      | `qwen-image`、`qwen-image-2.0-`* | multimodal（同步）               | `POST /multimodal-generation/generation`                     |
| Qwen-Image-Edit | `qwen-image-edit-max*`          | multimodal（同步）               | `POST /multimodal-generation/generation`                     |
| Wan（万相）         | `wan2.6-t2i`                    | image-generation + tasks（异步） | `POST /image-generation/generation` + `GET /tasks/{task_id}` |


> 关键点：不再按 `adapter_type=text_to_image/image_edit` 将在线请求一律打到同一路径；必须按协议族分流。

---

## 网关内部实现建议（供网关仓库落地）

### A. 入口函数按“对外路径”决定协议族

- 命中 `/multimodal-generation/generation`：
  - online：转发到 DashScope `.../multimodal-generation/generation`
  - local：若 local 只实现 image-generation 风格接口，则在网关内做请求体适配（把 multimodal 的 `messages` 转换为 local 可理解的 payload）
- 命中 `/image-generation/generation`：
  - online：转发到 DashScope `.../image-generation/generation`（保持异步任务）
  - local：转发到 local unified 的 image-generation 接口，并保持 `task_id` 前缀策略

### B. 配置与路由表（configs.json）

建议在网关的模型映射配置中显式增加字段，避免用字符串前缀猜测：

- `protocol_family`: `multimodal_sync` | `image_generation_async`
- `backend_type`: `local` | `online`
- `endpoint`: upstream base url
- `task_prefix`: local task id 前缀（如 `qi_` / `qe_`）

> 这样路由决策完全配置驱动，避免“某次新增模型族导致误路由”。

---

## 兼容策略

本方案**不提供旧入口兼容**，以最终最佳实践为准：

- `qwen-image`* 与 `qwen-image-edit*` 只能通过 `POST /api/v1/services/aigc/multimodal-generation/generation` 调用
- `wan2.6-t2i`（以及其他 task 模式模型）只能通过 `POST /api/v1/services/aigc/image-generation/generation` + `GET /api/v1/tasks/{task_id}` 调用
- 网关不需要为历史客户端提供“单入口/自动分流/软兼容”模式，避免协议语义再次混淆

---

## 测试清单（网关仓库）

### 单测（路由决策）

- 给定不同 `path` + `model` 的组合，断言选中的 `protocol_family` 与 upstream path 正确。

### 集成测试（真实上游）

- `qwen-image` 文生图：`POST /multimodal-generation/generation` 返回图片 URL
- `qwen-image-edit-max` 图像编辑：`POST /multimodal-generation/generation`（含 1 张 image）返回图片 URL
- `wan2.6-t2i` 文生图：`POST /image-generation/generation` 返回 task_id，`GET /tasks/{task_id}` 最终返回图片 URL

### 本地 unified 回归

- local 文生图返回 `qi`_ task_id，`GET /tasks/qi_...` 可取结果
- local 图像编辑返回 `qe`_ task_id，`GET /tasks/qe_...` 可取结果