/** Foundry v13 canvases can dispatch pointer events from nested board elements. */
export function isCanvasEventTarget(target, view, board) {
  if(!target)return false;
  const inside=(parent,child)=>!!parent&&(parent===child||typeof parent.contains==='function'&&parent.contains(child));
  if(inside(view,target)||inside(board,target))return true;
  const match=typeof target.closest==='function'?target.closest('#board'):null;
  return !!match&&(match===board||match===view||!!board&&inside(board,match));
}
