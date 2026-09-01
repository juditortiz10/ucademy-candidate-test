import { render, screen } from '@testing-library/react';
import { BookOpen, Clock } from 'lucide-react';
import { StatsCard } from './StatsCard';

describe('StatsCard', () => {
  /**
   * TEST QUE PASA - Verifica renderizado basico
   */
  it('should render title and value', () => {
    render(
      <StatsCard title="Total Cursos" value={5} icon={<BookOpen data-testid="icon" />} />
    );

    expect(screen.getByText('Total Cursos')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  /**
   * TEST QUE PASA - Verifica renderizado con string value
   */
  it('should render string value correctly', () => {
    render(
      <StatsCard title="Tiempo" value="9h 25m" icon={<Clock />} />
    );

    expect(screen.getByText('9h 25m')).toBeInTheDocument();
  });

  /**
   * TEST QUE PASA - Verifica renderizado de subtitle
   */
  it('should render subtitle when provided', () => {
    render(
      <StatsCard
        title="Tiempo"
        value="9h 25m"
        icon={<Clock />}
        subtitle="Total acumulado"
      />
    );

    expect(screen.getByText('Total acumulado')).toBeInTheDocument();
  });

  it('should not render a subtitle when it is not provided', () => {
    render(<StatsCard title="Tiempo" value="9h 25m" icon={<Clock />} />);

    expect(screen.queryByText('Total acumulado')).not.toBeInTheDocument();
  });

  it('should apply custom color to icon wrapper', () => {
    render(
      <StatsCard
        title="Completados"
        value={3}
        icon={<BookOpen data-testid="icon" />}
        color="rgb(16, 185, 129)"
      />
    );

    // El icono se envuelve en un contenedor que aplica el color recibido.
    const wrapper = screen.getByTestId('icon').parentElement as HTMLElement;
    expect(getComputedStyle(wrapper).color).toBe('rgb(16, 185, 129)');
  });

  it('should handle zero value', () => {
    render(<StatsCard title="Cursos Activos" value={0} icon={<BookOpen />} />);

    // 0 es falsy: debe renderizarse igualmente, no desaparecer.
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('should be accessible', () => {
    const { container } = render(
      <StatsCard title="Cursos Activos" value={4} icon={<BookOpen />} subtitle="Este mes" />
    );

    // Todo el contenido informativo debe ser texto legible por lectores de
    // pantalla, no imágenes ni pseudo-elementos.
    expect(container.textContent).toContain('Cursos Activos');
    expect(container.textContent).toContain('4');
    expect(container.textContent).toContain('Este mes');

    // El icono es decorativo: no debe aportar texto alternativo duplicado.
    const svg = container.querySelector('svg');
    expect(svg).not.toHaveAttribute('alt');
  });
});
