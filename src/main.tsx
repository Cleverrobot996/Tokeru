import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { ThemeProvider } from "./lib/theme";
import { restoreCustomFont } from "./lib/paper";
import "katex/dist/katex.min.css";
import "./styles/app.css";
import "./styles/home.css";
import "./styles/bank.css";
import "./styles/exam.css";
import "./styles/import.css";
import "./styles/organize.css";

void restoreCustomFont();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 10_000 },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <HashRouter>
        <App />
      </HashRouter>
    </ThemeProvider>
  </QueryClientProvider>,
);