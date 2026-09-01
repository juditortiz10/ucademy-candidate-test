import { useRef, useEffect, useState } from 'react';
import styled from 'styled-components';
import { Bot, Hand, Lightbulb, BookOpen, AlertCircle, Trash2, Zap } from 'lucide-react';
import { ChatMessage } from '../components/ChatMessage';
import { ChatInput } from '../components/ChatInput';
import { useChat } from '../hooks/useChat';

interface ChatProps {
  studentId: string;
}

export function Chat({ studentId }: ChatProps) {
  // El streaming es opcional para poder comparar ambos modos en la demo.
  const [useStreaming, setUseStreaming] = useState(true);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    messages,
    isLoading,
    isStreaming,
    isLoadingHistory,
    error,
    conversationId,
    sendMessage,
    sendWithStreaming,
    startNewConversation,
    deleteConversation,
    clearError,
  } = useChat({ studentId });

  const isBusy = isLoading || isStreaming;

  const handleSend = (message: string) => {
    setLastMessage(message);
    if (useStreaming) {
      sendWithStreaming(message);
    } else {
      sendMessage(message);
    }
  };

  const handleRetry = () => {
    clearError();
    if (lastMessage) handleSend(lastMessage);
  };

  const handleNewConversation = async () => {
    clearError();
    await startNewConversation();
  };

  // Auto-scroll cuando hay nuevos mensajes o llegan tokens del stream
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // El indicador de "escribiendo" solo aplica al modo sin streaming: con
  // streaming la propia burbuja se va rellenando.
  const showTypingIndicator = isLoading && !isStreaming;

  return (
    <Container>
      <ChatHeader>
        <HeaderTitle>
          <HeaderIcon><Bot size={32} /></HeaderIcon>
          <div>
            <h2>Asistente de Estudios</h2>
            <HeaderSubtitle>Pregúntame sobre tus cursos</HeaderSubtitle>
          </div>
        </HeaderTitle>

        <HeaderActions>
          <StreamingToggle
            $active={useStreaming}
            onClick={() => setUseStreaming((value) => !value)}
            aria-pressed={useStreaming}
            title="Alterna entre respuesta completa y streaming token a token"
          >
            <Zap size={14} /> Streaming {useStreaming ? 'ON' : 'OFF'}
          </StreamingToggle>

          {conversationId && messages.length > 0 && (
            <IconButton onClick={deleteConversation} aria-label="Eliminar esta conversación">
              <Trash2 size={16} />
            </IconButton>
          )}

          <NewChatButton onClick={handleNewConversation}>
            + Nueva conversación
          </NewChatButton>
        </HeaderActions>
      </ChatHeader>

      <MessagesContainer role="log" aria-live="polite" aria-label="Historial de la conversación">
        {isLoadingHistory && <HistoryNotice aria-busy="true">Cargando conversación...</HistoryNotice>}

        {!isLoadingHistory && messages.length === 0 && (
          <WelcomeMessage>
            <WelcomeIcon><Hand size={48} /></WelcomeIcon>
            <WelcomeTitle>¡Hola! Soy tu asistente de estudios</WelcomeTitle>
            <WelcomeText>
              Puedo ayudarte con:
              <ul>
                <li>Dudas sobre el contenido de tus cursos</li>
                <li>Técnicas de estudio y organización</li>
                <li>Motivación y consejos</li>
              </ul>
            </WelcomeText>
            <SuggestionButtons>
              <SuggestionButton onClick={() => handleSend('¿Cómo puedo mejorar mi técnica de estudio?')}>
                <Lightbulb size={14} /> Técnicas de estudio
              </SuggestionButton>
              <SuggestionButton onClick={() => handleSend('¿Qué curso me recomiendas empezar?')}>
                <BookOpen size={14} /> Recomendaciones
              </SuggestionButton>
            </SuggestionButtons>
          </WelcomeMessage>
        )}

        {messages.map((message) => (
          <ChatMessage
            key={message.id}
            role={message.role}
            content={message.content}
            timestamp={message.timestamp}
          />
        ))}

        {showTypingIndicator && <ChatMessage role="assistant" content="" isLoading />}

        {error && (
          <ErrorBanner role="alert">
            <AlertCircle size={18} />
            <ErrorText>{error.message}</ErrorText>
            {lastMessage && <RetryButton onClick={handleRetry}>Reintentar</RetryButton>}
          </ErrorBanner>
        )}

        <div ref={messagesEndRef} />
      </MessagesContainer>

      <ChatInput
        onSend={handleSend}
        disabled={isBusy}
        placeholder="Escribe tu pregunta..."
      />
    </Container>
  );
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: calc(100vh - 48px);
  background: var(--color-background);
  border-radius: var(--radius-lg);
  overflow: hidden;
`;

const ChatHeader = styled.header`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-md) var(--spacing-lg);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
`;

const HeaderTitle = styled.div`
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);

  h2 {
    font-size: 16px;
    font-weight: 600;
  }
`;

const HeaderIcon = styled.span`
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-primary);
`;

const HeaderSubtitle = styled.p`
  font-size: 13px;
  color: var(--color-text-secondary);
`;

const NewChatButton = styled.button`
  padding: var(--spacing-sm) var(--spacing-md);
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  font-size: 13px;
  transition: all 0.2s ease;

  &:hover {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }
`;

const MessagesContainer = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: var(--spacing-lg);
`;

const WelcomeMessage = styled.div`
  text-align: center;
  max-width: 400px;
  margin: var(--spacing-xl) auto;
`;

const WelcomeIcon = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: var(--spacing-md);
  color: var(--color-primary);
`;

const WelcomeTitle = styled.h3`
  font-size: 20px;
  font-weight: 600;
  margin-bottom: var(--spacing-sm);
`;

const WelcomeText = styled.div`
  color: var(--color-text-secondary);
  font-size: 14px;
  margin-bottom: var(--spacing-lg);

  ul {
    text-align: left;
    margin-top: var(--spacing-sm);
    padding-left: var(--spacing-lg);
  }

  li {
    margin-bottom: var(--spacing-xs);
  }
`;

const SuggestionButtons = styled.div`
  display: flex;
  gap: var(--spacing-sm);
  justify-content: center;
  flex-wrap: wrap;
`;

const SuggestionButton = styled.button`
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  font-size: 13px;
  color: var(--color-text-primary);
  transition: all 0.2s ease;

  &:hover {
    background: var(--color-primary);
    color: white;
    border-color: var(--color-primary);
  }
`;

const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
`;

const StreamingToggle = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: var(--spacing-xs) var(--spacing-sm);
  border-radius: var(--radius-full);
  font-size: 12px;
  border: 1px solid ${(props) => (props.$active ? 'var(--color-primary)' : 'var(--color-border)')};
  background: ${(props) => (props.$active ? 'var(--color-primary)' : 'transparent')};
  color: ${(props) => (props.$active ? 'white' : 'var(--color-text-secondary)')};
  transition: all 0.2s ease;
`;

const IconButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  background: transparent;
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  transition: all 0.2s ease;

  &:hover {
    border-color: var(--color-error);
    color: var(--color-error);
  }
`;

const HistoryNotice = styled.div`
  text-align: center;
  padding: var(--spacing-md);
  color: var(--color-text-secondary);
  font-size: 13px;
`;

const ErrorBanner = styled.div`
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  margin-top: var(--spacing-md);
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid var(--color-error);
  border-radius: var(--radius-md);
  color: var(--color-error);
`;

const ErrorText = styled.span`
  flex: 1;
  font-size: 13px;
`;

const RetryButton = styled.button`
  padding: var(--spacing-xs) var(--spacing-sm);
  background: var(--color-error);
  color: white;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 500;
`;
