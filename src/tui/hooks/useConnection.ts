import { useState, useEffect, useCallback } from "react";
import { verifyApiKey } from "../../api.js";
import { getApiKey, getEnvironment } from "../../config.js";
import type { ConnectionStatus } from "../types.js";

interface UseConnectionResult {
  status: ConnectionStatus;
  environment: "prod" | "local";
  error: string | null;
  retry: () => void;
}

export function useConnection(): UseConnectionResult {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const environment = getEnvironment();

  const connect = useCallback(async () => {
    setStatus("connecting");
    setError(null);

    const apiKey = getApiKey();
    if (!apiKey) {
      setStatus("error");
      setError("Not authenticated. Run: mindstudio-local auth");
      return;
    }

    try {
      const isValid = await verifyApiKey();
      if (isValid) {
        setStatus("connected");
      } else {
        setStatus("error");
        setError("Invalid API key. Run: mindstudio-local auth");
      }
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Connection failed");
    }
  }, []);

  useEffect(() => {
    connect();
  }, [connect]);

  return {
    status,
    environment,
    error,
    retry: connect,
  };
}
