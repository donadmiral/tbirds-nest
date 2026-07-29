/** The scalloped seal in the three metals, for the web desk. */
const GRADS: Record<string, string[]> = {
  public_figure: ['#D9FBEC', '#4ADE9C', '#059669', '#064E3B'],
  business: ['#EDEFF3', '#C3C8CF', '#6E7278', '#3F4348'],
  official: ['#FBF8F0', '#F4EFE4', '#C9BFB0', '#A2977F'],
};
const CHECKS: Record<string, string> = { public_figure: '#FFFFFF', business: '#FFFFFF', official: '#0B1E3D' };
const SEAL = 'M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34z';
const CHECK = 'M10.54 16.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z';

export default function Seal({ tier, size = 18 }: { tier: string; size?: number }) {
  const g = GRADS[tier] || GRADS.business;
  const id = 'seal-' + tier;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={g[0]} /><stop offset="35%" stopColor={g[1]} />
          <stop offset="70%" stopColor={g[2]} /><stop offset="100%" stopColor={g[3]} />
        </linearGradient>
      </defs>
      <path d={SEAL} fill={'url(#' + id + ')'} stroke="rgba(255,255,255,0.5)" strokeWidth="0.4" />
      <path d={CHECK} fill={CHECKS[tier] || '#FFFFFF'} />
    </svg>
  );
}