import { useState, useEffect } from 'react';
import { API_STATUS_EVENT, getApiStatus, type ApiStatusUpdate } from '../api/status';

interface NetworkStatus {
  isOnline: boolean;
  wasOffline: boolean;
  apiStatus: ApiStatusUpdate | null;
}

export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [wasOffline, setWasOffline] = useState(false);
  const [apiStatus, setApiStatus] = useState<ApiStatusUpdate | null>(getApiStatus);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setWasOffline(true);
    };
    const handleApiStatus = () => setApiStatus(getApiStatus());

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener(API_STATUS_EVENT, handleApiStatus);

    // If already offline when hook mounts, track it
    if (!navigator.onLine) {
      setWasOffline(true);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener(API_STATUS_EVENT, handleApiStatus);
    };
  }, []);

  return { isOnline, wasOffline, apiStatus };
}
