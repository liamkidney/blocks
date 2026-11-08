// Single source of truth for control order, persistence and placement.
// All modes use the same four-button component and saved preference.
(()=>{
  "use strict";
  const COMMANDS=Object.freeze(["left","right","down","rotate_cw"]);
  const DIAMOND_SLOTS=Object.freeze([
    Object.freeze({column:"1",row:"2"}),
    Object.freeze({column:"2",row:"2"}),
    Object.freeze({column:"1 / 3",row:"3"}),
    Object.freeze({column:"1 / 3",row:"1"})
  ]);
  // Preserve existing player preferences across the refactor.
  const storageKey="blocks:control-order:v1:"+
    location.pathname.replace(/index[.]html$/,"");
  function valid(order){
    return Array.isArray(order)&&order.length===COMMANDS.length&&
      new Set(order).size===COMMANDS.length&&
      COMMANDS.every(command=>order.includes(command));
  }
  function load(){
    try{
      const value=JSON.parse(localStorage.getItem(storageKey)||"null");
      if(valid(value))return value.slice();
    }catch(_){}
    return COMMANDS.slice();
  }
  let savedOrder=load();
  function getOrder(){return savedOrder.slice()}
  function defaultOrder(){return COMMANDS.slice()}

  // CSS decides the geometry; every mode receives one logical slot number.
  function apply(order=savedOrder,root=document){
    if(!valid(order))return false;
    for(const button of root.querySelectorAll(".control")){
      const index=order.indexOf(button.dataset.command);
      if(index<0)continue;
      const slot=DIAMOND_SLOTS[index];
      button.style.setProperty("--portrait-control-order",index);
      button.style.setProperty("--diamond-control-column",slot.column);
      button.style.setProperty("--diamond-control-row",slot.row);
    }
    return true;
  }
  function save(order){
    if(!valid(order))return false;
    savedOrder=order.slice();
    try{localStorage.setItem(storageKey,JSON.stringify(savedOrder))}
    catch(_){}
    apply();
    return true;
  }
  function reset(){return save(COMMANDS)}
  function createPad(template,playerIndex){
    const originals=Array.from(template.querySelectorAll("button.control"));
    if(originals.length!==COMMANDS.length||
       !valid(originals.map(button=>button.dataset.command)))
      throw new Error("Expected four unique Blocks controls");
    const pad=document.createElement("div");
    for(const original of originals){
      const button=original.cloneNode(true);
      button.dataset.player=String(playerIndex);
      const label=original.getAttribute("aria-label")||
        original.dataset.command.replaceAll("_"," ");
      button.setAttribute("aria-label","Player "+(playerIndex+1)+" "+label);
      pad.appendChild(button);
    }
    apply(savedOrder,pad);
    return pad;
  }
  function prepareDiamondPad(pad){
    // Normalise HTML wrappers to four direct grid children, for both stations.
    for(const button of Array.from(pad.querySelectorAll("button.control")))
      pad.appendChild(button);
    pad.classList.add("diamond-pad");
    apply(savedOrder,pad);
  }
  window.BLOCKS_CONTROL_LAYOUT=Object.freeze({
    getOrder,defaultOrder,valid,apply,save,reset,createPad,prepareDiamondPad
  });
})();
