// Coordinates independent game engines; no DOM or input assumptions.
class GameSession {
  constructor({playerCount=1,config={},snapshots=[]}={}){
    if(![1,2].includes(playerCount))throw new Error("Unsupported player count");
    this.config=config;
    this.games=[];
    this.events=[];
    for(let i=0;i<playerCount;i++)this.replaceGame(i,snapshots[i]||null);
  }
  replaceGame(player,snapshot=null){
    if(!Number.isInteger(player)||player<0||player>this.games.length||player>1)
      throw new Error("Invalid player");
    const config={...this.config,onEvent:event=>{
      this.events.push({player:player+1,...event});
    }};
    const game=snapshot?Game.fromSnapshot(snapshot,config):new Game(config);
    this.games[player]=game;
    return game;
  }
  update(dt){
    for(const game of this.games)game.update(dt);
  }
  drainEvents(){
    return this.events.splice(0);
  }
}
