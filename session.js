// Coordinates independent game engines; no DOM or input assumptions.
class GameSession {
  constructor({playerCount=1,config={},snapshots=[]}={}){
    if(![1,2].includes(playerCount))throw new Error("Unsupported player count");
    this.config=config;
    this.games=[];
    this.events=[];
    this.attackProgress=[0,0];
    this.outcome=null;
    for(let i=0;i<playerCount;i++)this.replaceGame(i,snapshots[i]||null);
  }
  replaceGame(player,snapshot=null){
    if(!Number.isInteger(player)||player<0||player>this.games.length||player>1)
      throw new Error("Invalid player");
    const config={...this.config,onEvent:event=>this.handleEvent(player,event)};
    const game=snapshot?Game.fromSnapshot(snapshot,config):new Game(config);
    this.games[player]=game;
    this.attackProgress[player]=0;
    this.outcome=null;
    return game;
  }
  handleEvent(player,event){
    this.events.push({player:player+1,...event});
    if(this.games.length!==2||this.outcome||event.type!=="lines_cleared")return;
    this.attackProgress[player]+=event.count;
    const rows=Math.floor(this.attackProgress[player]/2);
    this.attackProgress[player]%=2;
    if(rows>0)this.games[1-player].addGarbage(rows);
    this.resolveOutcome();
  }
  resolveOutcome(){
    if(this.games.length!==2||this.outcome)return this.outcome;
    const lost=this.games.map(game=>game.phase==="game_over");
    if(!lost.some(Boolean))return null;
    this.outcome=lost.every(Boolean)?"draw":lost[0]?"player2":"player1";
    return this.outcome;
  }
  pause(){
    if(this.outcome)return;
    for(const game of this.games)game.pause();
  }
  resume(){
    if(this.outcome)return;
    for(const game of this.games)game.resume();
  }
  update(dt){
    if(this.outcome)return;
    for(const game of this.games){
      if(this.outcome)break;
      game.update(dt);
    }
    this.resolveOutcome();
  }
  drainEvents(){
    return this.events.splice(0);
  }
}
