# Backend Image Generation — What Atlas Supports

## How to trigger image generation

Atlas returns `IMAGE_GEN` tokens in the chat response. The frontend parses these and sends a separate `POST /api/image` request to generate the actual image.

### Backend: When Atlas emits IMAGE_GEN

The backend auto-injects `IMAGE_GEN` tokens when the user explicitly asks for images using these keywords:

```
generate, create, make, draw, sketch, visualize, design, mockup, wireframe, show me, build me + image|picture|visual|ui|screen|layout|logo|icon|banner|diagram|chart|graphic|illustration
```

Examples that trigger:
- "generate an image of..."
- "show me a mockup of..."
- "draw a logo for..."
- "create a visual of..."

### Backend: Image generation endpoint

**POST /api/image**
```json
{
  "prompt": "dark mobile dashboard UI with gold accents",
  "mode": "render" | "schematic",
  "size": "square" | "landscape" | "portrait"
}
```

Response:
```json
{
  "url": "https://generativelanguage.googleapis.com/...",
  "mimeType": "image/png",
  "mode": "render",
  "prompt": "dark mobile dashboard UI with gold accents"
}
```

## What the backend does NOT do (frontend responsibility)

- **Inline image rendering** — The frontend must detect `IMAGE_GEN` tokens in the SSE stream and render the image inline in the chat bubble.
- **Image version history** — The frontend must track versions of generated images per session.
- **Canvas panel / lightbox** — The frontend must handle tap-to-expand, zoom, pan, etc.
- **Multi-turn refinement** — The frontend must pass a previous image's base64 back to the backend as `imageData` when the user asks to refine it.

## How to implement refinement

Send the previous image as `imageData` alongside the message:

```json
{
  "message": "make it glow more",
  "imageData": {
    "base64": "iVBORw0KGgo...",
    "mediaType": "image/png"
  }
}
```

The backend passes this to Gemini Imagen 3 for image-to-image refinement.

## Dual engines

- **Render mode**: Gemini Imagen 3 (creative visuals, mockups, product shots)
- **Schematic mode**: DALL-E 3 (diagrams, wireframes, architecture)
- Auto-fallback between engines if one fails

## What changed today (reverted)

The following backend changes were reverted because the frontend in this repo is NOT the live frontend:

- Proactive visual generation (removed from system prompt)
- Refinement keywords (refine, improve, update, redesign) removed from auto-detection
- Focus chip system prompt (removed from nexus.ts)

The backend remains clean. The frontend repo (`jochanae/atlas-idk`) is where you implement the UI.
