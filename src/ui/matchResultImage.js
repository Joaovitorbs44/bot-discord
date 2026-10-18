"use strict";
const sharp = require("sharp");
const { drawText } = require("../scripts/mapVetoImage");

const WIDTH = 1100, HEIGHT = 690;
const escape = value => String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
// Glyphs are drawn as SVG rectangles. This is independent of installed fonts.
const text = (x,y,value,size=22,color="#F4F6FA",weight=500,extra="") => {
  const scale = size >= 48 ? 5 : size >= 30 ? 3 : size >= 20 ? 2 : 1.5;
  const anchorEnd = /text-anchor="end"/.test(extra);
  const label = String(value ?? "").toUpperCase().replace(/[ÀÁÂÃÄ]/g,"A").replace(/[ÈÉÊË]/g,"E").replace(/[ÌÍÎÏ]/g,"I").replace(/[ÒÓÔÕÖ]/g,"O").replace(/[ÙÚÛÜ]/g,"U").replace(/Ç/g,"C").replace(/[^A-Z0-9 -]/g," ");
  const width = label.length * 6 * scale;
  return drawText(label, anchorEnd ? x - width : x, y - 7 * scale, scale, color, 10000);
};
const rect = (x,y,w,h,r,fill,stroke="none",opacity=1) =>
  '<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx="'+r+'" fill="'+fill+'" stroke="'+stroke+'" opacity="'+opacity+'"/>';
const row = (player,index,x,y) =>
  text(x,y,String(index+1).padStart(2,"0"),16,"#FF6558",700)+
  text(x+44,y,player.name,18,"#F7F8FC",650)+
  text(x+245,y,player.rank||"-",14,"#AEB8C9",400)+
  (player.captain?text(x+382,y,"CAPTAIN",12,"#FF958D",700):"");

async function renderMatchResult({matchCode="482731",map="Fortress",winner="B",winners=[],losers=[]}={}) {
  const left=50, right=565;
  const winnerLabel = winners.find(player => player.captain)?.name || "CAPITAO";
  const roster = (list,x) => list.slice(0,5).map((p,i)=>row(p,i,x,389+i*46)).join("");
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="'+WIDTH+'" height="'+HEIGHT+'" viewBox="0 0 '+WIDTH+' '+HEIGHT+'">'+
    '<defs>'+
    '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#111722"/><stop offset=".55" stop-color="#202B39"/><stop offset="1" stop-color="#11151D"/></linearGradient>'+
    '<radialGradient id="glow"><stop stop-color="#FF3D2C" stop-opacity=".32"/><stop offset="1" stop-color="#FF3D2C" stop-opacity="0"/></radialGradient>'+
    '<linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#FFFFFF" stop-opacity=".15"/><stop offset="1" stop-color="#FFFFFF" stop-opacity=".035"/></linearGradient>'+
    '<filter id="blur"><feGaussianBlur stdDeviation="52"/></filter>'+
    '</defs>'+
    rect(0,0,WIDTH,HEIGHT,0,"url(#bg)")+
    '<circle cx="900" cy="30" r="340" fill="url(#glow)" filter="url(#blur)"/>'+
    '<circle cx="120" cy="680" r="240" fill="#32516D" opacity=".14" filter="url(#blur)"/>'+
    rect(28,28,1044,634,28,"url(#glass)","#FFFFFF25")+
    rect(50,54,6,34,3,"#FF3D2C")+
    text(70,78,"INVI SIX PRO",20,"#FFFFFF",800,'letter-spacing="1.8"')+
    text(1020,77,"MATCH REPORT - SEASON 01",14,"#A6B0C2",600,'text-anchor="end" letter-spacing="1.3"')+
    '<line x1="50" y1="105" x2="1050" y2="105" stroke="#FFFFFF24"/>'+
    text(54,157,"VICTORY",45,"#FFFFFF",800,'letter-spacing="-1.5"')+
    text(56,190,"TIME "+winnerLabel.slice(0,24)+" - "+map.toUpperCase()+" - "+matchCode,16,"#B6C0D1",600,'letter-spacing="1"')+
    rect(814,125,210,82,16,"#FF3D2C")+
    text(836,158,"MATCH STATUS",13,"#FFE3DF",700,'letter-spacing="1"')+
    text(836,185,"COMPLETE",20,"#FFFFFF",800)+
    rect(left,238,480,362,22,"url(#glass)","#FFFFFF2A")+
    rect(right,238,485,362,22,"url(#glass)","#FFFFFF2A")+
    rect(left+16,255,448,70,14,"#2E4A42")+
    rect(right+16,255,453,70,14,"#47343B")+
    text(left+32,278,"WINNERS",14,"#A7E8C7",700,'letter-spacing="1.5"')+
    text(left+32,312,"+5 PTS",28,"#FFFFFF",800)+
    text(right+32,278,"DEFEAT",14,"#F0B5B7",700,'letter-spacing="1.5"')+
    text(right+32,312,"-3 PTS",28,"#FFFFFF",800)+
    roster(winners,left+30)+roster(losers,right+30)+
    '<line x1="54" y1="626" x2="1046" y2="626" stroke="#FFFFFF26"/>'+
    text(55,646,"INVI SIX PRO - COMPETITIVE",12,"#929EAF",600,'letter-spacing="1.1"')+
    text(1040,646,"PREVIEW - TEST DATA",12,"#929EAF",600,'text-anchor="end"')+
    '</svg>';
  return sharp(Buffer.from(svg)).png().toBuffer();
}
module.exports={renderMatchResult};
