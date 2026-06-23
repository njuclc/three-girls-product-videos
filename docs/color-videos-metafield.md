# `custom.color_videos` 产品视频字段说明（消费端对接）

本工具把每个产品的颜色视频配置写入产品的一个 JSON metafield。消费端（店面主题 / 前端）据此为不同颜色播放对应视频，并在缺失时回退到默认视频。

## Metafield 位置

| 项 | 值 |
| --- | --- |
| owner | Product |
| namespace | `custom` |
| key | `color_videos` |
| type | `json` |

读取方式：

- **Liquid（主题）**：`product.metafields.custom.color_videos.value`
- **Storefront API**：`product.metafield(namespace: "custom", key: "color_videos").value`（返回字符串，需 `JSON.parse`）

## 数据结构

```jsonc
{
  "version": 1,                       // schema 版本号
  "colors": {
    // key = 颜色的 publicTitle（与产品 swatch 颜色名一致）
    "Creamy Green (White Green)": {
      "variantId": 50632095727937,    // 该颜色对应的 variant id（number | null）
      "videos": [
        {
          "fileId": "gid://shopify/Video/55889763336513", // Shopify Video 文件 GID（唯一标识）
          "url": "https://cdn.shopify.com/videos/.../xxx.mp4", // 可直接 <video> 播放的 mp4 地址
          "filename": "AD148-2.MOV",   // 原始上传文件名（展示用）
          "status": "READY",           // 转码状态：READY / PROCESSING / FAILED / UNKNOWN
          "poster": "https://cdn.shopify.com/.../xxx.thumbnail.0000000000.jpg" // 封面图 URL
        }
        // ... 同一颜色可有多个视频
      ]
    },

    // 保留 key：产品级默认 / 回退视频列表
    "__default__": {
      "variantId": null,
      "videos": [ /* 同上结构 */ ]
    }
  }
}
```

### 字段含义

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `version` | number | schema 版本，当前为 `1` |
| `colors` | object | key 为颜色 `publicTitle`，value 见下 |
| `colors[*].variantId` | number \| null | 该颜色对应的 variant id |
| `colors[*].videos` | array | 该颜色的视频条目列表 |
| `videos[*].fileId` | string | Shopify Video 文件 GID，唯一标识 |
| `videos[*].url` | string | 可直接播放的 mp4 地址；转码完成前可能为空 |
| `videos[*].filename` | string | 原始上传文件名，仅展示用 |
| `videos[*].status` | string | `READY` / `PROCESSING` / `FAILED` / `UNKNOWN` |
| `videos[*].poster` | string | 封面图 URL；个别老数据可能为空字符串 |

## 消费端关键约定

1. **按颜色取视频**：用当前选中颜色的 `publicTitle` 去 `colors[publicTitle]?.videos` 查询；也可用 `variantId` 反查（每个颜色项都带 `variantId`）。
2. **回退逻辑**：`colors["__default__"]` 是**保留 key**，表示产品级默认视频列表。当某个颜色没有对应条目（或其 `videos` 为空 / 无可播放视频）时，回退到 `__default__`。
3. **`__default__` 不是真实颜色**：遍历 `colors` 渲染颜色时**必须跳过它**。
4. **只播放可用视频**：仅使用 `status === "READY"` 且 `url` 非空的条目。`PROCESSING` 表示仍在转码，`FAILED` 应忽略。
5. **封面图**：`poster` 可直接用作 `<video poster="...">` 或加载前占位图；为空时需做兜底。

## 取视频示例

```js
const raw = product.metafields?.custom?.color_videos?.value ?? '{"colors":{}}';
const map = JSON.parse(raw);

const playable = (entry) =>
  (entry?.videos ?? []).filter((v) => v.status === "READY" && v.url);

/** 返回某颜色应展示的视频；无专属视频时回退到默认列表。 */
function videosForColor(colorTitle) {
  const own = playable(map.colors[colorTitle]);
  return own.length ? own : playable(map.colors["__default__"]);
}

/** 遍历真实颜色（跳过保留的默认 key）。 */
const realColors = Object.keys(map.colors).filter((k) => k !== "__default__");
```

## 真实示例

产品 `Aurelia Ditsy Floral Jacquard Curtains`（handle: `aurelia-jacquard-floral-pinch-pleated-curtains`）：

```json
{
  "version": 1,
  "colors": {
    "Creamy Green (White Green)": {
      "variantId": 50632095727937,
      "videos": [
        {
          "fileId": "gid://shopify/Video/55889763336513",
          "url": "https://cdn.shopify.com/videos/c/vp/d7b9e7e63b114a8b945dfc053f71ee0d/d7b9e7e63b114a8b945dfc053f71ee0d.SD-480p-1.2Mbps-86654709.mp4",
          "filename": "AD148-2.MOV",
          "status": "READY",
          "poster": "https://cdn.shopify.com/s/files/1/0908/8326/0737/files/preview_images/d7b9e7e63b114a8b945dfc053f71ee0d.thumbnail.0000000000.jpg?v=1781602658"
        }
      ]
    },
    "__default__": {
      "variantId": null,
      "videos": [
        {
          "fileId": "gid://shopify/Video/55949456769345",
          "url": "https://cdn.shopify.com/videos/c/vp/142ddd1fa0fa40f3ab093b765dc12f5a/142ddd1fa0fa40f3ab093b765dc12f5a.SD-480p-1.5Mbps-87097125.mp4",
          "filename": "Aurelia-Cream Green-Unined (2).mp4",
          "status": "READY",
          "poster": "https://cdn.shopify.com/s/files/1/0908/8326/0737/files/preview_images/142ddd1fa0fa40f3ab093b765dc12f5a.thumbnail.0000000000.jpg?v=1782105996"
        }
      ]
    }
  }
}
```
