import { render, screen } from '@testing-library/react';
import { ChatMessage } from './ChatMessage';

describe('ChatMessage', () => {
  it('should render plain text for user messages', () => {
    render(<ChatMessage role="user" content="¿Qué es un closure?" />);

    expect(screen.getByText('¿Qué es un closure?')).toBeInTheDocument();
  });

  it('should render markdown formatting in assistant messages', () => {
    const { container } = render(
      <ChatMessage role="assistant" content={'**useState** es ideal para:\n\n- Estado simple\n- Componentes pequeños'} />
    );

    // La negrita se renderiza como <strong>, no como asteriscos literales
    expect(container.querySelector('strong')).toHaveTextContent('useState');
    expect(container.textContent).not.toContain('**');

    // La lista se renderiza como <ul>/<li>
    expect(container.querySelectorAll('li')).toHaveLength(2);
  });

  it('should preserve line breaks inside code blocks', () => {
    const code = ['```js', 'const a = 1;', 'const b = 2;', '```'].join('\n');
    const { container } = render(<ChatMessage role="assistant" content={code} />);

    const pre = container.querySelector('pre');
    expect(pre).toBeInTheDocument();

    // Regresión: `white-space: normal` sobre <pre> colapsaba los saltos y el
    // código aparecía todo en una línea.
    expect(pre?.textContent).toContain('const a = 1;\nconst b = 2;');
    expect(getComputedStyle(pre as Element).whiteSpace).toBe('pre');
  });

  it('should show a typing indicator while loading', () => {
    render(<ChatMessage role="assistant" content="" isLoading />);

    expect(screen.getByLabelText('El asistente está escribiendo')).toBeInTheDocument();
  });

  it('should collapse very long messages behind a toggle', () => {
    render(<ChatMessage role="assistant" content={'palabra '.repeat(200)} />);

    expect(screen.getByRole('button', { name: 'Ver más' })).toBeInTheDocument();
  });

  it('should not offer the toggle for short messages', () => {
    render(<ChatMessage role="assistant" content="Respuesta corta." />);

    expect(screen.queryByRole('button', { name: /ver más/i })).not.toBeInTheDocument();
  });

  it('should render the timestamp', () => {
    render(
      <ChatMessage role="assistant" content="Hola" timestamp={new Date('2026-09-02T10:30:00')} />
    );

    expect(screen.getByText(/10:30/)).toBeInTheDocument();
  });
});
