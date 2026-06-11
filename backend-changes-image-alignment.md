# Backend Changes: Image Alignment

## What changed

The backend now stores generated images in the database, so they persist across page refreshes.

### 1. Database columns added

```sql
ALTER TABLE "chat_messages" ADD COLUMN "image_b64" text;
ALTER TABLE "chat_messages" ADD COLUMN "image_mime_type" text;
```

Applied to the dev database (Neon prod needs manual application).

### 2. Backend saves images on assistant message insert

In `artifacts/api-server/src/routes/chat.ts`, when the assistant message is saved:

```typescript
imageB64: imageGenResult?.images?.[0]?.imageUrl.split(",")[1] ?? null,
imageMimeType: imageGenResult?.images?.[0]?.imageUrl.startsWith("data:image/jpeg") ? "image/jpeg" : "image/png",
```

### 3. OpenAPI spec updated

`Message` schema now includes:
```yaml
imageB64:
  type: ["string", "null"]
imageMimeType:
  type: ["string", "null"]
```

### 4. API client regenerated

`lib/api-client-react/src/generated/api.schemas.ts` now has:
```typescript
imageB64?: string | null;
imageMimeType?: string | null;
```

## What you need to do in your frontend

Your frontend already references `imageB64` in the message rendering code. The types should now match. If you see TypeScript errors, run the codegen in your frontend repo:

```bash
# In your frontend repo (atlas-idk)
pnpm run codegen  # or whatever generates the API client
```

Then verify that `ChatMessage` type includes `imageB64` and `imageMimeType`.

## Files changed in backend

- `lib/db/src/schema/chat_messages.ts` — added columns
- `lib/db/migrations/0015_chat_message_images.sql` — migration
- `artifacts/api-server/src/routes/chat.ts` — save image on insert
- `lib/api-spec/openapi.yaml` — updated Message schema
- `lib/api-client-react/src/generated/api.schemas.ts` — regenerated
