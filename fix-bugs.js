const fs = require('fs');
const path = require('path');

// Fix 1: pushHistory crash - make it safe
const ctrlPath = path.join(process.cwd(), 'src/controllers/stories/useEnhancementController.ts');
let ctrl = fs.readFileSync(ctrlPath, 'utf8');
if (ctrl.includes('pushHistory();') && !ctrl.includes('typeof pushHistory')) {
  ctrl = ctrl.replace('pushHistory();', 'if (typeof pushHistory === "function") pushHistory();');
  fs.writeFileSync(ctrlPath, ctrl, 'utf8');
  console.log('Fix 1: pushHistory safe guard added');
}

// Fix 2: Single result (remove fake variations)
const reconPath = path.join(process.cwd(), 'src/services/ai/identityReconstructionService.ts');
let recon = fs.readFileSync(reconPath, 'utf8');
const oldVars = "const VARIATIONS = [\n  { id: 'crisp',    label: 'Crisp',    fidelity: 0.25 },\n  { id: 'balanced', label: 'Balanced', fidelity: 0.35 },\n  { id: 'natural',  label: 'Natural',  fidelity: 0.5 },\n  { id: 'subtle',   label: 'Subtle',   fidelity: 0.7 },\n];";
if (recon.includes(oldVars)) {
  recon = recon.replace(oldVars, "const VARIATIONS = [\n  { id: 'enhanced', label: 'Enhanced', fidelity: 0.35 },\n];");
  console.log('Fix 2: single variation at 0.35');
} else {
  console.log('Fix 2: pattern not found, checking current state...');
}
fs.writeFileSync(reconPath, recon, 'utf8');

// Fix 3: Compare slider fixed height
const modalPath = path.join(process.cwd(), 'src/components/stories/EnhancerModal.tsx');
let modal = fs.readFileSync(modalPath, 'utf8');
if (modal.includes('height={SCREEN_H * 0.55}')) {
  modal = modal.replace('height={SCREEN_H * 0.55}', 'height={450}');
  console.log('Fix 3: compare slider height fixed to 450');
}
if (modal.includes('enhancedUri={previewUri}')) {
  modal = modal.replace('enhancedUri={previewUri}', 'enhancedUri={previewUri || ""}');
  console.log('Fix 4: enhancedUri fallback added');
}
fs.writeFileSync(modalPath, modal, 'utf8');
console.log('All fixes applied');
