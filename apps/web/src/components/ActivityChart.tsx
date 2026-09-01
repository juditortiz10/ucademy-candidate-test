import styled from 'styled-components';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

export interface ActivityDay {
  date: string;
  label: string;
  minutes: number;
  hours: number;
}

interface ActivityChartProps {
  data: ActivityDay[];
}

/** Convierte minutos a un texto legible: 95 -> "1h 35m" */
function formatMinutes(minutes: number): string {
  if (minutes === 0) return 'Sin actividad';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours === 0 ? `${mins}m` : `${hours}h ${mins}m`;
}

interface ActivityTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: ActivityDay }>;
}

function ActivityTooltip({ active, payload }: ActivityTooltipProps) {
  if (!active || !payload?.length) return null;

  const day = payload[0].payload;
  const formatted = new Date(`${day.date}T00:00:00`).toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <TooltipBox>
      <TooltipDate>{formatted}</TooltipDate>
      <TooltipValue>{formatMinutes(day.minutes)}</TooltipValue>
    </TooltipBox>
  );
}

export function ActivityChart({ data }: ActivityChartProps) {
  const totalMinutes = data.reduce((acc, day) => acc + day.minutes, 0);

  if (totalMinutes === 0) {
    return <EmptyChart>Todavía no hay actividad registrada esta semana</EmptyChart>;
  }

  return (
    <ChartWrapper
      role="img"
      aria-label={`Actividad de los últimos ${data.length} días: ${formatMinutes(totalMinutes)} en total`}
    >
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: 'var(--color-text-secondary)' }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: 'var(--color-text-secondary)' }}
            tickFormatter={(value: number) => `${value}h`}
            width={44}
          />
          <Tooltip content={<ActivityTooltip />} cursor={{ fill: 'rgba(99, 102, 241, 0.08)' }} />
          <Bar dataKey="hours" fill="var(--color-primary)" radius={[4, 4, 0, 0]} maxBarSize={48} />
        </BarChart>
      </ResponsiveContainer>
    </ChartWrapper>
  );
}

const ChartWrapper = styled.div`
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--spacing-md);
`;

const EmptyChart = styled.div`
  background: var(--color-surface);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-lg);
  height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
  font-size: 14px;
`;

const TooltipBox = styled.div`
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  padding: var(--spacing-sm) var(--spacing-md);
`;

const TooltipDate = styled.div`
  font-size: 12px;
  color: var(--color-text-secondary);
  text-transform: capitalize;
`;

const TooltipValue = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
`;
