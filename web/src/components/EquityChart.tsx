import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export default function EquityChart({ points }: { points: { time: number; equity: number }[] }) {
  if (points.length < 2) return <div className="empty small">The equity curve appears after two closed trades.</div>;
  const data = [{ time: points[0].time - 1, equity: 0 }, ...points].map((p) => ({ ...p, label: new Date(p.time * 1000).toISOString().slice(5, 16).replace('T', ' ') }));
  const up = data[data.length - 1].equity >= 0;
  const color = up ? 'var(--pos)' : 'var(--neg)';
  return (
    <div style={{ width: '100%', height: 240 }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--faint)' }} minTickGap={48} tickLine={false} axisLine={{ stroke: 'var(--line)' }} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--faint)' }} width={52} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(2)}`} />
          <Tooltip
            contentStyle={{ background: 'var(--card-2)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--text)' }}
            labelStyle={{ color: 'var(--muted)' }}
            formatter={(v: number) => [`${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(2)}`, 'net P&L']}
          />
          <Area type="monotone" dataKey="equity" stroke={color} fill="url(#eqFill)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
