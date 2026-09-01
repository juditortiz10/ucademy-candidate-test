import { useState, useCallback, useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, ChatHistoryMessage } from '../services/api';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface UseChatOptions {
  studentId: string;
  onError?: (error: Error) => void;
  /** Carga automáticamente la última conversación al montar */
  autoLoadHistory?: boolean;
}

/** Adapta un mensaje persistido al modelo que renderiza la UI */
const toMessage = (message: ChatHistoryMessage): Message => ({
  id: message._id,
  role: message.role === 'assistant' ? 'assistant' : 'user',
  content: message.content,
  timestamp: message.createdAt ? new Date(message.createdAt) : new Date(),
});

export function useChat({ studentId, onError, autoLoadHistory = true }: UseChatOptions) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(autoLoadHistory);
  const [error, setError] = useState<Error | null>(null);

  /** Cancela el stream en vuelo si el componente se desmonta */
  const cancelStreamRef = useRef<(() => void) | null>(null);

  const reportError = useCallback(
    (err: Error) => {
      setError(err);
      onError?.(err);
    },
    [onError]
  );

  // Mutation para enviar mensajes
  const sendMutation = useMutation({
    mutationFn: async (message: string) => {
      return api.sendChatMessage({
        studentId,
        message,
        conversationId: conversationId || undefined,
      });
    },
    onMutate: async (message) => {
      setError(null);

      // Optimistic update
      const tempId = `temp-${Date.now()}`;
      const userMessage: Message = {
        id: tempId,
        role: 'user',
        content: message,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMessage]);
      return { tempId };
    },
    onSuccess: (data) => {
      // Actualizar conversationId si es nueva
      if (data.conversationId) {
        setConversationId(data.conversationId);
      }

      const assistantMessage: Message = {
        id: data.assistantMessage._id,
        role: 'assistant',
        content: data.assistantMessage.content,
        timestamp: new Date(data.assistantMessage.createdAt ?? Date.now()),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    },
    onError: (err: Error, _message, context) => {
      // Se retira el mensaje optimista para que el usuario pueda reintentar
      // sin verlo duplicado.
      setMessages((prev) => prev.filter((message) => message.id !== context?.tempId));
      reportError(err);
    },
  });

  /**
   * Envía el mensaje y va pintando la respuesta token a token.
   */
  const sendWithStreaming = useCallback(
    (message: string) => {
      setError(null);

      const userMessage: Message = {
        id: `temp-${Date.now()}`,
        role: 'user',
        content: message,
        timestamp: new Date(),
      };

      // Burbuja vacía del asistente que se va rellenando con cada token.
      const streamingId = `streaming-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        userMessage,
        { id: streamingId, role: 'assistant', content: '', timestamp: new Date() },
      ]);
      setIsStreaming(true);

      cancelStreamRef.current = api.streamChatMessage(
        { studentId, message, conversationId: conversationId || undefined },
        {
          onStart: (newConversationId) => setConversationId(newConversationId),
          onToken: (token) => {
            setMessages((prev) =>
              prev.map((item) =>
                item.id === streamingId ? { ...item, content: item.content + token } : item
              )
            );
          },
          onDone: ({ messageId, content }) => {
            setMessages((prev) =>
              prev.map((item) => (item.id === streamingId ? { ...item, id: messageId, content } : item))
            );
            setIsStreaming(false);
            cancelStreamRef.current = null;
          },
          onError: (err) => {
            // Se retiran las dos burbujas provisionales del intento fallido.
            setMessages((prev) =>
              prev.filter((item) => item.id !== streamingId && item.id !== userMessage.id)
            );
            setIsStreaming(false);
            cancelStreamRef.current = null;
            reportError(err);
          },
        }
      );
    },
    [studentId, conversationId, reportError]
  );

  const startNewConversation = useCallback(async () => {
    try {
      setError(null);
      const result = await api.startNewConversation(studentId);
      setConversationId(result._id);
      setMessages([]);
      return result;
    } catch (err) {
      reportError(err as Error);
    }
  }, [studentId, reportError]);

  /**
   * Carga el historial desde el backend. Sin `conversationId` el backend
   * devuelve la conversación más reciente del estudiante.
   */
  const loadHistory = useCallback(
    async (targetConversationId?: string) => {
      setIsLoadingHistory(true);
      setError(null);

      try {
        const history = await api.getChatHistory(
          studentId,
          targetConversationId ?? conversationId ?? undefined,
          { limit: 100 }
        );

        setMessages(history.messages.filter((m) => m.role !== 'system').map(toMessage));
        setConversationId(history.conversation?._id ?? null);

        return history;
      } catch (err) {
        reportError(err as Error);
      } finally {
        setIsLoadingHistory(false);
      }
    },
    [studentId, conversationId, reportError]
  );

  const deleteConversation = useCallback(async () => {
    if (!conversationId) return;

    try {
      await api.deleteChatHistory(studentId, conversationId);
      setConversationId(null);
      setMessages([]);
    } catch (err) {
      reportError(err as Error);
    }
  }, [studentId, conversationId, reportError]);

  // Carga inicial del historial (una sola vez por estudiante).
  useEffect(() => {
    if (!autoLoadHistory) return;

    let active = true;

    api
      .getChatHistory(studentId, undefined, { limit: 100 })
      .then((history) => {
        if (!active) return;
        setMessages(history.messages.filter((m) => m.role !== 'system').map(toMessage));
        setConversationId(history.conversation?._id ?? null);
      })
      .catch((err) => {
        if (active) reportError(err as Error);
      })
      .finally(() => {
        if (active) setIsLoadingHistory(false);
      });

    return () => {
      active = false;
    };
    // Solo debe reejecutarse si cambia el estudiante.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, autoLoadHistory]);

  // Cierra el EventSource si el componente se desmonta a mitad del stream.
  useEffect(() => () => cancelStreamRef.current?.(), []);

  return {
    messages,
    conversationId,
    isLoading: sendMutation.isPending,
    isStreaming,
    isLoadingHistory,
    error: error ?? sendMutation.error,
    sendMessage: sendMutation.mutate,
    sendWithStreaming,
    startNewConversation,
    loadHistory,
    deleteConversation,
    clearMessages: () => setMessages([]),
    clearError: () => setError(null),
  };
}
