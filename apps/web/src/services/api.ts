import axios from 'axios';

const apiClient = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface ChatHistoryMessage {
  _id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt?: string;
  metadata?: { tokensUsed?: number; model?: string; responseTime?: number };
}

export interface ChatHistoryResponse {
  conversation: { _id: string; title: string; messageCount: number } | null;
  messages: ChatHistoryMessage[];
  pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean };
}

export interface StreamHandlers {
  onStart?: (conversationId: string) => void;
  onToken: (token: string) => void;
  onDone?: (payload: { conversationId: string; messageId: string; content: string }) => void;
  onError?: (error: Error) => void;
}

export const api = {
  // === Student Endpoints ===

  getDashboard: async (studentId: string) => {
    const response = await apiClient.get(`/students/${studentId}/dashboard`);
    return response.data;
  },

  getCourses: async (studentId: string) => {
    const response = await apiClient.get(`/students/${studentId}/courses`);
    return response.data;
  },

  getStats: async (studentId: string) => {
    const response = await apiClient.get(`/students/${studentId}/stats`);
    return response.data;
  },

  updatePreferences: async (studentId: string, preferences: Record<string, unknown>) => {
    const response = await apiClient.patch(`/students/${studentId}/preferences`, preferences);
    return response.data;
  },

  // === Chat Endpoints ===

  sendChatMessage: async (data: {
    studentId: string;
    message: string;
    conversationId?: string;
  }) => {
    const response = await apiClient.post('/chat/message', data);
    return response.data;
  },

  startNewConversation: async (studentId: string, initialContext?: string) => {
    const response = await apiClient.post('/chat/conversation/new', {
      studentId,
      initialContext,
    });
    return response.data;
  },

  getConversations: async (studentId: string) => {
    const response = await apiClient.get(`/chat/conversations/${studentId}`);
    return response.data;
  },

  getChatHistory: async (
    studentId: string,
    conversationId?: string,
    params: { page?: number; limit?: number } = {}
  ): Promise<ChatHistoryResponse> => {
    const response = await apiClient.get(`/chat/history/${studentId}`, {
      params: { ...(conversationId ? { conversationId } : {}), ...params },
    });
    return response.data;
  },

  deleteChatHistory: async (studentId: string, conversationId: string) => {
    const response = await apiClient.delete(`/chat/history/${studentId}/${conversationId}`);
    return response.data;
  },

  /**
   * Envía un mensaje y consume la respuesta token a token vía SSE.
   *
   * Se usa `EventSource` (solo GET, de ahí los query params) porque el flujo
   * es unidireccional servidor→cliente. Devuelve una función para cancelar.
   */
  streamChatMessage: (
    data: { studentId: string; message: string; conversationId?: string },
    handlers: StreamHandlers
  ): (() => void) => {
    const params = new URLSearchParams({
      studentId: data.studentId,
      message: data.message,
      ...(data.conversationId ? { conversationId: data.conversationId } : {}),
    });

    const source = new EventSource(`/api/chat/message/stream?${params.toString()}`);
    let finished = false;

    const close = () => {
      finished = true;
      source.close();
    };

    source.onmessage = (event) => {
      const payload = JSON.parse(event.data);

      switch (payload.type) {
        case 'start':
          handlers.onStart?.(payload.conversationId);
          break;
        case 'token':
          handlers.onToken(payload.content);
          break;
        case 'done':
          handlers.onDone?.(payload);
          close();
          break;
        case 'error':
          handlers.onError?.(new Error(payload.message));
          close();
          break;
      }
    };

    // `EventSource` reintenta al cerrarse la conexión; si el stream ya terminó
    // correctamente, cerrar aquí evita que se reabra y reenvíe el mensaje.
    source.onerror = () => {
      if (finished) return;
      handlers.onError?.(new Error('Se perdió la conexión con el asistente'));
      close();
    };

    return close;
  },
};

// Interceptor para manejo de errores
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const data = error.response?.data;

    // Nest devuelve `message` como string o como array de errores de validación.
    const message = Array.isArray(data?.message)
      ? data.message.join('. ')
      : data?.message || error.message || 'Error de conexión';

    console.error('API Error:', message);

    const normalized = new Error(message) as Error & { statusCode?: number };
    normalized.statusCode = error.response?.status;

    return Promise.reject(normalized);
  }
);
