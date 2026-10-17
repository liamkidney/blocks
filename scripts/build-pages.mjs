// Assemble production and development PWAs under one GitHub Pages artifact.
// Usage: node scripts/build-pages.mjs <source-dir> <output-dir> <prod|dev> <commit-sha>
import {copyFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";

const [source,output,channel,revision]=process.argv.slice(2);
if(!source||!output||!["prod","dev"].includes(channel)||!revision)
  throw new Error("Usage: build-pages.mjs <source> <destination> <prod|dev> <revision>");

const assets=[
  "index.html","styles.css","tetrominoes.js","game.js","session.js","app.js",
  "multiplayer.js","manifest.json","sw.js","version.js","config.js",
  "player-name.js","score-sync.js","high-scores.js",
  "icon.svg","favicon-32.png","apple-touch-icon.png","icon-192.png","icon-512.png"
];
mkdirSync(output,{recursive:true});
for(const name of assets){
  const from=join(source,name);
  if(!existsSync(from))throw new Error("Missing build asset: "+from);
  copyFileSync(from,join(output,name));
}
// New game modes are present in dev only until gameplay is explicitly released.
if(channel==="dev"&&!existsSync(join(source,"game-modes.js")))
  throw new Error("Missing dev game-modes.js");
if(existsSync(join(source,"game-modes.js")))
  copyFileSync(join(source,"game-modes.js"),join(output,"game-modes.js"));

// Developer-only inspectors are not published under the production PWA.
if(channel==="dev"){
  for(const name of ["scores-test.html","players-test.html","leaderboard-test.html"]){
    const sourcePath=join(source,name);
    if(!existsSync(sourcePath))throw new Error("Missing dev inspector: "+sourcePath);
    copyFileSync(sourcePath,join(output,name));
  }
}
if(existsSync(join(source,"score-ownership.js")))
  copyFileSync(join(source,"score-ownership.js"),join(output,"score-ownership.js"));
const name=channel==="dev"?"Blocks Dev":"Blocks";
const appPath=channel==="dev"?"/blocks/dev/":"/blocks/";
const manifest=JSON.parse(readFileSync(join(output,"manifest.json"),"utf8"));
Object.assign(manifest,{name,short_name:name,id:appPath,start_url:"./",scope:"./"});
if(channel==="dev")delete manifest.orientation; // Allow rotation when installed.
writeFileSync(join(output,"manifest.json"),JSON.stringify(manifest,null,2)+"\n");

let html=readFileSync(join(output,"index.html"),"utf8");
if(!html.includes('content="Blocks"')||!html.includes("<title>Blocks</title>"))
  throw new Error("Unexpected PWA title markup");
html=html.replace('name="apple-mobile-web-app-title" content="Blocks"',
  'name="apple-mobile-web-app-title" content="'+name+'"');
html=html.replace("<title>Blocks</title>","<title>"+name+"</title>");
html=html.replace(/\?v=[\w-]+/g,"?v="+revision);
writeFileSync(join(output,"index.html"),html);

let sw=readFileSync(join(output,"sw.js"),"utf8");
const cachePattern=/const CACHE="[^"]+";/;
const cacheCleanup='key.startsWith("blocks-")';
if(!cachePattern.test(sw)||!sw.includes(cacheCleanup))
  throw new Error("Unexpected service-worker cache markup");
sw=sw.replace(cachePattern,'const CACHE="blocks-'+channel+'-'+revision+'";');
sw=sw.replace(cacheCleanup,'key.startsWith("blocks-'+channel+'-")');
writeFileSync(join(output,"sw.js"),sw);

let version=readFileSync(join(output,"version.js"),"utf8");
const before=version;
version=version.replace(/(window\.BLOCKS_VERSION\s*=\s*")([^"]+)(";)/,
  (_match,opening,value,closing)=>opening+value+" · "+channel+" "+revision+closing);
if(version===before)throw new Error("Could not stamp build version");
writeFileSync(join(output,"version.js"),version);
