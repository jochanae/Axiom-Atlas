# Frontend Sync Checklist — Make Images Work

## What I fixed in the backend

- Database: `image_b64` and `image_mime_type` columns added
- Backend: saves generated image base64 when assistant message is stored
- API types: `Message` now includes `imageB64` and `imageMimeType`

## What you need to do in your frontend (atlas-idk)

### Step 1: Check that your ChatMessage type includes image fields

In your frontend, the `ChatMessage` type should look like this:

```typescript
type ChatMessage = {
  id?: number | string;
  role: "user" | "assistant";
  content: string;
  // ... other fields
  imageB64?: string;
  imageMimeType?: string;
};
```

If `imageB64` and `imageMimeType` are missing, add them.

### Step 2: Check that `doSend` passes `imageData` for refinement

When you refine an image, `doSend` must send the base64 image back to the backend:

```typescript
doSend("make it glow more", sessionId, messages, null, {
  base64: "base64 string here",
  mediaType: "image/jpeg"  // or "image/png"
});
```

### Step 3: Check that the backend SSE response includes `imageGen`

The backend sends images in the SSE `done` event as:

```typescript
{
  type: "done",
  content: "...",
  imageGen: {
    images: [{
      imageUrl: "data:image/jpeg;base64,...",
      prompt: "...",
      model: "imagen-3",
      mode: "render"
    }]
  }
}
```

Your frontend should extract the image and store it on the message.

### Step 4: When the assistant message arrives with an image

When you receive the `done` event with `imageGen`, save the image to the message:

```typescript
const image = res.imageGen?.images?.[0];
if (image) {
  // Add to the assistant message
  assistantMessage.imageB64 = image.imageUrl.split(",")[1];
  assistantMessage.imageMimeType = image.imageUrl.startsWith("data:image/jpeg")
    ? "image/jpeg" : "image/png";
}
```

### Step 5: Render inline images in chat

In your chat bubble component, render the image when `imageB64` exists:

```tsx
{message.imageB64 && (
  <img
    src={`data:${message.imageMimeType ?? "image/png"};base64,${message.imageB64}`}
    alt="Generated visual"
    style={{ maxWidth: "100%", borderRadius: 10 }}
  />
)}
```

### Step 6: Tap-to-open CanvasPanel

When the user taps the image, open the CanvasPanel with version history.

## Quick verification

1. Open a workspace
2. Ask Atlas: "draw a red circle"
3. Check if the image appears in the chat
4. Tap the image to open the canvas panel
5. Type a refinement and send
6. Check if the new image appears in the version strip

If any of these steps don't work, tell me which one and I'll fix the backend.
