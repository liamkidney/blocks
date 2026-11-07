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
    if(iOS)return '<p>On iPhone or iPad:</p>'+
      '<ol><li>Open this page in <strong>Safari</strong>.</li>'+
      '<li>Tap <strong>Share</strong> (the square with an upward arrow).</li>'+
      '<li>Choose <strong>Add to Home Screen</strong>, keep <strong>Open as Web App</strong> enabled, then tap <strong>Add</strong>.</li>'+
      '<li>Launch <strong>Blocks</strong> from your Home Screen.</li></ol>';
    if(android)return '<p>In <strong>Chrome</strong>, open the browser menu (⋮) and choose '+
      '<strong>Install app</strong> or <strong>Add to Home screen</strong>. '+
      'Then open Blocks from its Home Screen icon.</p>';
    return '<p>Use your browser’s <strong>Install app</strong> command. '+
      'On Safari for Mac, use <strong>File → Add to Dock</strong>. '+
      'Then launch Blocks from the installed app icon.</p>';
  }
  function refresh(){
    if(!button||!instructions||!status)return;
    button.hidden=!installPrompt||installedNotice;
    instructions.hidden=!!installPrompt&&!installedNotice;
    instructions.innerHTML=installedNotice?
      '<p>Open <strong>Blocks</strong> from its app icon to play. This browser tab cannot start a game.</p>':
      manualInstructions();
    status.textContent=installedNotice?'Blocks is installed. Open the app to play.':'';
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
      '<p class="blocks-install-intro">Add Blocks to your device once, then open it like any other app.</p>'+
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
