const {app,BrowserWindow,desktopCapturer,ipcMain,Notification,screen}=require("electron");
const fs=require("fs");
const path=require("path");

function localConfig(){
  const files=[path.join(process.cwd(),"settings.local.json"),path.join(app.getPath("userData"),"settings.local.json")];
  for(const file of files){try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch{}}
  return {};
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
  const c=localConfig();return {vpsConfigured:Boolean(c.vpsEndpoint&&c.vpsToken),platform:process.platform};
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
  const c=localConfig();
  if(!c.vpsEndpoint||!c.vpsToken)return {ok:false,error:"VPS não configurada"};
  try{
    const r=await fetch(c.vpsEndpoint,{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+c.vpsToken},body:JSON.stringify({imageBase64:p.imageBase64,asset:p.asset,capturedAt:p.capturedAt,source:"primary-screen"})});
    const b=await r.json().catch(()=>({}));
    return Object.assign({ok:r.ok,status:r.status},b);
  }catch(err){return {ok:false,error:String(err&&err.message||err)};}
});
app.whenReady().then(createWindow);
app.on("window-all-closed",()=>{if(process.platform!=="darwin")app.quit();});
