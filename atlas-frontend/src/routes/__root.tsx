import {
  Outlet,
  createRootRoute,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import "../styles.css";
import NotFound from "@/pages/not-found";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Atlas — Decision Enforcement System" },
      {
        name: "description",
        content:
          "Atlas: a decision enforcement system. Permanent record of architectural decisions, costs, and bought lessons.",
      },
    ],
  }),
  shellComponent: RootShell,
  component: () => <Outlet />,
  notFoundComponent: NotFound,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" style={{ background: "#0D0B09" }}>
      <head>
        <HeadContent />
        <style>{`html,body{background:#0D0B09 !important;}`}</style>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
  var KEY='__atlas_chunk_reload__';
  var RX=/Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|Unable to preload CSS|Loading chunk \\\\d+ failed|Loading CSS chunk/i;
  function clearRuntimeCaches(){
    try{
      if('caches' in window){
        caches.keys().then(function(keys){
          return Promise.all(keys.map(function(key){ return caches.delete(key); }));
        }).catch(function(){});
      }
      if('serviceWorker' in navigator){
        navigator.serviceWorker.getRegistrations().then(function(regs){
          return Promise.all(regs.map(function(reg){ return reg.unregister(); }));
        }).catch(function(){});
      }
    }catch(_){ }
  }
  function reload(msg){
    try{
      if(!msg||!RX.test(String(msg)))return false;
      var last=Number(sessionStorage.getItem(KEY)||0);
      if(Date.now()-last<10000)return false;
      sessionStorage.setItem(KEY,String(Date.now()));
      clearRuntimeCaches();
      location.reload();
      return true;
    }catch(_){return false;}
  }
  window.addEventListener('error',function(e){
    var m=e&&(e.message||(e.error&&e.error.message));
    if(reload(m)){e.preventDefault&&e.preventDefault();}
  },true);
  window.addEventListener('unhandledrejection',function(e){
    var r=e&&e.reason;
    var m=r&&(r.message||String(r));
    if(reload(m)){e.preventDefault&&e.preventDefault();}
  });
})();`,
          }}
        />
      </head>
      <body style={{ background: "#0D0B09" }}>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
