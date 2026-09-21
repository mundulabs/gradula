export const WORKSPACE_VIEWS = ['board','overview','knowledge','pulse'] as const;
export type WorkspaceView = typeof WORKSPACE_VIEWS[number];
/** Missing/unknown URLs open tickets; retired Map links open the summary. */
export function workspaceView(value:string|null):WorkspaceView {
  if(value==='map')return 'overview';
  return WORKSPACE_VIEWS.includes(value as WorkspaceView)?value as WorkspaceView:'board';
}
