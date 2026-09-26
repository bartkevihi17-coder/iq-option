const {app,BrowserWindow,desktopCapturer,ipcMain,Notification,screen}=require("electron");
const fs=require("fs");
const path=require("path");
const VPS_ENDPOINT="https://mcp.enfoquepapelaria.com.br/iq-assistant/upload";
const AGENT_CREDENTIALS="C:\\ProgramData\\Enfoque\\NetworkAgent\\credentials.json";

function agentCredentials(){
  try{
    const c=JSON.parse(fs.readFileSync(AGENT_CREDENTIALS,"utf8"));
    if(c&&c.agentToken&&c.deviceId)return c;
  }catch{}
  return null;
}
function createWindow(){
  const win=new BrowserWindow({
    width:1480,height:920,minWidth:1100,minHeight:700,backgroundColor:"#080a0f",autoHideMenuBar:true,
    webPreferences:{nodeIntegration:true,contextIsolation:false}
  });
  win.loadFile("index.html");
}
ipcMain.handle("notify",async(_e,p)=>{
  if(Notification.isSupported())new Notification({title:p.title||"IQ Assistant",body:p.body||""}).show();
  return {ok:true};
});
ipcMain.handle("runtime-config",async()=>{
  const c=agentCredentials();
  return {vpsConfigured:Boolean(c&&c.agentToken),deviceId:c&&c.deviceId||null,platform:process.platform};
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
app.on("window-all-closed",()=>{if(process.platform!=="darwin")app.quit();});
