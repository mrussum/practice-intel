import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App, meQuery } from "./App";
import { RequestError } from "./lib/api";
import "./index.css";

const queryClient: QueryClient = new QueryClient({
  // Any 401 means the session expired or was revoked: show the login screen.
  queryCache: new QueryCache({
    onError: (err) => {
      if (err instanceof RequestError && err.status === 401) queryClient.setQueryData(meQuery.queryKey, null);
    },
  }),
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // Retrying a 401 can't succeed.
      retry: (count, err) => !(err instanceof RequestError && err.status === 401) && count < 1,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
