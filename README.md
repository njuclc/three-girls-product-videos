# Product color video config

An internal tool (Next.js, deployable on Vercel) for configuring the demo video
that plays when a shopper clicks each fabric color on a Shopify product.

It does three things:

1. **Search products** in your Shopify store.
2. **Show a product's fabric colors** — parsed from the storefront product page
   `<script data-free-swatch-variants="json">`, with automatic fallback to the
   `custom.free_swatch` metafield (so it works even on password-protected dev
   stores).
3. **Upload a video per color** to Shopify Files and save the result into the
   product's `custom.color_videos` JSON metafield.

Unlike a Shopify embedded app, this needs **no Partner app, no OAuth and no
tunnel** — it talks to the Admin API with a custom-app access token.

## 1. Create a Shopify Admin API token

In your store admin: **Settings → Apps and sales channels → Develop apps →
Create an app**. Under **Configuration → Admin API integration**, grant:

- `read_products`, `write_products`
- `read_files`, `write_files`

**Install** the app, then reveal the **Admin API access token** (`shpat_...`).

## 2. Configure environment

Copy `.env.example` to `.env.local` and fill in:

| Variable | Description |
| --- | --- |
| `SHOPIFY_STORE_DOMAIN` | e.g. `three-girls-develop.myshopify.com` |
| `SHOPIFY_ADMIN_TOKEN` | the `shpat_...` token |
| `SHOPIFY_API_VERSION` | e.g. `2025-10` |
| `APP_PASSWORD` | password that gates this tool (leave empty only for local dev) |

## 3. Run locally

```bash
npm install
npm run dev
# open http://localhost:3000
```

## 4. Deploy to Vercel

```bash
npm i -g vercel   # if needed
vercel            # link/create the project
vercel --prod
```

Set the four environment variables in **Vercel → Project → Settings →
Environment Variables** (same names as above). Redeploy.

## How video upload works (and why)

Vercel serverless functions cap request bodies at ~4.5 MB, so the video bytes
**never pass through the server**:

1. Browser → `POST /api/upload/stage` → server calls `stagedUploadsCreate` and
   returns a Shopify staged upload target.
2. Browser uploads the file **directly** to that target.
3. Browser → `POST /api/upload/register` → server calls `fileCreate` and writes
   the entry into the `custom.color_videos` metafield.

Shopify transcodes videos asynchronously, so a freshly uploaded video shows as
`PROCESSING` until you click **Refresh status** (which fills in the playable
CDN URL).

## The metafield it writes — `custom.color_videos` (type `json`)

```json
{
  "version": 1,
  "colors": {
    "Linen White": {
      "variantId": 123456789,
      "videos": [
        {
          "fileId": "gid://shopify/Video/123",
          "url": "https://cdn.shopify.com/videos/.../file.mp4",
          "filename": "white.mp4",
          "status": "READY"
        }
      ]
    }
  }
}
```

Your theme reads this keyed by color name (`public_title`) to swap the `<video>`
when a swatch is clicked.
