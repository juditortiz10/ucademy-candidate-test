import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { Dashboard } from './Dashboard';
import { api } from '../services/api';

// Mock del servicio API
// El runner de este proyecto es vitest (apps/web/project.json -> @nx/vite:test),
// por eso se usa `vi` en lugar de `jest`.
vi.mock('../services/api', () => ({
  api: {
    getDashboard: vi.fn(),
    getCourses: vi.fn(),
    getStats: vi.fn(),
  },
}));

const mockDashboard = {
  student: {
    id: '507f1f77bcf86cd799439011',
    name: 'María García',
    email: 'maria@test.com',
  },
  stats: {
    totalCourses: 5,
    completedCourses: 1,
    inProgressCourses: 2,
    totalTimeSpentMinutes: 565,
    totalTimeSpentFormatted: '9h 25m',
  },
  recentCourses: [],
};

const mockCourses = [
  {
    _id: '1',
    title: 'React desde Cero',
    description: 'Aprende React',
    category: 'Frontend',
    totalLessons: 20,
    progress: { progressPercentage: 70, completedLessons: 14 },
  },
];

const mockStats = {
  totals: { totalCourses: 5 },
  streak: { currentStreakDays: 2, longestStreakDays: 2, studiedToday: true },
  activityByDay: [
    { date: '2026-08-26', label: 'mié', minutes: 60, hours: 1 },
    { date: '2026-08-27', label: 'jue', minutes: 0, hours: 0 },
  ],
};

const renderWithProviders = (component: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>{component}</BrowserRouter>
    </QueryClientProvider>
  );
};

describe('Dashboard', () => {
  beforeEach(() => {
    (api.getDashboard as ReturnType<typeof vi.fn>).mockResolvedValue(mockDashboard);
    (api.getCourses as ReturnType<typeof vi.fn>).mockResolvedValue(mockCourses);
    (api.getStats as ReturnType<typeof vi.fn>).mockResolvedValue(mockStats);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * ✅ TEST QUE PASA - Verifica que el dashboard renderiza el greeting
   */
  it('should render student greeting', async () => {
    renderWithProviders(<Dashboard studentId="507f1f77bcf86cd799439011" />);

    await waitFor(() => {
      expect(screen.getByText(/¡Hola, María García!/)).toBeInTheDocument();
    });
  });

  /**
   * ✅ TEST QUE PASA - Verifica que se muestran las stats cards
   */
  it('should render stats cards', async () => {
    renderWithProviders(<Dashboard studentId="507f1f77bcf86cd799439011" />);

    await waitFor(() => {
      expect(screen.getByText('Cursos Activos')).toBeInTheDocument();
      expect(screen.getByText('Cursos Completados')).toBeInTheDocument();
      expect(screen.getByText('Tiempo de Estudio')).toBeInTheDocument();
    });
  });

  /**
   * ✅ TEST QUE PASA - Verifica estado de loading
   */
  it('should show loading state initially', () => {
    (api.getDashboard as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => undefined) // Never resolves
    );

    renderWithProviders(<Dashboard studentId="test" />);

    expect(screen.getByText('Cargando dashboard...')).toBeInTheDocument();
  });

  it('should render a skeleton while loading', () => {
    (api.getDashboard as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => undefined));

    renderWithProviders(<Dashboard studentId="test" />);

    // El esqueleto se anuncia como ocupado a los lectores de pantalla.
    expect(screen.getByLabelText('Cargando dashboard...')).toHaveAttribute('aria-busy', 'true');
  });

  it('should show error state when API fails', async () => {
    (api.getDashboard as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Error de conexión')
    );

    renderWithProviders(<Dashboard studentId="test" />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText('Error al cargar el dashboard')).toBeInTheDocument();
    expect(screen.getByText('Error de conexión')).toBeInTheDocument();
  });

  it('should refetch when clicking retry after an error', async () => {
    const user = userEvent.setup();
    const getDashboard = api.getDashboard as ReturnType<typeof vi.fn>;
    getDashboard.mockRejectedValueOnce(new Error('Error de conexión'));

    renderWithProviders(<Dashboard studentId="507f1f77bcf86cd799439011" />);

    const retry = await screen.findByRole('button', { name: /reintentar/i });

    getDashboard.mockResolvedValue(mockDashboard);
    await user.click(retry);

    await waitFor(() => {
      expect(screen.getByText(/¡Hola, María García!/)).toBeInTheDocument();
    });
  });

  it('should render course cards', async () => {
    renderWithProviders(<Dashboard studentId="507f1f77bcf86cd799439011" />);

    await waitFor(() => {
      expect(screen.getByText('React desde Cero')).toBeInTheDocument();
    });
    expect(screen.getByText('Frontend')).toBeInTheDocument();
    expect(screen.getByText(/14\/20 lecciones/)).toBeInTheDocument();
    // Curso a medias -> el botón invita a continuar
    expect(screen.getByText('Continuar')).toBeInTheDocument();
  });

  it('should show empty state when no courses', async () => {
    (api.getCourses as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    renderWithProviders(<Dashboard studentId="507f1f77bcf86cd799439011" />);

    await waitFor(() => {
      expect(screen.getByText(/No tienes cursos todavía/)).toBeInTheDocument();
    });
  });

  it('should render the activity chart section', async () => {
    renderWithProviders(<Dashboard studentId="507f1f77bcf86cd799439011" />);

    await waitFor(() => {
      expect(screen.getByText('Actividad Semanal')).toBeInTheDocument();
    });
    // Con datos reales el gráfico se describe para lectores de pantalla.
    await waitFor(() => {
      expect(screen.getByRole('img', { name: /actividad de los últimos/i })).toBeInTheDocument();
    });
  });

  it('should show the study streak from the stats endpoint', async () => {
    renderWithProviders(<Dashboard studentId="507f1f77bcf86cd799439011" />);

    await waitFor(() => {
      expect(screen.getByText('Racha de estudio')).toBeInTheDocument();
    });
    expect(screen.getByText('2 días')).toBeInTheDocument();
    expect(screen.getByText('¡Hoy ya has estudiado!')).toBeInTheDocument();
  });

  it('should still render when the stats endpoint fails', async () => {
    (api.getStats as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('stats caído'));

    renderWithProviders(<Dashboard studentId="507f1f77bcf86cd799439011" />);

    // El dashboard no depende de /stats para pintarse.
    await waitFor(() => {
      expect(screen.getByText(/¡Hola, María García!/)).toBeInTheDocument();
    });
    expect(screen.getByText('Total Cursos')).toBeInTheDocument();
  });

  it('should be accessible (a11y)', async () => {
    renderWithProviders(<Dashboard studentId="507f1f77bcf86cd799439011" />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('¡Hola, María García!');
    });

    // Jerarquía de encabezados: un h1 y los h2 de cada sección.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(0);
  });
});
