import type { NamingController } from "./NamingScreen";
import type { PageModel, PageKey } from "./SpatialPage";
import { pageKey, listPage } from "./SpatialPage";

export function namePage(name: NamingController, symbols: boolean): PageModel {
  if (!name.inGrid()) {
    const page = listPage("name",name.spatialTitle(),name.spatialPresets(),-1);
    page.keys = page.keys.filter(k=>k.id.indexOf("row:")===0);
    page.keys.forEach(k=>k.id=k.id.replace("row:","preset:"));
    return page;
  }
  let letters = symbols ? "0123456789-?!.,/():;[]" : "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  if (name.isLowerCase()) letters = letters.toLowerCase();
  const keys: PageKey[] = letters.split("").map((label,i)=>({
    ...pageKey("char:"+label,label,3+(i%8)*20,39+Math.floor(i/8)*18,14,14),
    enabled:name.typed().length<name.spatialLimit(),
  }));
  keys.push(pageKey("case",name.isLowerCase()?"ABC":"abc",43,93,34,14));
  keys.push(pageKey("symbols",symbols?"ABC":"123",83,93,34,14));
  keys.push(pageKey("char: ","SPACE",3,112,46,14));
  keys.push(pageKey("delete","DELETE",55,112,50,14));
  keys.push(pageKey("done","DONE",111,112,46,14));
  keys.find(k=>k.id==="char: ").enabled=name.typed().length<name.spatialLimit();
  keys.find(k=>k.id==="done").enabled=name.typed().trim().length>0;
  keys.find(k=>k.id==="delete").enabled=name.typed().length>0;
  return {context:"name",title:name.spatialTitle(),text:name.typed()+"_",keys};
}
