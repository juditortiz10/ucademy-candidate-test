import styled from 'styled-components';
import { BookOpen } from 'lucide-react';

interface CourseCardProps {
  title: string;
  description: string;
  thumbnail?: string;
  progress?: number;
  category: string;
  totalLessons: number;
  completedLessons?: number;
}

/**
 * 📝 TODO: El candidato debe completar este componente
 *
 * Funcionalidades a implementar:
 * 1. Mostrar barra de progreso visual
 * 2. Mostrar estado del curso (no iniciado, en progreso, completado)
 * 3. Añadir animación hover
 * 4. Manejar click para navegar al curso
 * 5. Mostrar tiempo estimado restante
 *
 * Bonus:
 * - Añadir skeleton loading state
 * - Implementar lazy loading para la imagen
 */
export function CourseCard({
  title,
  description,
  thumbnail,
  progress = 0,
  category,
  totalLessons,
  completedLessons = 0,
}: CourseCardProps) {
  // TODO: Implementar lógica de estado del curso
  const status = progress === 100 ? 'completed' : progress > 0 ? 'in-progress' : 'not-started';

  return (
    <Card>
      <Thumbnail $url={thumbnail}>
        {!thumbnail && <ThumbnailPlaceholder><BookOpen size={48} /></ThumbnailPlaceholder>}
        <CategoryBadge>{category}</CategoryBadge>
      </Thumbnail>

      <Content>
        <Title>{title}</Title>
        <Description>{description}</Description>

        {/* TODO: Implementar barra de progreso */}
        <ProgressSection>
          <ProgressBar>
            <ProgressFill style={{ width: `${progress}%` }} />
          </ProgressBar>
          <ProgressText>
            {completedLessons}/{totalLessons} lecciones • {progress}%
          </ProgressText>
        </ProgressSection>

        {/* TODO: Implementar botón de acción según estado */}
        <ActionButton $status={status}>
          {status === 'completed' && 'Repasar'}
          {status === 'in-progress' && 'Continuar'}
          {status === 'not-started' && 'Comenzar'}
        </ActionButton>
      </Content>
    </Card>
  );
}

const Thumbnail = styled.div<{ $url?: string }>`
  height: 140px;
  background: ${(props) => (props.$url ? `url(${props.$url})` : 'var(--color-background)')};
  background-size: cover;
  background-position: center;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.3s ease;
`;

const Card = styled.div`
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  overflow: hidden;
  border: 1px solid var(--color-border);
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
  cursor: pointer;

  &:hover {
    transform: translateY(-4px);
    box-shadow: var(--shadow-lg);
    border-color: var(--color-primary);
  }

  /* La miniatura hace un zoom sutil al pasar por encima */
  &:hover ${Thumbnail} {
    transform: scale(1.05);
  }

  &:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;

    &:hover {
      transform: none;
    }
  }
`;

const ThumbnailPlaceholder = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
  opacity: 0.5;
`;

const CategoryBadge = styled.span`
  position: absolute;
  top: var(--spacing-sm);
  right: var(--spacing-sm);
  background: rgba(0, 0, 0, 0.6);
  color: white;
  padding: var(--spacing-xs) var(--spacing-sm);
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-weight: 500;
`;

const Content = styled.div`
  padding: var(--spacing-md);
`;

const Title = styled.h3`
  font-size: 16px;
  font-weight: 600;
  margin-bottom: var(--spacing-xs);
  color: var(--color-text-primary);
`;

const Description = styled.p`
  font-size: 13px;
  color: var(--color-text-secondary);
  margin-bottom: var(--spacing-md);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
`;

const ProgressSection = styled.div`
  margin-bottom: var(--spacing-md);
`;

const ProgressBar = styled.div`
  height: 6px;
  background: var(--color-background);
  border-radius: var(--radius-full);
  overflow: hidden;
  margin-bottom: var(--spacing-xs);
`;

const ProgressFill = styled.div`
  height: 100%;
  background: var(--color-primary);
  border-radius: var(--radius-full);
  transition: width 0.3s ease;
`;

const ProgressText = styled.div`
  font-size: 12px;
  color: var(--color-text-secondary);
`;

const ActionButton = styled.button<{ $status: string }>`
  width: 100%;
  padding: var(--spacing-sm) var(--spacing-md);
  border: none;
  border-radius: var(--radius-md);
  font-weight: 500;
  font-size: 14px;
  background: ${(props) =>
    props.$status === 'completed'
      ? 'var(--color-success)'
      : props.$status === 'in-progress'
        ? 'var(--color-primary)'
        : 'var(--color-background)'};
  color: ${(props) => (props.$status === 'not-started' ? 'var(--color-text-primary)' : 'white')};
  transition: all 0.2s ease;

  &:hover {
    opacity: 0.9;
  }
`;
