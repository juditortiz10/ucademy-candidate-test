import { useState } from 'react';
import styled, { keyframes, css } from 'styled-components';
import ReactMarkdown from 'react-markdown';
import { User, Bot, Copy, Check } from 'lucide-react';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: Date;
  isLoading?: boolean;
}

/** Los mensajes más largos que esto se colapsan con un botón "Ver más" */
const COLLAPSE_THRESHOLD = 900;

export function ChatMessage({ role, content, timestamp, isLoading }: ChatMessageProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const isLong = content.length > COLLAPSE_THRESHOLD;
  const collapsed = isLong && !expanded;

  const handleCopy = async () => {
    await navigator.clipboard?.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Container $role={role} role="listitem">
      <Avatar $role={role} aria-hidden="true">
        {role === 'user' ? <User size={18} /> : <Bot size={18} />}
      </Avatar>

      <MessageContent $role={role}>
        {isLoading ? (
          <LoadingIndicator aria-label="El asistente está escribiendo">
            <Dot $delay={0} />
            <Dot $delay={0.15} />
            <Dot $delay={0.3} />
          </LoadingIndicator>
        ) : (
          <>
            <MessageText $collapsed={collapsed}>
              {/* El asistente responde en markdown; el usuario escribe texto plano */}
              {role === 'assistant' ? <ReactMarkdown>{content}</ReactMarkdown> : content}
            </MessageText>

            {isLong && (
              <ToggleButton onClick={() => setExpanded((value) => !value)}>
                {expanded ? 'Ver menos' : 'Ver más'}
              </ToggleButton>
            )}

            <Footer>
              {timestamp && <Timestamp>{formatTime(timestamp)}</Timestamp>}
              {role === 'assistant' && content && (
                <CopyButton onClick={handleCopy} aria-label="Copiar respuesta">
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                </CopyButton>
              )}
            </Footer>
          </>
        )}
      </MessageContent>
    </Container>
  );
}

/** Hoy muestra solo la hora; otro día antepone la fecha */
function formatTime(date: Date): string {
  const isToday = new Date().toDateString() === date.toDateString();
  const time = date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

  if (isToday) return time;

  return `${date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })} · ${time}`;
}

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const bounce = keyframes`
  0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
  40%           { transform: translateY(-5px); opacity: 1; }
`;

const Container = styled.div<{ $role: string }>`
  display: flex;
  gap: var(--spacing-sm);
  flex-direction: ${(props) => (props.$role === 'user' ? 'row-reverse' : 'row')};
  align-items: flex-start;
  margin-bottom: var(--spacing-md);
  animation: ${fadeIn} 0.25s ease;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const Avatar = styled.div<{ $role: string }>`
  width: 36px;
  height: 36px;
  border-radius: var(--radius-full);
  background: ${(props) => (props.$role === 'user' ? 'var(--color-primary)' : 'var(--color-background)')};
  color: ${(props) => (props.$role === 'user' ? 'white' : 'var(--color-text-secondary)')};
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: ${(props) => (props.$role === 'assistant' ? '1px solid var(--color-border)' : 'none')};
`;

const MessageContent = styled.div<{ $role: string }>`
  max-width: 70%;
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-lg);
  background: ${(props) => (props.$role === 'user' ? 'var(--color-primary)' : 'var(--color-surface)')};
  color: ${(props) => (props.$role === 'user' ? 'white' : 'var(--color-text-primary)')};
  border: ${(props) => (props.$role === 'assistant' ? '1px solid var(--color-border)' : 'none')};
  min-width: 0;
`;

const MessageText = styled.div<{ $collapsed: boolean }>`
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;

  ${(props) =>
    props.$collapsed &&
    css`
      max-height: 260px;
      overflow: hidden;
      mask-image: linear-gradient(to bottom, black 70%, transparent 100%);
    `}

  /* Estilos del markdown renderizado */
  p, ul, ol, blockquote {
    white-space: normal;
    margin-bottom: var(--spacing-sm);
  }

  > :last-child {
    margin-bottom: 0;
  }

  ul, ol {
    padding-left: var(--spacing-lg);
  }

  code {
    background: rgba(100, 116, 139, 0.15);
    padding: 1px 5px;
    border-radius: var(--radius-sm);
    font-size: 0.9em;
    font-family: 'SFMono-Regular', Consolas, monospace;
  }

  pre {
    background: #1e293b;
    color: #e2e8f0;
    padding: var(--spacing-sm) var(--spacing-md);
    border-radius: var(--radius-md);
    overflow-x: auto;
    margin-bottom: var(--spacing-sm);
    /* Los saltos de línea del código son significativos: no se colapsan. */
    white-space: pre;

    code {
      background: none;
      padding: 0;
      color: inherit;
      white-space: pre;
      word-break: normal;
    }
  }

  h1, h2, h3 {
    font-size: 1em;
    font-weight: 600;
    margin-bottom: var(--spacing-xs);
  }

  blockquote {
    border-left: 3px solid var(--color-border);
    padding-left: var(--spacing-sm);
    color: var(--color-text-secondary);
  }

  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.9em;
  }

  th, td {
    border: 1px solid var(--color-border);
    padding: 4px 8px;
    text-align: left;
  }
`;

const ToggleButton = styled.button`
  background: none;
  border: none;
  padding: 0;
  margin-top: var(--spacing-xs);
  font-size: 12px;
  font-weight: 600;
  color: inherit;
  opacity: 0.8;
  text-decoration: underline;

  &:hover {
    opacity: 1;
  }
`;

const Footer = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--spacing-xs);
  margin-top: var(--spacing-xs);
`;

const Timestamp = styled.span`
  font-size: 11px;
  opacity: 0.7;
`;

const CopyButton = styled.button`
  background: none;
  border: none;
  padding: 2px;
  display: flex;
  align-items: center;
  color: var(--color-text-secondary);
  opacity: 0.6;
  transition: opacity 0.2s ease;

  &:hover {
    opacity: 1;
  }
`;

const LoadingIndicator = styled.div`
  display: flex;
  gap: 4px;
  padding: var(--spacing-xs);
`;

const Dot = styled.div<{ $delay: number }>`
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--color-text-secondary);
  animation: ${bounce} 1.2s infinite ease-in-out;
  animation-delay: ${(props) => props.$delay}s;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;
