// Coordinates independent game engines; no DOM or input assumptions.
class GameSession {
  constructor({playerCount=1,config={},snapshots=[]}={}){
    if(![1,2].includes(playerCount))throw new Error("Unsupported player count");
    this.config=config;
    this.games=[];
    this.events=[];
    this.attackProgress=[0,0];
    for(let i=0;i<playerCount;i++)this.replaceGame(i,snapshots[i]||null);
  }
  replaceGame(player,snapshot=null){
    if(!Number.isInteger(player)||player<0||player>this.games.length||player>1)
      throw new Error("Invalid player");
    const config={...this.config,onEvent:event=>this.handleEvent(player,event)};
    const game=snapshot?Game.fromSnapshot(snapshot,config):new Game(config);
    this.games[player]=game;
    this.attackProgress[player]=0;
    return game;
  }
  handleEvent(player,event){
    this.events.push({player:player+1,...event});
    if(this.games.length!==2||event.type!=="lines_cleared")return;
    this.attackProgress[player]+=event.count;
    const rows=Math.floor(this.attackProgress[player]/2);
    this.attackProgress[player]%=2;
    if(rows>0)this.games[1-player].addGarbage(rows);
  }
  update(dt){
    for(const game of this.games)game.update(dt);
  }
  drainEvents(){
    return this.events.splice(0);
  }
}
