'use strict';
const $ = id => document.getElementById(id);
const form = $('configForm');
const controls = [...form.querySelectorAll('input,select')];
const defaults = Object.fromEntries(controls.map(el => [el.id, el.type === 'checkbox' ? el.checked : el.value]));
const historyKey = 'shaft-studio-config-history-v1';
const f = n => Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
let config, currentView = '3d', azimuth = 26, elevation = 16, zoom = 1, timer;
let customHeights = [], lastCount = 0, lastSpacing = 'even';
let pendingHistoryEntry = null;
const colors = { white:'#f7f7ee', steel:'#bbc5c5', acrylic:'#d3e7e2', wood:'#d6b48a' };
const materials = { white:'白色板材', steel:'304 不锈钢', acrylic:'半透明亚克力', wood:'浅色木板' };
function notify(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(timer); timer = setTimeout(() => $('toast').hidden = true, 3500); }
function readHistory() { try { const entries = JSON.parse(localStorage.getItem(historyKey) || '[]'); return Array.isArray(entries) ? entries.filter(item => item && item.id && item.values) : []; } catch { return []; } }
function writeHistory(entries) { try { localStorage.setItem(historyKey, JSON.stringify(entries)); return true; } catch { notify('历史配置无法保存，请检查浏览器存储空间或权限。'); return false; } }
function currentValues() { return Object.fromEntries(controls.map(el => [el.id, el.type === 'checkbox' ? el.checked : el.value])); }
function renderHistory() {
  const entries = readHistory();
  $('historyList').innerHTML = entries.length ? entries.map(item => `<article class="history-item"><div class="history-item-main"><strong>${esc(item.name)}</strong><span>${esc(item.description || '自定义配置')} · ${esc(item.savedAt || '')}</span></div><button type="button" class="history-restore" data-history-restore="${esc(item.id)}">恢复</button><button type="button" class="history-delete" data-history-delete="${esc(item.id)}" aria-label="删除 ${esc(item.name)}">删除</button></article>`).join('') : '<p class="history-empty">暂无历史配置</p>';
}
function getConfig() {
  const c = Object.fromEntries(controls.map(el => [el.id, el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value]));
  c.wheelHeight = 41; c.wheelDiameter = 25; c.wheelWidth = 13;
  c.cx = c.offsetX + (c.holeMode === 'edge' ? c.hole / 2 : 0);
  c.cy = c.offsetY + (c.holeMode === 'edge' ? c.hole / 2 : 0);
  c.xspan = c.length - 2*c.cx; c.yspan = c.width - 2*c.cy;
  c.heights = Array.from({length:Math.max(2,Math.min(8,Math.round(c.levels)||2))}, (_,i) => c.bottom + i*(c.height-c.top-c.bottom)/(c.levels-1));
  if (c.spacing === 'custom' && lastSpacing === 'custom') c.heights = c.heights.map((v,i) => customHeights[i] ?? v);
  c.double = c.clampMode === 'double';
  c.guardRailCount = Math.max(0,c.levels-1) * (Number(c.guardSide) + Number(c.guardCross)) + (c.guardTop ? (Number(c.guardSide) + Number(c.guardCross)) : 0);
  c.guardClampCount = c.guardRailCount * 2;
  c.topGuardHeight = Math.min(c.guardHeight, c.top);
  c.clampCount = c.levels * (c.double ? 8 : 4);
  c.rodCount = 4+c.levels*(c.double ? 4 : 2)+c.guardRailCount;
  c.totalHeight = c.height+(c.wheels ? c.wheelHeight : 0);
  c.longRod = Math.floor(c.xspan + c.hole + 20);
  c.shortRod = Math.floor(c.yspan + c.hole + 20);
  return c;
}
function syncCustom(c) {
  if (lastCount !== c.levels || lastSpacing !== c.spacing) {
    if (lastSpacing !== 'custom' || c.spacing !== 'custom') customHeights = [...c.heights];
    $('customLevels').innerHTML = c.heights.map((v,i) => `<label>第 ${i+1} 层板面高度<div class="input-unit"><input data-level="${i}" type="number" min="1" max="3000" value="${customHeights[i] ?? v}"><span>mm</span></div></label>`).join('');
    lastCount = c.levels; lastSpacing = c.spacing;
  }
  $('customLevels').hidden = c.spacing !== 'custom';
}
function validate(c) {
  const errors = [], warnings = [];
  const enums = {material:['white','steel','acrylic','wood'], holeMode:['center','edge'], spacing:['even','custom'], clampMode:['double','single'], clampColor:['silver','black'], guardSide:['0','1','2'], guardCross:['0','1','2']};
  for (const [key,values] of Object.entries(enums)) if (!values.includes(c[key])) errors.push('配置中的选项无效，请重新选择。');
  for (const el of controls.filter(el => el.type === 'number')) {
    if (!el.validity.valid || el.value.trim() === '' || !Number.isFinite(Number(el.value))) errors.push(`${el.closest('label').firstChild.textContent.trim()}：请输入 ${el.min}–${el.max} 范围内的有效数字。`);
  }
  if (errors.length) return {errors,warnings};
  if (c.radius > Math.min(c.length,c.width)/2) errors.push('圆角半径不能超过层板短边的一半。');
  const qx=Math.abs(c.cx-c.length/2)-(c.length/2-c.radius), qy=Math.abs(c.cy-c.width/2)-(c.width/2-c.radius);
  const sdf=Math.hypot(Math.max(qx,0),Math.max(qy,0))+Math.min(Math.max(qx,qy),0)-c.radius;
  if (sdf > -c.hole/2) errors.push('通孔超出层板或进入圆角边缘，请增大孔距边尺寸。');
  if (c.xspan <= Math.max(c.hole,c.clampLength) || c.yspan <= Math.max(c.hole,c.clampWidth)) errors.push('对称孔或夹具间距过小，请减小孔距边尺寸或增大层板。');
  if (c.hole <= c.rod) errors.push('通孔直径应大于光轴直径，为穿板装配留出间隙。');
  if (c.bore !== c.rod) errors.push('十字夹适配孔径必须与光轴直径一致。');
  if (Math.min(c.clampLength,c.clampWidth,c.clampHeight) < c.bore + 2) errors.push('夹具体的长、宽、高应至少比适配孔径大 2 mm。');
  const support = c.thickness + c.clampHeight*(c.double?2:1)+(c.double?c.clampGap:0);
  if (c.bottom <= support) errors.push(`底层板面高度需大于 ${f(support)} mm，为板下夹具预留空间。`);
  if (c.top >= c.height || c.bottom >= c.height-c.top) errors.push('顶部露出量与底层高度超出立柱可用范围。');
  for(let i=0;i<c.heights.length;i++) {
    const h = c.heights[i];
    if(!Number.isFinite(h) || h <= support || h>c.height) errors.push(`第 ${i+1} 层高度需大于 ${f(support)} 且不超过立柱长度。`);
    if(i>0 && h-c.heights[i-1]<=support+5) errors.push(`第 ${i}、${i+1} 层空间不足，板面间距需大于 ${f(support+5)} mm。`);
    if((c.guardSide || c.guardCross) && i>0) {
      const gap=h-c.heights[i-1]-c.thickness;
      if (gap < c.clampHeight+c.rod+6) errors.push(`第 ${i}、${i+1} 层之间空间不足，中部围挡至少需要 ${f(c.clampHeight+c.rod+6)} mm 净高；请增大层间距或减少围挡数量。`);
      if (c.guardHeight+c.clampHeight/2+c.rod/2 > gap || c.guardHeight-c.clampHeight/2-c.rod/2 < 0) errors.push(`第 ${i}、${i+1} 层的围挡高度 ${f(c.guardHeight)} mm 超出层间净空，请调整围挡高度。`);
    }
  }
  if(c.wheels && c.wheelHeight < c.wheelDiameter+10) errors.push('脚轮安装高度需至少为轮径加 10 mm，为支架预留空间。');
  if(c.hole-c.rod>3) warnings.push('板孔比光轴大超过 3 mm，请确认定位与垫片方案。');
  if(c.material==='steel' && c.thickness<=3 && Math.max(c.xspan,c.yspan)>500) warnings.push('薄不锈钢板跨距较大，承重使用前请确认挠度或增加加强结构。');
  return {errors:[...new Set(errors)], warnings};
}
function update() {
  const c = getConfig(); syncCustom(c);
  const {errors,warnings}=validate(c);
  for (const el of controls.filter(el => el.type === 'number')) {
    const label = el.closest('label');
    let hint = label.querySelector('.input-hint');
    if (!hint) { hint = document.createElement('small'); hint.className = 'input-hint'; label.append(hint); }
    const recommended = defaults[el.id];
    hint.textContent = `范围 ${el.min}–${el.max} ${el.parentElement.querySelector('span')?.textContent || ''} · 推荐 ${recommended}`;
    const invalid = !el.validity.valid || el.value.trim() === '' || !Number.isFinite(Number(el.value));
    el.setAttribute('aria-invalid', invalid ? 'true' : 'false');
    hint.classList.toggle('invalid', invalid);
  }
  $('alerts').hidden = !errors.length && !warnings.length;
  $('alerts').className = errors.length ? 'error' : '';
  $('alerts').textContent = errors.length ? `配置待调整 · ${errors.join(' ')} 当前保留上一次有效预览。` : warnings.join(' ');
  document.querySelectorAll('#export,#exportSvg,#exportCsv,#exportPdf,#print,#saveConfig,#generate').forEach(el=>el.disabled=!!errors.length);
  if(errors.length) return;
  config=c;
  $('holeNote').textContent = `孔中心距左右板边 ${f(c.cx)} mm，距前后板边 ${f(c.cy)} mm；4 孔对称，孔径 Φ${f(c.hole)}。`;
  $('screwDiameter').textContent = `Φ${f(c.rod)} mm`;
  $('guardTopNote').textContent = c.guardTop && c.top < c.guardHeight ? `顶部围挡按顶部层板剩余高度 ${f(c.top)} mm 生成（小于层间围挡高度 ${f(c.guardHeight)} mm）` : '';
  $('statBoards').textContent = `${c.levels} 块 · ${f(c.thickness)} mm`;
  $('statRods').textContent = `${c.rodCount} 根 · Φ${f(c.rod)}`;
  $('statClamps').textContent = `${c.clampCount} 只 · Φ${f(c.bore)}`;
  const gaps = c.heights.slice(1).map((v,i)=>v-c.heights[i]);
  $('statSpacing').textContent = gaps.every(v=>Math.abs(v-gaps[0])<.01) ? `${f(gaps[0])} mm` : '自定义层高';
  $('overallSize').textContent = `${f(c.length)} × ${f(c.width)} × ${f(c.totalHeight)} mm`;
  renderRack(); renderPlate(); renderBom();
}
 $('generate').addEventListener('click',()=>{
  const result=validate(getConfig());
  if(result.errors.length){$('alerts').scrollIntoView({behavior:'smooth',block:'nearest'});return;}
  if(currentView!=='3d')document.querySelector('#tab3d').click();
  renderRack();renderPlate();renderBom();
  notify('效果图已根据当前参数生成');
});
// Orthographic solid renderer. Every coordinate comes from the design parameters.
const add=(a,b)=>a.map((v,i)=>v+b[i]);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const normalized=a=>{const m=Math.hypot(...a);return m?a.map(v=>v/m):[0,0,0];};
const shade=(hex,n)=>'#'+hex.slice(1).match(/../g).map(v=>Math.max(0,Math.min(255,Math.round(parseInt(v,16)*n))).toString(16).padStart(2,'0')).join('');
function renderRack() {
  if(!config) return;
  const c=config, ar=azimuth*Math.PI/180, er=elevation*Math.PI/180;
  const ca=Math.cos(ar),sa=Math.sin(ar),ce=Math.cos(er),se=Math.sin(er);
  const cam=[sa*ce,ca*ce,se], right=[ca,-sa,0], up=[sa*se,ca*se,-ce];
  const foot=c.wheels?c.wheelHeight:0;
  const raw=p=>[dot(p,right),dot(p,up),dot(p,cam)];
  const corners=[];for(const x of [-c.length/2,c.length/2])for(const y of [-c.width/2,c.width/2])for(const z of [-foot,c.height])corners.push(raw([x,y,z]));
  const xmin=Math.min(...corners.map(p=>p[0])),xmax=Math.max(...corners.map(p=>p[0])),ymin=Math.min(...corners.map(p=>p[1])),ymax=Math.max(...corners.map(p=>p[1]));
  const fitScale=Math.min(650/(xmax-xmin||1),605/(ymax-ymin||1));
  const scale=fitScale*zoom, tx=500-(xmin+xmax)/2*scale,ty=423-(ymin+ymax)/2*scale;
  const proj=p=>{const q=raw(p);return [q[0]*scale+tx,q[1]*scale+ty,q[2]];};
  const point=p=>`${p[0].toFixed(2)},${p[1].toFixed(2)}`;
  const path=points=>'M'+points.map(p=>point(proj(p))).join('L')+'Z';
  const shapes=[];
  function face(points,color,options={}) {
    const n=normalized(cross(sub(points[1],points[0]),sub(points[2],points[0])));
    if(dot(n,cam)<-.001) return;
    const light=.78+.22*Math.max(0,dot(n,normalized([-.4,.3,1])));
    const d=options.holes ? path(points)+options.holes.map(path).join('') : path(points);
    shapes.push({depth:points.reduce((s,p)=>s+raw(p)[2],0)/points.length+(options.bias||0),markup:`<path d="${d}" fill="${shade(color,light)}" fill-rule="evenodd" stroke="${shade(color,.69)}" stroke-width=".45" stroke-linejoin="round" ${options.opacity?`opacity="${options.opacity}"`:''}/>`});
  }
  function box(center,size,color) {
    const [x,y,z]=center,[w,d,h]=size.map(v=>v/2);
    const v=[[-w,-d,-h],[w,-d,-h],[w,d,-h],[-w,d,-h],[-w,-d,h],[w,-d,h],[w,d,h],[-w,d,h]].map(p=>add(p,[x,y,z]));
    [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]].forEach(ids=>face(ids.map(i=>v[i]),color));
  }
  function cylinder(a,b,r,color,segments=12,inner=false,bias=0) {
    const direction=normalized(sub(b,a)),u=normalized(cross(direction,Math.abs(direction[2])<.8?[0,0,1]:[0,1,0])),v=cross(direction,u);
    const circle=p=>Array.from({length:segments},(_,i)=>add(p,add(u.map(n=>n*r*Math.cos(i*2*Math.PI/segments)),v.map(n=>n*r*Math.sin(i*2*Math.PI/segments)))));
    const s=circle(a),t=circle(b);
    for(let i=0;i<segments;i++) {const j=(i+1)%segments;face(inner?[s[i],t[i],t[j],s[j]]:[s[i],s[j],t[j],t[i]],color,{bias});}
    if(!inner){face([...s].reverse(),color,{bias});face(t,color,{bias});}
  }
  function board(z) {
    const r=c.radius,w=c.length/2,d=c.width/2;
    const outline=[];
    if(r===0)outline.push([w,d,z],[-w,d,z],[-w,-d,z],[w,-d,z]);
    else for(const [x,y,start] of [[w-r,d-r,0],[-w+r,d-r,90],[-w+r,-d+r,180],[w-r,-d+r,270]])for(let i=0;i<=5;i++){const a=(start+i*18)*Math.PI/180;outline.push([x+r*Math.cos(a),y+r*Math.sin(a),z]);}
    const holes=[];
    for(const x of [-c.xspan/2,c.xspan/2])for(const y of [-c.yspan/2,c.yspan/2]) {
      holes.push(Array.from({length:20},(_,i)=>[x+Math.cos(i*Math.PI/10)*c.hole/2,y+Math.sin(i*Math.PI/10)*c.hole/2,z]));
      cylinder([x,y,z-c.thickness],[x,y,z],c.hole/2,shade(colors[c.material],.8),16,true);
    }
    const color=colors[c.material],bottom=outline.map(p=>[p[0],p[1],z-c.thickness]);
    face(outline,color,{holes,opacity:c.material==='acrylic'?.68:1});
    face([...bottom].reverse(),color,{holes:holes.map(ps=>ps.map(p=>[p[0],p[1],z-c.thickness]))});
    for(let i=0;i<outline.length;i++){const j=(i+1)%outline.length;face([bottom[i],bottom[j],outline[j],outline[i]],color);}
  }
  const xs=[-c.xspan/2,c.xspan/2],ys=[-c.yspan/2,c.yspan/2];
  const cuts=[0,c.height,...c.heights.flatMap(h=>[h-c.thickness-c.clampHeight*(c.double?2:1)-(c.double?c.clampGap:0),h-c.thickness-c.clampHeight,h-c.thickness,h])].filter(z=>z>=0&&z<=c.height).sort((a,b)=>a-b);
  for(const x of xs)for(const y of ys){
    for(let i=1;i<cuts.length;i++)if(cuts[i]>cuts[i-1])cylinder([x,y,cuts[i-1]],[x,y,cuts[i]],c.rod/2,'#c6cdcb',12);
    if(c.wheels){
      const wheelZ=-foot+c.wheelDiameter/2, wheelR=c.wheelDiameter/2;
      cylinder([x-wheelR,y-c.wheelWidth/2,wheelZ],[x-wheelR,y+c.wheelWidth/2,wheelZ],wheelR,'#404942',18);
      cylinder([x-wheelR,y+c.wheelWidth/2,wheelZ],[x-wheelR,y+c.wheelWidth/2+1,wheelZ],wheelR*.48,'#bdc8b7',12);
      cylinder([x-wheelR,y+c.wheelWidth/2+1,wheelZ],[x-wheelR,y+c.wheelWidth/2+2,wheelZ],wheelR*.17,'#646d62',12);
      box([x,y,-foot+c.wheelDiameter+10],[c.rod+5,c.wheelWidth+5,20],'#b8c2bd');
      box([x,y,-foot/2],[c.rod+9,c.rod+11,Math.max(8,foot-c.wheelDiameter*.7)],'#a6b6a0');
      cylinder([x,y,-9],[x,y,0],c.rod*.85,'#afbfa9',12);
    } else cylinder([x,y,0],[x,y,4],c.rod*.65,'#535d51',12);
  }
  const clampColor=c.clampColor==='black'?'#474f4c':'#cbd2cd';
  function clamp(x,y,z,axis) {
    box([x,y,z],axis==='x'?[c.clampLength,c.clampWidth,c.clampHeight]:[c.clampWidth,c.clampLength,c.clampHeight],clampColor);
    const screwR=Math.min(3,c.clampHeight*.15),frontY=y+(axis==='x'?c.clampWidth:c.clampLength)/2;
    cylinder([x,frontY,z],[x,frontY+1.2,z],screwR,'#404945',10);
    const hp=z+c.clampHeight/2+.08;
    const ring=Array.from({length:16},(_,i)=>[x+Math.cos(i*Math.PI/8)*(c.rod/2+.6),y+Math.sin(i*Math.PI/8)*(c.rod/2+.6),hp]);
    const hole=Array.from({length:16},(_,i)=>[x+Math.cos(i*Math.PI/8)*c.rod/2,y+Math.sin(i*Math.PI/8)*c.rod/2,hp]);
    face(ring,'#4a5350',{holes:[hole],bias:.05});
  }
  for(const h of c.heights){
    const z=h-c.thickness-c.clampHeight/2;
    for(const y of ys) cylinder([-c.longRod/2,y,z],[c.longRod/2,y,z],c.rod/2,'#c6cdcb',12);
    for(const x of xs)for(const y of ys)clamp(x,y,z,'x');
    if(c.double){const z2=z-c.clampHeight-c.clampGap;
      for(const x of xs)cylinder([x,-c.shortRod/2,z2],[x,c.shortRod/2,z2],c.rod/2,'#c6cdcb',12);
      for(const x of xs)for(const y of ys)clamp(x,y,z2,'y');
    }
    board(h);
    // Keep the rod visible through the board hole instead of letting the board face cover it.
    for (const x of [-c.xspan/2,c.xspan/2]) for (const y of [-c.yspan/2,c.yspan/2])
      cylinder([x,y,h-c.thickness-.5],[x,y,h+.5],c.rod/2,'#c6cdcb',12,false,8);
  }
  function drawGuard(z) {
    if(c.guardSide>0) for(const y of [-c.yspan/2,c.yspan/2].slice(0,Number(c.guardSide))) {
      cylinder([-c.xspan/2,y,z],[c.xspan/2,y,z],c.rod/2,'#c6cdcb',12);
      clamp(-c.xspan/2,y,z,'x'); clamp(c.xspan/2,y,z,'x');
    }
    if(c.guardCross>0) for(const x of [-c.xspan/2,c.xspan/2].slice(0,Number(c.guardCross))) {
      cylinder([x,-c.yspan/2,z],[x,c.yspan/2,z],c.rod/2,'#c6cdcb',12);
      clamp(x,-c.yspan/2,z,'y'); clamp(x,c.yspan/2,z,'y');
    }
  }
  if(c.guardSide || c.guardCross) for(let i=1;i<c.heights.length;i++) drawGuard(c.heights[i-1]+c.guardHeight);
  if(c.guardTop && (c.guardSide || c.guardCross)) drawGuard(c.heights[c.heights.length-1]+c.topGuardHeight);
  let grid='';
  if(c.grid){const step=Math.max(50,Math.ceil(Math.max(c.length,c.width)/800)*100),span=Math.max(c.length,c.width)*.9;
    for(let n=-span;n<=span;n+=step)for(const ps of [[[n,-span,-foot],[n,span,-foot]],[[-span,n,-foot],[span,n,-foot]]])grid+=`<path d="M${ps.map(p=>point(proj(p))).join('L')}" stroke="#dde3d5" stroke-width=".65" opacity=".65"/>`;
  }
  const shadow=proj([0,0,-foot-1]);
  let s=`<defs><radialGradient id="floorShadow"><stop offset="0" stop-color="#758068" stop-opacity=".22"/><stop offset="1" stop-color="#758068" stop-opacity="0"/></radialGradient><marker id="dimArrow" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M8 0L0 4L8 8" fill="none" stroke="#8b9c7f" stroke-width="1"/></marker></defs><rect width="1000" height="850" fill="#f7f8f4"/><g>${grid}</g><ellipse cx="${shadow[0]}" cy="${shadow[1]}" rx="${Math.max(100,c.length*scale*.65)}" ry="${Math.max(25,c.width*scale*.32)}" fill="url(#floorShadow)"/>`;
  shapes.sort((a,b)=>a.depth-b.depth);s+=shapes.map(o=>o.markup).join('');
  const font=`font-family="-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif"`;
  function dim(a,b,label,offset=[0,0]) {
    const p=proj(a),q=proj(b),pa=[p[0]+offset[0],p[1]+offset[1]],qa=[q[0]+offset[0],q[1]+offset[1]];
    return `<g stroke="#92a384" fill="none" stroke-width=".8"><path d="M${point(p)}L${point(pa)}M${point(q)}L${point(qa)}" stroke-dasharray="3 3"/><path d="M${point(pa)}L${point(qa)}" marker-start="url(#dimArrow)" marker-end="url(#dimArrow)"/></g><text x="${(pa[0]+qa[0])/2}" y="${(pa[1]+qa[1])/2-9}" fill="#718362" ${font} text-anchor="middle" font-size="12" stroke="#f7f8f4" stroke-width="5" paint-order="stroke">${label}</text>`;
  }
  if(c.dimensions && elevation<85){s+=dim([-c.length/2,c.width/2,-foot],[c.length/2,c.width/2,-foot],`L ${f(c.length)}`,[0,38]);
    s+=dim([c.length/2,c.width/2,-foot],[c.length/2,-c.width/2,-foot],`W ${f(c.width)}`,[26,26]);
    const all=corners.map(q=>q[0]*scale+tx),xx=Math.max(...all)+56, top=proj([c.length/2,-c.width/2,c.height]),bt=proj([c.length/2,-c.width/2,-foot]);
    s+=`<path d="M${point(top)}L${xx},${top[1]}M${point(bt)}L${xx},${bt[1]}" stroke="#92a384" stroke-width=".8" stroke-dasharray="3 3"/><path d="M${xx},${top[1]}V${bt[1]}" stroke="#92a384" stroke-width=".8" marker-start="url(#dimArrow)" marker-end="url(#dimArrow)"/><text transform="translate(${xx+17},${(top[1]+bt[1])/2}) rotate(-90)" text-anchor="middle" fill="#718362" font-size="12" ${font}>H ${f(c.totalHeight)} mm${c.wheels?'（含脚轮）':''}</text>`;
  }
  $('rackSvg').innerHTML=s;
  $('zoomText').textContent=`${Math.round(zoom*100)}%`;
}
function renderPlate(){
  const c=config,sc=Math.min(690/c.length,310/c.width),w=c.length*sc,h=c.width*sc,x=(1000-w)/2,y=290-h/2;
  const t=(x,y,s,sz=12,col='#7b8b6b',anchor='middle')=>`<text x="${x}" y="${y}" font-size="${sz}" fill="${col}" text-anchor="${anchor}">${esc(s)}</text>`;
  const line=(x1,y1,x2,y2,arrows=false)=>`<path d="M${x1},${y1}L${x2},${y2}" fill="none" stroke="#94a080" stroke-width="1" ${arrows?'marker-start="url(#pa)" marker-end="url(#pa)"':'stroke-dasharray="3 3"'}/>`;
  let s=`<defs><pattern id="plateGrid" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M25 0H0V25" fill="none" stroke="#e7ebdf" stroke-width=".6"/></pattern><marker id="pa" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M8 0L0 4L8 8" fill="none" stroke="#94a080"/></marker></defs><rect width="1000" height="760" fill="#f7f8f4"/><rect width="1000" height="760" fill="url(#plateGrid)"/><g font-family="-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif">`;
  s+=`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${c.radius*sc}" fill="#eef2e8" stroke="#5e7161" stroke-width="1.4"/>`;
  for(const xx of [x+c.cx*sc,x+w-c.cx*sc])for(const yy of [y+c.cy*sc,y+h-c.cy*sc]){
    const r=c.hole*sc/2;
    s+=`<circle cx="${xx}" cy="${yy}" r="${r}" fill="#f7f8f4" stroke="#5e7161" stroke-width="1.2"/>`;
    s+=line(xx-r-6,yy,xx+r+6,yy)+line(xx,yy-r-6,xx,yy+r+6);
  }
  s+=line(x,y-10,x,y-57)+line(x+w,y-10,x+w,y-57)+line(x,y-48,x+w,y-48,true)+t(500,y-60,`L ${f(c.length)}`,14);
  s+=line(x-10,y,x-60,y)+line(x-10,y+h,x-60,y+h)+line(x-49,y,x-49,y+h,true)+`<text transform="translate(${x-61},${y+h/2}) rotate(-90)" font-size="14" fill="#7b8b6b" text-anchor="middle">W ${f(c.width)}</text>`;
  const p1=[x+w-c.cx*sc,y+c.cy*sc];
  s+=line(...p1,x+w+35,y-15)+line(x+w+35,y-15,x+w+70,y-15)+t(x+w+35,y-24,`4 孔 Φ${f(c.hole)}`,12,'#67785a');
  s+=line(x+w-c.radius*sc*.3,y+c.radius*sc*.3,x+w+40,y+40)+t(x+w+43,y+56,`R${f(c.radius)}`,12,'#67785a');
  const dx=192,dy=535,detailScale=Math.min(4,115/Math.max(c.cx+c.hole,c.cy+c.hole,c.radius+10)),dh=116,dw=170;
  const hx=dx+c.cx*detailScale,hy=dy+c.cy*detailScale,rr=c.hole*detailScale/2;
  s+=t(dx,dy-30,'左上角孔位 · 局部放大',12,'#667c5c','start');
  s+=`<path d="M${dx},${dy+dh}V${dy+c.radius*detailScale}Q${dx},${dy} ${dx+c.radius*detailScale},${dy}H${dx+dw}" fill="none" stroke="#5e7161" stroke-width="1.5"/><circle cx="${hx}" cy="${hy}" r="${rr}" fill="#eef2e8" stroke="#5e7161" stroke-width="1.2"/>`;
  s+=line(hx-rr-7,hy,hx+rr+7,hy)+line(hx,hy-rr-7,hx,hy+rr+7);
  s+=line(dx,dy-5,dx,dy-20)+line(hx,hy,hx,dy-20)+line(dx,dy-15,hx,dy-15,true)+t((dx+hx)/2,dy-22,`X ${f(c.cx)}`,10);
  s+=line(dx-5,dy,dx-36,dy)+line(hx,hy,dx-36,hy)+line(dx-28,dy,dx-28,hy,true)+t(dx-36,(dy+hy)/2+4,`Y ${f(c.cy)}`,10,'#7b8b6b','end');
  s+=t(475,540,`孔中心距左右板边：${f(c.cx)} mm`,12,'#6a7c60','start')+t(475,566,`孔中心距前后板边：${f(c.cy)} mm`,12,'#6a7c60','start')+t(475,592,`孔边净距：左右 ${f(c.cx-c.hole/2)} / 前后 ${f(c.cy-c.hole/2)} mm`,12,'#6a7c60','start');
  s+=line(130,674,870,674)+t(145,699,`${materials[c.material]} · T ${f(c.thickness)} mm · ${c.levels} 件`,13,'#586e4f','start')+t(855,699,'单位 mm / 示意图',11,'#8b9980','end')+'</g>';
  $('plateSvg').innerHTML=s;
  $('plateCaption').textContent='孔位以孔中心标注 · 四角对称 · 图形按实际尺寸比例绘制';
}
function bomRows(){const c=config;return [
  ['打孔层板',`${f(c.length)} × ${f(c.width)} × ${f(c.thickness)} mm`,`${c.levels} 块`,`${materials[c.material]}；4 × Φ${f(c.hole)}；R${f(c.radius)}`],
  ['立柱光轴',`Φ${f(c.rod)} × ${f(c.height)} mm`,'4 根','贯穿所有层板'],
  ...((c.guardSide||c.guardCross)?[
    ...(Number(c.guardSide)>0?[['围挡侧向光轴（沿层板长度）',`Φ${f(c.rod)} × ${f(c.longRod)} mm`,`${Number(c.guardSide)*(c.levels-1+(c.guardTop?1:0))} 根`,`公式：floor(孔中心距 ${f(c.xspan)} + 孔径 ${f(c.hole)} + 20)；每个层间 ${c.guardSide} 根${c.guardTop?'；顶层另加同规格':''}`]]:[]),
    ...(Number(c.guardCross)>0?[['围挡横向光轴（沿层板宽度）',`Φ${f(c.rod)} × ${f(c.shortRod)} mm`,`${Number(c.guardCross)*(c.levels-1+(c.guardTop?1:0))} 根`,`公式：floor(孔中心距 ${f(c.yspan)} + 孔径 ${f(c.hole)} + 20)；每个层间 ${c.guardCross} 根${c.guardTop?'；顶层另加同规格':''}`]]:[])
  ]:[]),
  ['长向横杆',`Φ${f(c.rod)} × ${f(c.longRod)} mm`,`${c.levels*2} 根`,`公式：floor(孔中心距 ${f(c.xspan)} + 孔径 ${f(c.hole)} + 20)`],
  ...(c.double?[['短向横杆',`Φ${f(c.rod)} × ${f(c.shortRod)} mm`,`${c.levels*2} 根`,`公式：floor(孔中心距 ${f(c.yspan)} + 孔径 ${f(c.hole)} + 20)`]]:[]),
  ['光轴十字夹',`Φ${f(c.bore)} / ${f(c.clampLength)} × ${f(c.clampWidth)} × ${f(c.clampHeight)} mm`,`${c.clampCount+c.guardClampCount} 只`,`基础夹具 ${c.clampCount} 只；围挡两端另加 ${c.guardClampCount} 只；${c.clampColor==='black'?'黑色':'银色'}`],
  ...(c.wheels?[
    ['钢丝绳连接器锁扣',`M${f(c.rod)} · 内径 ${f(c.rod+1)} mm · 长 60 mm`,'4 个','光轴与脚轮连接配件，规格随光轴直径确定'],
    ['万向轮',`安装高 ${f(c.wheelHeight)} / Φ${f(c.wheelDiameter)} × 宽 ${f(c.wheelWidth)} mm`,'4 只','带刹车；轮子转动半径约 48 mm']
  ]:[])
];}
function renderBom(){
  $('bomTable').innerHTML='<table><thead><tr><th>部件</th><th>规格</th><th>数量</th><th>说明</th></tr></thead><tbody>'+bomRows().map(r=>'<tr>'+r.map(v=>`<td>${esc(v)}</td>`).join('')+'</tr>').join('')+'</tbody></table>';
}
function saveBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);}
function svgSource(){const svg=$(currentView==='plate'?'plateSvg':'rackSvg').cloneNode(true);svg.setAttribute('xmlns','http://www.w3.org/2000/svg');svg.setAttribute('width','1000');svg.setAttribute('height',currentView==='plate'?'760':'850');return new XMLSerializer().serializeToString(svg);}
function exportSvg(){if(currentView==='bom')return exportCsv();saveBlob(new Blob([svgSource()],{type:'image/svg+xml;charset=utf-8'}),currentView==='plate'?'层板打孔图.svg':'光轴置物架.svg');}
function exportCsv(){const rows=[['部件','规格','数量','说明'],...bomRows()];saveBlob(new Blob(['\uFEFF'+rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),'置物架材料清单.csv');}
function exportPdf(){
  if(!config)return;
  const popup=window.open('','_blank','width=1100,height=850');
  if(!popup){notify('无法打开 PDF 导出窗口，请允许浏览器弹窗后重试。');return;}
  const rack=svgSourceFor('rackSvg','1000','850'), plate=svgSourceFor('plateSvg','1000','760');
  const now=new Date(), saved=readHistory().find(item=>JSON.stringify(item.values)===JSON.stringify(currentValues()));
  const pad=n=>String(n).padStart(2,'0');
  const stamp=saved ? `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}` : `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  const fileName=`${saved?saved.name:'我的光轴置物架'}_${stamp}.pdf`;
  popup.document.open();popup.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(fileName)}</title><style>
  @page{size:A4;margin:12mm}*{box-sizing:border-box}body{margin:0;color:#233c38;font:12px/1.5 -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif}section{page-break-after:always}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:0 0 10px;border-bottom:1px solid #dfe5de;padding-bottom:6px}.meta{color:#7d8d82;margin-bottom:10px}.visual{width:100%;height:190mm;object-fit:contain;background:#f7f8f4}.plate{height:170mm}table{width:100%;border-collapse:collapse;font-size:10px}th{text-align:left;background:#eef2e8;color:#61745f;padding:7px}td{padding:7px;border-bottom:1px solid #e3e8e0}.print-note{color:#7d8d82;margin-top:10px}@media print{.no-print{display:none}}</style></head><body>
  <section><h1>光轴置物架 · 立体效果图</h1><div class="meta">${f(config.length)} × ${f(config.width)} × ${f(config.totalHeight)} mm · ${config.levels} 层</div><img class="visual" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(rack)}"></section>
  <section><h1>层板打孔图</h1><div class="meta">四角对称通孔 · 单位 mm</div><img class="visual plate" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(plate)}"></section>
  <section><h1>材料清单</h1><div class="meta">配置生成时间：${new Date().toLocaleString('zh-CN')}</div>${$('bomTable').innerHTML}<p class="print-note">杆件长度和夹具数量按当前参数计算，实际下料前请结合所购配件复核。</p></section>
  </body></html>`);popup.document.close();popup.focus();setTimeout(()=>{popup.print();notify(`PDF 文件名已设置为：${fileName}；保存位置请在系统窗口中选择项目目录。`);},350);
}
function svgSourceFor(id,width,height){const svg=$(id).cloneNode(true);svg.setAttribute('xmlns','http://www.w3.org/2000/svg');svg.setAttribute('width',width);svg.setAttribute('height',height);return new XMLSerializer().serializeToString(svg);}
async function exportPng(){
  if(currentView==='bom')return exportCsv();
  const url=URL.createObjectURL(new Blob([svgSource()],{type:'image/svg+xml;charset=utf-8'}));
  const image=new Image();
  try {await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=url;});
    const canvas=document.createElement('canvas');canvas.width=2000;canvas.height=currentView==='plate'?1520:1700;canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('empty');
    saveBlob(blob,currentView==='plate'?'层板打孔图.png':'光轴置物架.png');notify('图片已导出 · 2 倍分辨率 PNG');
  }catch{notify('图片导出失败，请使用「导出 SVG」保存矢量图。');}finally{URL.revokeObjectURL(url);}
}
form.addEventListener('input',e=>{if(e.target.dataset.level!==undefined)customHeights[Number(e.target.dataset.level)]=e.target.value===''?NaN:Number(e.target.value);update();});
form.addEventListener('change',update);
function applyValues(values){for(const el of controls)if(Object.hasOwn(values,el.id)){if(el.type==='checkbox')el.checked=!!values[el.id];else el.value=values[el.id];}lastCount=0;lastSpacing='even';customHeights=[];update();}
$('reset').addEventListener('click',()=>{applyValues(defaults);azimuth=26;elevation=16;zoom=1;selectAngle('perspective');renderRack();notify('已恢复默认置物架配置');});
$('photoPreset').addEventListener('click',()=>{applyValues(defaults);notify('已应用参考图二风格：三层白板、双十字夹、四脚轮');});
$('platePreset').addEventListener('click',()=>{applyValues({...defaults,length:380,width:140,height:800,thickness:3,radius:5,material:'steel',hole:8,holeMode:'edge',offsetX:10,offsetY:6,rod:6,bore:6,clampLength:22,clampWidth:14,clampHeight:10,bottom:70,top:40,wheelDiameter:35,wheelHeight:50});notify('已应用图一：380×140、T3、R5、Φ8，孔边净距 10 / 6 mm');});
for(const tab of document.querySelectorAll('[data-view]')) tab.addEventListener('click',()=>{
  currentView=tab.dataset.view;
  for(const t of document.querySelectorAll('[data-view]')){t.classList.toggle('active',t===tab);t.setAttribute('aria-selected',t===tab?'true':'false');}
  $('view3d').hidden=currentView!=='3d';$('viewPlate').hidden=currentView!=='plate';$('viewBom').hidden=currentView!=='bom';
  $('export').querySelector('span').textContent=currentView==='bom'?'导出清单':'导出图片';
});
function selectAngle(name){document.querySelectorAll('[data-angle]').forEach(el=>el.classList.toggle('selected',el.dataset.angle===name));}
for(const b of document.querySelectorAll('[data-angle]'))b.addEventListener('click',()=>{[azimuth,elevation]=({perspective:[26,16],front:[0,0],side:[90,0],top:[0,90]})[b.dataset.angle];zoom=1;selectAngle(b.dataset.angle);renderRack();});
function changeZoom(delta){zoom=Math.max(.45,Math.min(2.5,zoom+delta));renderRack();}
$('zoomIn').addEventListener('click',()=>changeZoom(.1));$('zoomOut').addEventListener('click',()=>changeZoom(-.1));
$('fit').addEventListener('click',()=>{azimuth=26;elevation=16;zoom=1;selectAngle('perspective');renderRack();});
let drag;
$('scene').addEventListener('pointerdown',e=>{if(e.button!==0)return;drag={x:e.clientX,y:e.clientY,az:azimuth,el:elevation};$('scene').setPointerCapture(e.pointerId);});
$('scene').addEventListener('pointermove',e=>{if(!drag)return;azimuth=drag.az+(e.clientX-drag.x)*.35;elevation=Math.max(0,Math.min(89,drag.el+(e.clientY-drag.y)*.25));selectAngle('');renderRack();});
for(const event of ['pointerup','pointercancel','lostpointercapture'])$('scene').addEventListener(event,()=>drag=null);
$('scene').addEventListener('wheel',e=>{e.preventDefault();changeZoom(e.deltaY<0?.06:-.06);},{passive:false});
 $('export').addEventListener('click',exportPng);$('exportPdf').addEventListener('click',exportPdf);$('exportSvg').addEventListener('click',exportSvg);$('exportCsv').addEventListener('click',exportCsv);$('print').addEventListener('click',()=>window.print());
$('saveConfig').addEventListener('click',()=>{const values=Object.fromEntries(controls.map(el=>[el.id,el.type==='checkbox'?el.checked:el.value]));saveBlob(new Blob([JSON.stringify({version:1,values,heights:config.heights},null,2)],{type:'application/json'}),'光轴置物架配置.json');});
$('historyOpen').addEventListener('click',()=>{renderHistory();$('historyDialog').showModal();});
$('historyClose').addEventListener('click',()=>$('historyDialog').close());
$('historyDialog').addEventListener('click',e=>{if(e.target===$('historyDialog'))$('historyDialog').close();});
$('historyList').addEventListener('click',e=>{
  const restore=e.target.closest('[data-history-restore]'),remove=e.target.closest('[data-history-delete]');
  if(restore){const item=readHistory().find(entry=>entry.id===restore.dataset.historyRestore);if(!item)return;applyValues(item.values);if(Array.isArray(item.heights)){customHeights=item.heights;lastCount=0;update();}$('historyDialog').close();notify(validate(getConfig()).errors.length?'历史配置已恢复，请按红色提示调整参数。':'历史配置已恢复');}
  if(remove){writeHistory(readHistory().filter(entry=>entry.id!==remove.dataset.historyDelete));renderHistory();}
});
$('historySaveForm').addEventListener('submit',e=>{e.preventDefault();const name=$('historyName').value.trim();if(!name){$('historyName').focus();return;}const entry={id:`${Date.now()}-${Math.random().toString(36).slice(2)}`,name,description:`${$('length').value} × ${$('width').value} mm · ${$('levels').value} 层`,savedAt:new Intl.DateTimeFormat('zh-CN',{dateStyle:'medium'}).format(new Date()),values:currentValues(),heights:[...getConfig().heights]};const duplicate=readHistory().some(item=>item.name===name);if(duplicate){pendingHistoryEntry=entry;$('duplicateHistoryDialog').showModal();return;}if(writeHistory([entry,...readHistory()].slice(0,30))){$('historyName').value='';renderHistory();notify('已保存到历史配置');}});
$('historyOverwrite').addEventListener('click',()=>{if(!pendingHistoryEntry)return;const entries=readHistory().filter(item=>item.name!==pendingHistoryEntry.name);if(writeHistory([pendingHistoryEntry,...entries].slice(0,30))){$('duplicateHistoryDialog').close();$('historyName').value='';pendingHistoryEntry=null;renderHistory();notify('已覆盖原来的历史配置');}});
$('historyRename').addEventListener('click',()=>{$('duplicateHistoryDialog').close();pendingHistoryEntry=null;$('historyName').focus();});
$('loadConfig').addEventListener('click',()=>$('configFile').click());
$('configFile').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{
  if(file.size>100000)throw new Error('size');const data=JSON.parse(await file.text());
  if(data.version!==1||!data.values||typeof data.values!=='object'||!controls.some(el=>Object.hasOwn(data.values,el.id)))throw new Error('format');
  const before=Object.fromEntries(controls.map(el=>[el.id,el.type==='checkbox'?el.checked:el.value])),beforeCustom=[...customHeights];
  applyValues(data.values);if(data.values.spacing==='custom'&&Array.isArray(data.heights)){customHeights=data.heights.map(v=>typeof v==='number'?v:NaN);lastCount=0;update();}
  if(validate(getConfig()).errors.length){applyValues(before);customHeights=beforeCustom;lastCount=0;update();throw new Error('invalid');}
  notify('配置已载入');
}catch{notify('配置无法载入，请选择本页面保存的有效配置 JSON。');}finally{e.target.value='';}});
let historyExists=false;try{historyExists=localStorage.getItem(historyKey)!==null;}catch{}
if(!historyExists){
  const screenshotValues={...defaults,length:'312',width:'1000',thickness:'18',radius:'',material:'white',hole:'8',holeMode:'edge',offsetX:'10',offsetY:'6',height:'600',levels:'2',bottom:'90',top:'50',spacing:'even',rod:'8',bore:'8',clampMode:'double',guardSide:'1',guardCross:'1',guardHeight:'220',guardTop:false,wheels:true,dimensions:true,grid:true};
  writeHistory([{id:'screenshot-config-2026-10-27',name:'截图中的置物架配置',description:'截图可见参数；未显示项使用初始值',savedAt:'2026-10-27',values:screenshotValues,heights:[90,550]}]);
}
const latestHistory=readHistory()[0];
if(latestHistory){applyValues(latestHistory.values);if(Array.isArray(latestHistory.heights)){customHeights=latestHistory.heights;lastCount=0;update();}}
else update();
