const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {execFileSync}=require("node:child_process");
const {fileURLToPath}=require("node:url");

const root=path.join(__dirname,"..");
const iconFiles=["favicon-32.png","apple-touch-icon.png","icon-192.png","icon-512.png","icon.svg"];

test("development icons are blue, production icons remain byte-for-byte red",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"blocks-icons-"));
  try{
    for(const channel of ["prod","dev"]){
      const output=path.join(dir,channel);
      execFileSync(process.execPath,[path.join(root,"scripts/build-pages.mjs"),
        root,output,channel,"icon1234"]);
      for(const name of iconFiles){
        const original=fs.readFileSync(path.join(root,name));
        const rendered=fs.readFileSync(path.join(output,name));
        if(channel==="prod"){
          assert.deepEqual(rendered,original, "production icon changed: "+name);
        }else{
          assert.notDeepEqual(rendered,original, "development icon unchanged: "+name);
          if(name==="icon.svg"){
            const text=rendered.toString("utf8");
            assert.match(text,/#2684ff/);
            assert.doesNotMatch(text,/#ff3b30/);
          }else{
            assert.deepEqual(rendered.subarray(0,8),
              Buffer.from([137,80,78,71,13,10,26,10]));
            assert.equal(rendered.readUInt32BE(16),original.readUInt32BE(16));
            assert.equal(rendered.readUInt32BE(20),original.readUInt32BE(20));
          }
        }
      }
      const index=fs.readFileSync(path.join(output,"index.html"),"utf8");
      assert.match(index,/apple-touch-icon\.png/);
      assert.match(index,/favicon-32\.png/);
      const manifest=JSON.parse(fs.readFileSync(path.join(output,"manifest.json"),"utf8"));
      assert.ok(manifest.icons.some(i=>i.src.startsWith("icon-192.png")));
      assert.ok(manifest.icons.some(i=>i.src.startsWith("icon-512.png")));
    }
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
