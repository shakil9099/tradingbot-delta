import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export default function EquityChart({ points }: { points: { time: number; equity: number }[] }) {
  if (points.length < 2) return <p className="muted">The equity curve appears after two closed trades.</p>;
  const data = [{ time: points[0].time - 1, equity: 0 }, ...points].map((p) => ({ ...p, label: new Date(p.time * 1000).toISOString().slice(5, 16).replace('T', ' ') }));
  return (
    <div style={{ width: '100%', height: 220 }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} minTickGap={40} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} width={50} />
          <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--line)' }} formatter={(v: number) => [`$${v.toFixed(2)}`, 'net P&L']} />
          <Area type="linear" dataKey="equity" stroke="var(--accent)" fill="var(--accent-soft)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
