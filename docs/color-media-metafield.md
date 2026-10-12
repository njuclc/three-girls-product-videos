# `custom.color_media` 颜色主图媒体字段说明（消费端对接）

本工具把每个产品的"颜色 → 主图区媒体集"配置写入产品的一个 JSON metafield。消费端（店面主题）在购物者点击颜色 swatch 时，把 PDP 主图区切换为该颜色的媒体集；**该颜色没有配置（或无可渲染条目）时，回退展示产品原生 `product.media` 列表，即保持主题默认行为**。

与 `custom.color_videos`（"Real Case Show" 视频块的数据源）相互独立、互不影响。

## Metafield 位置

| 项 | 值 |
| --- | --- |
| owner | Product |
| namespace | `custom` |
| key | `color_media` |
| type | `json` |

读取方式：

- **Liquid（主题）**：`product.metafields.custom.color_media.value`
- **Storefront API**：`product.metafield(namespace: "custom", key: "color_media").value`（返回字符串，需 `JSON.parse`）

## 数据结构

```jsonc
{
  "version": 1,                       // schema 版本号
  "colors": {
    // key = 颜色的 publicTitle（与产品 swatch 颜色名、color_videos 的 key 一致）
    "Creamy Green (White Green)": {
      "media": [
        // 来源一：本工具上传的文件（Shopify Files，不在产品 media 里）
        {
          "kind": "upload",
          "type": "image",                        // "image" | "video"
          "fileId": "gid://shopify/MediaImage/123", // 唯一标识
          "url": "https://cdn.shopify.com/...",     // 可直接展示的 CDN 地址
          "width": 2048,                            // 原始像素宽（image；可能缺省）
          "height": 2048,
          "filename": "green-1.jpg",               // 原始文件名（展示用）
          "status": "READY"                         // READY / PROCESSING / FAILED / UNKNOWN
        },
        {
          "kind": "upload",
          "type": "video",
          "fileId": "gid://shopify/Video/456",
          "url": "https://cdn.shopify.com/videos/.../xxx.mp4",
          "poster": "https://cdn.shopify.com/.../xxx.thumbnail.jpg", // 封面
          "filename": "green.mp4",
          "status": "READY"
        },
        // 来源二：对产品已有 media 的引用（只存 id，不存 url ——
        // 产品视频的 url 会过期，且主题端可直接用 product.media 按 id 渲染）
        {
          "kind": "product_media",
          "mediaId": "gid://shopify/ProductMedia/789",
          "type": "image"               // "image" | "video"（工具端只允许写入这两种）
        }
      ]
    }
  }
}
```

### 字段含义

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `version` | number | schema 版本，当前为 `1` |
| `colors` | object | key 为颜色 `publicTitle`，value 见下 |
| `colors[*].media` | array | 该颜色的媒体条目，**数组顺序即展示顺序**（运营拖拽排序） |
| `media[*].kind` | string | `upload`（工具上传的文件）或 `product_media`（产品 media 引用） |
| `media[*].type` | string | `image` / `video`（`product_media` 理论上还可能出现 `external_video`、`model`，消费端遇到应跳过） |
| `media[*].fileId` | string | kind=upload 时：Shopify 文件 GID，条目唯一标识 |
| `media[*].url` | string | kind=upload 时：CDN 地址；视频转码完成前可能为空 |
| `media[*].poster` | string | kind=upload 且 type=video 时：封面图 URL |
| `media[*].width` / `height` | number | kind=upload 且 type=image 时：原始尺寸（旧数据可能缺省） |
| `media[*].filename` | string | 原始文件名，仅展示用 |
| `media[*].status` | string | kind=upload 时：`READY` / `PROCESSING` / `FAILED` / `UNKNOWN` |
| `media[*].mediaId` | string | kind=product_media 时：`ProductMedia` GID |

**没有 `variantId`、没有 `__default__`**：free-swatch 数据里的 variant id 属于色卡产品，与本产品无关（`color_videos` 历史字段里的同名键同样如此，消费端从未使用）；未配置颜色的回退就是产品原生 `product.media`，不需要默认集。

## 消费端关键约定

1. **按颜色取媒体**：用当前选中颜色的 `publicTitle` 查 `colors[publicTitle]?.media`。
2. **条目唯一标识**：`kind === "upload" ? fileId : mediaId`。
3. **product_media 引用不存 url**：渲染时在 `product.media` 里按 `mediaId` 找到对应 media（Liquid 端 `product.media | where: "id", mediaId` 的等价做法），用主题现有的 media 渲染方式（图片 `preview_image`，视频原生 `<video>`）。找不到（产品 media 被删）时跳过该条。
4. **只渲染可用条目**：kind=upload 时仅用 `status === "READY"` 且 `url` 非空的条目；`PROCESSING` 跳过，`FAILED` 忽略。
5. **回退逻辑**：颜色无条目、或过滤后为空 → 不接管主图区，展示产品原生 media 列表（主题默认行为）。
6. **顺序即数组顺序**，消费端不重排。

## 取媒体示例

```js
const raw = product.metafields?.custom?.color_media?.value ?? '{"colors":{}}';
const map = typeof raw === "string" ? JSON.parse(raw) : raw;

const renderable = (entry) =>
  entry.kind === "product_media" ||
  (entry.status === "READY" && entry.url);

/** 返回某颜色应展示的媒体条目；空数组表示回退产品原生 media。 */
function mediaForColor(colorTitle) {
  return (map.colors[colorTitle]?.media ?? []).filter(renderable);
}
```
