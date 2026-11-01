import type {MemoryCoverStroke} from '../../../shared/memoryBookCreative';
import {memoryCoverStrokePath} from '../../../shared/memoryCoverPersonalization';

/** Normalized drawing geometry is shared with the native cover renderer. */
export function MemoryCoverInk({strokes, width, height}: {strokes: readonly MemoryCoverStroke[]; width: number; height: number}) {
  return <svg aria-hidden="true" width={width} height={height} viewBox={`0 0 200 ${height / width * 200}`} style={{position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden'}}>
    {strokes.map((stroke, index) => {
      const h = height / width * 200, path = memoryCoverStrokePath(stroke.points, 200, h), last = stroke.points.at(-1);
      if (!last) return null;
      if (stroke.points.length === 1 || stroke.tool === 'dot') return <circle key={index} cx={last.x * 200} cy={last.y * h} r={Math.max(2, stroke.width * .9)} fill={stroke.color} opacity={stroke.tool === 'highlight' ? .4 : 1}/>;
      const line = {d: path, fill: 'none', stroke: stroke.color, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const};
      if (stroke.tool === 'neon') return <g key={index}><path {...line} strokeWidth={stroke.width * 2.6} opacity={.35}/><path {...line} strokeWidth={stroke.width * 1.5} opacity={.55}/><path {...line} stroke="#FFFFFF" strokeWidth={Math.max(1.5, stroke.width * .6)}/></g>;
      if (stroke.tool === 'arrow') {
        const previous = stroke.points[Math.max(0, stroke.points.length - 4)], angle = Math.atan2((last.y - previous.y) * h, (last.x - previous.x) * 200), length = Math.max(10, stroke.width * 3.2), x = last.x * 200, y = last.y * h;
        return <g key={index}><path {...line} strokeWidth={stroke.width}/><path d={`M ${x - length * Math.cos(angle - Math.PI / 7)} ${y - length * Math.sin(angle - Math.PI / 7)} L ${x} ${y} L ${x - length * Math.cos(angle + Math.PI / 7)} ${y - length * Math.sin(angle + Math.PI / 7)}`} stroke={stroke.color} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" fill="none"/></g>;
      }
      return <path key={index} {...line} strokeWidth={stroke.width * (stroke.tool === 'marker' ? 1.6 : stroke.tool === 'highlight' ? 2.2 : 1)} strokeLinecap={stroke.tool === 'highlight' ? 'butt' : 'round'} opacity={stroke.tool === 'highlight' ? .4 : stroke.tool === 'marker' ? .75 : 1}/>;
    })}
  </svg>;
}
