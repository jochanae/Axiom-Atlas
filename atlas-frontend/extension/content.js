// Atlas IDE — Content Script
// Extracts page metadata when triggered

function extractMetadata() {
  const meta = {};
  
  // Basic info
  meta.title = document.title;
  meta.url = location.href;
  meta.description = document.querySelector('meta[name="description"]')?.content || "";
  
  // Open Graph
  meta.ogTitle = document.querySelector('meta[property="og:title"]')?.content || "";
  meta.ogDescription = document.querySelector('meta[property="og:description"]')?.content || "";
  meta.ogImage = document.querySelector('meta[property="og:image"]')?.content || "";
  
  // Tech stack hints
  const scripts = Array.from(document.querySelectorAll('script[src]')).map(s => s.src);
  meta.frameworks = [];
  if (scripts.some(s => s.includes('react'))) meta.frameworks.push('React');
  if (scripts.some(s => s.includes('vue'))) meta.frameworks.push('Vue');
  if (scripts.some(s => s.includes('angular'))) meta.frameworks.push('Angular');
  if (scripts.some(s => s.includes('next'))) meta.frameworks.push('Next.js');
  if (document.querySelector('[data-reactroot], [data-reactid], #__next')) meta.frameworks.push('React (DOM)');
  
  // Color palette from CSS custom properties
  const rootStyles = getComputedStyle(document.documentElement);
  meta.colors = {
    background: rootStyles.getPropertyValue('--background')?.trim() || rootStyles.backgroundColor,
    foreground: rootStyles.getPropertyValue('--foreground')?.trim() || rootStyles.color,
  };
  
  // Headings
  meta.headings = Array.from(document.querySelectorAll('h1, h2')).slice(0, 5).map(h => ({
    level: h.tagName,
    text: h.textContent?.trim().slice(0, 100) || "",
  }));
  
  // Font
  meta.font = rootStyles.fontFamily;
  
  return meta;
}

// Listen for extraction request from popup/background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "extract-metadata") {
    const metadata = extractMetadata();
    sendResponse({ metadata });
    return true;
  }
});
