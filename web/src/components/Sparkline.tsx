import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";

export function Sparkline({ data, className }: { data: number[]; className?: string }) {
  if (!data || data.length < 2) {
    return <div className={className ?? "h-8 w-24"} />;
  }

  const points = data.map((close, i) => ({ i, close }));
  const isUp = data[data.length - 1] >= data[0];
  const color = isUp ? "var(--color-up)" : "var(--color-down)";

  return (
    <div className={className ?? "h-8 w-24"}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <YAxis domain={["dataMin", "dataMax"]} hide />
          <Line type="monotone" dataKey="close" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
