import { Toaster as Sonner, toast } from "sonner";

/**
 * shadcn-style sonner wrapper, RAINCHECK dark theme.
 * Used for tx feedback (pending → mined) per design law §6.
 * Persistent in-page callouts (errors that must stay visible) stay as
 * in-page panels — never toasts.
 */
function Toaster(props: React.ComponentProps<typeof Sonner>) {
  return (
    <Sonner
      theme="dark"
      position="bottom-right"
      toastOptions={{
        style: {
          background: "#0B1220",
          color: "#F4FEFF",
          border: "1px solid rgba(53, 224, 255, 0.25)",
        },
      }}
      {...props}
    />
  );
}

export { Toaster, toast };
