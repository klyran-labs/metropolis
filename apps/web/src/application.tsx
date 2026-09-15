import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { IdentityStateProvider } from "./identity";
import { router } from "./router";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, refetchOnWindowFocus: false },
  },
});

export default function Application() {
  return (
    <QueryClientProvider client={queryClient}>
      <IdentityStateProvider>
        <RouterProvider router={router} />
      </IdentityStateProvider>
    </QueryClientProvider>
  );
}
