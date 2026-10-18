const sharp = require("sharp");
const { createWorker } = require("tesseract.js");
const language = require("@tesseract.js-data/eng");

function lines(tsv, scale = 3) {
  const groups = new Map();
  for (const row of String(tsv || "").split("\n").slice(1)) {
    const parts = row.split("\t");
    if (parts[0] !== "5" || !parts[11]?.trim()) continue;
    const key = parts.slice(1, 5).join(":");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ text: parts[11].trim(), x: Number(parts[6]), y: (Number(parts[7]) + Number(parts[9]) / 2) / scale });
  }
  return [...groups.values()].map(words => ({ text: words.sort((a,b) => a.x-b.x).map(w => w.text).join(" "), y: words.reduce((s,w) => s+w.y,0)/words.length })).sort((a,b) => a.y-b.y);
}
function normalize(value) { return String(value).normalize("NFKD").replace(/[^a-z0-9]/gi, "").toLowerCase(); }
function similarity(a,b) {
  a=normalize(a); b=normalize(b);
  if (!a || !b) return 0;
  let previous=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++) {
    const current=[i];
    for(let j=1;j<=b.length;j++) current[j]=Math.min(current[j-1]+1,previous[j]+1,previous[j-1]+Number(a[i-1]!==b[j-1]));
    previous=current;
  }
  return 1-previous[b.length]/Math.max(a.length,b.length);
}
function matchRows(names, numbers, roster) {
  const used = new Set();
  return roster.map(player => {
    const candidates=names.map((line,index)=>({...line,index,score:similarity(line.text,player.r6_nickname)})).sort((a,b)=>b.score-a.score);
    const best=candidates[0];
    if (!best || best.score < .80 || (candidates[1] && best.score-candidates[1].score < .12) || used.has(best.index)) return { discordId: player.discord_id, kills: null, deaths: null };
    const conflicts=roster.filter(other=>other.discord_id!==player.discord_id && similarity(best.text,other.r6_nickname)>=best.score-.12);
    if(conflicts.length) return {discordId:player.discord_id,kills:null,deaths:null};
    used.add(best.index);
    const numeric=numbers.filter(row=>Math.abs(row.y-best.y)<12).sort((a,b)=>Math.abs(a.y-best.y)-Math.abs(b.y-best.y))[0];
    const values=numeric?.text.trim().match(/^(\d{1,2})\s+(\d{1,2})$/);
    return {discordId:player.discord_id,kills:values?Number(values[1]):null,deaths:values?Number(values[2]):null};
  });
}
async function extract(buffer, roster) {
  const metadata=await sharp(buffer,{limitInputPixels:20000000}).metadata();
  const width=metadata.width,height=metadata.height;
  if(!width || !height || width/height<1.8 || width/height>2.7) throw new Error("Formato diferente dos exemplos. A staff pode preencher os dados manualmente.");
  const crop = async (left, span) => sharp(buffer,{limitInputPixels:20000000})
    .extract({left:Math.round(width*left),top:0,width:Math.round(width*span),height:Math.round(height*.94)})
    .grayscale().normalize().resize({width:Math.round(width*span)*3}).png().toBuffer();
  const worker=await createWorker("eng",1,{langPath:language.langPath,gzip:true,cacheMethod:"none"});
  const timer=setTimeout(()=>worker.terminate().catch(()=>{}),90000);
  try {
    await worker.setParameters({tessedit_char_whitelist:"0123456789 ",tessedit_pageseg_mode:"6",preserve_interword_spaces:"1"});
    const numbers=await worker.recognize(await crop(.745,.10),{},{tsv:true});
    const numericLines=lines(numbers.data.tsv).filter(line=>line.y>height*.04);
    if(numericLines.length===9 && numericLines[0].y>height*.12) numericLines.unshift({text:"",y:numericLines[0].y-(numericLines[2].y-numericLines[1].y)});
    if(numericLines.length!==10) throw new Error("Não consegui localizar as 10 linhas. Revisão manual necessária.");
    await worker.setParameters({tessedit_char_whitelist:"",tessedit_pageseg_mode:"7"});
    const names=[];
    for(const numeric of numericLines) {
      const top=Math.max(0,Math.round(numeric.y-height*.029));
      const row=await sharp(buffer,{limitInputPixels:20000000}).extract({left:Math.round(width*.288),top,width:Math.round(width*.225),height:Math.min(Math.round(height*.060),height-top)}).grayscale().normalize().resize({width:Math.round(width*.225)*4}).png().toBuffer();
      const result=await worker.recognize(row);
      names.push({text:result.data.text.trim(),y:numeric.y});
    }
    await worker.setParameters({tessedit_char_whitelist:"0123456789",tessedit_pageseg_mode:"7"});
    for(const numeric of numericLines) {
      const values=[];
      for(const [left,span] of [[.748,.044],[.803,.039]]) {
        const top=Math.max(0,Math.round(numeric.y-height*.027));
        const cell=await sharp(buffer,{limitInputPixels:20000000}).extract({left:Math.round(width*left),top,width:Math.round(width*span),height:Math.min(Math.round(height*.055),height-top)}).grayscale().normalize().resize({width:Math.round(width*span)*6}).png().toBuffer();
        const read=await worker.recognize(cell);
        const value=read.data.text.trim();
        values.push(read.data.confidence>=70 && /^\d{1,2}$/.test(value)?value:"?");
      }
      const original=numeric.text.trim().match(/^(\d{1,2})\s+(\d{1,2})$/);
      if(original) {
        for(let index=0;index<2;index++) {
          if(values[index]==="?") values[index]=original[index+1];
          else if(Number(values[index])!==Number(original[index+1])) values[index]="?";
        }
      }
      numeric.text=values.join(" ");
    }
    return {rows:matchRows(names,numericLines,roster),text:names.map(n=>n.text).join("\n")+"\n"+numbers.data.text};
  } finally { clearTimeout(timer); await worker.terminate(); }
}
module.exports={extract,matchRows,similarity,lines};
