import type { ConnectionStatus } from './types';

export function getConnectionDisplay(status: ConnectionStatus) {
  switch (status) {
    case 'connected':
      return { color: 'green', text: 'Connected to Cloud' };
    case 'connecting':
      return { color: 'yellow', text: 'Connecting...' };
    case 'not_authenticated':
      return { color: 'yellow', text: 'Not Authenticated' };
    case 'disconnected':
      return { color: 'red', text: 'Disconnected' };
    default:
      return { color: 'red', text: 'Error' };
  }
}
