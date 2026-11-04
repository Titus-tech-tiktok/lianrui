export function modelAssetSlot(sourceRole, selectedSlot = 'top') {
  if (sourceRole === 'master') return ['top', 'bottom', 'master'].includes(selectedSlot) ? selectedSlot : 'top';
  if (sourceRole === 'reference') return selectedSlot === 'pose' ? 'pose' : 'reference';
  return sourceRole;
}

export function selectModelAssetDraft(drafts, activeId, allowCompleted = false) {
  const active = drafts.find(item => item.id === activeId);
  if (!active || active.operationType === 'scene_only') return null;
  if (active.status === '生成中' || active.poseAnalyzing || active.activeOperation) return null;
  return allowCompleted || !active.result?.path ? active : null;
}

export function assignModelAsset(draft, slot, source) {
  const changed = draft[slot]?.path !== source.path;
  draft.operationType = 'dress';
  draft[slot] = source;
  if (changed && ['top', 'bottom'].includes(slot)) draft.materialSelections = (draft.materialSelections || []).filter(item => item.slot !== slot);
  if (slot === 'pose' && changed) { draft.poseAnalysis = null; draft.poseAnalysisError = ''; }
  if (!draft.title) draft.title = source.taskName || source.name || '模特图任务';
  draft.selected = true;
  return draft;
}

export function nextModelAssetSlot(slot) {
  return ({ top: 'bottom', bottom: 'reference', reference: 'pose' })[slot] || slot;
}
