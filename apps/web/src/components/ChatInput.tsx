import { useState, useRef, useEffect, useCallback, KeyboardEvent } from 'react';
import styled from 'styled-components';
import { Send, Loader2 } from 'lucide-react';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
  maxLength?: number;
}

const MAX_LENGTH = 2000;
/** A partir de este % de uso se avisa al usuario de que se acerca al límite */
const WARN_THRESHOLD = 0.9;

export function ChatInput({
  onSend,
  disabled = false,
  placeholder = 'Escribe tu mensaje...',
  maxLength = MAX_LENGTH,
}: ChatInputProps) {
  const [message, setMessage] = useState('');
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  // Historial local para recuperar mensajes con las flechas arriba/abajo
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);

  /**
   * Auto-resize: el textarea crece con el contenido hasta el máximo del CSS,
   * momento en el que aparece el scroll interno.
   */
  const resize = useCallback(() => {
    const element = textAreaRef.current;
    if (!element) return;

    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, []);

  useEffect(resize, [message, resize]);

  const handleSend = () => {
    const trimmed = message.trim();
    if (!trimmed || disabled) return;

    onSend(trimmed);
    historyRef.current = [trimmed, ...historyRef.current].slice(0, 50);
    historyIndexRef.current = -1;
    setMessage('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter envía; Shift+Enter inserta un salto de línea.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }

    // Flechas arriba/abajo recuperan mensajes anteriores, solo con el input
    // vacío o mientras se está navegando el historial.
    const navigating = historyIndexRef.current >= 0;

    if (e.key === 'ArrowUp' && (navigating || message === '')) {
      const next = Math.min(historyIndexRef.current + 1, historyRef.current.length - 1);
      if (next < 0) return;
      e.preventDefault();
      historyIndexRef.current = next;
      setMessage(historyRef.current[next]);
    }

    if (e.key === 'ArrowDown' && navigating) {
      e.preventDefault();
      const next = historyIndexRef.current - 1;
      historyIndexRef.current = next;
      setMessage(next >= 0 ? historyRef.current[next] : '');
    }
  };

  const remaining = maxLength - message.length;
  const isNearLimit = message.length >= maxLength * WARN_THRESHOLD;

  return (
    <Container>
      <InputWrapper>
        <TextArea
          ref={textAreaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, maxLength))}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          maxLength={maxLength}
          rows={1}
          aria-label="Mensaje para el asistente"
          aria-describedby="chat-input-counter"
        />
        <Counter id="chat-input-counter" $warn={isNearLimit} aria-live="polite">
          {isNearLimit ? `${remaining} caracteres restantes` : `${message.length}/${maxLength}`}
        </Counter>
      </InputWrapper>

      <SendButton
        onClick={handleSend}
        disabled={disabled || !message.trim()}
        aria-label={disabled ? 'Enviando mensaje' : 'Enviar mensaje'}
      >
        {disabled ? <SpinningLoader size={18} /> : <Send size={18} />}
      </SendButton>
    </Container>
  );
}

const Container = styled.div`
  display: flex;
  gap: var(--spacing-sm);
  padding: var(--spacing-md);
  background: var(--color-surface);
  border-top: 1px solid var(--color-border);
  align-items: flex-end;
`;

const InputWrapper = styled.div`
  flex: 1;
  position: relative;
`;

const TextArea = styled.textarea`
  width: 100%;
  padding: var(--spacing-sm) var(--spacing-md);
  padding-bottom: 22px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  font-size: 14px;
  font-family: inherit;
  resize: none;
  outline: none;
  transition: border-color 0.2s ease;
  min-height: 44px;
  max-height: 120px;
  overflow-y: auto;
  display: block;

  &:focus {
    border-color: var(--color-primary);
  }

  &:disabled {
    background: var(--color-background);
    cursor: not-allowed;
  }
`;

const Counter = styled.span<{ $warn: boolean }>`
  position: absolute;
  right: var(--spacing-md);
  bottom: 6px;
  font-size: 11px;
  pointer-events: none;
  color: ${(props) => (props.$warn ? 'var(--color-error)' : 'var(--color-text-secondary)')};
`;

const SendButton = styled.button`
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background: var(--color-primary);
  color: white;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;

  &:hover:not(:disabled) {
    background: var(--color-primary-dark);
  }

  &:disabled {
    background: var(--color-border);
    cursor: not-allowed;
  }
`;

const SpinningLoader = styled(Loader2)`
  animation: spin 1s linear infinite;

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
`;
