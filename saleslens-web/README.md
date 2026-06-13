# SalesLens Web

Private web version of SalesLens.

## Local Setup

Copy `.env.example` to `.env.local` and fill in the Supabase values:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

Install dependencies and run:

```bash
npm install
npm run dev
```

## Deployment

Deploy this folder to Vercel. Add the same environment variables in the Vercel project settings.

## Supabase Setup

1. Open the Supabase project.
2. Go to SQL Editor.
3. Open `supabase/schema.sql` from this repo.
4. Paste the full SQL into Supabase and run it.
5. Confirm the tables exist:
   - `customers`
   - `uploads`
   - `sales_records`
   - `product_images`
   - `style_catalog_entries`

For the first private version, Row Level Security allows any authenticated SalesLens user to read and manage data. Before inviting anyone else, tighten this with account/user roles.

## Import Local Mac App Data

Create `.env.import.local` from `.env.import.example` and add the Supabase service role key. Do not commit this file.

```bash
node scripts/import-local-data.mjs --replace
```

The importer reads:

```text
~/Library/Application Support/SalesLens/sales-records.json
~/Library/Application Support/SalesLens/ProductImages/associations.json
```

## Sync Local Product Images

To make cached Rebel Rags product images available to the web app, use the same `.env.import.local` service role key and run:

```bash
npm run sync:images
```

The script uploads local files from:

```text
~/Library/Application Support/SalesLens/ProductImages/*.image
```

It creates or updates the public Supabase Storage bucket `product-images`, then upserts matching `product_images` rows for Rebel Rags.
