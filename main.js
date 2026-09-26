const {app,BrowserWindow,desktopCapturer,ipcMain,Notification,screen,safeStorage}=require("electron");
const fs=require("fs");
const path=require("path");
const Broker=require("iqoption");

const VPS_ENDPOINT="https://mcp.enfoquepapelaria.com.br/iq-assistant/upload";
const AGENT_CREDENTIALS="C:\\ProgramData\\Enfoque\\NetworkAgent\\credentials.json";

let mainWindow=null;
let iqBroker=null;
let iqConnected=false;
let iqSubscription=null;
let iqCandleHandler=null;

function agentCredentials(){
  try{
    const c=JSON.parse(fs.readFileSync(AGENT_CREDENTIALS,"utf8"));
    if(c&&c.agentToken&&c.deviceId)return c;
  }catch{}
  return null;
}

function iqSessionPath(){
  return path.join(app.getPath("userData"),"iq-session.json");
}

function saveIqSession(ssid){
  if(!ssid||!safeStorage.isEncryptionAvailable())return false;
  const encrypted=safeStorage.encryptString(String(ssid)).toString("base64");
  fs.writeFileSync(iqSessionPath(),JSON.stringify({encryptedSsid:encrypted,updatedAt:new Date().toISOString()},null,2),"utf8");
  return true;
}

function loadIqSession(){
  try{
    if(!safeStorage.isEncryptionAvailable())return null;
    const data=JSON.parse(fs.readFileSync(iqSessionPath(),"utf8"));
    if(!data.encryptedSsid)return null;
    return safeStorage.decryptString(Buffer.from(data.encryptedSsid,"base64"));
  }catch{
    return null;
  }
}

function forgetIqSession(){
  try{fs.unlinkSync(iqSessionPath());}catch{}
}

function normalizeIqAssets(){
  try{
    return Broker.assets()
      .filter(a=>a&&Number.isFinite(Number(a.active_id))&&a.name)
      .map(a=>{
        const name=String(a.name);
        const compact=name.replace(/[^A-Za-z0-9]/g,"").toUpperCase();
        const ticker=String(a.ticker||"").trim().toUpperCase();
        const symbol=ticker||compact||("IQ"+a.active_id);
        const badge=(ticker||((name.match(/[A-Za-z0-9]+/)||["IQ"])[0])).slice(0,5).toUpperCase();
        const precision=/BTC|BITCOIN|ETH|CRYPTO/i.test(name+" "+ticker)?2:5;
        return {name, symbol, badge, activeId:Number(a.active_id), p:precision};
      });
  }catch{
    return [];
  }
}

function iqStatus(){
  return {
    connected:iqConnected,
    hasSavedSession:Boolean(loadIqSession()),
    subscription:iqSubscription,
    assets:normalizeIqAssets()
  };
}

async function cleanupIqBroker(){
  if(iqBroker){
    try{
      if(iqSubscription)await iqBroker.unsubscribe("candle-generated",{active_id:iqSubscription.activeId,size:iqSubscription.size});
    }catch{}
    try{
      if(iqCandleHandler)iqBroker.removeListener("candle-generated",iqCandleHandler);
    }catch{}
    try{await iqBroker.disconnect();}catch{}
  }
  iqBroker=null;
  iqConnected=false;
  iqSubscription=null;
  iqCandleHandler=null;
}

async function connectIq({email,password,ssid,remember}={}){
  await cleanupIqBroker();
  const useSsid=String(ssid||"").trim();
  if(!useSsid&&!String(email||"").trim())throw new Error("Informe e-mail/senha ou um SSID.");
  iqBroker=useSsid
    ? new Broker({ssid:useSsid,bigInt:"string"})
    : new Broker({email:String(email||"").trim(),password:String(password||""),bigInt:"string"});

  if(!useSsid){
    await iqBroker.login();
  }
  await iqBroker.connect();
  iqConnected=true;

  iqCandleHandler=(tick)=>{
    try{
      if(!iqSubscription||!tick)return;
      if(Number(tick.active_id)!==Number(iqSubscription.activeId))return;
      const close=Number(tick.close);
      if(!Number.isFinite(close))return;
      if(mainWindow&&!mainWindow.isDestroyed()){
        mainWindow.webContents.send("iq-tick",{
          activeId:Number(tick.active_id),
          close,
          open:Number(tick.open),
          min:Number(tick.min),
          max:Number(tick.max),
          ask:Number(tick.ask),
          bid:Number(tick.bid),
          from:Number(tick.from)||Math.floor(Date.now()/1000),
          to:Number(tick.to)||Math.floor(Date.now()/1000),
          size:Number(tick.size)||1
        });
      }
    }catch{}
  };
  iqBroker.on("candle-generated",iqCandleHandler);

  if(remember&&iqBroker.ssid){
    saveIqSession(iqBroker.ssid);
  }
  return iqStatus();
}

function createWindow(){
  mainWindow=new BrowserWindow({
    width:1480,height:920,minWidth:1100,minHeight:700,backgroundColor:"#080a0f",autoHideMenuBar:true,
    webPreferences:{nodeIntegration:true,contextIsolation:false}
  });
  mainWindow.loadFile("index.html");
}

ipcMain.handle("notify",async(_e,p)=>{
  if(Notification.isSupported())new Notification({title:p.title||"IQ Assistant",body:p.body||""}).show();
  return {ok:true};
});

ipcMain.handle("runtime-config",async()=>{
  const c=agentCredentials();
  return {vpsConfigured:Boolean(c&&c.agentToken),deviceId:c&&c.deviceId||null,platform:process.platform};
});

ipcMain.handle("iq-status",async()=>iqStatus());

ipcMain.handle("iq-login",async(_e,p)=>{
  try{
    const status=await connectIq(p||{});
    return {ok:true,...status};
  }catch(err){
    await cleanupIqBroker();
    return {ok:false,error:String(err&&err.message||err),...iqStatus()};
  }
});

ipcMain.handle("iq-autoconnect",async()=>{
  const ssid=loadIqSession();
  if(!ssid)return {ok:false,skipped:true,error:"Nenhuma sessão salva.",...iqStatus()};
  try{
    const status=await connectIq({ssid,remember:true});
    return {ok:true,...status};
  }catch(err){
    await cleanupIqBroker();
    return {ok:false,error:String(err&&err.message||err),...iqStatus()};
  }
});

ipcMain.handle("iq-disconnect",async()=>{
  await cleanupIqBroker();
  return {ok:true,...iqStatus()};
});

ipcMain.handle("iq-forget-session",async()=>{
  forgetIqSession();
  return {ok:true,...iqStatus()};
});

ipcMain.handle("iq-subscribe",async(_e,p)=>{
  if(!iqBroker||!iqConnected)return {ok:false,error:"IQ Option não conectada."};
  const activeId=Number(p&&p.activeId);
  const size=Math.max(1,Number(p&&p.size)||1);
  if(!Number.isFinite(activeId))return {ok:false,error:"Ativo inválido."};
  try{
    if(iqSubscription){
      try{await iqBroker.unsubscribe("candle-generated",{active_id:iqSubscription.activeId,size:iqSubscription.size});}catch{}
    }
    await iqBroker.subscribe("candle-generated",{active_id:activeId,size});
    iqSubscription={activeId,size};
    return {ok:true,subscription:iqSubscription};
  }catch(err){
    return {ok:false,error:String(err&&err.message||err)};
  }
});

ipcMain.handle("capture-primary",async()=>{
  const display=screen.getPrimaryDisplay();
  const scale=display.scaleFactor||1;
  const sources=await desktopCapturer.getSources({types:["screen"],thumbnailSize:{width:Math.round(display.size.width*scale),height:Math.round(display.size.height*scale)}});
  const source=sources.find(s=>s.display_id===String(display.id))||sources[0];
  if(!source)return {ok:false,error:"Nenhuma tela encontrada"};
  return {ok:true,dataUrl:source.thumbnail.toDataURL()};
});

ipcMain.handle("upload-shot",async(_e,p)=>{
  const c=agentCredentials();
  if(!c||!c.agentToken)return {ok:false,error:"Credencial do Enfoque Network Agent não encontrada"};
  try{
    const r=await fetch(VPS_ENDPOINT,{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+c.agentToken},body:JSON.stringify({imageBase64:p.imageBase64,asset:p.asset,capturedAt:p.capturedAt,source:"primary-screen",deviceId:c.deviceId})});
    const b=await r.json().catch(()=>({}));
    return Object.assign({ok:r.ok,status:r.status},b);
  }catch(err){return {ok:false,error:String(err&&err.message||err)};}
});

app.whenReady().then(createWindow);
app.on("window-all-closed",async()=>{
  await cleanupIqBroker();
  if(process.platform!=="darwin")app.quit();
});
