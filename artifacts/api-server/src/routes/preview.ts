import { Router } from "express";
import { db, sessionsTable, chatMessagesTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

const router = Router();

// Extract FILE_EDIT blocks from a message
function parseFileEdits(content: string): Array<{ path: string; language: string; content: string }> {
  const files: Array<{ path: string; language: string; content: string }> = [];
  const regex = /FILE_EDIT_START\npath: ([^\n]+)\nlanguage: ([^\n]+)\nFILE_EDIT_CONTENT\n([\s\S]*?)\nFILE_EDIT_END/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    files.push({
      path: match[1].trim(),
      language: match[2].trim(),
      content: match[3].trim(),
    });
  }
  return files;
}

// Build a standalone HTML page that renders a React component
function buildComponentPreview(componentCode: string, componentName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview - ${componentName}</title>
  <script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0C0A09;
      color: #E7E5E4;
      font-family: system-ui, -apple-system, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    #root { width: 100%; max-width: 100%; }
    .preview-container {
      background: #1C1917;
      border: 1px solid #252220;
      border-radius: 12px;
      overflow: hidden;
      width: 100%;
    }
    .error-banner {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #ef4444;
      padding: 12px 16px;
      border-radius: 8px;
      font-family: monospace;
      font-size: 12px;
      margin: 16px;
      white-space: pre-wrap;
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel">
    const { useState, useEffect, useRef, useCallback, useMemo } = React;

    // Error boundary
    class ErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
      }
      static getDerivedStateFromError(error) {
        return { hasError: true, error };
      }
      render() {
        if (this.state.hasError) {
          return React.createElement('div', { className: 'error-banner' },
            'Preview error: ' + this.state.error?.message || 'Unknown error'
          );
        }
        return this.props.children;
      }
    }

    // Stub common components Atlas might reference
    const Stub = ({ name }) => React.createElement('div', {
      style: {
        padding: '8px 12px',
        border: '1px dashed rgba(201,162,76,0.3)',
        borderRadius: 6,
        color: 'rgba(201,162,76,0.6)',
        fontSize: 11,
        fontFamily: 'monospace',
      }
    }, name);

    // Component from Atlas
    ${componentCode}

    // Render
    const root = ReactDOM.createRoot(document.getElementById('root'));
    root.render(
      React.createElement(ErrorBoundary, null,
        React.createElement('div', { className: 'preview-container' },
          typeof ${componentName} !== 'undefined'
            ? React.createElement(${componentName})
            : React.createElement(Stub, { name: 'Component not found: ${componentName}' })
        )
      )
    );
  </script>
</body>
</html>`;
}

// Build a preview HTML page from multiple files
function buildMultiFilePreview(files: Array<{ path: string; content: string }>): string {
  // Find the main component (largest file, or first .tsx file)
  const mainFile = files.find(f => f.path.endsWith('.tsx')) || files[0];
  const componentName = mainFile?.path.split('/').pop()?.replace(/\.tsx?$/, '') || 'Component';

  // Build imports from other files
  const otherFiles = files.filter(f => f.path !== mainFile?.path);
  const moduleCode = otherFiles.map(f => {
    const name = f.path.split('/').pop()?.replace(/\.tsx?$/, '') || 'Module';
    return `
// ${f.path}
${f.content}
`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview</title>
  <script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0C0A09;
      color: #E7E5E4;
      font-family: system-ui, -apple-system, sans-serif;
      min-height: 100vh;
    }
    #root { width: 100%; min-height: 100vh; }
    .error-banner {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #ef4444;
      padding: 12px 16px;
      border-radius: 8px;
      font-family: monospace;
      font-size: 12px;
      margin: 16px;
      white-space: pre-wrap;
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel">
    const { useState, useEffect, useRef, useCallback, useMemo } = React;

    class ErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
      }
      static getDerivedStateFromError(error) {
        return { hasError: true, error };
      }
      render() {
        if (this.state.hasError) {
          return React.createElement('div', { className: 'error-banner' },
            'Preview error: ' + (this.state.error?.message || 'Unknown error')
          );
        }
        return this.props.children;
      }
    }

    ${moduleCode}

    ${mainFile?.content || ''}

    const root = ReactDOM.createRoot(document.getElementById('root'));
    const Component = typeof ${componentName} !== 'undefined' ? ${componentName} : () => React.createElement('div', null, 'Component not found');
    root.render(
      React.createElement(ErrorBoundary, null,
        React.createElement(Component)
      )
    );
  </script>
</body>
</html>`;
}

// GET /api/preview/session/:sessionId - renders the latest FILE_EDIT as a preview page
router.get("/preview/session/:sessionId", async (req, res): Promise<void> => {
  const sessionId = Number(req.params.sessionId);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    res.status(400).json({ error: "Invalid session id" });
    return;
  }

  try {
    // Get the latest assistant message
    const messages = await db
      .select()
      .from(chatMessagesTable)
      .where(eq(chatMessagesTable.sessionId, sessionId))
      .orderBy(desc(chatMessagesTable.createdAt))
      .limit(10);

    const assistantMsg = messages.find(m => m.role === "assistant");
    if (!assistantMsg) {
      res.status(404).json({ error: "No assistant message found" });
      return;
    }

    const files = parseFileEdits(assistantMsg.content);
    if (files.length === 0) {
      res.status(404).json({ error: "No FILE_EDIT blocks found in this session" });
      return;
    }

    const html = buildMultiFilePreview(files);
    res.setHeader("Content-Type", "text/html");
    res.setHeader("X-Frame-Options", "ALLOWALL");
    res.setHeader("Content-Security-Policy", "frame-ancestors *");
    res.send(html);
  } catch (err) {
    console.error("Preview error:", err);
    res.status(500).json({ error: "Failed to generate preview" });
  }
});

// GET /api/preview/component - POST a component and get a preview
router.post("/preview/component", async (req, res): Promise<void> => {
  const { code, componentName = "Component" } = req.body as { code: string; componentName?: string };

  if (!code || typeof code !== "string") {
    res.status(400).json({ error: "code is required" });
    return;
  }

  try {
    const html = buildComponentPreview(code, componentName);
    res.setHeader("Content-Type", "text/html");
    res.setHeader("X-Frame-Options", "ALLOWALL");
    res.setHeader("Content-Security-Policy", "frame-ancestors *");
    res.send(html);
  } catch (err) {
    console.error("Preview error:", err);
    res.status(500).json({ error: "Failed to generate preview" });
  }
});

export default router;
