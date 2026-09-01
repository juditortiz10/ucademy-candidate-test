import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { Chat } from './Chat';
import { api, StreamHandlers } from '../services/api';

// Mock del servicio API
// El runner de este proyecto es vitest (apps/web/project.json -> @nx/vite:test),
// por eso se usa `vi` en lugar de `jest`.
vi.mock('../services/api', () => ({
  api: {
    sendChatMessage: vi.fn(),
    startNewConversation: vi.fn(),
    getChatHistory: vi.fn(),
    deleteChatHistory: vi.fn(),
    streamChatMessage: vi.fn(),
  },
}));

const mocked = <T,>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

const emptyHistory = {
  conversation: null,
  messages: [],
  pagination: { page: 1, limit: 100, total: 0, totalPages: 0, hasMore: false },
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

/** Espera a que termine la carga inicial del historial */
const renderChat = async () => {
  const result = renderWithProviders(<Chat studentId="507f1f77bcf86cd799439011" />);
  await waitFor(() => {
    expect(screen.queryByText('Cargando conversación...')).not.toBeInTheDocument();
  });
  return result;
};

/** Desactiva el streaming para probar el camino de respuesta completa */
const disableStreaming = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: /streaming/i }));
};

describe('Chat', () => {
  beforeEach(() => {
    mocked(api.getChatHistory).mockResolvedValue(emptyHistory);
    mocked(api.sendChatMessage).mockResolvedValue({
      conversationId: 'conv-123',
      userMessage: { _id: 'msg-1', content: 'Test', role: 'user' },
      assistantMessage: {
        _id: 'msg-2',
        content: 'Response',
        role: 'assistant',
        createdAt: new Date().toISOString(),
      },
    });
    mocked(api.streamChatMessage).mockImplementation(
      (_data: unknown, handlers: StreamHandlers) => {
        handlers.onStart?.('conv-123');
        handlers.onToken('Hola');
        handlers.onToken(' María');
        handlers.onDone?.({ conversationId: 'conv-123', messageId: 'msg-2', content: 'Hola María' });
        return () => undefined;
      }
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * ✅ TEST QUE PASA - Verifica renderizado inicial
   */
  it('should render welcome message when no messages', async () => {
    await renderChat();

    expect(
      screen.getByText(/¡Hola! Soy tu asistente de estudios/)
    ).toBeInTheDocument();
  });

  /**
   * ✅ TEST QUE PASA - Verifica header del chat
   */
  it('should render chat header', async () => {
    await renderChat();

    expect(screen.getByText('Asistente de Estudios')).toBeInTheDocument();
    expect(screen.getByText('+ Nueva conversación')).toBeInTheDocument();
  });

  describe('Message sending', () => {
    it('should send message when clicking send button', async () => {
      const user = userEvent.setup();
      await renderChat();
      await disableStreaming(user);

      await user.type(screen.getByRole('textbox'), '¿Qué es un closure?');
      await user.click(screen.getByRole('button', { name: /enviar mensaje/i }));

      await waitFor(() => {
        expect(api.sendChatMessage).toHaveBeenCalledWith(
          expect.objectContaining({ message: '¿Qué es un closure?' })
        );
      });
    });

    it('should send message when pressing Enter', async () => {
      const user = userEvent.setup();
      await renderChat();
      await disableStreaming(user);

      await user.type(screen.getByRole('textbox'), 'Hola{Enter}');

      await waitFor(() => {
        expect(api.sendChatMessage).toHaveBeenCalledWith(
          expect.objectContaining({ message: 'Hola' })
        );
      });
    });

    it('should insert a newline with Shift+Enter instead of sending', async () => {
      const user = userEvent.setup();
      await renderChat();

      const textbox = screen.getByRole('textbox');
      await user.type(textbox, 'Primera{Shift>}{Enter}{/Shift}Segunda');

      expect(api.sendChatMessage).not.toHaveBeenCalled();
      expect(api.streamChatMessage).not.toHaveBeenCalled();
      expect(textbox).toHaveValue('Primera\nSegunda');
    });

    it('should show user message immediately (optimistic update)', async () => {
      const user = userEvent.setup();
      // La respuesta nunca llega: solo debe verse el mensaje del usuario.
      mocked(api.sendChatMessage).mockImplementation(() => new Promise(() => undefined));

      await renderChat();
      await disableStreaming(user);
      await user.type(screen.getByRole('textbox'), 'Mi pregunta{Enter}');

      expect(await screen.findByText('Mi pregunta')).toBeInTheDocument();
      expect(screen.queryByText('Response')).not.toBeInTheDocument();
    });

    it('should show assistant response after API call', async () => {
      const user = userEvent.setup();
      await renderChat();
      await disableStreaming(user);

      await user.type(screen.getByRole('textbox'), 'Hola{Enter}');

      expect(await screen.findByText('Response')).toBeInTheDocument();
    });

    it('should disable input while sending', async () => {
      const user = userEvent.setup();
      mocked(api.sendChatMessage).mockImplementation(() => new Promise(() => undefined));

      await renderChat();
      await disableStreaming(user);
      await user.type(screen.getByRole('textbox'), 'Hola{Enter}');

      await waitFor(() => {
        expect(screen.getByRole('textbox')).toBeDisabled();
      });
      expect(screen.getByRole('button', { name: /enviando mensaje/i })).toBeDisabled();
    });

    it('should show typing indicator while waiting for response', async () => {
      const user = userEvent.setup();
      mocked(api.sendChatMessage).mockImplementation(() => new Promise(() => undefined));

      await renderChat();
      await disableStreaming(user);
      await user.type(screen.getByRole('textbox'), 'Hola{Enter}');

      expect(
        await screen.findByLabelText('El asistente está escribiendo')
      ).toBeInTheDocument();
    });

    it('should clear the input after sending', async () => {
      const user = userEvent.setup();
      await renderChat();

      const textbox = screen.getByRole('textbox');
      await user.type(textbox, 'Hola{Enter}');

      await waitFor(() => expect(textbox).toHaveValue(''));
    });
  });

  describe('Streaming', () => {
    it('should display tokens as they arrive', async () => {
      const user = userEvent.setup();
      let emit: StreamHandlers | null = null;
      mocked(api.streamChatMessage).mockImplementation((_data: unknown, handlers: StreamHandlers) => {
        emit = handlers;
        return () => undefined;
      });

      await renderChat();
      await user.type(screen.getByRole('textbox'), 'Hola{Enter}');

      await waitFor(() => expect(api.streamChatMessage).toHaveBeenCalled());

      // Los tokens llegan fuera del ciclo de React: se envuelven en act()
      // para que el re-render quede aplicado antes de aserciones.
      act(() => emit!.onToken('Hola'));
      expect(await screen.findByText('Hola', { selector: 'p' })).toBeInTheDocument();

      act(() => emit!.onToken(' María'));
      expect(await screen.findByText('Hola María', { selector: 'p' })).toBeInTheDocument();
    });

    it('should complete message when stream ends', async () => {
      const user = userEvent.setup();
      await renderChat();

      await user.type(screen.getByRole('textbox'), 'Hola{Enter}');

      expect(await screen.findByText('Hola María')).toBeInTheDocument();
      // Cerrado el stream, el input vuelve a estar disponible.
      await waitFor(() => expect(screen.getByRole('textbox')).not.toBeDisabled());
    });

    it('should handle stream errors gracefully', async () => {
      const user = userEvent.setup();
      mocked(api.streamChatMessage).mockImplementation((_data: unknown, handlers: StreamHandlers) => {
        handlers.onError?.(new Error('Se perdió la conexión con el asistente'));
        return () => undefined;
      });

      await renderChat();
      await user.type(screen.getByRole('textbox'), 'Hola{Enter}');

      const alert = await screen.findByRole('alert');
      expect(within(alert).getByText('Se perdió la conexión con el asistente')).toBeInTheDocument();
    });
  });

  describe('Conversation management', () => {
    it('should start new conversation when button clicked', async () => {
      const user = userEvent.setup();
      mocked(api.startNewConversation).mockResolvedValue({ _id: 'conv-nueva' });

      await renderChat();
      await user.click(screen.getByText('+ Nueva conversación'));

      await waitFor(() => {
        expect(api.startNewConversation).toHaveBeenCalledWith('507f1f77bcf86cd799439011');
      });
    });

    it('should clear messages when starting new conversation', async () => {
      const user = userEvent.setup();
      mocked(api.startNewConversation).mockResolvedValue({ _id: 'conv-nueva' });

      await renderChat();
      await user.type(screen.getByRole('textbox'), 'Hola{Enter}');
      expect(await screen.findByText('Hola María')).toBeInTheDocument();

      await user.click(screen.getByText('+ Nueva conversación'));

      await waitFor(() => {
        expect(screen.queryByText('Hola María')).not.toBeInTheDocument();
      });
      // Vuelve la pantalla de bienvenida
      expect(screen.getByText(/¡Hola! Soy tu asistente de estudios/)).toBeInTheDocument();
    });

    it('should load history for existing conversation', async () => {
      mocked(api.getChatHistory).mockResolvedValue({
        conversation: { _id: 'conv-123', title: 'Dudas sobre React', messageCount: 2 },
        messages: [
          {
            _id: 'm1',
            conversationId: 'conv-123',
            role: 'user',
            content: '¿Qué es useState?',
            createdAt: new Date().toISOString(),
          },
          {
            _id: 'm2',
            conversationId: 'conv-123',
            role: 'assistant',
            content: 'Es un hook de estado',
            createdAt: new Date().toISOString(),
          },
        ],
        pagination: { page: 1, limit: 100, total: 2, totalPages: 1, hasMore: false },
      });

      await renderChat();

      expect(await screen.findByText('¿Qué es useState?')).toBeInTheDocument();
      expect(screen.getByText('Es un hook de estado')).toBeInTheDocument();
      // Con historial cargado no debe mostrarse la bienvenida
      expect(screen.queryByText(/¡Hola! Soy tu asistente de estudios/)).not.toBeInTheDocument();
    });

    it('should hide system messages coming from the history', async () => {
      mocked(api.getChatHistory).mockResolvedValue({
        conversation: { _id: 'conv-123', title: 'Chat', messageCount: 1 },
        messages: [
          {
            _id: 'm0',
            conversationId: 'conv-123',
            role: 'system',
            content: 'Contexto interno del asistente',
            createdAt: new Date().toISOString(),
          },
        ],
        pagination: { page: 1, limit: 100, total: 1, totalPages: 1, hasMore: false },
      });

      await renderChat();

      expect(screen.queryByText('Contexto interno del asistente')).not.toBeInTheDocument();
    });

    it('should delete the conversation when clicking the trash button', async () => {
      const user = userEvent.setup();
      mocked(api.deleteChatHistory).mockResolvedValue(undefined);

      await renderChat();
      await user.type(screen.getByRole('textbox'), 'Hola{Enter}');
      expect(await screen.findByText('Hola María')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /eliminar esta conversación/i }));

      await waitFor(() => {
        expect(api.deleteChatHistory).toHaveBeenCalledWith('507f1f77bcf86cd799439011', 'conv-123');
      });
      expect(screen.queryByText('Hola María')).not.toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should be keyboard navigable', async () => {
      const user = userEvent.setup();
      await renderChat();

      const textbox = screen.getByRole('textbox');

      // Se puede llegar al campo de texto tabulando, sin usar el ratón.
      for (let i = 0; i < 10 && document.activeElement !== textbox; i++) {
        await user.tab();
      }

      expect(textbox).toHaveFocus();

      await user.keyboard('Pregunta por teclado');
      expect(textbox).toHaveValue('Pregunta por teclado');
    });

    it('should have proper aria labels', async () => {
      await renderChat();

      expect(screen.getByLabelText('Mensaje para el asistente')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /enviar mensaje/i })).toBeInTheDocument();
      expect(screen.getByRole('log', { name: /historial de la conversación/i })).toBeInTheDocument();
    });

    it('should announce new messages to screen readers', async () => {
      const user = userEvent.setup();
      await renderChat();

      const log = screen.getByRole('log');
      // La región es "polite": los mensajes nuevos se anuncian sin interrumpir.
      expect(log).toHaveAttribute('aria-live', 'polite');

      await user.type(screen.getByRole('textbox'), 'Hola{Enter}');

      await waitFor(() => {
        expect(within(log).getByText('Hola María')).toBeInTheDocument();
      });
    });
  });

  describe('Error handling', () => {
    it('should show error message when API fails', async () => {
      const user = userEvent.setup();
      mocked(api.sendChatMessage).mockRejectedValue(new Error('El asistente no está disponible'));

      await renderChat();
      await disableStreaming(user);
      await user.type(screen.getByRole('textbox'), 'Hola{Enter}');

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'El asistente no está disponible'
      );
    });

    it('should allow retry after error', async () => {
      const user = userEvent.setup();
      mocked(api.sendChatMessage).mockRejectedValueOnce(new Error('Fallo temporal'));

      await renderChat();
      await disableStreaming(user);
      await user.type(screen.getByRole('textbox'), 'Hola{Enter}');

      const retry = await screen.findByRole('button', { name: /reintentar/i });
      await user.click(retry);

      // El segundo intento reutiliza el último mensaje enviado.
      await waitFor(() => {
        expect(api.sendChatMessage).toHaveBeenCalledTimes(2);
      });
      expect(await screen.findByText('Response')).toBeInTheDocument();
    });

    it('should remove the optimistic message when sending fails', async () => {
      const user = userEvent.setup();
      mocked(api.sendChatMessage).mockRejectedValue(new Error('Fallo'));

      await renderChat();
      await disableStreaming(user);
      await user.type(screen.getByRole('textbox'), 'Mensaje perdido{Enter}');

      await screen.findByRole('alert');
      // No debe quedar un mensaje del usuario sin respuesta en el hilo.
      expect(screen.queryByText('Mensaje perdido')).not.toBeInTheDocument();
    });

    it('should handle network disconnection during history load', async () => {
      mocked(api.getChatHistory).mockRejectedValue(new Error('Error de conexión'));

      await renderChat();

      expect(await screen.findByRole('alert')).toHaveTextContent('Error de conexión');
    });
  });
});
