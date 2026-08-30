import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App.js";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Supabase Realtime is the production transport for the live Agent
      // Timeline (§7, §12); this build polls instead — same tradeoff the
      // architecture doc explicitly allows ("or a simple short-interval
      // poll if Realtime is flaky under demo conditions").
      refetchInterval: 5000,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
