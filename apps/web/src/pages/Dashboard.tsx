import { useQuery } from '@tanstack/react-query';
import styled from 'styled-components';
import { BookOpen, CheckCircle, Clock, Target, Flame, AlertCircle, RefreshCw } from 'lucide-react';
import { StatsCard } from '../components/StatsCard';
import { CourseCard } from '../components/CourseCard';
import { ActivityChart } from '../components/ActivityChart';
import { DashboardSkeleton } from '../components/DashboardSkeleton';
import { api } from '../services/api';

interface DashboardProps {
  studentId: string;
}

export function Dashboard({ studentId }: DashboardProps) {
  const { data: dashboard, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['dashboard', studentId],
    queryFn: () => api.getDashboard(studentId),
  });

  const { data: courses } = useQuery({
    queryKey: ['courses', studentId],
    queryFn: () => api.getCourses(studentId),
  });

  // Las estadísticas alimentan la racha y el gráfico; si fallan, el resto del
  // dashboard se sigue mostrando.
  const { data: stats } = useQuery({
    queryKey: ['stats', studentId],
    queryFn: () => api.getStats(studentId),
  });

  if (isLoading) {
    return (
      <>
        <VisuallyHidden role="status">Cargando dashboard...</VisuallyHidden>
        <DashboardSkeleton />
      </>
    );
  }

  if (error) {
    return (
      <ErrorState role="alert">
        <AlertCircle size={40} />
        <ErrorTitle>Error al cargar el dashboard</ErrorTitle>
        <ErrorDetail>{(error as Error).message}</ErrorDetail>
        <RetryButton onClick={() => refetch()} disabled={isRefetching}>
          <RefreshCw size={16} className={isRefetching ? 'spinning' : undefined} />
          {isRefetching ? 'Reintentando...' : 'Reintentar'}
        </RetryButton>
      </ErrorState>
    );
  }

  if (!dashboard) {
    return <ErrorState role="alert">No se encontraron datos</ErrorState>;
  }

  return (
    <Container>
      <Header>
        <Greeting>
          <h1>¡Hola, {dashboard.student.name}!</h1>
          <Subtitle>Aquí está tu progreso de hoy</Subtitle>
        </Greeting>
      </Header>

      {/* Sección de estadísticas */}
      <StatsGrid>
        <StatsCard
          title="Cursos Activos"
          value={dashboard.stats.inProgressCourses}
          icon={<BookOpen size={24} />}
          color="var(--color-primary)"
        />
        <StatsCard
          title="Cursos Completados"
          value={dashboard.stats.completedCourses}
          icon={<CheckCircle size={24} />}
          color="var(--color-success)"
        />
        <StatsCard
          title="Tiempo de Estudio"
          value={dashboard.stats.totalTimeSpentFormatted}
          icon={<Clock size={24} />}
          color="var(--color-secondary)"
          subtitle="Total acumulado"
        />
        {stats ? (
          <StatsCard
            title="Racha de estudio"
            value={`${stats.streak.currentStreakDays} ${stats.streak.currentStreakDays === 1 ? 'día' : 'días'}`}
            icon={<Flame size={24} />}
            color="var(--color-warning)"
            subtitle={stats.streak.studiedToday ? '¡Hoy ya has estudiado!' : 'Estudia hoy para mantenerla'}
          />
        ) : (
          <StatsCard
            title="Total Cursos"
            value={dashboard.stats.totalCourses}
            icon={<Target size={24} />}
            color="var(--color-primary)"
          />
        )}
      </StatsGrid>

      {/* Actividad de los últimos 7 días, con datos reales de /stats */}
      <Section>
        <SectionTitle>Actividad Semanal</SectionTitle>
        {stats ? (
          <ActivityChart data={stats.activityByDay} />
        ) : (
          <ChartLoading aria-busy="true">Cargando actividad...</ChartLoading>
        )}
      </Section>

      {/* Sección de cursos recientes */}
      <Section>
        <SectionHeader>
          <SectionTitle>Continúa donde lo dejaste</SectionTitle>
          <ViewAllLink href="/courses">Ver todos →</ViewAllLink>
        </SectionHeader>

        <CoursesGrid>
          {courses?.slice(0, 4).map((course: any) => (
            <CourseCard
              key={course._id}
              title={course.title}
              description={course.description}
              thumbnail={course.thumbnail}
              progress={course.progress?.progressPercentage || 0}
              category={course.category}
              totalLessons={course.totalLessons}
              completedLessons={course.progress?.completedLessons || 0}
            />
          ))}
        </CoursesGrid>

        {courses?.length === 0 && (
          <EmptyState>
            No tienes cursos todavía. ¡Explora el catálogo!
          </EmptyState>
        )}
      </Section>
    </Container>
  );
}

const Container = styled.div`
  max-width: 1200px;
  margin: 0 auto;
`;

const Header = styled.header`
  margin-bottom: var(--spacing-xl);
`;

const Greeting = styled.div`
  h1 {
    font-size: 28px;
    font-weight: 700;
    margin-bottom: var(--spacing-xs);
  }
`;

const Subtitle = styled.p`
  color: var(--color-text-secondary);
  font-size: 16px;
`;

const StatsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-xl);
`;

const Section = styled.section`
  margin-bottom: var(--spacing-xl);
`;

const SectionHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-md);
`;

const SectionTitle = styled.h2`
  font-size: 18px;
  font-weight: 600;
  margin-bottom: var(--spacing-md);
`;

const ViewAllLink = styled.a`
  color: var(--color-primary);
  font-size: 14px;
  font-weight: 500;
`;

const ChartLoading = styled.div`
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
`;

const CoursesGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--spacing-md);
`;

/** Visible para lectores de pantalla, oculto visualmente */
const VisuallyHidden = styled.span`
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
`;

const ErrorState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm);
  height: 400px;
  color: var(--color-error);
  text-align: center;
`;

const ErrorTitle = styled.h2`
  font-size: 18px;
  font-weight: 600;
`;

const ErrorDetail = styled.p`
  font-size: 14px;
  color: var(--color-text-secondary);
`;

const RetryButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
  margin-top: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-lg);
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: var(--radius-md);
  font-size: 14px;
  font-weight: 500;

  &:hover:not(:disabled) {
    background: var(--color-primary-dark);
  }

  &:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .spinning {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
`;

const EmptyState = styled.div`
  text-align: center;
  padding: var(--spacing-xl);
  color: var(--color-text-secondary);
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  border: 1px dashed var(--color-border);
`;
