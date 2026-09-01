import styled, { keyframes } from 'styled-components';

/**
 * Esqueleto del dashboard: reproduce la retícula real para que no haya
 * salto de layout cuando llegan los datos.
 */
export function DashboardSkeleton() {
  return (
    <Container aria-busy="true" aria-label="Cargando dashboard...">
      <Block $width="280px" $height="34px" />
      <Block $width="200px" $height="18px" style={{ marginBottom: 'var(--spacing-xl)' }} />

      <Grid>
        {Array.from({ length: 4 }).map((_, index) => (
          <Block key={index} $height="88px" />
        ))}
      </Grid>

      <Block $height="24px" $width="160px" />
      <Block $height="200px" style={{ marginBottom: 'var(--spacing-xl)' }} />

      <Block $height="24px" $width="220px" />
      <CoursesGrid>
        {Array.from({ length: 4 }).map((_, index) => (
          <Block key={index} $height="300px" />
        ))}
      </CoursesGrid>
    </Container>
  );
}

const shimmer = keyframes`
  0%   { background-position: -400px 0; }
  100% { background-position: 400px 0; }
`;

const Container = styled.div`
  max-width: 1200px;
  margin: 0 auto;
`;

const Block = styled.div<{ $width?: string; $height?: string }>`
  width: ${(props) => props.$width ?? '100%'};
  height: ${(props) => props.$height ?? '20px'};
  border-radius: var(--radius-md);
  margin-bottom: var(--spacing-md);
  background: linear-gradient(
    90deg,
    var(--color-border) 25%,
    var(--color-surface) 50%,
    var(--color-border) 75%
  );
  background-size: 800px 100%;
  animation: ${shimmer} 1.4s infinite linear;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-xl);
`;

const CoursesGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--spacing-md);
`;
