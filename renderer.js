const {ipcRenderer}=require("electron");

const FALLBACK=[
  {name:"Bitcoin / USDT",symbol:"BTCUSDT",badge:"BTC",stream:"btcusdt",p:2},
  {name:"Ethereum / USDT",symbol:"ETHUSDT",badge:"ETH",stream:"ethusdt",p:2},
  {name:"Solana / USDT",symbol:"SOLUSDT",badge:"SOL",stream:"solusdt",p:3},
  {name:"BNB / USDT",symbol:"BNBUSDT",badge:"BNB",stream:"bnbusdt",p:2},
  {name:"USDT / Real",symbol:"USDTBRL",badge:"BRL",stream:"usdtbrl",p:4},
  {name:"Euro / USDT",symbol:"EURUSDT",badge:"EUR",stream:"eurusdt",p:5}
];

let assets=FALLBACK.slice();
let provider="binance";
let asset=assets[0];
let ws=null;
let pts=[];
let rule=null;
let last=null;
let first=null;
let lastAlert=0;
let touched=0;
let timer=null;
let busy=false;
let buffer=0;
let events=[];
let zoom=1;
const BASE_VISIBLE=180;

const $=id=>document.getElementById(id);
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));

function fmt(n,p){
  p=p===undefined?(asset.p||5):p;
  return Number.isFinite(n)?n.toLocaleString("pt-BR",{minimumFractionDigits:p,maximumFractionDigits:p}):"--";
}
function ema(v,n){
  if(!v.length)return[];
  let k=2/(n+1),o=[v[0]];
  for(let i=1;i<v.length;i++)o.push(v[i]*k+o[i-1]*(1-k));
  return o;
}
function calcRsi(v,n){
  n=n||14;
  if(v.length<n+1)return null;
  let g=0,l=0;
  for(let i=v.length-n;i<v.length;i++){
    let d=v[i]-v[i-1];
    if(d>=0)g+=d;else l-=d;
  }
  if(!l)return 100;
  let rs=(g/n)/(l/n);
  return 100-100/(1+rs);
}
function velocity(){
  let s=pts.slice(-20);
  if(s.length<3)return 0;
  return (s[s.length-1].p-s[0].p)/Math.max(.1,(s[s.length-1].t-s[0].t)/1000);
}
function addEvent(type,title,detail){
  events.unshift({type,title,detail,time:new Date()});
  if(events.length>100)events.pop();
  renderEvents();
}
function renderEvents(){
  $("events").innerHTML=events.length
    ?events.map(e=>'<div class="event"><time>'+e.time.toLocaleTimeString("pt-BR")+'</time><div><b>'+escapeHtml(e.title)+'</b><small>'+escapeHtml(e.detail)+'</small></div><span class="pill">'+escapeHtml(e.type)+'</span></div>').join("")
    :'<div class="card panel muted">Nenhum alerta ainda.</div>';
}
function escapeHtml(v){
  return String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
}
function notify(title,body){
  addEvent("alerta",title,body);
  if($("notify").checked)ipcRenderer.invoke("notify",{title,body});
}
function resetSeries(){
  pts=[];last=null;first=null;
  $("live").textContent="--";
  $("change").textContent="aguardando feed";
}
function updateAssetHeader(a){
  $("name").textContent=a.name;
  $("symbol").textContent=a.symbol||("IQ-"+a.activeId);
  $("badge").textContent=a.badge||"IQ";
}
function handlePrice(price,at){
  const p=Number(price);
  if(!Number.isFinite(p))return;
  const n=Number.isFinite(Number(at))?Number(at):Date.now();
  last=p;
  if(first===null)first=p;
  if(!pts.length||n-pts[pts.length-1].t>=180)pts.push({t:n,p});
  else pts[pts.length-1]={t:n,p};
  if(pts.length>720)pts.shift();
  update();
  evaluate();
}
async function connect(a){
  asset=a;
  resetSeries();
  updateAssetHeader(a);
  if(ws){try{ws.close();}catch{} ws=null;}

  if(provider==="iq"){
    $("conn").textContent="IQ conectando ativo";
    $("dot").style.background="#f4c565";
    const r=await ipcRenderer.invoke("iq-subscribe",{activeId:a.activeId,size:1});
    if(r.ok){
      $("conn").textContent="IQ Option ao vivo";
      $("dot").style.background="#46d6a0";
      addEvent("feed","IQ Option ao vivo",a.name+" • ativo "+a.activeId);
    }else{
      $("conn").textContent="Erro IQ Option";
      $("dot").style.background="#ff6d83";
      addEvent("erro","Falha ao assinar ativo",r.error||"Erro desconhecido");
    }
    return;
  }

  $("conn").textContent="Binance conectando";
  $("dot").style.background="#f4c565";
  ws=new WebSocket("wss://stream.binance.com:9443/ws/"+a.stream+"@trade");
  ws.onopen=()=>{
    $("conn").textContent="Binance ao vivo";
    $("dot").style.background="#46d6a0";
    addEvent("feed","Feed conectado",a.symbol);
  };
  ws.onclose=()=>{
    if(provider==="binance"&&asset===a){
      $("conn").textContent="Reconectando";
      setTimeout(()=>connect(a),1800);
    }
  };
  ws.onerror=()=>{
    $("conn").textContent="Erro no feed";
    $("dot").style.background="#ff6d83";
  };
  ws.onmessage=e=>{
    const m=JSON.parse(e.data);
    handlePrice(Number(m.p),Date.now());
  };
}
function update(){
  let v=pts.map(x=>x.p),e9=ema(v,9),e21=ema(v,21),rv=calcRsi(v),vel=velocity();
  $("live").textContent=fmt(last);
  if(first){
    let ch=(last-first)/first*100;
    $("change").textContent=(ch>=0?"+":"")+ch.toFixed(3)+"% nesta sessão";
    $("change").style.color=ch>=0?"#46d6a0":"#ff6d83";
  }
  if(e9.length&&e21.length){
    let up=e9[e9.length-1]>e21[e21.length-1];
    $("trend").textContent=up?"SUBINDO":"CAINDO";
    $("trend").style.color=up?"#46d6a0":"#ff6d83";
  }
  $("rsi").textContent=rv===null?"--":rv.toFixed(1);
  $("rsiNote").textContent=rv===null?"coletando":rv>70?"sobrecomprado":rv<30?"sobrevendido":"neutro";
  $("vel").textContent=(vel>=0?"+":"")+fmt(vel,Math.min(5,(asset.p||5)+1))+"/s";
  if(rule&&Number.isFinite(last)){
    let d=Math.abs(rule.target-last),pc=d/last*100;
    $("dist").textContent=pc.toFixed(3)+"%";
    let toward=(rule.target-last)*vel>0,eta=toward&&Math.abs(vel)>1e-8?d/Math.abs(vel):null;
    $("eta").textContent=eta!==null&&eta<3600?"ETA ~"+(eta<60?eta.toFixed(1)+"s":(eta/60).toFixed(1)+"m"):"ETA --";
  }else{
    $("dist").textContent="--";
    $("eta").textContent="ETA --";
  }
  draw(v,e9,e21);
}
function check(id,ok){
  $(id).textContent=ok?"●":"○";
  $(id).classList.toggle("ok",!!ok);
}
function setSignal(k,t){
  $("signal").className="signal "+k;
  $("signal").textContent=t;
}
function evaluate(){
  if(!rule||!Number.isFinite(last))return;
  let v=pts.map(x=>x.p),e9=ema(v,9),e21=ema(v,21),rv=calcRsi(v),vel=velocity();
  let delta=rule.target-last;
  let toward=delta*vel>0;
  let pct=Math.abs(delta)/last*100;
  let prox=pct<=rule.margin;
  let emaOk=e9.length&&e21.length?(rule.dir==="buy"?e9[e9.length-1]>=e21[e21.length-1]:e9[e9.length-1]<=e21[e21.length-1]):false;
  let rsiOk=rv===null?true:(rule.dir==="buy"?rv<76:rv>24);
  let dirOk=rule.dir==="buy"?vel>0:vel<0;
  check("cDir",dirOk);check("cEma",emaOk);check("cRsi",rsiOk);check("cProx",prox);
  let score=[dirOk,prox,!rule.ema||emaOk,!rule.rsi||rsiOk].filter(Boolean).length*25;
  $("score").textContent=score+"%";
  let crossed=rule.dir==="buy"?last>=rule.target:last<=rule.target;
  if(crossed){
    $("signalTitle").textContent="Meta alcançada";
    setSignal("trigger","Preço em "+fmt(last)+". Meta "+fmt(rule.target)+" alcançada.");
    if(Date.now()-lastAlert>rule.cool*1000){
      notify(rule.dir==="buy"?"Meta de compra atingida":"Meta de venda atingida",(asset.symbol||asset.name)+": "+fmt(last)+" • meta "+fmt(rule.target));
      lastAlert=Date.now();
    }
    touched=Date.now();
    return;
  }
  if(prox&&toward&&dirOk&&(!rule.ema||emaOk)){
    $("signalTitle").textContent="Chegando na região";
    setSignal("approach","A "+pct.toFixed(3)+"% da meta, com movimento favorável"+(rv!==null?" e RSI "+rv.toFixed(1):"")+".");
    if(Date.now()-lastAlert>rule.cool*1000){
      notify("Preço se aproximando",(asset.symbol||asset.name)+" está indo para "+fmt(rule.target)+" • faltam "+pct.toFixed(3)+"%");
      lastAlert=Date.now();
    }
    return;
  }
  if($("reject").checked&&touched&&Date.now()-touched<8000&&!toward){
    setSignal("reject","O preço tocou a região e passou a se afastar: possível rejeição.");
    return;
  }
  $("signalTitle").textContent="Observando mercado";
  setSignal("",prox?"Perto da meta, mas sem confirmação suficiente.":"Fora da zona de pré-alerta.");
}
function draw(v,e9,e21){
  let c=$("chart"),r=c.getBoundingClientRect(),d=devicePixelRatio||1,w=Math.max(10,r.width),h=Math.max(10,r.height);
  if(c.width!==Math.round(w*d)||c.height!==Math.round(h*d)){c.width=Math.round(w*d);c.height=Math.round(h*d);}
  let ctx=c.getContext("2d");
  ctx.setTransform(d,0,0,d,0,0);
  ctx.clearRect(0,0,w,h);
  ctx.strokeStyle="#181e29";ctx.lineWidth=1;
  for(let i=1;i<6;i++){ctx.beginPath();ctx.moveTo(0,h*i/6);ctx.lineTo(w,h*i/6);ctx.stroke();}
  if(v.length<2)return;

  const visibleCount=clamp(Math.round(BASE_VISIBLE/zoom),24,720);
  const start=Math.max(0,v.length-visibleCount);
  const vv=v.slice(start),f9=e9.slice(start),f21=e21.slice(start);
  let mn=Math.min.apply(null,vv),mx=Math.max.apply(null,vv);
  let pad=(mx-mn||Math.abs(mx)*.0005||1)*.14;
  mn-=pad;mx+=pad;
  let yy=z=>h-(z-mn)/(mx-mn)*h,xx=i=>vv.length<=1?0:i/(vv.length-1)*w;

  function line(arr,col,lw){
    ctx.beginPath();
    arr.forEach((z,i)=>i?ctx.lineTo(xx(i),yy(z)):ctx.moveTo(xx(i),yy(z)));
    ctx.strokeStyle=col;ctx.lineWidth=lw;ctx.stroke();
  }
  line(vv,"#eef2f8",1.7);
  if(f9.length===vv.length)line(f9,"#8a5cf6",1.25);
  if(f21.length===vv.length)line(f21,"#58b9ff",1.05);
  if(rule&&rule.target>=mn&&rule.target<=mx){
    ctx.save();ctx.setLineDash([5,5]);ctx.strokeStyle=rule.dir==="buy"?"#46d6a0":"#ff6d83";
    ctx.beginPath();ctx.moveTo(0,yy(rule.target));ctx.lineTo(w,yy(rule.target));ctx.stroke();ctx.restore();
  }
}
function save(){
  let target=Number(String($("target").value).replace(",","."));
  if(!Number.isFinite(target)||target<=0){notify("Meta inválida","Informe um preço alvo válido.");return;}
  rule={dir:$("direction").value,target,margin:Number($("margin").value)||.2,cool:Number($("cooldown").value)||15,ema:$("emaFilter").checked,rsi:$("rsiFilter").checked};
  $("targetLegend").textContent="Meta "+(rule.dir==="buy"?"↑ ":"↓ ")+fmt(target);
  addEvent("regra","Regra ativada",(asset.symbol||asset.name)+" • "+rule.dir+" em "+fmt(target)+" • pré-alerta "+rule.margin+"%");
  evaluate();update();
}
function search(q){
  let s=q.trim().toLowerCase();
  let f=assets.filter(a=>!s||String(a.name).toLowerCase().includes(s)||String(a.symbol||"").toLowerCase().includes(s)||String(a.badge||"").toLowerCase().includes(s)).slice(0,12);
  $("results").innerHTML=f.map((a,i)=>'<div class="assetopt" data-index="'+i+'"><b>'+escapeHtml(a.name)+'</b><small>'+escapeHtml(a.symbol||("IQ "+a.activeId))+'</small></div>').join("");
  $("results").classList.add("open");
  document.querySelectorAll(".assetopt").forEach((el,i)=>el.onclick=()=>{let a=f[i];if(a){connect(a);$("search").value="";$("results").classList.remove("open");}});
}
function setStream(on){
  $("streamBtn").classList.toggle("active",on);
  $("streamBtn").innerHTML='<i></i> '+(on?"Enviando pra VPS":"Mandar pra VPS");
  $("streamBtn2").textContent=on?"Parar envio":"Iniciar envio";
  $("streamState").textContent=on?"Enviando":"Parado";
}
async function toggleStream(){
  if(timer){
    clearInterval(timer);timer=null;setStream(false);
    addEvent("vps","Streaming parado","Capturas encerradas.");
    return;
  }
  let cfg=await ipcRenderer.invoke("runtime-config");
  if(!cfg.vpsConfigured){notify("VPS não configurada","Credencial do Enfoque Network Agent não encontrada.");return;}
  setStream(true);
  addEvent("vps","Streaming iniciado","1 captura por segundo; buffer máximo 10.");
  async function tick(){
    if(busy)return;
    busy=true;
    try{
      let cap=await ipcRenderer.invoke("capture-primary");
      if(!cap.ok)throw new Error(cap.error||"Falha ao capturar");
      let up=await ipcRenderer.invoke("upload-shot",{imageBase64:cap.dataUrl,asset:asset.symbol||asset.name,capturedAt:new Date().toISOString()});
      if(!up.ok)throw new Error(up.error||("HTTP "+up.status));
      buffer=Number(up.count||Math.min(10,buffer+1));
      $("buffer").textContent=buffer+" / 10";
      $("last").textContent=new Date().toLocaleTimeString("pt-BR");
      $("lastDetail").textContent=up.stored||"enviado";
    }catch(e){
      $("lastDetail").textContent=String(e.message||e);
      addEvent("erro","Falha no envio",String(e.message||e));
    }finally{busy=false;}
  }
  await tick();
  timer=setInterval(tick,1000);
}
function setZoom(value){
  zoom=clamp(value,.5,7.5);
  $("zoomLevel").textContent=Math.round(zoom*100)+"%";
  update();
}
function zoomBy(mult){setZoom(zoom*mult);}

function updateIqUi(status,message){
  const connected=Boolean(status&&status.connected);
  $("iqState").textContent=message||(connected?"Conectado":"Desconectado");
  $("iqState").classList.toggle("connected",connected);
  $("iqConnect").disabled=false;
  $("iqConnect").textContent=connected?"Reconectar":"Conectar IQ Option";
  $("iqDisconnect").disabled=!connected;
  $("sourcePill").textContent=provider==="iq"?"IQ OPTION":"BINANCE";
}
async function activateIq(status){
  provider="iq";
  if(ws){try{ws.close();}catch{} ws=null;}
  assets=(status.assets||[]).filter(a=>Number.isFinite(Number(a.activeId)));
  if(!assets.length){
    updateIqUi(status,"Conectado, mas a lista de ativos veio vazia");
    return;
  }
  $("sourcePill").textContent="IQ OPTION";
  $("providerNote").textContent="Dados em tempo real via candle-generated da IQ Option.";
  updateIqUi(status,"Conectado • "+assets.length+" ativos carregados");
  addEvent("iq","IQ Option conectada",assets.length+" ativos disponíveis para pesquisa.");
  let preferred=assets.find(a=>/bitcoin|btc/i.test(a.name))||assets.find(a=>Number(a.activeId)===816)||assets.find(a=>/EUR\/USD/.test(a.name))||assets[0];
  await connect(preferred);
}
async function connectIq(){
  $("iqConnect").disabled=true;
  $("iqConnect").textContent="Conectando...";
  $("iqState").textContent="Autenticando...";
  const mode=$("iqAuthMode").value;
  const payload={remember:$("iqRemember").checked};
  if(mode==="ssid")payload.ssid=$("iqSsid").value.trim();
  else{payload.email=$("iqEmail").value.trim();payload.password=$("iqPassword").value;}
  const r=await ipcRenderer.invoke("iq-login",payload);
  if(r.ok){
    $("iqPassword").value="";
    if(mode==="ssid")$("iqSsid").value="";
    await activateIq(r);
  }else{
    provider="binance";
    updateIqUi(r,"Falha: "+(r.error||"não foi possível conectar"));
    $("providerNote").textContent="Fallback Binance continua disponível.";
    addEvent("erro","IQ Option não conectou",r.error||"Erro desconhecido");
  }
}
async function disconnectIq(){
  const r=await ipcRenderer.invoke("iq-disconnect");
  provider="binance";assets=FALLBACK.slice();
  $("sourcePill").textContent="BINANCE";
  $("providerNote").textContent="Fallback público ativo. Conecte a IQ Option para usar os candles dela.";
  updateIqUi(r,"Desconectado");
  connect(assets[0]);
}
async function tryAutoIq(){
  $("iqState").textContent="Verificando sessão salva...";
  const r=await ipcRenderer.invoke("iq-autoconnect");
  if(r.ok){
    await activateIq(r);
  }else{
    provider="binance";assets=FALLBACK.slice();
    updateIqUi(r,r.skipped?"Sem sessão salva":"Sessão salva não conectou");
    connect(assets[0]);
  }
}
function toggleAuthFields(){
  const ssid=$("iqAuthMode").value==="ssid";
  $("iqCredentialsFields").style.display=ssid?"none":"grid";
  $("iqSsidField").style.display=ssid?"grid":"none";
}

ipcRenderer.on("iq-tick",(_event,tick)=>{
  if(provider!=="iq"||!asset||Number(tick.activeId)!==Number(asset.activeId))return;
  handlePrice(Number(tick.close),(Number(tick.from)||Date.now()/1000)*1000);
});

document.querySelectorAll(".nav").forEach(b=>b.onclick=()=>{
  let p=b.dataset.page;
  document.querySelectorAll(".page").forEach(x=>x.classList.remove("active"));
  $("page-"+p).classList.add("active");
  document.querySelectorAll(".nav").forEach(x=>x.classList.toggle("active",x.dataset.page===p));
});
document.querySelectorAll(".card").forEach(c=>c.onmousemove=e=>{
  let r=c.getBoundingClientRect();
  c.style.setProperty("--mx",(e.clientX-r.left)+"px");
  c.style.setProperty("--my",(e.clientY-r.top)+"px");
});

$("search").onfocus=e=>search(e.target.value);
$("search").oninput=e=>search(e.target.value);
document.addEventListener("click",e=>{if(!e.target.closest(".search"))$("results").classList.remove("open");});
$("save").onclick=save;
$("streamBtn").onclick=toggleStream;
$("streamBtn2").onclick=toggleStream;
$("clear").onclick=()=>{events=[];renderEvents();};
$("zoomIn").onclick=()=>zoomBy(1.25);
$("zoomOut").onclick=()=>zoomBy(.8);
$("zoomLevel").onclick=()=>setZoom(1);
$("chart").addEventListener("wheel",e=>{e.preventDefault();zoomBy(e.deltaY<0?1.16:.86);},{passive:false});
$("iqAuthMode").onchange=toggleAuthFields;
$("iqConnect").onclick=connectIq;
$("iqDisconnect").onclick=disconnectIq;
$("iqForget").onclick=async()=>{
  await ipcRenderer.invoke("iq-forget-session");
  $("iqState").textContent="Sessão salva removida";
  addEvent("iq","Sessão esquecida","O SSID criptografado local foi removido.");
};

ipcRenderer.invoke("runtime-config").then(c=>$("vpsPill").textContent=c.vpsConfigured?"configurada":"não configurada");
renderEvents();
toggleAuthFields();
setZoom(1);
tryAutoIq();
window.onresize=update;
