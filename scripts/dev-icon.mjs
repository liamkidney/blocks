// Recolour the existing red PWA artwork blue in development builds only.
// No external image dependency: the source icons are PNGs with indexed palettes
// (favicon, 192, 512) or RGBA pixels (Apple touch icon).
import {inflateSync,deflateSync} from "node:zlib";

export const DEV_BLUE="#2684ff";
const RED=[255,59,48], BLUE=[38,132,255];
const SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]);

function crc32(bytes){
  let crc=0xffffffff;
  for(const value of bytes){
    crc^=value;
    for(let bit=0;bit<8;bit++)
      crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  }
  return (crc^0xffffffff)>>>0;
}
function makeChunk(type,data){
  const name=Buffer.from(type,"ascii");
  const chunk=Buffer.alloc(12+data.length);
  chunk.writeUInt32BE(data.length,0);
  name.copy(chunk,4);
  data.copy(chunk,8);
  chunk.writeUInt32BE(crc32(Buffer.concat([name,data])),8+data.length);
  return chunk;
}
function decodeChunks(bytes){
  if(!bytes.subarray(0,8).equals(SIGNATURE))throw Error("Not a PNG icon");
  const chunks=[];
  for(let offset=8;offset<bytes.length;){
    if(offset+12>bytes.length)throw Error("Truncated PNG chunk");
    const length=bytes.readUInt32BE(offset);
    const end=offset+length+12;
    if(end>bytes.length)throw Error("Truncated PNG chunk contents");
    const type=bytes.toString("ascii",offset+4,offset+8);
    chunks.push({type,data:Buffer.from(bytes.subarray(offset+8,offset+8+length))});
    offset=end;
    if(type==="IEND")break;
  }
  if(chunks.at(-1)?.type!=="IEND")throw Error("PNG IEND missing");
  return chunks;
}
function paeth(a,b,c){
  const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);
  return pa<=pb&&pa<=pc?a:pb<=pc?b:c;
}
function recolourRgba(chunks,width,height){
  const idat=chunks.filter(chunk=>chunk.type==="IDAT");
  if(!idat.length)throw Error("PNG IDAT missing");
  const raw=inflateSync(Buffer.concat(idat.map(chunk=>chunk.data)));
  const stride=width*4, expected=height*(stride+1);
  if(raw.length!==expected)throw Error("Unexpected RGBA PNG layout");
  const result=Buffer.alloc(expected);
  let previous=Buffer.alloc(stride),position=0,changed=0;
  for(let y=0;y<height;y++){
    const filter=raw[position++];
    if(filter>4)throw Error("Unsupported PNG filter "+filter);
    const original=Buffer.alloc(stride);
    for(let i=0;i<stride;i++){
      const left=i>=4?original[i-4]:0;
      const above=previous[i];
      const upperLeft=i>=4?previous[i-4]:0;
      const prediction=filter===0?0:
        filter===1?left:
        filter===2?above:
        filter===3?Math.floor((left+above)/2):paeth(left,above,upperLeft);
      original[i]=(raw[position+i]+prediction)&255;
    }
    position+=stride;
    result[y*(stride+1)]=0; // Re-encode rows without filters.
    const row=Buffer.from(original);
    for(let i=0;i<stride;i+=4){
      const r=row[i],g=row[i+1],b=row[i+2];
      // Anti-aliased red can be mixed with the black outline or cream
      // background. R-G identifies its red contribution in either mixture.
      if(r-g<=8||r-b<=14||row[i+3]===0)continue;
      const contribution=Math.max(0,Math.min(1,(r-g-4)/192));
      if(contribution===0)continue;
      row[i]=Math.round(r+(BLUE[0]-RED[0])*contribution);
      row[i+1]=Math.min(255,Math.round(g+(BLUE[1]-RED[1])*contribution));
      row[i+2]=Math.min(255,Math.round(b+(BLUE[2]-RED[2])*contribution));
      changed++;
    }
    row.copy(result,y*(stride+1)+1);
    previous=original; // The next PNG row depends on the original pixels.
  }
  if(!changed)throw Error("Expected red pixels in RGBA icon");
  const compressed=deflateSync(result,{level:9});
  const replaced=[];
  let wroteIdat=false;
  for(const chunk of chunks){
    if(chunk.type==="IDAT"){
      if(!wroteIdat){replaced.push({type:"IDAT",data:compressed});wroteIdat=true}
    }else replaced.push(chunk);
  }
  return replaced;
}
export function bluePng(source){
  const bytes=Buffer.isBuffer(source)?source:Buffer.from(source);
  let chunks=decodeChunks(bytes);
  const ihdr=chunks.find(chunk=>chunk.type==="IHDR")?.data;
  if(!ihdr||ihdr.length!==13)throw Error("Invalid PNG header");
  const width=ihdr.readUInt32BE(0),height=ihdr.readUInt32BE(4);
  if(ihdr[8]!==8||ihdr[12]!==0)throw Error("Unsupported PNG bit depth or interlace");
  if(ihdr[9]===3){
    let changed=0;
    chunks=chunks.map(chunk=>{
      if(chunk.type!=="PLTE")return chunk;
      const palette=Buffer.from(chunk.data);
      for(let i=0;i<palette.length;i+=3){
        if(palette[i]===RED[0]&&palette[i+1]===RED[1]&&palette[i+2]===RED[2]){
          palette[i]=BLUE[0];palette[i+1]=BLUE[1];palette[i+2]=BLUE[2];changed++;
        }
      }
      return {type:"PLTE",data:palette};
    });
    if(!changed)throw Error("Expected red entry in PNG palette");
  }else if(ihdr[9]===6){
    chunks=recolourRgba(chunks,width,height);
  }else throw Error("Unsupported icon colour type "+ihdr[9]);
  return Buffer.concat([SIGNATURE,...chunks.map(chunk=>makeChunk(chunk.type,chunk.data))]);
}
export function blueSvg(source){
  if(!source.includes("#ff3b30"))throw Error("Expected red SVG fill");
  return source.replaceAll("#ff3b30",DEV_BLUE);
}
