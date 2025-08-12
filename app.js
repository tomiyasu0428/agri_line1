(()=>{'use strict';
const el={gpsStatus:document.getElementById('gpsStatus'),acc:document.getElementById('acc'),spd:document.getElementById('spd'),hdg:document.getElementById('hdg'),hz:document.getElementById('hz'),mode:document.getElementById('mode'),
offset:document.getElementById('offset'),unit:document.getElementById('unit'),dir:document.getElementById('dir'),hint:document.getElementById('hint'),distInfo:document.getElementById('distInfo'),
start:document.getElementById('startBtn'),stop:document.getElementById('stopBtn'),
setA:document.getElementById('setA'),setB:document.getElementById('setB'),clearAB:document.getElementById('clearAB'),swath:document.getElementById('swath'),
prevLine:document.getElementById('prevLine'),nextLine:document.getElementById('nextLine'),snapNearest:document.getElementById('snapNearest'),
log:document.getElementById('log'),viz:document.getElementById('viz'),vizRange:document.getElementById('vizRange'), warn:document.getElementById('warn'),
wakelockBtn:document.getElementById('wakelockBtn'),speechBtn:document.getElementById('speechBtn'),
driveBtn:document.getElementById('driveBtn'),presetBtn:document.getElementById('presetBtn')};

const ctx=el.viz.getContext('2d');
function resizeCanvas(){const rect=el.viz.getBoundingClientRect();el.viz.width=Math.max(600,Math.floor(rect.width*devicePixelRatio));el.viz.height=Math.floor(260*devicePixelRatio)}
resizeCanvas();addEventListener('resize',resizeCanvas);

 let watchId=null,pollId=null,last=null;
 let wakeLock=null;
let A=null,B=null,swathWidth=parseFloat(localStorage.getItem('swathWidth')||el.swath.value)||2.0,currentLineIndex=parseInt(localStorage.getItem('lineIndex')||'0',10)||0;
let tickCount=0,lastHzAt=performance.now(), lastUpdateAt=0;
const R=6378137,toRad=d=>d*Math.PI/180;
// 音声ガイダンス
let speechEnabled=(localStorage.getItem('speechEnabled')==='1');
let lastSpokenAt=0; // ms
let lastSpokenState='none'; // 'left'|'right'|'ok'|'none'
const SPEAK_COOLDOWN_MS=2500;
const THRESH_OUT=0.30; // m
const THRESH_IN =0.25; // m (hysteresis)
function updateSpeechBtnLabel(){ el.speechBtn.textContent='音声: '+(speechEnabled?'ON':'OFF'); }
function speak(text){
  try{
    if(!speechEnabled) return;
    const now=performance.now();
    if(now-lastSpokenAt<SPEAK_COOLDOWN_MS) return;
    const uttr=new SpeechSynthesisUtterance(text);
    uttr.lang='ja-JP';
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(uttr);
    lastSpokenAt=now;
  }catch(_){}
}
function speakGuidance(offset){
  if(!speechEnabled) return;
  if(!Number.isFinite(offset)) return;
  const abs=Math.abs(offset);
  if(abs>=THRESH_OUT){
    const dir=offset>0?'左へ':'右へ';
    const state=offset>0?'left':'right';
    if(state!==lastSpokenState){ speak(`${dir}${abs.toFixed(1)}メートル`); lastSpokenState=state; }
  }else if(abs<=THRESH_IN){
    if(lastSpokenState!=='ok'){ speak('OK'); lastSpokenState='ok'; }
  }
}

// Driveモード
let driveMode=(localStorage.getItem('driveMode')==='1');
let preset=localStorage.getItem('drivePreset')||'wide'; // 'wide' | 'normal'
function updateDriveButtons(){
  el.driveBtn.textContent='Driveモード: '+(driveMode?'ON':'OFF');
  el.presetBtn.textContent='しきい値: '+(preset==='wide'?'Wide':'Normal');
}
function getThresholds(){
  if(preset==='wide') return {green:0.50,yellow:1.00}; // m
  return {green:0.20,yellow:0.50};
}

function log(s){const t=new Date().toLocaleTimeString();el.log.textContent=`[${t}] ${s}\n`+el.log.textContent}

function degToMeters(lat,lon,lat0,lon0){const x=toRad(lon-lon0)*R*Math.cos(toRad((lat+lat0)/2));const y=toRad(lat-lat0)*R;return {x,y}}
function vecLen(v){return Math.hypot(v.x,v.y)} function vecNorm(v){const L=vecLen(v)||1;return{x:v.x/L,y:v.y/L}} function vecPerp(v){return{x:-v.y,y:v.x}}

function setAFrom(lat,lon){const lat0=lat,lon0=lon;A={xy:{x:0,y:0},deg:{lat,lon},lat0,lon0};B=null;el.setB.disabled=false;el.hint.textContent='A点設定済。B点を設定してください。';el.distInfo.textContent='';log(`A点設定: ${lat.toFixed(7)}, ${lon.toFixed(7)}`)}
function setBFrom(lat,lon){if(!A)return;const xy=degToMeters(lat,lon,A.lat0,A.lon0);B={xy,deg:{lat,lon},lat0:A.lat0,lon0:A.lon0};const dist=vecLen(xy);el.distInfo.textContent=`AB距離: ${dist.toFixed(2)} m`;if(dist<5){alert(`B点までの距離が短すぎます (${dist.toFixed(2)} m)。10〜30m離して設定してください。`)}el.hint.textContent='ABライン設定OK。最寄ラインへスナップ可。';log(`B点設定: ${lat.toFixed(7)}, ${lon.toFixed(7)} (距離 ${dist.toFixed(2)} m)`)}

function crossTrack(p){if(!A||!B)return null;const v={x:B.xy.x-A.xy.x,y:B.xy.y-A.xy.y};const n=vecNorm(v);const w={x:p.x-A.xy.x,y:p.y-A.xy.y};const perp=w.x*(-n.y)+w.y*(n.x);return {perp}}
function updateUI(offset, distFromA, abDist){const abs=Math.abs(offset);el.offset.textContent=abs.toFixed(2);el.unit.textContent='m';el.dir.textContent=offset>0?'← 左へ':(offset<0?'右へ →':'—');const info=[];if(isFinite(distFromA)) info.push(`A→現在: ${distFromA.toFixed(1)} m`);if(isFinite(abDist)) info.push(`AB距離: ${abDist.toFixed(1)} m`);el.distInfo.textContent=info.join(' / ')}

 function drawViz(offset){
   const w=el.viz.width,h=el.viz.height;ctx.clearRect(0,0,w,h);
   const range=Math.max(swathWidth*1.5,2.0);el.vizRange.textContent=`±${range.toFixed(1)} m`;
   const m2px=(w*0.8)/(range*2);const cx=w/2;
   // 背景
   let bg='#0f0f0f';
   if(driveMode){
     const th=getThresholds();
     const abs=Math.abs(offset);
     if(abs<=th.green) bg='#0f2215'; else if(abs<=th.yellow) bg='#221f0f'; else bg='#2a1111';
   }
   ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
   // グリッド
   ctx.strokeStyle='#2a2a2a';ctx.beginPath();for(let m=-range;m<=range;m+=swathWidth){const x=Math.round(cx+m*m2px);ctx.moveTo(x,0);ctx.lineTo(x,h)}ctx.stroke();
   // 中央基準線
   ctx.strokeStyle='#66d1ff';ctx.lineWidth=3*devicePixelRatio;ctx.beginPath();ctx.moveTo(cx,0);ctx.lineTo(cx,h);ctx.stroke();
   // Driveモードの矢印＆キャロット
   if(driveMode){
     // ステア矢印（太さと長さを|offset|で決定）
     const abs=Math.min(Math.abs(offset), range);
     const len= (h*0.22) + (h*0.25)*(abs/range);
     const width= (10*devicePixelRatio) + (20*devicePixelRatio)*(abs/range);
     ctx.fillStyle= offset>0 ? '#4de1c1' : '#4db1e1';
     const centerY=h*0.35;
     if(offset>0){ // 左矢印
       ctx.fillRect(cx-len, centerY-width/2, len, width);
       ctx.beginPath(); ctx.moveTo(cx-len, centerY - width); ctx.lineTo(cx-len, centerY + width); ctx.lineTo(cx-len-(width*1.2), centerY); ctx.closePath(); ctx.fill();
     }else if(offset<0){ // 右矢印
       ctx.fillRect(cx, centerY-width/2, len, width);
       ctx.beginPath(); ctx.moveTo(cx+len, centerY - width); ctx.lineTo(cx+len, centerY + width); ctx.lineTo(cx+len+(width*1.2), centerY); ctx.closePath(); ctx.fill();
     }
     // 自車アイコン
     ctx.fillStyle='#e6e6e6'; const carY=h*0.65; ctx.fillRect(cx-10,carY-14,20,28);
     // キャロット（◎）: 速度から先読み距離L
     const spdKmh=parseFloat(el.spd.textContent)||0; const spd=spdKmh/3.6; // m/s
     const L=Math.max(3, Math.min(8, 2*spd));
     ctx.strokeStyle='#ffd24d'; ctx.lineWidth=2*devicePixelRatio; const tx=Math.round(cx - offset*m2px); const ty=carY - L*m2px*0.6; ctx.beginPath(); ctx.arc(tx, ty, 10, 0, Math.PI*2); ctx.stroke();
   } else {
     // 旧来のバー表示
     const tx=Math.round(cx - offset*m2px),ty=h*0.65;ctx.fillStyle='#4de1c1';ctx.fillRect(tx-20,ty-35,40,70);
   }
 }

function updateHz(){const now=performance.now();if(now-lastHzAt>=1000){el.hz.textContent=tickCount.toString();tickCount=0;lastHzAt=now;}}
 function onGeo(pos){
   el.gpsStatus.textContent='取得中';
   lastUpdateAt=performance.now();
   tickCount++;updateHz();
   const cur={lat:pos.coords.latitude,lon:pos.coords.longitude,acc:pos.coords.accuracy||999,time:pos.timestamp};
   el.acc.textContent=(cur.acc||0).toFixed(0);
   // 速度と進行方位を更新
   if(last){
     const dx=degToMeters(cur.lat,cur.lon,last.lat,last.lon);
     const dt=(cur.time-last.time)/1000;
     if(dt>0){
       const v=vecLen(dx)/dt;
       el.spd.textContent=(v*3.6).toFixed(1);
       let headingDeg=NaN;
       if(Number.isFinite(pos.coords.heading)){
         headingDeg=pos.coords.heading;
       }else if(v>0.5){ // 低速時はノイズ回避
         const rad=Math.atan2(dx.x,dx.y); // 北=0°, 時計回り
         headingDeg=((rad*180/Math.PI)+360)%360;
       }
       if(Number.isFinite(headingDeg)) el.hdg.textContent=Math.round(headingDeg).toString();
      }
   }
   last=cur;
   // オフセット計算と描画
   let distFromA=NaN,abDist=NaN,offset=0;
   if(A){
     const xy=degToMeters(cur.lat,cur.lon,A.lat0,A.lon0);
     distFromA=vecLen(xy);
     if(B){
       abDist=vecLen({x:B.xy.x-A.xy.x,y:B.xy.y-A.xy.y});
       if(abDist>=5){
         const ct=crossTrack(xy);
         offset=(currentLineIndex*swathWidth)-(ct?ct.perp:0);
         el.hint.textContent=`ターゲット: ${currentLineIndex}本目 / 横ズレ ${offset.toFixed(2)} m`;
       }else{
         el.hint.textContent='AB距離が短すぎます（5m以上に）';
       }
     }
   }
   updateUI(offset,distFromA,abDist);
   drawViz(offset);
    // 音声ガイダンス
    speakGuidance(offset);
    // polling -> watch 自動復帰判定
    if(!watchId && pollId){
      onGeo._pollOk=(onGeo._pollOk||0)+1;
      if(onGeo._pollOk>=10){
        try{
          clearInterval(pollId); pollId=null; onGeo._pollOk=0;
          const opts={enableHighAccuracy:true, maximumAge:0, timeout:15000};
          watchId=navigator.geolocation.watchPosition(onGeo, e=>{log('watchPosition error(retry): '+e.message);}, opts);
          el.mode.textContent='watch';
          log('resume watchPosition after stable polling');
        }catch(e){ log('resume watch error: '+e.message); }
      }
    }
 }

function startWatch(){ if (watchId||pollId) stopAll(); const opts={enableHighAccuracy:true, maximumAge:0, timeout:15000}; try{ watchId=navigator.geolocation.watchPosition(onGeo, e=>{log('watchPosition error: '+e.message);}, opts); el.mode.textContent='watch'; }catch(e){ log('watchPosition exception: '+e.message); } el.start.disabled=true; el.stop.disabled=false; // guard監視
  const guard=setInterval(()=>{ if(!watchId){ clearInterval(guard); return; } const idle=performance.now()-lastUpdateAt; el.warn.style.display = idle>3000 ? 'block':'none'; if(idle>5000){ // fallback to polling
      try{ if(watchId){ navigator.geolocation.clearWatch(watchId); watchId=null; } if(pollId) clearInterval(pollId); pollId=setInterval(()=>{ navigator.geolocation.getCurrentPosition(onGeo, err=>log('getCurrentPosition error: '+err.message), {enableHighAccuracy:true, maximumAge:0, timeout:8000}); }, 1000); el.mode.textContent='polling'; log('fallback to polling'); clearInterval(guard); }catch(e){ log('fallback error: '+e.message); }
  } }, 1000);}

function stopAll(){ if(watchId){navigator.geolocation.clearWatch(watchId);watchId=null;} if(pollId){clearInterval(pollId);pollId=null;} el.start.disabled=false; el.stop.disabled=true; el.warn.style.display='none'; el.hz.textContent='-'; }

document.getElementById('startBtn').addEventListener('click', startWatch);
document.getElementById('stopBtn').addEventListener('click', stopAll);
document.getElementById('setA').addEventListener('click', ()=>{ if(!last){alert('位置取得後に押してください'); return;} setAFrom(last.lat,last.lon); });
document.getElementById('setB').addEventListener('click', ()=>{ if(!last){alert('位置取得後に押してください'); return;} setBFrom(last.lat,last.lon); });
document.getElementById('clearAB').addEventListener('click', ()=>{A=null;B=null;document.getElementById('setB').disabled=true;document.getElementById('hint').textContent='A/Bラインを設定してください'; document.getElementById('distInfo').textContent='';});
 document.getElementById('prevLine').addEventListener('click', ()=>{currentLineIndex-=1; if(last&&A){const xy=degToMeters(last.lat,last.lon,A.lat0,A.lon0);const ct=crossTrack(xy);const offset=(currentLineIndex*swathWidth)-(ct?ct.perp:0);drawViz(offset);}else{drawViz(0);} });
 document.getElementById('nextLine').addEventListener('click', ()=>{currentLineIndex+=1; if(last&&A){const xy=degToMeters(last.lat,last.lon,A.lat0,A.lon0);const ct=crossTrack(xy);const offset=(currentLineIndex*swathWidth)-(ct?ct.perp:0);drawViz(offset);}else{drawViz(0);} });
 document.getElementById('snapNearest').addEventListener('click', ()=>{
   if(!last||!A||!B){ alert('A/B設定と位置取得後に押してください'); return; }
   const abDist=vecLen({x:B.xy.x-A.xy.x,y:B.xy.y-A.xy.y});
   if(abDist<5){ alert('AB距離が短すぎます（5m以上に）'); return; }
   const xy=degToMeters(last.lat,last.lon,A.lat0,A.lon0);
   const ct=crossTrack(xy);
   const n=Math.round((ct?ct.perp:0)/swathWidth);
   currentLineIndex=n;
   const offset=(currentLineIndex*swathWidth)-(ct?ct.perp:0);
   const distFromA=vecLen(xy);
   updateUI(offset,distFromA,abDist);
   el.hint.textContent=`最寄ラインへスナップ: ${currentLineIndex}本目`;
   drawViz(offset);
 });

 // 作業幅の変更を反映
 el.swath.addEventListener('change', ()=>{
   const v=parseFloat(el.swath.value)||swathWidth; swathWidth=v; localStorage.setItem('swathWidth', String(v));
   if(last&&A){const xy=degToMeters(last.lat,last.lon,A.lat0,A.lon0);const ct=crossTrack(xy);const offset=(currentLineIndex*swathWidth)-(ct?ct.perp:0);drawViz(offset);}else{drawViz(0);} 
 });

 // Wake Lock（画面常時ON）
 async function requestWakeLock(){
   if(!('wakeLock' in navigator)){ log('wakeLock unsupported'); alert('画面常時ONは端末/ブラウザ非対応です。自動ロック設定をご確認ください。'); return; }
   try{
     wakeLock=await navigator.wakeLock.request('screen');
     el.wakelockBtn.textContent='画面常時ON: ON';
     wakeLock.addEventListener('release',()=>{ el.wakelockBtn.textContent='画面常時ON'; wakeLock=null; });
   }catch(e){ log('wakeLock error: '+e.message); }
 }
 async function toggleWakeLock(){
   try{
     if(wakeLock){ await wakeLock.release(); wakeLock=null; el.wakelockBtn.textContent='画面常時ON'; }
     else{ await requestWakeLock(); }
   }catch(e){ log('wakeLock toggle error: '+e.message); }
 }
 el.wakelockBtn.addEventListener('click', ()=>{ toggleWakeLock(); localStorage.setItem('wakePref', el.wakelockBtn.textContent.includes('ON')?'1':'0'); });
 document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible' && wakeLock==null && localStorage.getItem('wakePref')==='1'){ requestWakeLock(); }});

 // 音声ON/OFFトグル
 el.speechBtn.addEventListener('click', ()=>{ speechEnabled=!speechEnabled; localStorage.setItem('speechEnabled', speechEnabled?'1':'0'); updateSpeechBtnLabel(); });

 // Driveモードとしきい値
 el.driveBtn.addEventListener('click', ()=>{ driveMode=!driveMode; localStorage.setItem('driveMode', driveMode?'1':'0'); updateDriveButtons(); if(last&&A){const xy=degToMeters(last.lat,last.lon,A.lat0,A.lon0);const ct=crossTrack(xy);const offset=(currentLineIndex*swathWidth)-(ct?ct.perp:0);drawViz(offset);}else{drawViz(0);} });
 el.presetBtn.addEventListener('click', ()=>{ preset=(preset==='wide'?'normal':'wide'); localStorage.setItem('drivePreset', preset); updateDriveButtons(); if(last&&A){const xy=degToMeters(last.lat,last.lon,A.lat0,A.lon0);const ct=crossTrack(xy);const offset=(currentLineIndex*swathWidth)-(ct?ct.perp:0);drawViz(offset);}else{drawViz(0);} });

 // 初期UI反映
 updateSpeechBtnLabel();
 updateDriveButtons();
 if(localStorage.getItem('wakePref')==='1'){ requestWakeLock(); }
 el.swath.value=String(swathWidth);
 if(Number.isFinite(currentLineIndex)) try{ localStorage.setItem('lineIndex', String(currentLineIndex)); }catch(_){ }
drawViz(0);
})();