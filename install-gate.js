// Blocks is playable only when launched as an installed web app.
// Browsers cannot be forced to install a PWA: this gate provides the platform's
// installation path, then keeps browser tabs locked until app-mode launch.
(function(){
  "use strict";
  const modes=["standalone","window-controls-overlay","fullscreen"];
  function isAppMode(){
    return navigator.standalone===true||modes.some(mode=>
      window.matchMedia?.("(display-mode: "+mode+")")?.matches===true);
  }
  if(isAppMode())return;

  document.documentElement.classList.add("blocks-install-required");
  const ua=navigator.userAgent||"";
  const iOS=/iPad|iPhone|iPod/.test(ua)||
    (navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
  const android=/Android/i.test(ua);
  let installPrompt=null,installedNotice=false;
  let button=null,instructions=null,status=null;

  function manualInstructions(){
    // The Share sheet already belongs to the browser the player is using.
    // No browser-switch step or device heading is needed on iPhone/iPad.
    if(iOS)return '<ol>'+
      '<li>Tap <svg class="blocks-share-icon" viewBox="0 0 24 24" aria-label="Share" role="img">'+
      '<path d="M12 16V3m0 0L8 7m4-4 4 4M5 11H4v9h16v-9h-1" '+
      'fill="none" stroke="currentColor" stroke-width="1.7" '+
      'stroke-linecap="round" stroke-linejoin="round"/></svg> <strong>Share</strong>.</li>'+
      '<li>Select <strong>Add to Home Screen</strong>.</li>'+
      '</ol>';
    if(android)return '<ol>'+
      '<li>Open the browser menu <strong>(⋮)</strong>.</li>'+
      '<li>Select <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>'+
      '</ol>';
    return '<p>Choose <strong>Install app</strong> from your browser menu. '+
      'On Safari for Mac, choose <strong>File → Add to Dock</strong>.</p>';
  }
  function refresh(){
    if(!button||!instructions||!status)return;
    button.hidden=!installPrompt||installedNotice;
    instructions.hidden=!!installPrompt&&!installedNotice;
    instructions.innerHTML=installedNotice?
      '<p>Open <strong>Blocks</strong> from its app icon to play.</p>':
      manualInstructions();
    status.textContent=installedNotice?'Blocks installed.':'';
  }
  function unlockIfInstalled(){
    if(!isAppMode())return;
    document.documentElement.classList.remove("blocks-install-required");
    document.getElementById("blocks-install-gate")?.remove();
  }
  function mount(){
    if(isAppMode()){unlockIfInstalled();return;}
    if(document.getElementById("blocks-install-gate"))return;
    const gate=document.createElement("main");
    gate.id="blocks-install-gate";
    gate.innerHTML=
      '<div class="blocks-install-card">'+
      '<img class="blocks-install-icon" src="icon-192.png" alt="" width="80" height="80">'+
      '<h1>Install Blocks to play</h1>'+

      '<button id="blocks-install-button" type="button" hidden>Install Blocks</button>'+
      '<div id="blocks-install-instructions" class="blocks-install-instructions"></div>'+
      '<p id="blocks-install-status" class="blocks-install-status" role="status" aria-live="polite"></p>'+
      '</div>';
    document.body.appendChild(gate);
    button=gate.querySelector("#blocks-install-button");
    instructions=gate.querySelector("#blocks-install-instructions");
    status=gate.querySelector("#blocks-install-status");
    button.addEventListener("click",async()=>{
      if(!installPrompt)return;
      const prompt=installPrompt;
      installPrompt=null; // A browser prompt can only be used once.
      button.hidden=true;
      try{
        const result=await prompt.prompt();
        if(result?.outcome==="accepted")installedNotice=true;
      }catch(error){
        console.warn("Blocks installation prompt failed:",error);
      }
      refresh();
    });
    refresh();
  }

  window.addEventListener("beforeinstallprompt",event=>{
    if(isAppMode())return;
    event.preventDefault();
    installPrompt=event;
    refresh();
  });
  window.addEventListener("appinstalled",()=>{
    installPrompt=null;
    installedNotice=true;
    refresh();
  });
  for(const mode of modes){
    window.matchMedia?.("(display-mode: "+mode+")")?.addEventListener?.(
      "change",unlockIfInstalled);
  }
  if(document.readyState==="loading")
    document.addEventListener("DOMContentLoaded",mount,{once:true});
  else mount();
})();
