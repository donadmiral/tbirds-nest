/** Shared page-turn rules. Media mounting belongs to the single active page. */
export type MemoryTurnDirection = 1 | -1;
export type MemoryTurn = {
  token: number;
  from: number;
  to: number;
  direction: MemoryTurnDirection;
  progress: number;
  phase: 'dragging' | 'settling' | 'committed';
};
export const MEMORY_TURN_MS = 560;
export const clampTurnProgress = (value:number) => Math.max(0,Math.min(1,Number.isFinite(value)?value:0));
export function memoryTurnProgress(dx:number,width:number,direction:MemoryTurnDirection) {
  return clampTurnProgress((-direction*dx)/Math.max(1,width*.82));
}
export function memoryTurnShouldCommit(progress:number,velocityX:number,direction:MemoryTurnDirection) {
  return progress>=.34 || (progress>=.035 && -direction*velocityX>.5);
}
export function memoryTurnDuration(progress:number,commit:boolean,reducedMotion:boolean) {
  return reducedMotion?0:Math.max(120,Math.round(MEMORY_TURN_MS*(commit?1-progress:progress)));
}
export function memoryTurnAngle(progress:number,direction:MemoryTurnDirection) {
  return -180*(direction===1?clampTurnProgress(progress):1-clampTurnProgress(progress));
}

/** A turn owns a generation until its committed index is acknowledged by React. */
export class MemoryBookTurnMachine {
  private ids:readonly string[];
  private generation=0;
  index:number;
  turn:MemoryTurn|null=null;
  constructor(ids:readonly string[],index=0){this.ids=[...ids];this.index=this.clamp(index);}
  private clamp(index:number){return Math.max(0,Math.min(index,Math.max(0,this.ids.length-1)));}
  sync(ids:readonly string[],index:number){
    const changed=ids.length!==this.ids.length||ids.some((id,i)=>id!==this.ids[i]);
    this.ids=[...ids];const next=this.clamp(index);
    if(changed||next!==this.index||this.turn?.phase==='committed')this.cancel();
    this.index=next;
  }
  begin(direction:MemoryTurnDirection,dragging=false){
    const to=this.index+direction;
    if(this.turn||to<0||to>=this.ids.length)return null;
    this.turn={token:++this.generation,from:this.index,to,direction,progress:0,phase:dragging?'dragging':'settling'};
    return this.turn;
  }
  move(token:number,progress:number){
    if(this.turn?.token!==token||this.turn.phase!=='dragging')return false;
    this.turn.progress=clampTurnProgress(progress);return true;
  }
  settle(token:number){if(this.turn?.token!==token||this.turn.phase==='committed')return false;this.turn.phase='settling';return true;}
  finish(token:number,commit:boolean){
    if(this.turn?.token!==token||this.turn.phase==='committed')return null;
    if(!commit){this.cancel();return null;}
    this.index=this.turn.to;this.turn.progress=1;this.turn.phase='committed';
    return this.index;
  }
  cancel(){this.generation++;this.turn=null;}
}
